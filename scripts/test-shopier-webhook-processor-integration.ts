import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import {
    buildShopierWebhookEventId,
    processPaymentWebhookInbox,
    processShopierPaymentWebhook,
} from "@hushle/platform-payments";
import { POST } from "../apps/web/src/app/api/payments/webhooks/[provider]/route";

const webhookToken = "shopier-integration-webhook-token-with-safe-length";
const accountId = "123456";

async function createOrder(userId: number, suffix: string, productId: string) {
    return prisma.paymentOrder.create({
        data: {
            id: randomUUID(),
            userId,
            provider: "shopier_v2",
            status: "awaiting_payment",
            idempotencyKey: `shopier-webhook:${suffix}`,
            requestFingerprint: "e".repeat(64),
            productKind: "coin_pack",
            productReference: `coin_pack_${suffix}`,
            productVersion: 1,
            productNameSnapshot: "120 Coin",
            quantity: 1,
            unitAmountMinor: 1_197,
            totalAmountMinor: 1_197,
            currency: "TRY",
            grantSnapshot: { schemaVersion: 1, coinAmount: 120 },
            providerSessionReference: productId,
            providerHostedUrl: `https://www.shopier.com/${productId}`,
        },
    });
}

function payload(order: Awaited<ReturnType<typeof createOrder>>, providerOrderId: string, email: string) {
    return {
        id: providerOrderId,
        paymentStatus: "paid",
        dateCreated: order.createdAt.toISOString(),
        currency: "TRY",
        totals: { subtotal: "11.97", shipping: "0.00", discount: "0.00", total: "11.97" },
        shippingInfo: { email },
        lineItems: [{
            productId: order.providerSessionReference,
            title: `${order.productNameSnapshot} [${order.id.slice(0, 8)}]`,
            type: "digital",
            quantity: 1,
            price: "11.97",
            total: "11.97",
        }],
    };
}

async function sendWebhook(body: object, webhookId: string, account = accountId, event = "order.created"): Promise<Response> {
    const raw = JSON.stringify(body);
    return POST(new Request("http://localhost/api/payments/webhooks/shopier_v2", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "shopier-account-id": account,
            "shopier-event": event,
            "shopier-webhook-id": webhookId,
            "shopier-timestamp": String(Math.floor(Date.now() / 1000)),
            "shopier-signature": createHmac("sha256", webhookToken).update(raw).digest("hex"),
        },
        body: raw,
    }), { params: Promise.resolve({ provider: "shopier_v2" }) });
}

async function processInbox() {
    return processPaymentWebhookInbox({
        processor: (event) => processShopierPaymentWebhook(event, { webhookToken }),
        batchSize: 10,
        maxAttempts: 1,
        claimTtlMs: 60_000,
    });
}

