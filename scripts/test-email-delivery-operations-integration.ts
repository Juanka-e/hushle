import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import {
    processEmailOutbox,
    recordEmailDeliveryProviderEvent,
} from "@hushle/platform-email";

if (process.env.EMAIL_DELIVERY_OPERATIONS_INTEGRATION !== "true") {
    console.log("email delivery operations integration skipped; set EMAIL_DELIVERY_OPERATIONS_INTEGRATION=true");
    process.exit(0);
}
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Integration test requires a local database");
}

const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
const username = `email_ops_${suffix}`;
const email = `${username}@example.test`;
const env = {
    EMAIL_TOKEN_SECRET: "email_delivery_operations_secret_is_long_enough",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3201",
};
let sendCount = 0;
const provider = {
    async send() {
        sendCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 75));
    },
};

async function createNotice(userId: number, key: string) {
    return prisma.emailOutboxMessage.create({
        data: {
            id: randomUUID(),
            userId,
            deduplicationKey: key,
            messageClass: "transactional",
            template: "security_notice",
            recipient: email,
            subject: "Security notice",
            payload: { siteName: "Hushle", title: "Security", message: "Test" },
        },
    });
}

async function main() {
    const user = await prisma.user.create({
        data: { username, email, normalizedEmail: email, password: "integration-only" },
    });
    try {
        const first = await createNotice(user.id, `email-ops-race:${suffix}`);
        const results = await Promise.all([
            processEmailOutbox({ provider, env, batchSize: 1 }),
            processEmailOutbox({ provider, env, batchSize: 1 }),
        ]);
        assert.equal(sendCount, 1, "concurrent workers must not send the same message twice");
        assert.equal(results.reduce((sum, result) => sum + result.sent, 0), 1);
        assert.equal((await prisma.emailOutboxMessage.findUniqueOrThrow({ where: { id: first.id } })).status, "sent");

        const event = {
            provider: "ses",
            providerEventId: `bounce-${suffix}`,
            type: "hard_bounce" as const,
            recipient: email,
            occurredAt: new Date(),
        };
        assert.deepEqual(await recordEmailDeliveryProviderEvent(event), { duplicate: false, suppressed: true });
        assert.deepEqual(await recordEmailDeliveryProviderEvent(event), { duplicate: true, suppressed: false });
        assert.equal(await prisma.emailDeliveryEvent.count({ where: { providerEventId: event.providerEventId } }), 1);

        const blocked = await createNotice(user.id, `email-ops-suppressed:${suffix}`);
        const blockedResult = await processEmailOutbox({ provider, env, batchSize: 1 });
        assert.equal(blockedResult.deadLettered, 1);
        assert.equal(sendCount, 1, "suppressed recipient must not reach the provider");
        const blockedRow = await prisma.emailOutboxMessage.findUniqueOrThrow({ where: { id: blocked.id } });
        assert.equal(blockedRow.status, "dead_letter");
        assert.match(blockedRow.lastError ?? "", /suppressed/i);
    } finally {
        await prisma.emailDeliveryEvent.deleteMany({ where: { normalizedEmail: email } });
        await prisma.emailSuppression.deleteMany({ where: { normalizedEmail: email } });
        await prisma.emailOutboxMessage.deleteMany({ where: { recipient: email } });
        await prisma.user.deleteMany({ where: { username } });
    }
    console.log("email delivery operations integration test passed");
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
