import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import {
    buildPaytrCallbackHash,
    getPaymentWebhookProcessor,
    processPaymentWebhookInbox,
    processPaytrPaymentWebhook,
} from "@hushle/platform-payments";
import { POST } from "../apps/web/src/app/api/payments/webhooks/[provider]/route";

const credentials = {
    merchantId: "123456",
    merchantKey: "integration-key",
    merchantSalt: "integration-salt",
};

function callbackBody(input: {
    merchantOrderId: string;
    status: "success" | "failed";
    amountMinor: number;
    testMode?: boolean;
}): string {
    const totalAmount = String(input.amountMinor);
    return new URLSearchParams({
        merchant_oid: input.merchantOrderId,
        status: input.status,
        total_amount: totalAmount,
        hash: buildPaytrCallbackHash({
            merchantOrderId: input.merchantOrderId,
            status: input.status,
            totalAmount,
            credentials,
        }),
        currency: "TL",
        payment_type: "card",
        test_mode: input.testMode === false ? "0" : "1",
        ...(input.status === "failed" ? { failed_reason_code: "integration_failure" } : {}),
    }).toString();
}

async function sendCallback(body: string): Promise<Response> {
    return POST(
        new Request("http://localhost/api/payments/webhooks/paytr", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body,
        }),
        { params: Promise.resolve({ provider: "paytr" }) }
    );
}

async function createAwaitingOrder(input: {
    userId: number;
    itemId: number;
    suffix: string;
    amountMinor?: number;
}) {
    const id = randomUUID();
    return prisma.paymentOrder.create({
        data: {
            id,
            userId: input.userId,
            provider: "paytr",
            providerConfigVersion: 1,
            status: "awaiting_payment",
            idempotencyKey: `paytr-webhook:${input.suffix}`,
            requestFingerprint: "a".repeat(64),
            productKind: "cosmetic_item",
            productReference: `avatar_${input.suffix}`,
            productVersion: 1,
            productNameSnapshot: "Webhook Avatar",
            quantity: 1,
            unitAmountMinor: input.amountMinor ?? 14_900,
            totalAmountMinor: input.amountMinor ?? 14_900,
            currency: "TRY",
            grantSnapshot: {
                schemaVersion: 1,
                items: [{
                    shopItemId: input.itemId,
                    renderSnapshot: {
                        type: "avatar",
                        rarity: "epic",
                        renderMode: "image",
                        renderSpecVersion: 1,
                        imageUrl: "/images/webhook-avatar.png",
                        templateKey: null,
                        templateConfig: null,
                        badgeText: null,
                    },
                }],
            },
            providerOrderReference: id.replaceAll("-", ""),
            providerSessionReference: `sandbox-token-${input.suffix}`,
        },
    });
}