async function run(): Promise<void> {
    assert.equal(process.env.SHOPIER_WEBHOOK_PROCESSOR_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);
    const previous = {
        checkoutMode: process.env.SHOPIER_CHECKOUT_MODE,
        webhookMode: process.env.SHOPIER_WEBHOOK_MODE,
        webhookToken: process.env.SHOPIER_WEBHOOK_TOKEN,
        accountId: process.env.SHOPIER_ACCOUNT_ID,
    };
    process.env.SHOPIER_CHECKOUT_MODE = "live";
    process.env.SHOPIER_WEBHOOK_MODE = "live";
    process.env.SHOPIER_WEBHOOK_TOKEN = webhookToken;
    process.env.SHOPIER_ACCOUNT_ID = accountId;

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const user = await prisma.user.create({
        data: {
            username: `shopier_hook_${suffix}`,
            password: "integration-test-only",
            email: `shopier_${suffix}@example.test`,
            normalizedEmail: `shopier_${suffix}@example.test`,
            emailVerifiedAt: new Date(),
            wallet: { create: { coinBalance: 0 } },
        },
    });
    const orderIds: string[] = [];
    const providerEventIds: string[] = [];
    try {
        const order = await createOrder(user.id, `${suffix}:success`, "689793");
        orderIds.push(order.id);
        const eventId = `shopier-hook-${suffix}-success`;
        const body = payload(order, "990001", user.email!);
        providerEventIds.push(buildShopierWebhookEventId(Buffer.from(JSON.stringify(body))));
        assert.equal((await sendWebhook(body, eventId)).status, 200);
        assert.equal((await sendWebhook(body, `${eventId}-mutated-replay`)).status, 200);
        const ingested = await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: {
                provider_providerEventId: {
                    provider: "shopier_v2",
                    providerEventId: buildShopierWebhookEventId(Buffer.from(JSON.stringify(body))),
                },
            },
        });
        assert.equal(ingested.deliveryCount, 2);
        assert.equal(JSON.stringify(ingested).includes(user.email!), false);
        const processed = await processInbox();
        assert.equal(processed.processed, 1);
        const fulfilled = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
        assert.equal(fulfilled.status, "fulfilled");
        assert.equal(fulfilled.providerOrderReference, "990001");
        assert.equal(fulfilled.providerHostedUrl, null);
        assert.equal((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).coinBalance, 120);

        const externalRefundBody = {
            id: `external-refund-${suffix}`, type: "partial", status: "succeeded",
            orderId: "990001", dateCreated: new Date().toISOString(),
            dateRefunded: new Date().toISOString(), currency: "TRY", total: "5.00",
        };
        providerEventIds.push(buildShopierWebhookEventId(Buffer.from(JSON.stringify(externalRefundBody))));
        assert.equal((await sendWebhook(externalRefundBody, `shopier-hook-${suffix}-external-refund`, accountId, "refund.updated")).status, 200);
        assert.equal((await processInbox()).processed, 1);
        const externalRefundCase = await prisma.paymentReconciliationCase.findUniqueOrThrow({ where: { orderId: order.id } });
        assert.equal(externalRefundCase.reasonCode, "shopier_external_refund_detected");
        assert.equal((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).coinBalance, 120);
        const proof = await prisma.paymentCheckoutVerification.findUniqueOrThrow({ where: { orderId: order.id } });
        assert.equal(proof.providerPaymentReference, "990001");
        assert.equal(proof.amountMinor, 1_197);
        await processShopierPaymentWebhook(
            await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: ingested.id } }),
            { webhookToken }
        );
        assert.equal((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).coinBalance, 120);

        const mismatchOrder = await createOrder(user.id, `${suffix}:mismatch`, "689794");
        orderIds.push(mismatchOrder.id);
        const mismatchEventId = `shopier-hook-${suffix}-mismatch`;
        const mismatchBody = payload(mismatchOrder, "990002", "different@example.test");
        providerEventIds.push(buildShopierWebhookEventId(Buffer.from(JSON.stringify(mismatchBody))));
        assert.equal((await sendWebhook(
            mismatchBody,
            mismatchEventId
        )).status, 200);
        const mismatchResult = await processInbox();
        assert.equal(mismatchResult.processed, 1);
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: mismatchOrder.id } })).status, "awaiting_payment");
        const review = await prisma.paymentReconciliationCase.findUniqueOrThrow({ where: { orderId: mismatchOrder.id } });
        assert.equal(review.reasonCode, "shopier_buyer_email_mismatch");
        assert.equal(await prisma.paymentCheckoutVerification.count({ where: { orderId: mismatchOrder.id } }), 0);
        assert.equal((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).coinBalance, 120);

        const amountOrder = await createOrder(user.id, `${suffix}:amount`, "689795");
        orderIds.push(amountOrder.id);
        await prisma.paymentOrder.update({
            where: { id: amountOrder.id },
            data: { unitAmountMinor: 1_297, totalAmountMinor: 1_297 },
        });
        const amountBody = payload(amountOrder, "990003", user.email!);
        const amountProviderEventId = buildShopierWebhookEventId(Buffer.from(JSON.stringify(amountBody)));
        providerEventIds.push(amountProviderEventId);
        assert.equal((await sendWebhook(amountBody, `shopier-hook-${suffix}-amount`)).status, 200);
        const amountResult = await processInbox();
        assert.equal(amountResult.deadLettered, 1);
        const amountEvent = await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: {
                provider_providerEventId: {
                    provider: "shopier_v2",
                    providerEventId: amountProviderEventId,
                },
            },
        });
        assert.equal(amountEvent.lastErrorCode, "shopier_order_proof_mismatch");
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: amountOrder.id } })).status, "awaiting_payment");
        assert.equal(await prisma.paymentCheckoutVerification.count({ where: { orderId: amountOrder.id } }), 0);
        assert.equal((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).coinBalance, 120);

        assert.equal((await sendWebhook(body, `shopier-hook-${suffix}-bad-account`, "wrong")).status, 400);
    } finally {
        await prisma.notification.deleteMany({ where: { userId: user.id } });
        await prisma.paymentReconciliationCase.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentWebhookEvent.deleteMany({
            where: { provider: "shopier_v2", providerEventId: { in: providerEventIds } },
        });
        await prisma.paymentCheckoutVerification.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentCoinLot.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentFulfillment.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentOrder.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.walletLedgerEntry.deleteMany({ where: { wallet: { userId: user.id } } });
        await prisma.wallet.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
        process.env.SHOPIER_CHECKOUT_MODE = previous.checkoutMode;
        process.env.SHOPIER_WEBHOOK_MODE = previous.webhookMode;
        process.env.SHOPIER_WEBHOOK_TOKEN = previous.webhookToken;
        process.env.SHOPIER_ACCOUNT_ID = previous.accountId;
        await prisma.$disconnect();
    }
    console.log("Shopier webhook fulfillment integration checks passed");
}

void run();
