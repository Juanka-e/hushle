import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import {
    buildIyzicoCfRetrieveResponseSignature,
    buildIyzicoHppWebhookSignatureV3,
    processIyzicoPaymentWebhook,
    processPaymentWebhookInbox,
} from "@hushle/platform-payments";
import { POST } from "../apps/web/src/app/api/payments/webhooks/[provider]/route";

const credentials = {
    apiKey: "sandbox-integration-api-key",
    secretKey: "sandbox-integration-secret-key",
};
const merchantId = "3404590";

async function createAwaitingOrder(input: {
    userId: number;
    itemId: number;
    suffix: string;
    amountMinor: number;
}) {
    const id = randomUUID();
    const token = `iyzico-webhook-token-${input.suffix.replace(/[^A-Za-z0-9]/g, "")}`;
    return prisma.paymentOrder.create({
        data: {
            id,
            userId: input.userId,
            provider: "iyzico",
            providerConfigVersion: 1,
            status: "awaiting_payment",
            idempotencyKey: `iyzico-webhook:${input.suffix}`,
            requestFingerprint: "c".repeat(64),
            productKind: "cosmetic_item",
            productReference: `avatar_${input.suffix}`,
            productVersion: 1,
            productNameSnapshot: "iyzico Webhook Avatar",
            quantity: 1,
            unitAmountMinor: input.amountMinor,
            totalAmountMinor: input.amountMinor,
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
                        imageUrl: "/images/iyzico-webhook-avatar.png",
                        templateKey: null,
                        templateConfig: null,
                        badgeText: null,
                    },
                }],
            },
            providerOrderReference: id,
            providerSessionReference: token,
            providerHostedUrl: `https://sandbox-cpp.iyzipay.com/?token=${token}`,
        },
    });
}

function webhookPayload(input: {
    orderId: string;
    token: string;
    paymentId: string;
    referenceCode: string;
    status: "SUCCESS" | "FAILURE";
}) {
    return {
        paymentConversationId: input.orderId,
        merchantId: Number(merchantId),
        status: input.status,
        token: input.token,
        iyziReferenceCode: input.referenceCode,
        iyziEventType: "CHECKOUT_FORM_AUTH",
        iyziEventTime: Date.now(),
        iyziPaymentId: Number(input.paymentId),
    } as const;
}

async function sendWebhook(payload: ReturnType<typeof webhookPayload>, validSignature = true): Promise<Response> {
    const signature = buildIyzicoHppWebhookSignatureV3({
        secretKey: credentials.secretKey,
        iyziEventType: payload.iyziEventType,
        iyziPaymentId: String(payload.iyziPaymentId),
        token: payload.token,
        paymentConversationId: payload.paymentConversationId,
        status: payload.status,
    });
    return POST(
        new Request("http://localhost/api/payments/webhooks/iyzico", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-iyz-signature-v3": validSignature ? signature : "0".repeat(64),
            },
            body: JSON.stringify(payload),
        }),
        { params: Promise.resolve({ provider: "iyzico" }) }
    );
}

function retrieveResponse(input: {
    orderId: string;
    token: string;
    paymentId: string;
    amountMinor: number;
}): Response {
    const amount = `${Math.floor(input.amountMinor / 100)}.${String(input.amountMinor % 100).padStart(2, "0")}`;
    return new Response(JSON.stringify({
        status: "success",
        conversationId: input.orderId,
        token: input.token,
        paymentId: input.paymentId,
        basketId: input.orderId,
        price: amount,
        paidPrice: amount,
        currency: "TRY",
        fraudStatus: 1,
        paymentStatus: "SUCCESS",
        signature: buildIyzicoCfRetrieveResponseSignature({
            secretKey: credentials.secretKey,
            paymentStatus: "SUCCESS",
            paymentId: input.paymentId,
            currency: "TRY",
            basketId: input.orderId,
            conversationId: input.orderId,
            paidPrice: amount,
            price: amount,
            token: input.token,
        }),
    }));
}