async function run(): Promise<void> {
    assert.equal(process.env.PAYTR_WEBHOOK_PROCESSOR_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);
    const previous = {
        mode: process.env.PAYTR_CHECKOUT_MODE,
        id: process.env.PAYTR_MERCHANT_ID,
        key: process.env.PAYTR_MERCHANT_KEY,
        salt: process.env.PAYTR_MERCHANT_SALT,
    };
    process.env.PAYTR_CHECKOUT_MODE = "sandbox";
    process.env.PAYTR_MERCHANT_ID = credentials.merchantId;
    process.env.PAYTR_MERCHANT_KEY = credentials.merchantKey;
    process.env.PAYTR_MERCHANT_SALT = credentials.merchantSalt;

    const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
    const user = await prisma.user.create({
        data: { username: `paytr_processor_${suffix}`, password: "integration-test-only" },
    });
    const item = await prisma.shopItem.create({
        data: {
            code: `paytr_processor_${suffix}`,
            type: "avatar",
            name: "Webhook Avatar",
            rarity: "epic",
            renderMode: "image",
            renderSpecVersion: 1,
            priceCoin: 0,
            imageUrl: "/images/webhook-avatar.png",
        },
    });

    try {
        const successOrder = await createAwaitingOrder({ userId: user.id, itemId: item.id, suffix: `${suffix}:success` });
        const successBody = callbackBody({
            merchantOrderId: successOrder.providerOrderReference!,
            status: "success",
            amountMinor: successOrder.totalAmountMinor,
        });
        const first = await sendCallback(successBody);
        assert.equal(first.status, 200);
        assert.equal(await first.text(), "OK");
        const duplicate = await sendCallback(successBody);
        assert.equal(duplicate.status, 200);
        assert.equal(await duplicate.text(), "OK");
        const conflictingOutcome = await sendCallback(callbackBody({
            merchantOrderId: successOrder.providerOrderReference!,
            status: "failed",
            amountMinor: successOrder.totalAmountMinor,
        }));
        assert.equal(conflictingOutcome.status, 400, "the same PayTR order cannot change callback identity");

        const pendingSuccessEvent = await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: { provider_providerEventId: { provider: "paytr", providerEventId: successOrder.providerOrderReference! } },
        });
        await Promise.all([
            processPaytrPaymentWebhook(pendingSuccessEvent),
            processPaytrPaymentWebhook(pendingSuccessEvent),
        ]);

        const processed = await processPaymentWebhookInbox({
            processor: getPaymentWebhookProcessor(),
            batchSize: 10,
            maxAttempts: 3,
            claimTtlMs: 60_000,
        });
        assert.equal(processed.processed, 1);
        const completedOrder = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: successOrder.id } });
        assert.equal(completedOrder.status, "fulfilled");
        assert.ok(completedOrder.paidAt);
        assert.ok(completedOrder.fulfilledAt);
        assert.equal(completedOrder.providerSessionReference, null);
        assert.equal(await prisma.inventoryItem.count({ where: { userId: user.id, shopItemId: item.id } }), 1);
        assert.equal(await prisma.notification.count({
            where: { userId: user.id, resourceType: "payment_order", resourceId: successOrder.id },
        }), 1);
        const fulfillment = await prisma.paymentFulfillment.findUniqueOrThrow({ where: { orderId: successOrder.id } });
        assert.ok(fulfillment.notificationSentAt);
        const storedSuccessEvent = await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: { provider_providerEventId: { provider: "paytr", providerEventId: successOrder.providerOrderReference! } },
        });
        assert.equal(storedSuccessEvent.deliveryCount, 2);
        assert.equal(storedSuccessEvent.orderId, successOrder.id);
        await processPaytrPaymentWebhook(storedSuccessEvent);
        assert.equal(await prisma.inventoryItem.count({ where: { userId: user.id, shopItemId: item.id } }), 1);
        assert.equal(await prisma.notification.count({
            where: { userId: user.id, resourceType: "payment_order", resourceId: successOrder.id },
        }), 1);

        const failedOrder = await createAwaitingOrder({ userId: user.id, itemId: item.id, suffix: `${suffix}:failed`, amountMinor: 15_900 });
        assert.equal((await sendCallback(callbackBody({
            merchantOrderId: failedOrder.providerOrderReference!,
            status: "failed",
            amountMinor: failedOrder.totalAmountMinor,
        }))).status, 200);
        const failedResult = await processPaymentWebhookInbox({
            processor: getPaymentWebhookProcessor(),
            batchSize: 10,
            maxAttempts: 3,
            claimTtlMs: 60_000,
        });
        assert.equal(failedResult.processed, 1);
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: failedOrder.id } })).status, "failed");
        assert.equal(await prisma.paymentFulfillment.count({ where: { orderId: failedOrder.id } }), 0);

        const mismatchOrder = await createAwaitingOrder({ userId: user.id, itemId: item.id, suffix: `${suffix}:mismatch`, amountMinor: 16_900 });
        assert.equal((await sendCallback(callbackBody({
            merchantOrderId: mismatchOrder.providerOrderReference!,
            status: "success",
            amountMinor: mismatchOrder.totalAmountMinor + 1,
        }))).status, 200);
        const mismatchResult = await processPaymentWebhookInbox({
            processor: getPaymentWebhookProcessor(),
            batchSize: 10,
            maxAttempts: 3,
            claimTtlMs: 60_000,
        });
        assert.equal(mismatchResult.deadLettered, 1);
        const mismatchEvent = await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: { provider_providerEventId: { provider: "paytr", providerEventId: mismatchOrder.providerOrderReference! } },
        });
        assert.equal(mismatchEvent.lastErrorCode, "amount_mismatch");
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: mismatchOrder.id } })).status, "awaiting_payment");

        const liveModeOrder = await createAwaitingOrder({ userId: user.id, itemId: item.id, suffix: `${suffix}:live-mode`, amountMinor: 17_900 });
        assert.equal((await sendCallback(callbackBody({
            merchantOrderId: liveModeOrder.providerOrderReference!,
            status: "success",
            amountMinor: liveModeOrder.totalAmountMinor,
            testMode: false,
        }))).status, 200);
        const liveModeResult = await processPaymentWebhookInbox({
            processor: getPaymentWebhookProcessor(),
            batchSize: 10,
            maxAttempts: 3,
            claimTtlMs: 60_000,
        });
        assert.equal(liveModeResult.deadLettered, 1);
        const liveModeEvent = await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: { provider_providerEventId: { provider: "paytr", providerEventId: liveModeOrder.providerOrderReference! } },
        });
        assert.equal(liveModeEvent.lastErrorCode, "sandbox_mode_mismatch");
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: liveModeOrder.id } })).status, "awaiting_payment");

        const invalidBody = new URLSearchParams(successBody);
        invalidBody.set("hash", "invalid-signature");
        assert.equal((await sendCallback(invalidBody.toString())).status, 400);
    } finally {
        await prisma.notification.deleteMany({ where: { userId: user.id } });
        await prisma.paymentWebhookEvent.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentFulfillment.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.inventoryItem.deleteMany({ where: { userId: user.id } });
        await prisma.paymentOrder.deleteMany({ where: { userId: user.id } });
        await prisma.shopItem.delete({ where: { id: item.id } });
        await prisma.user.delete({ where: { id: user.id } });
        process.env.PAYTR_CHECKOUT_MODE = previous.mode;
        process.env.PAYTR_MERCHANT_ID = previous.id;
        process.env.PAYTR_MERCHANT_KEY = previous.key;
        process.env.PAYTR_MERCHANT_SALT = previous.salt;
        await prisma.$disconnect();
    }

    console.log("PayTR webhook processor integration checks passed");
}

void run();
