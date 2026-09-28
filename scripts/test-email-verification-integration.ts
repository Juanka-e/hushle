import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { UserAccountStatus, prisma } from "@hushle/platform-db";
import {
    confirmEmailVerification,
    createSmtpEmailProvider,
    enqueueEmailVerification,
    processEmailOutbox,
} from "@hushle/platform-email";

if (process.env.EMAIL_VERIFICATION_INTEGRATION !== "true") {
    console.log(
        "email verification integration skipped; set EMAIL_VERIFICATION_INTEGRATION=true"
    );
    process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(databaseUrl)) {
    throw new Error("Integration test requires a local database");
}

const mailpitBaseUrl =
    process.env.MAILPIT_API_URL?.replace(/\/+$/, "") ??
    "http://127.0.0.1:8025";
const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
const username = `email_it_${suffix}`;
const email = `${username}@example.test`;
const outboxIds: string[] = [];

function collectStrings(value: unknown, output: string[] = []): string[] {
    if (typeof value === "string") output.push(value);
    else if (Array.isArray(value)) {
        for (const item of value) collectStrings(item, output);
    } else if (value && typeof value === "object") {
        for (const item of Object.values(value)) collectStrings(item, output);
    }
    return output;
}

async function readVerificationTokenFromMailpit(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const listResponse = await fetch(`${mailpitBaseUrl}/api/v1/messages`);
        assert.equal(listResponse.ok, true);
        const list = (await listResponse.json()) as {
            messages?: Array<Record<string, unknown>>;
        };
        for (const summary of list.messages ?? []) {
            if (!collectStrings(summary).some((value) => value.includes(email))) {
                continue;
            }
            const id =
                typeof summary.ID === "string"
                    ? summary.ID
                    : typeof summary.id === "string"
                      ? summary.id
                      : null;
            if (!id) continue;
            const messageResponse = await fetch(
                `${mailpitBaseUrl}/api/v1/message/${encodeURIComponent(id)}`
            );
            assert.equal(messageResponse.ok, true);
            const message = await messageResponse.json();
            for (const value of collectStrings(message)) {
                const match = value.match(
                    /verify-email\?token=([^"'&\s<>]+)/
                );
                if (match?.[1]) return decodeURIComponent(match[1]);
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Verification message was not found in Mailpit");
}

async function main(): Promise<void> {
    const env = {
        EMAIL_PROVIDER: "smtp",
        EMAIL_FROM: "Hushle <no-reply@example.test>",
        EMAIL_TOKEN_SECRET:
            "integration_email_token_secret_which_is_long_enough",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3201",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "1025",
        SMTP_SECURE: "false",
    };
    const user = await prisma.user.create({
        data: {
            username,
            email,
            normalizedEmail: email,
            password: "integration-test-only",
            accountStatus: UserAccountStatus.pending_email_verification,
            emailVerificationRequiredAt: new Date(),
        },
    });

    try {
        const first = await prisma.$transaction((tx) =>
            enqueueEmailVerification(tx, {
                userId: user.id,
                email,
                siteName: "Hushle Integration",
                env,
            })
        );
        outboxIds.push(first.outboxId);
        const second = await prisma.$transaction((tx) =>
            enqueueEmailVerification(tx, {
                userId: user.id,
                email,
                siteName: "Hushle Integration",
                env,
            })
        );
        outboxIds.push(second.outboxId);

        const [firstToken, firstOutbox] = await Promise.all([
            prisma.emailVerificationToken.findUniqueOrThrow({
                where: { id: first.tokenId },
            }),
            prisma.emailOutboxMessage.findUniqueOrThrow({
                where: { id: first.outboxId },
            }),
        ]);
        assert.ok(firstToken.revokedAt);
        assert.equal(firstOutbox.status, "dead_letter");

        const provider = createSmtpEmailProvider(env);
        const delivery = await processEmailOutbox({
            provider,
            env,
            batchSize: 10,
        }).finally(() => provider.close?.());
        assert.equal(delivery.sent, 1);
        assert.equal(delivery.retried, 0);

        const rawToken = await readVerificationTokenFromMailpit();
        const confirmed = await confirmEmailVerification({
            token: rawToken,
            env,
        });
        assert.deepEqual(confirmed, { ok: true, userId: user.id });

        const duplicate = await confirmEmailVerification({
            token: rawToken,
            env,
        });
        assert.equal(duplicate.ok, false);

        const activated = await prisma.user.findUniqueOrThrow({
            where: { id: user.id },
            select: {
                accountStatus: true,
                emailVerifiedAt: true,
            },
        });
        assert.equal(activated.accountStatus, UserAccountStatus.active);
        assert.ok(activated.emailVerifiedAt);
    } finally {
        await prisma.emailOutboxMessage.deleteMany({
            where: { id: { in: outboxIds } },
        });
        await prisma.user.deleteMany({ where: { username } });
    }

    console.log("email verification integration test passed");
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