async function run(): Promise<void> {
    assert.equal(process.env.IYZICO_WEBHOOK_PROCESSOR_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);
    const previous = {
        apiKey: process.env.IYZICO_API_KEY,
        secretKey: process.env.IYZICO_SECRET_KEY,
        merchantId: process.env.IYZICO_MERCHANT_ID,
        checkoutMode: process.env.IYZICO_CHECKOUT_MODE,
        webhookMode: process.env.IYZICO_WEBHOOK_MODE,
    };
    process.env.IYZICO_API_KEY = credentials.apiKey;
    process.env.IYZICO_SECRET_KEY = credentials.secretKey;
    process.env.IYZICO_MERCHANT_ID = merchantId;
    process.env.IYZICO_CHECKOUT_MODE = "sandbox";
    process.env.IYZICO_WEBHOOK_MODE = "sandbox";

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const user = await prisma.user.create({
        data: { username: `iyzico_webhook_${suffix}`, password: "integration-test-only" },
    });
    const item = await prisma.shopItem.create({
        data: {
            code: `iyzico_webhook_${suffix}`,
            type: "avatar",
            name: "iyzico Webhook Avatar",
            rarity: "epic",
            renderMode: "image",
            renderSpecVersion: 1,
            priceCoin: 0,
            imageUrl: "/images/iyzico-webhook-avatar.png",
        },
    });
    const recoveryItem = await prisma.shopItem.create({
        data: {
            code: `iyzico_webhook_recovery_${suffix}`,
            type: "avatar",
            name: "iyzico Recovery Avatar",
            rarity: "rare",
            renderMode: "image",
            renderSpecVersion: 1,
            priceCoin: 0,
            imageUrl: "/images/iyzico-recovery-avatar.png",
        },
    });
    const orderIds: string[] = [];

    try {
        const successOrder = await createAwaitingOrder({
            userId: user.id,
            itemId: item.id,
            suffix: `${suffix}:success`,
            amountMinor: 14_900,
        });
        orderIds.push(successOrder.id);
        const successPaymentId = "28157797";
        const successPayload = webhookPayload({
            orderId: successOrder.id,
            token: successOrder.providerSessionReference!,
            paymentId: successPaymentId,
            referenceCode: randomUUID(),
            status: "SUCCESS",
        });
        assert.equal((await sendWebhook(successPayload)).status, 200);
        assert.equal((await sendWebhook(successPayload)).status, 200);
        const successEvent = await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: { provider_providerEventId: { provider: "iyzico", providerEventId: successPayload.iyziReferenceCode } },
        });
        assert.equal(successEvent.deliveryCount, 2);
        assert.equal(JSON.stringify(successEvent.metadata).includes(successPayload.token), false);

        let retrieveCalls = 0;
        const successProcessor = (event: typeof successEvent) => processIyzicoPaymentWebhook(event, {
            credentials,
            fetchImpl: async () => {
                retrieveCalls += 1;
                return retrieveResponse({
                    orderId: successOrder.id,
                    token: successPayload.token,
                    paymentId: successPaymentId,
                    amountMinor: successOrder.totalAmountMinor,
                });
            },
        });
        const successResult = await processPaymentWebhookInbox({
            processor: successProcessor,
            batchSize: 10,
            maxAttempts: 2,
            claimTtlMs: 60_000,
        });
        assert.equal(successResult.processed, 1, JSON.stringify({
            successResult,
            lastErrorCode: (await prisma.paymentWebhookEvent.findUniqueOrThrow({
                where: { id: successEvent.id },
            })).lastErrorCode,
        }));
        assert.equal(retrieveCalls, 1);
        const fulfilled = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: successOrder.id } });
        assert.equal(fulfilled.status, "fulfilled");
        assert.equal(fulfilled.providerSessionReference, null);
        assert.equal(fulfilled.providerHostedUrl, null);
        assert.equal(await prisma.inventoryItem.count({ where: { userId: user.id, shopItemId: item.id } }), 1);
        assert.equal(await prisma.notification.count({
            where: { userId: user.id, resourceType: "payment_order", resourceId: successOrder.id },
        }), 1);
        const proof = await prisma.paymentCheckoutVerification.findUniqueOrThrow({
            where: { orderId: successOrder.id },
        });
        assert.equal(proof.providerPaymentReference, successPaymentId);
        await processIyzicoPaymentWebhook(
            await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: successEvent.id } }),
            { credentials, fetchImpl: async () => { throw new Error("duplicate must not retrieve"); } }
        );

        const recoveryOrder = await createAwaitingOrder({
            userId: user.id,
            itemId: recoveryItem.id,
            suffix: `${suffix}:recovery`,
            amountMinor: 15_400,
        });
        orderIds.push(recoveryOrder.id);
        const recoveryPaymentId = "28157801";
        const recoveryPayload = webhookPayload({
            orderId: recoveryOrder.id,
            token: recoveryOrder.providerSessionReference!,
            paymentId: recoveryPaymentId,
            referenceCode: randomUUID(),
            status: "SUCCESS",
        });
        assert.equal((await sendWebhook(recoveryPayload)).status, 200);
        await prisma.paymentCheckoutVerification.create({
            data: {
                orderId: recoveryOrder.id,
                provider: "iyzico",
                providerPaymentReference: recoveryPaymentId,
                amountMinor: recoveryOrder.totalAmountMinor,
                paidAmountMinor: recoveryOrder.totalAmountMinor,
                currency: recoveryOrder.currency,
                providerPaymentStatus: "SUCCESS",
                providerRiskStatus: 1,
                verifiedAt: new Date(),
            },
        });
        await prisma.paymentOrder.update({
            where: { id: recoveryOrder.id },
            data: {
                status: "paid",
                paidAt: new Date(),
                providerSessionReference: null,
                providerHostedUrl: null,
            },
        });
        const recoveryResult = await processPaymentWebhookInbox({
            processor: (event) => processIyzicoPaymentWebhook(event, {
                credentials,
                fetchImpl: async () => { throw new Error("paid recovery must not retrieve"); },
            }),
            batchSize: 10,
            maxAttempts: 1,
            claimTtlMs: 60_000,
        });
        assert.equal(recoveryResult.processed, 1);
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: recoveryOrder.id } })).status, "fulfilled");
        assert.equal(await prisma.inventoryItem.count({
            where: { userId: user.id, shopItemId: recoveryItem.id },
        }), 1, "paid order recovery must complete the idempotent grant");

        const failedOrder = await createAwaitingOrder({
            userId: user.id,
            itemId: item.id,
            suffix: `${suffix}:failed`,
            amountMinor: 15_900,
        });
        orderIds.push(failedOrder.id);
        const failedPayload = webhookPayload({
            orderId: failedOrder.id,
            token: failedOrder.providerSessionReference!,
            paymentId: "28157798",
            referenceCode: randomUUID(),
            status: "FAILURE",
        });
        assert.equal((await sendWebhook(failedPayload)).status, 200);
        const failedResult = await processPaymentWebhookInbox({
            processor: (event) => processIyzicoPaymentWebhook(event, {
                credentials,
                fetchImpl: async () => { throw new Error("failure must not retrieve"); },
            }),
            batchSize: 10,
            maxAttempts: 1,
            claimTtlMs: 60_000,
        });
        assert.equal(failedResult.processed, 1);
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: failedOrder.id } })).status, "failed");

        const tokenMismatchOrder = await createAwaitingOrder({
            userId: user.id,
            itemId: item.id,
            suffix: `${suffix}:token`,
            amountMinor: 16_900,
        });
        orderIds.push(tokenMismatchOrder.id);
        const tokenMismatchPayload = webhookPayload({
            orderId: tokenMismatchOrder.id,
            token: "signed-but-wrong-order-token",
            paymentId: "28157799",
            referenceCode: randomUUID(),
            status: "SUCCESS",
        });
        assert.equal((await sendWebhook(tokenMismatchPayload)).status, 200);
        const tokenMismatchResult = await processPaymentWebhookInbox({
            processor: (event) => processIyzicoPaymentWebhook(event, { credentials }),
            batchSize: 10,
            maxAttempts: 1,
            claimTtlMs: 60_000,
        });
        assert.equal(tokenMismatchResult.deadLettered, 1);
        const tokenMismatchEvent = await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: { provider_providerEventId: { provider: "iyzico", providerEventId: tokenMismatchPayload.iyziReferenceCode } },
        });
        assert.equal(tokenMismatchEvent.lastErrorCode, "token_correlation_mismatch");
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: tokenMismatchOrder.id } })).status, "awaiting_payment");

        const amountMismatchOrder = await createAwaitingOrder({
            userId: user.id,
            itemId: item.id,
            suffix: `${suffix}:amount`,
            amountMinor: 17_900,
        });
        orderIds.push(amountMismatchOrder.id);
        const amountMismatchPayload = webhookPayload({
            orderId: amountMismatchOrder.id,
            token: amountMismatchOrder.providerSessionReference!,
            paymentId: "28157800",
            referenceCode: randomUUID(),
            status: "SUCCESS",
        });
        assert.equal((await sendWebhook(amountMismatchPayload)).status, 200);
        const amountMismatchResult = await processPaymentWebhookInbox({
            processor: (event) => processIyzicoPaymentWebhook(event, {
                credentials,
                fetchImpl: async () => retrieveResponse({
                    orderId: amountMismatchOrder.id,
                    token: amountMismatchPayload.token,
                    paymentId: String(amountMismatchPayload.iyziPaymentId),
                    amountMinor: amountMismatchOrder.totalAmountMinor - 100,
                }),
            }),
            batchSize: 10,
            maxAttempts: 1,
            claimTtlMs: 60_000,
        });
        assert.equal(amountMismatchResult.deadLettered, 1);
        const amountMismatchEvent = await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: { provider_providerEventId: { provider: "iyzico", providerEventId: amountMismatchPayload.iyziReferenceCode } },
        });
        assert.equal(amountMismatchEvent.lastErrorCode, "iyzico_retrieve_invalid_provider_response");
        assert.equal(await prisma.paymentCheckoutVerification.count({ where: { orderId: amountMismatchOrder.id } }), 0);
        assert.equal((await sendWebhook({ ...successPayload, iyziReferenceCode: randomUUID() }, false)).status, 400);
    } finally {
        await prisma.notification.deleteMany({ where: { userId: user.id } });
        await prisma.paymentWebhookEvent.deleteMany({
            where: { provider: "iyzico", providerOrderReference: { in: orderIds } },
        });
        await prisma.paymentCheckoutVerification.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentFulfillment.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.inventoryItem.deleteMany({ where: { userId: user.id } });
        await prisma.paymentOrder.deleteMany({ where: { userId: user.id } });
        await prisma.shopItem.deleteMany({ where: { id: { in: [item.id, recoveryItem.id] } } });
        await prisma.user.delete({ where: { id: user.id } });
        process.env.IYZICO_API_KEY = previous.apiKey;
        process.env.IYZICO_SECRET_KEY = previous.secretKey;
        process.env.IYZICO_MERCHANT_ID = previous.merchantId;
        process.env.IYZICO_CHECKOUT_MODE = previous.checkoutMode;
        process.env.IYZICO_WEBHOOK_MODE = previous.webhookMode;
        await prisma.$disconnect();
    }

    console.log("iyzico Signature V3 webhook processor integration checks passed");
}

void run();
