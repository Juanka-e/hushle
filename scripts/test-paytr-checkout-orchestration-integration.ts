import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import {
    PaytrCheckoutError,
    createPaymentCheckoutOrderRecord,
    createPaytrSandboxCheckoutSession,
} from "@hushle/platform-payments";

async function createOrder(userId: number, suffix: string, shopItemId: number) {
    return createPaymentCheckoutOrderRecord({
        userId,
        provider: "paytr",
        providerConfigVersion: 1,
        idempotencyKey: `paytr-checkout:${suffix}`,
        quote: {
            productKind: "cosmetic_item",
            productReference: `avatar_${suffix}`,
            productVersion: 1,
            productName: "Sandbox Avatar",
            quantity: 1,
            unitAmountMinor: 14900,
            currency: "TRY",
            grantSnapshot: {
                schemaVersion: 1,
                items: [{
                    shopItemId,
                    renderSnapshot: {
                        type: "avatar",
                        rarity: "epic",
                        renderMode: "image",
                        renderSpecVersion: 1,
                        imageUrl: "/images/sandbox-avatar.png",
                        templateKey: null,
                        templateConfig: null,
                        badgeText: null,
                    },
                }],
            },
        },
        legalAcceptance: {
            checkoutTermsVersion: "terms-test-v1",
            privacyNoticeVersion: "privacy-test-v1",
            distanceSalesNoticeVersion: "distance-test-v1",
            buyerDataPolicyVersion: "buyer-data-v1",
            acceptedAt: new Date(),
        },
    });
}

async function run(): Promise<void> {
    assert.equal(process.env.PAYTR_CHECKOUT_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
    const contact = {
        fullName: "Sensitive Test Name",
        phone: "+905551112233",
        address: "Sensitive Test Address Istanbul",
    };
    const user = await prisma.user.create({
        data: {
            username: `paytr_checkout_${suffix}`,
            password: "integration-test-only",
            email: `paytr_${suffix}@example.test`,
            normalizedEmail: `paytr_${suffix}@example.test`,
            emailVerifiedAt: new Date(),
        },
    });
    const item = await prisma.shopItem.create({
        data: {
            code: `paytr_avatar_${suffix}`,
            type: "avatar",
            name: "Sandbox Avatar",
            rarity: "epic",
            renderMode: "image",
            renderSpecVersion: 1,
            priceCoin: 0,
            imageUrl: "/images/sandbox-avatar.png",
        },
    });

    try {
        const order = (await createOrder(user.id, `${suffix}:success`, item.id)).order;
        let providerCalls = 0;
        let providerBody = "";
        const fetchImpl: typeof fetch = async (_url, init) => {
            providerCalls += 1;
            providerBody = String(init?.body);
            return new Response(JSON.stringify({
                status: "success",
                token: `sandbox-token-${suffix}`,
            }));
        };
        const session = await createPaytrSandboxCheckoutSession({
            orderId: order.id,
            email: user.email!,
            userIp: "203.0.113.25",
            contact,
            successUrl: `https://example.test/checkout?order=${order.id}`,
            failureUrl: `https://example.test/checkout?order=${order.id}&failed=1`,
            credentials: {
                merchantId: "123456",
                merchantKey: "integration-key",
                merchantSalt: "integration-salt",
            },
            fetchImpl,
        });
        assert.equal(session.duplicate, false);
        assert.equal(providerCalls, 1);
        const providerForm = new URLSearchParams(providerBody);
        assert.equal(providerForm.get("user_name"), contact.fullName);
        assert.equal(providerForm.get("user_phone"), contact.phone);
        assert.equal(providerForm.get("user_address"), contact.address);
        assert.equal(providerForm.get("test_mode"), "1");

        const duplicate = await createPaytrSandboxCheckoutSession({
            orderId: order.id,
            email: user.email!,
            userIp: "203.0.113.25",
            contact,
            successUrl: "https://example.test/checkout",
            failureUrl: "https://example.test/checkout?failed=1",
            credentials: {
                merchantId: "123456",
                merchantKey: "integration-key",
                merchantSalt: "integration-salt",
            },
            fetchImpl,
        });
        assert.equal(duplicate.duplicate, true);
        assert.equal(providerCalls, 1, "duplicate session must not call PayTR again");

        const stored = await prisma.paymentOrder.findUniqueOrThrow({
            where: { id: order.id },
            include: { attempts: true, checkoutConsent: true },
        });
        assert.equal(stored.status, "awaiting_payment");
        assert.equal(stored.attempts.length, 1);
        assert.equal(stored.attempts[0]?.status, "succeeded");
        assert.match(stored.attempts[0]?.providerRequestId ?? "", /^paytr-token-sha256:[a-f0-9]{64}$/);
        const persisted = JSON.stringify(stored);
        assert.equal(persisted.includes(contact.fullName), false);
        assert.equal(persisted.includes(contact.phone), false);
        assert.equal(persisted.includes(contact.address), false);

        const failedOrder = (await createOrder(user.id, `${suffix}:failed`, item.id)).order;
        await assert.rejects(
            () => createPaytrSandboxCheckoutSession({
                orderId: failedOrder.id,
                email: user.email!,
                userIp: "203.0.113.25",
                contact,
                successUrl: "https://example.test/checkout",
                failureUrl: "https://example.test/checkout?failed=1",
                credentials: {
                    merchantId: "123456",
                    merchantKey: "integration-key",
                    merchantSalt: "integration-salt",
                },
                fetchImpl: async () => new Response(JSON.stringify({
                    status: "failed",
                    reason: "provider detail must not persist",
                })),
            }),
            (error: unknown) =>
                error instanceof PaytrCheckoutError
                && error.code === "provider_rejected"
        );
        const failedAttempt = await prisma.paymentAttempt.findFirstOrThrow({
            where: { orderId: failedOrder.id },
        });
        assert.equal(failedAttempt.status, "failed");
        assert.equal(failedAttempt.errorCode, "provider_rejected");
        assert.equal(JSON.stringify(failedAttempt).includes("provider detail"), false);
    } finally {
        await prisma.paymentCheckoutConsent.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentAttempt.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentOrder.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.shopItem.delete({ where: { id: item.id } });
        await prisma.$disconnect();
    }

    console.log("PayTR checkout orchestration integration checks passed");
}

void run();
