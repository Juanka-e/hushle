import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import { prisma } from "@hushle/platform-db";
import {
    confirmEmailChange,
    createSmtpEmailProvider,
    enqueueEmailChange,
    enqueuePasswordReset,
    processEmailOutbox,
    resetPasswordWithToken,
    type TransactionalEmailMessage,
} from "@hushle/platform-email";

if (process.env.ACCOUNT_RECOVERY_INTEGRATION !== "true") {
    console.log(
        "account recovery integration skipped; set ACCOUNT_RECOVERY_INTEGRATION=true"
    );
    process.exit(0);
}

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Integration test requires a local database");
}

const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
const username = `recovery_${suffix}`;
const oldEmail = `${username}@example.test`;
const newEmail = `${username}_new@example.test`;
const outboxIds: string[] = [];
const sentMessages: TransactionalEmailMessage[] = [];
const env = {
    EMAIL_PROVIDER: "smtp",
    EMAIL_FROM: "Hushle <no-reply@example.test>",
    EMAIL_TOKEN_SECRET: "account_recovery_integration_secret_is_long_enough",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3201",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1025",
    SMTP_SECURE: "false",
};
const smtpProvider = createSmtpEmailProvider(env);

function tokenFromMessage(message: TransactionalEmailMessage, path: string) {
    const match = message.text.match(
        new RegExp(`${path.replaceAll("/", "\\/")}\\?token=([^\\s]+)`)
    );
    assert.ok(match?.[1], `Token URL for ${path} was not found`);
    return decodeURIComponent(match[1]);
}

async function deliverPending() {
    return processEmailOutbox({
        env,
        batchSize: 20,
        provider: {
            async send(message) {
                sentMessages.push(message);
                await smtpProvider.send(message);
            },
        },
    });
}

async function main() {
    const initialPassword = await bcryptjs.hash("Initial-Password-447!", 10);
    const user = await prisma.user.create({
        data: {
            username,
            email: oldEmail,
            normalizedEmail: oldEmail,
            emailVerifiedAt: new Date(),
            password: initialPassword,
            sessionVersion: 2,
        },
    });

    try {
        const mobileSession = await prisma.mobileAuthSession.create({
            data: {
                userId: user.id,
                deviceName: "integration-device",
                refreshExpiresAt: new Date(Date.now() + 86_400_000),
                tokens: {
                    create: {
                        kind: "refresh",
                        tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
                        expiresAt: new Date(Date.now() + 86_400_000),
                    },
                },
            },
        });
        const reset = await prisma.$transaction((tx) =>
            enqueuePasswordReset(tx, {
                userId: user.id,
                email: oldEmail,
                siteName: "Hushle",
                env,
            })
        );
        outboxIds.push(reset.outboxId);
        const resetOutbox =
            await prisma.emailOutboxMessage.findUniqueOrThrow({
                where: { id: reset.outboxId },
            });
        assert.equal(
            JSON.stringify(resetOutbox.payload).includes("password-reset:"),
            false
        );
        assert.equal((await deliverPending()).sent, 1);
        const resetToken = tokenFromMessage(
            sentMessages.at(-1)!,
            "/reset-password"
        );
        assert.equal(
            JSON.stringify(resetOutbox.payload).includes(resetToken),
            false
        );

        const nextPassword = "Replacement-Password-884!";
        const resetResult = await resetPasswordWithToken({
            token: resetToken,
            passwordHash: await bcryptjs.hash(nextPassword, 10),
            siteName: "Hushle",
        });
        assert.deepEqual(resetResult, { ok: true, userId: user.id });
        assert.equal(
            (
                await resetPasswordWithToken({
                    token: resetToken,
                    passwordHash: await bcryptjs.hash("Unused-Password-991!", 10),
                    siteName: "Hushle",
                })
            ).ok,
            false
        );
        const afterReset = await prisma.user.findUniqueOrThrow({
            where: { id: user.id },
            select: { password: true, sessionVersion: true },
        });
        assert.equal(afterReset.sessionVersion, 3);
        assert.ok(afterReset.password);
        assert.equal(await bcryptjs.compare(nextPassword, afterReset.password), true);
        assert.ok(
            (
                await prisma.mobileAuthSession.findUniqueOrThrow({
                    where: { id: mobileSession.id },
                })
            ).revokedAt
        );

        const activeAfterReset = await prisma.mobileAuthSession.create({
            data: {
                userId: user.id,
                deviceName: "second-device",
                refreshExpiresAt: new Date(Date.now() + 86_400_000),
            },
        });
        const change = await prisma.$transaction((tx) =>
            enqueueEmailChange(tx, {
                userId: user.id,
                currentEmail: oldEmail,
                newEmail,
                normalizedNewEmail: newEmail,
                siteName: "Hushle",
                env,
            })
        );
        outboxIds.push(change.outboxId);
        const changeDelivery = await deliverPending();
        assert.ok(changeDelivery.sent >= 2);
        const verificationMessage = sentMessages.find((message) =>
            message.text.includes("/verify-email-change?token=")
        );
        assert.ok(verificationMessage);
        const changeToken = tokenFromMessage(
            verificationMessage,
            "/verify-email-change"
        );
        const changeResult = await confirmEmailChange({
            token: changeToken,
            siteName: "Hushle",
        });
        assert.deepEqual(changeResult, { ok: true, userId: user.id });
        assert.equal(
            (await confirmEmailChange({
                token: changeToken,
                siteName: "Hushle",
            })).ok,
            false
        );
        const afterChange = await prisma.user.findUniqueOrThrow({
            where: { id: user.id },
            select: {
                email: true,
                normalizedEmail: true,
                emailVerifiedAt: true,
                pendingEmail: true,
                sessionVersion: true,
            },
        });
        assert.equal(afterChange.email, newEmail);
        assert.equal(afterChange.normalizedEmail, newEmail);
        assert.ok(afterChange.emailVerifiedAt);
        assert.equal(afterChange.pendingEmail, null);
        assert.equal(afterChange.sessionVersion, 4);
        assert.ok(
            (
                await prisma.mobileAuthSession.findUniqueOrThrow({
                    where: { id: activeAfterReset.id },
                })
            ).revokedAt
        );
    } finally {
        const messages = await prisma.emailOutboxMessage.findMany({
            where: {
                OR: [
                    { userId: user.id },
                    { recipient: { in: [oldEmail, newEmail] } },
                ],
            },
            select: { id: true },
        });
        await prisma.emailOutboxMessage.deleteMany({
            where: { id: { in: messages.map((message) => message.id) } },
        });
        await prisma.user.delete({ where: { id: user.id } }).catch(() => null);
    }
    console.log("account recovery integration test passed");
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await smtpProvider.close?.();
        await prisma.$disconnect();
    });
