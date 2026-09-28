import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, type PaymentOrder } from "@hushle/platform-db";
import {
    reconcileShopierOrder,
    runPaymentReconciliation,
    type ShopierPaidOrder,
    type ShopierProduct,
} from "@hushle/platform-payments";

const credentials = { personalAccessToken: "shopier-reconciliation-pat-with-safe-length" };
const webhookToken = "shopier-reconciliation-webhook-token-with-safe-length";

async function createOrder(input: {
    userId: number;
    suffix: string;
    productId?: string;
    status?: "awaiting_payment" | "pending_provider";
    createdAt: Date;
}): Promise<PaymentOrder> {
    const id = randomUUID();
    return prisma.paymentOrder.create({
        data: {
            id,
            userId: input.userId,
            provider: "shopier_v2",
            status: input.status ?? "awaiting_payment",
            idempotencyKey: `shopier-reconciliation:${input.suffix}`,
            requestFingerprint: "e".repeat(64),
            productKind: "coin_pack",
            productReference: `coin_pack_${input.suffix}`,
            productVersion: 1,
            productNameSnapshot: "120 Coin",
            quantity: 1,
            unitAmountMinor: 1_197,
            totalAmountMinor: 1_197,
            currency: "TRY",
            grantSnapshot: { schemaVersion: 1, coinAmount: 120 },
            providerSessionReference: input.productId,
            providerHostedUrl: input.productId ? `https://www.shopier.com/${input.productId}` : null,
            createdAt: input.createdAt,
        },
    });
}

function listing(order: PaymentOrder, productId: string): ShopierProduct {
    return {
        id: productId,
        title: `${order.productNameSnapshot} [${order.id.slice(0, 8)}]`,
        type: "digital",
        url: `https://www.shopier.com/${productId}`,
        priceData: { currency: "TRY", price: "11.97" },
        stockStatus: "inStock",
        stockQuantity: 1,
        shippingPayer: "sellerPays",
        customListing: true,
    };
}

function paidOrder(
    order: PaymentOrder,
    productId: string,
    email: string,
    providerOrderId: string,
    overrides: Partial<ShopierPaidOrder> = {}
): ShopierPaidOrder {
    return {
        id: providerOrderId,
        paymentStatus: "paid",
        dateCreated: order.createdAt.toISOString(),
        currency: "TRY",
        totals: { subtotal: "11.97", shipping: "0.00", discount: "0.00", total: "11.97" },
        shippingInfo: { email },
        lineItems: [{
            productId,
            title: `${order.productNameSnapshot} [${order.id.slice(0, 8)}]`,
            type: "digital",
            quantity: 1,
            price: "11.97",
            total: "11.97",
        }],
        refunds: [],
        ...overrides,
    };
}

