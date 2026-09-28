import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import {
    createPaymentCheckoutOrderRecord,
    createShopierCheckoutListing,
    ShopierCheckoutError,
} from "@hushle/platform-payments";

const credentials = { personalAccessToken: "shopier-integration-token-with-safe-length" };
const mediaUrl = "https://assets.example.test/payments/coin-pack.png";

async function createOrder(userId: number, suffix: string) {
    return (await createPaymentCheckoutOrderRecord({
        userId,
        provider: "shopier_v2",
        providerConfigVersion: 1,
        idempotencyKey: `shopier-checkout:${suffix}`,
        quote: {
            productKind: "coin_pack",
            productReference: `coin_pack_${suffix}`,
            productVersion: 1,
            productName: "120 Coin",
            quantity: 1,
            unitAmountMinor: 1_197,
            currency: "TRY",
            grantSnapshot: { schemaVersion: 1, coinAmount: 120 },
        },
        legalAcceptance: {
            checkoutTermsVersion: "terms-test-v1",
            privacyNoticeVersion: "privacy-test-v1",
            distanceSalesNoticeVersion: "distance-test-v1",
            buyerDataPolicyVersion: "buyer-data-v1",
            acceptedAt: new Date(),
        },
    })).order;
}

function productResponse(orderId: string, productId: string): Response {
    return new Response(JSON.stringify({
        id: productId,
        title: `120 Coin [${orderId.slice(0, 8)}]`,
        type: "digital",
        url: `https://www.shopier.com/${productId}`,
        priceData: { currency: "TRY", price: "11.97" },
        stockStatus: "inStock",
        stockQuantity: 1,
        shippingPayer: "sellerPays",
        customListing: true,
    }));
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
    await assert.rejects(action, (error: unknown) => {
        assert.ok(error instanceof ShopierCheckoutError);
        assert.equal(error.code, code);
        return true;
    });
}

async function run(): Promise<void> {
    assert.equal(process.env.SHOPIER_CHECKOUT_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
    const user = await prisma.user.create({
        data: {
            username: `shopier_checkout_${suffix}`,
            password: "integration-test-only",
            email: `shopier_${suffix}@example.test`,
            normalizedEmail: `shopier_${suffix}@example.test`,
            emailVerifiedAt: new Date(),
        },
    });

    try {
        const order = await createOrder(user.id, `${suffix}:success`);
        let providerCalls = 0;
        let releaseProvider!: () => void;
        const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
        const fetchImpl: typeof fetch = async () => {
            providerCalls += 1;
            await providerGate;
            return productResponse(order.id, "689793");
        };
        const first = createShopierCheckoutListing({
            orderId: order.id, mediaUrl, credentials, fetchImpl,
        });
        while (providerCalls === 0) await new Promise((resolve) => setTimeout(resolve, 5));
        await expectCode(() => createShopierCheckoutListing({
            orderId: order.id, mediaUrl, credentials, fetchImpl,
        }), "checkout_in_progress");
        releaseProvider();
        const session = await first;
        assert.equal(session.duplicate, false);
        assert.equal(providerCalls, 1);

        const duplicate = await createShopierCheckoutListing({
            orderId: order.id, mediaUrl, credentials, fetchImpl,
        });
        assert.equal(duplicate.duplicate, true);
        assert.equal(duplicate.productId, "689793");
        assert.equal(providerCalls, 1, "a stored Shopier listing must be reused");

        const stored = await prisma.paymentOrder.findUniqueOrThrow({
            where: { id: order.id }, include: { attempts: true },
        });
        assert.equal(stored.status, "awaiting_payment");
        assert.equal(stored.providerSessionReference, "689793");
        assert.equal(stored.providerHostedUrl, "https://www.shopier.com/689793");
        assert.equal(stored.attempts.length, 1);
        assert.equal(stored.attempts[0]?.status, "succeeded");
        assert.match(stored.attempts[0]?.providerRequestId ?? "", /^shopier-product-sha256:[a-f0-9]{64}$/);

        const uncertainOrder = await createOrder(user.id, `${suffix}:uncertain`);
        let uncertainCalls = 0;
        const unavailableFetch: typeof fetch = async () => {
            uncertainCalls += 1;
            throw new TypeError("network detail must not persist");
        };
        await expectCode(() => createShopierCheckoutListing({
            orderId: uncertainOrder.id, mediaUrl, credentials, fetchImpl: unavailableFetch,
        }), "checkout_uncertain");
        await expectCode(() => createShopierCheckoutListing({
            orderId: uncertainOrder.id, mediaUrl, credentials, fetchImpl: unavailableFetch,
        }), "checkout_uncertain");
        assert.equal(uncertainCalls, 1, "an uncertain product create must never be retried blindly");
        const uncertain = await prisma.paymentOrder.findUniqueOrThrow({
            where: { id: uncertainOrder.id },
            include: { attempts: true, reconciliationCase: true },
        });
        assert.equal(uncertain.attempts[0]?.status, "uncertain");
        assert.equal(uncertain.reconciliationCase?.reasonCode, "shopier_listing_create_uncertain");
        assert.equal(JSON.stringify(uncertain).includes("network detail"), false);

        const staleOrder = await createOrder(user.id, `${suffix}:stale`);
        await prisma.paymentOrder.update({
            where: { id: staleOrder.id }, data: { status: "pending_provider" },
        });
        const staleAttempt = await prisma.paymentAttempt.create({
            data: {
                orderId: staleOrder.id,
                attemptNumber: 1,
                status: "requested",
                requestFingerprint: staleOrder.requestFingerprint,
            },
        });
        await prisma.paymentAttempt.update({
            where: { id: staleAttempt.id },
            data: { updatedAt: new Date(Date.now() - 61_000) },
        });
        let staleCalls = 0;
        await expectCode(() => createShopierCheckoutListing({
            orderId: staleOrder.id,
            mediaUrl,
            credentials,
            fetchImpl: async () => {
                staleCalls += 1;
                return productResponse(staleOrder.id, "689794");
            },
        }), "checkout_uncertain");
        assert.equal(staleCalls, 0);
        const stale = await prisma.paymentOrder.findUniqueOrThrow({
            where: { id: staleOrder.id },
            include: { attempts: true, reconciliationCase: true },
        });
        assert.equal(stale.attempts[0]?.status, "uncertain");
        assert.equal(stale.reconciliationCase?.reasonCode, "shopier_listing_create_uncertain");
    } finally {
        await prisma.paymentReconciliationCase.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentCheckoutConsent.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentAttempt.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentOrder.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.$disconnect();
    }

    console.log("Shopier checkout orchestration integration checks passed");
}

void run();
