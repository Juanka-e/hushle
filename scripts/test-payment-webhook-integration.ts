import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import {
    PaymentWebhookError,
    PaymentWebhookProcessingError,
    createPaymentOrderRecord,
    ingestVerifiedPaymentWebhook,
    processPaymentWebhookInbox,
    type PaymentWebhookVerifier,
    type VerifiedPaymentWebhook,
} from "@hushle/platform-payments";

async function run(): Promise<void> {
    assert.equal(process.env.PAYMENT_WEBHOOK_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const user = await prisma.user.create({
        data: { username: `webhook_${suffix}`, password: "integration-test-only" },
    });
    const order = (await createPaymentOrderRecord({
        userId: user.id,
        provider: "stripe",
        providerConfigVersion: 1,
        idempotencyKey: `webhook:${suffix}:order`,
        quote: {
            productKind: "cosmetic_item",
            productReference: "integration_item",
            productVersion: 1,
            productName: "Integration Item",
            quantity: 1,
            unitAmountMinor: 12_500,
            currency: "TRY",
            grantSnapshot: { schemaVersion: 1, items: [{ shopItemId: 1, renderSnapshot: {} }] },
        },
    })).order;

    let envelope: VerifiedPaymentWebhook = {
        providerEventId: `evt_${suffix}`,
        eventType: "checkout.session.completed",
        outcome: "payment_succeeded",
        signatureVersion: "v1",
        providerOrderReference: order.id,
        amountMinor: 12_500,
        currency: "TRY",
        metadata: { apiVersion: "test" },
    };
    const verifier: PaymentWebhookVerifier = {
        provider: "stripe",
        acknowledgement: { status: 200, contentType: "application/json", body: "{}" },
        async verify(input) {
            assert.equal(input.headers["stripe-signature"], "valid");
            return envelope;
        },
    };
    const rawBody = new TextEncoder().encode('{"id":"event"}');
    const receivedAt = new Date("2026-08-08T12:00:00.000Z");

    try {
        const first = await ingestVerifiedPaymentWebhook({
            provider: "stripe",
            rawBody,
            headers: { "stripe-signature": "valid" },
            verifier,
            receivedAt,
        });
        assert.equal(first.duplicate, false);
        const duplicate = await ingestVerifiedPaymentWebhook({
            provider: "stripe",
            rawBody,
            headers: { "stripe-signature": "valid" },
            verifier,
            receivedAt: new Date(receivedAt.getTime() + 1_000),
        });
        assert.equal(duplicate.duplicate, true);
        assert.equal((await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: { id: first.event.id },
        })).deliveryCount, 2);

        await assert.rejects(
            () => ingestVerifiedPaymentWebhook({
                provider: "stripe",
                rawBody: new TextEncoder().encode('{"id":"changed"}'),
                headers: { "stripe-signature": "valid" },
                verifier,
            }),
            (error: unknown) => error instanceof PaymentWebhookError &&
                error.code === "event_identity_conflict"
        );

        const retryResult = await processPaymentWebhookInbox({
            processor: async () => {
                throw new PaymentWebhookProcessingError("provider_timeout", true);
            },
            batchSize: 10,
            maxAttempts: 3,
            claimTtlMs: 60_000,
            now: receivedAt,
        });
        assert.equal(retryResult.retried, 1);
        const retried = await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: { id: first.event.id },
        });
        assert.equal(retried.status, "retry");
        assert.equal(retried.lastErrorCode, "provider_timeout");

        const processed = await processPaymentWebhookInbox({
            processor: async () => "processed",
            batchSize: 10,
            maxAttempts: 3,
            claimTtlMs: 60_000,
            now: new Date(receivedAt.getTime() + 5 * 60_000),
        });
        assert.equal(processed.processed, 1);
        assert.equal((await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: { id: first.event.id },
        })).status, "processed");

        envelope = {
            ...envelope,
            providerEventId: `evt_dead_${suffix}`,
            eventType: "payment.failed",
            outcome: "payment_failed",
        };
        const dead = await ingestVerifiedPaymentWebhook({
            provider: "stripe",
            rawBody: new TextEncoder().encode('{"id":"dead"}'),
            headers: { "stripe-signature": "valid" },
            verifier,
            receivedAt,
        });
        const deadResult = await processPaymentWebhookInbox({
            processor: async () => {
                throw new PaymentWebhookProcessingError("amount_mismatch", false);
            },
            batchSize: 10,
            maxAttempts: 3,
            claimTtlMs: 60_000,
            now: receivedAt,
        });
        assert.equal(deadResult.deadLettered, 1);
        assert.equal((await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: { id: dead.event.id },
        })).status, "dead_letter");
    } finally {
        await prisma.paymentWebhookEvent.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentWebhookEvent.deleteMany({
            where: { providerEventId: { contains: suffix } },
        });
        await prisma.paymentOrder.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.$disconnect();
    }

    console.log("payment webhook integration checks passed");
}

void run();