async function run(): Promise<void> {
    assert.equal(process.env.SHOPIER_RECONCILIATION_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 60_000);
    const email = `shopier_reconciliation_${suffix}@example.test`;
    const user = await prisma.user.create({
        data: {
            username: `shopier_reconciliation_${suffix}`,
            password: "integration-test-only",
            email,
            normalizedEmail: email,
            emailVerifiedAt: now,
            wallet: { create: { coinBalance: 0 } },
        },
    });
    const orderIds: string[] = [];
    try {
        const uncertain = await createOrder({
            userId: user.id,
            suffix: `${suffix}:uncertain`,
            status: "pending_provider",
            createdAt: old,
        });
        orderIds.push(uncertain.id);
        await prisma.paymentAttempt.create({
            data: {
                orderId: uncertain.id,
                attemptNumber: 1,
                status: "uncertain",
                requestFingerprint: uncertain.requestFingerprint,
                errorCode: "provider_timeout",
            },
        });
        await prisma.paymentReconciliationCase.create({
            data: {
                orderId: uncertain.id,
                reasonCode: "shopier_listing_create_uncertain",
                nextCheckAt: now,
            },
        });
        let productQueries = 0;
        let orderQueries = 0;
        const uncertainResult = await reconcileShopierOrder({
            order: uncertain,
            credentials,
            webhookToken,
            productLookup: async () => {
                productQueries += 1;
                return [listing(uncertain, "780001")];
            },
            orderLookup: async ({ productId }) => {
                orderQueries += 1;
                return [paidOrder(uncertain, productId, email, "990001")];
            },
            now,
            retryDelayMinutes: 15,
        });
        assert.equal(uncertainResult, "fulfilled");
        assert.equal(productQueries, 1);
        assert.equal(orderQueries, 1);
        const recovered = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: uncertain.id } });
        assert.equal(recovered.status, "fulfilled");
        assert.equal(recovered.providerSessionReference, "780001");
        assert.equal(recovered.providerOrderReference, "990001");
        assert.equal((await prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: uncertain.id } })).status, "succeeded");
        assert.equal((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).coinBalance, 120);

        const concurrent = await createOrder({
            userId: user.id,
            suffix: `${suffix}:concurrent`,
            productId: "780002",
            createdAt: old,
        });
        orderIds.push(concurrent.id);
        const lookup = async () => [paidOrder(concurrent, "780002", email, "990002")];
        const concurrentResults = await Promise.all([
            reconcileShopierOrder({ order: concurrent, credentials, webhookToken, orderLookup: lookup, now, retryDelayMinutes: 15 }),
            reconcileShopierOrder({ order: concurrent, credentials, webhookToken, orderLookup: lookup, now, retryDelayMinutes: 15 }),
        ]);
        assert.deepEqual(concurrentResults, ["fulfilled", "fulfilled"]);
        assert.equal(await prisma.paymentCheckoutVerification.count({ where: { orderId: concurrent.id } }), 1);
        assert.equal(await prisma.notification.count({ where: { resourceId: concurrent.id } }), 1);
        assert.equal((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).coinBalance, 240);

        const amountMismatch = await createOrder({
            userId: user.id,
            suffix: `${suffix}:amount`,
            productId: "780003",
            createdAt: old,
        });
        orderIds.push(amountMismatch.id);
        const amountResult = await reconcileShopierOrder({
            order: amountMismatch,
            credentials,
            webhookToken,
            orderLookup: async () => [paidOrder(amountMismatch, "780003", email, "990003", {
                totals: { subtotal: "12.97", shipping: "0.00", discount: "0.00", total: "12.97" },
            })],
            now,
            retryDelayMinutes: 15,
        });
        assert.equal(amountResult, "review");
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: amountMismatch.id } })).status, "awaiting_payment");
        assert.equal(await prisma.paymentCheckoutVerification.count({ where: { orderId: amountMismatch.id } }), 0);

        const refunded = await createOrder({
            userId: user.id,
            suffix: `${suffix}:refunded`,
            productId: "780007",
            createdAt: old,
        });
        orderIds.push(refunded.id);
        assert.equal(await reconcileShopierOrder({
            order: refunded,
            credentials,
            webhookToken,
            orderLookup: async () => [paidOrder(refunded, "780007", email, "990007", {
                refunds: [{ status: "succeeded" }],
            })],
            now,
            retryDelayMinutes: 15,
        }), "review");
        assert.equal(
            (await prisma.paymentReconciliationCase.findUniqueOrThrow({ where: { orderId: refunded.id } })).reasonCode,
            "provider_return_detected"
        );
        assert.equal(await prisma.paymentCheckoutVerification.count({ where: { orderId: refunded.id } }), 0);

        const emailMismatch = await createOrder({
            userId: user.id,
            suffix: `${suffix}:email`,
            productId: "780004",
            createdAt: old,
        });
        orderIds.push(emailMismatch.id);
        assert.equal(await reconcileShopierOrder({
            order: emailMismatch,
            credentials,
            webhookToken,
            orderLookup: async () => [paidOrder(emailMismatch, "780004", "different@example.test", "990004")],
            now,
            retryDelayMinutes: 15,
        }), "review");
        assert.equal(
            (await prisma.paymentReconciliationCase.findUniqueOrThrow({ where: { orderId: emailMismatch.id } })).reasonCode,
            "shopier_buyer_email_mismatch"
        );

        const ambiguous = await createOrder({
            userId: user.id,
            suffix: `${suffix}:ambiguous`,
            status: "pending_provider",
            createdAt: old,
        });
        orderIds.push(ambiguous.id);
        let ambiguousOrderQueries = 0;
        assert.equal(await reconcileShopierOrder({
            order: ambiguous,
            credentials,
            webhookToken,
            productLookup: async () => [listing(ambiguous, "780005"), listing(ambiguous, "780006")],
            orderLookup: async () => {
                ambiguousOrderQueries += 1;
                return [];
            },
            now,
            retryDelayMinutes: 15,
        }), "review");
        assert.equal(ambiguousOrderQueries, 0);
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: ambiguous.id } })).status, "pending_provider");
        assert.equal(
            (await prisma.paymentReconciliationCase.findUniqueOrThrow({ where: { orderId: ambiguous.id } })).reasonCode,
            "shopier_listing_match_ambiguous"
        );

        const dryRun = await runPaymentReconciliation({
            config: { batchSize: 100, minAgeMinutes: 5, retryDelayMinutes: 15, maxAttempts: 12 },
            dryRun: true,
            environment: {
                SHOPIER_CHECKOUT_MODE: "live",
                SHOPIER_WEBHOOK_MODE: "live",
                SHOPIER_RECONCILIATION_MODE: "live",
                SHOPIER_PERSONAL_ACCESS_TOKEN: credentials.personalAccessToken,
                SHOPIER_WEBHOOK_TOKEN: webhookToken,
            },
            now: new Date(now.getTime() + 16 * 60_000),
        });
        assert.equal(dryRun.shopierEnabled, true);
        assert.ok(dryRun.candidatesByProvider.shopier >= 1);
        const missingSecretDryRun = await runPaymentReconciliation({
            config: { batchSize: 100, minAgeMinutes: 5, retryDelayMinutes: 15, maxAttempts: 12 },
            dryRun: true,
            environment: {
                SHOPIER_CHECKOUT_MODE: "live",
                SHOPIER_WEBHOOK_MODE: "live",
                SHOPIER_RECONCILIATION_MODE: "live",
            },
            now: new Date(now.getTime() + 16 * 60_000),
        });
        assert.equal(missingSecretDryRun.shopierEnabled, false);
        assert.equal(missingSecretDryRun.candidatesByProvider.shopier, 0);
        assert.equal((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).coinBalance, 240);
    } finally {
        await prisma.notification.deleteMany({ where: { userId: user.id } });
        await prisma.paymentReconciliationCase.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentCheckoutVerification.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentCoinLotAllocation.deleteMany({ where: { lot: { orderId: { in: orderIds } } } });
        await prisma.paymentCoinLot.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentFulfillment.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentOrder.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.walletLedgerEntry.deleteMany({ where: { wallet: { userId: user.id } } });
        await prisma.wallet.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.$disconnect();
    }
    console.log("Shopier listing recovery and paid-order reconciliation checks passed");
}

void run();
