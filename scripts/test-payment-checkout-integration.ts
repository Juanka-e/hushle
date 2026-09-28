import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import {
    PaymentOrderConflictError,
    createPaymentCheckoutOrderRecord,
    getActivePaymentOffer,
    listActivePaymentOffers,
} from "@hushle/platform-payments";

async function run(): Promise<void> {
    assert.equal(process.env.PAYMENT_CHECKOUT_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const user = await prisma.user.create({
        data: { username: `checkout_${suffix}`, password: "integration-test-only" },
    });
    const offerCode = `checkout_offer_${suffix}`;
    const unsupportedOfferCode = `checkout_future_asset_${suffix}`;
    await prisma.paymentOffer.create({
        data: {
            code: offerCode,
            productKind: "cosmetic_item",
            productReference: `avatar_${suffix}`,
            productVersion: 2,
            productName: "Integration Checkout Avatar",
            description: "Integration test offer",
            unitAmountMinor: 12_900,
            currency: "TRY",
            grantSnapshot: {
                schemaVersion: 2,
                plan: { schemaVersion: 1, effects: [{
                    effectId: "avatar", type: "inventory_entitlement",
                    catalog: "shop_item", itemReference: "1", renderSnapshot: {},
                }] },
            },
            isActive: true,
        },
    });
    await prisma.paymentOffer.create({
        data: {
            code: unsupportedOfferCode,
            productKind: "coin_pack",
            productReference: `future_asset_${suffix}`,
            productVersion: 1,
            productName: "Unavailable Future Asset",
            unitAmountMinor: 100,
            currency: "TRY",
            grantSnapshot: {
                schemaVersion: 2,
                plan: { schemaVersion: 1, effects: [{
                    effectId: "gem", type: "balance_credit", assetCode: "GEM", amount: 5,
                }] },
            },
            isActive: true,
        },
    });

    const acceptedAt = new Date();
    const input = {
        userId: user.id,
        provider: "iyzico" as const,
        providerConfigVersion: 1,
        idempotencyKey: `checkout:${suffix}:0001`,
        quote: {
            productKind: "cosmetic_item" as const,
            productReference: `avatar_${suffix}`,
            productVersion: 2,
            productName: "Integration Checkout Avatar",
            quantity: 1,
            unitAmountMinor: 12_900,
            currency: "TRY",
            grantSnapshot: {
                schemaVersion: 2,
                plan: { schemaVersion: 1, effects: [{
                    effectId: "avatar", type: "inventory_entitlement",
                    catalog: "shop_item", itemReference: "1", renderSnapshot: {},
                }] },
            },
        },
        legalAcceptance: {
            checkoutTermsVersion: "terms-v1",
            privacyNoticeVersion: "privacy-v1",
            distanceSalesNoticeVersion: "distance-v1",
            buyerDataPolicyVersion: "buyer-data-v1",
            acceptedAt,
            requestId: `request-${suffix}`,
            userAgentHash: createHash("sha256").update("integration-agent").digest("hex"),
        },
    };

    try {
        const offerViews = await listActivePaymentOffers();
        assert.equal(offerViews.some((offer) => offer.code === offerCode), true);
        assert.equal(offerViews.some((offer) => offer.code === unsupportedOfferCode), false);
        assert.equal(await getActivePaymentOffer(unsupportedOfferCode), null);

        const [first, duplicate] = await Promise.all([
            createPaymentCheckoutOrderRecord(input),
            createPaymentCheckoutOrderRecord(input),
        ]);
        assert.equal(duplicate.order.id, first.order.id);
        assert.equal([first, duplicate].filter((result) => result.reused).length, 1);

        const consents = await prisma.paymentCheckoutConsent.findMany({
            where: { orderId: first.order.id },
        });
        assert.equal(consents.length, 1);
        assert.equal(consents[0]?.checkoutTermsVersion, "terms-v1");
        assert.equal(consents[0]?.buyerDataPolicyVersion, "buyer-data-v1");
        assert.equal(consents[0]?.requestId, `request-${suffix}`);

        await assert.rejects(
            () => createPaymentCheckoutOrderRecord({
                ...input,
                legalAcceptance: { ...input.legalAcceptance, checkoutTermsVersion: "terms-v2" },
            }),
            (error: unknown) => error instanceof PaymentOrderConflictError
        );
        await assert.rejects(
            () => createPaymentCheckoutOrderRecord({
                ...input,
                legalAcceptance: { ...input.legalAcceptance, buyerDataPolicyVersion: "buyer-data-v2" },
            }),
            (error: unknown) => error instanceof PaymentOrderConflictError
        );
        assert.equal(await prisma.paymentOrder.count({ where: { userId: user.id } }), 1);
    } finally {
        await prisma.paymentCheckoutConsent.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentOrder.deleteMany({ where: { userId: user.id } });
        await prisma.paymentOffer.deleteMany({ where: { code: { in: [offerCode, unsupportedOfferCode] } } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.$disconnect();
    }

    console.log("payment checkout integration checks passed");
}

void run();
