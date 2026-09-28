import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import {
    buildIyzicoCfInitializeResponseSignature,
    buildIyzicoCfRetrieveResponseSignature,
    IyzicoCheckoutError,
    createIyzicoSandboxCheckoutSession,
    createPaymentCheckoutOrderRecord,
    verifyIyzicoSandboxCheckoutResult,
} from "@hushle/platform-payments";

const credentials = {
    apiKey: "sandbox-integration-api-key",
    secretKey: "sandbox-integration-secret-key",
};
const buyerData = {
    givenName: "Sensitive Test",
    familyName: "Player",
    identityNumber: "11111111110",
    phone: "+905551112233",
    addressLine: "Sensitive Integration Address Istanbul",
    city: "Istanbul",
    country: "Turkiye",
    zipCode: "34000",
};

function initializeResponse(orderId: string, token: string, paymentPageUrl: string): Response {
    return new Response(JSON.stringify({
        status: "success",
        conversationId: orderId,
        token,
        paymentPageUrl,
        signature: buildIyzicoCfInitializeResponseSignature({
            secretKey: credentials.secretKey,
            conversationId: orderId,
            token,
        }),
    }));
}

function retrieveResponse(input: {
    orderId: string;
    token: string;
    paymentId: string;
    amount: string;
}): Response {
    return new Response(JSON.stringify({
        status: "success",
        conversationId: input.orderId,
        token: input.token,
        paymentId: input.paymentId,
        basketId: input.orderId,
        price: input.amount,
        paidPrice: input.amount,
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
            paidPrice: input.amount,
            price: input.amount,
            token: input.token,
        }),
    }));
}

async function createOrder(userId: number, suffix: string, shopItemId: number) {
    return (await createPaymentCheckoutOrderRecord({
        userId,
        provider: "iyzico",
        providerConfigVersion: 1,
        idempotencyKey: `iyzico-checkout:${suffix}`,
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
    })).order;
}

async function run(): Promise<void> {
    assert.equal(process.env.IYZICO_CHECKOUT_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
    const user = await prisma.user.create({
        data: {
            username: `iyzico_checkout_${suffix}`,
            password: "integration-test-only",
            email: `iyzico_${suffix}@example.test`,
            normalizedEmail: `iyzico_${suffix}@example.test`,
            emailVerifiedAt: new Date(),
        },
    });
    const otherUser = await prisma.user.create({
        data: {
            username: `iyzico_other_${suffix}`,
            password: "integration-test-only",
            email: `iyzico_other_${suffix}@example.test`,
            normalizedEmail: `iyzico_other_${suffix}@example.test`,
            emailVerifiedAt: new Date(),
        },
    });
    const item = await prisma.shopItem.create({
        data: {
            code: `iyzico_avatar_${suffix}`,
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
        const order = await createOrder(user.id, `${suffix}:success`, item.id);
        const token = `iyzico-token-${suffix}`;
        const paymentPageUrl = `https://sandbox-cpp.iyzipay.com/?token=${token}`;
        let initializeCalls = 0;
        let initializeBody = "";
        const initializeFetch: typeof fetch = async (_url, init) => {
            initializeCalls += 1;
            initializeBody = String(init?.body);
            await new Promise((resolve) => setTimeout(resolve, 75));
            return initializeResponse(order.id, token, paymentPageUrl);
        };
        const checkoutInput = {
            orderId: order.id,
            userId: user.id,
            requestIp: "203.0.113.25",
            buyerData,
            callbackUrl: "https://example.test/api/payments/callback/iyzico",
            credentials,
            fetchImpl: initializeFetch,
        };
        await assert.rejects(
            () => createIyzicoSandboxCheckoutSession({ ...checkoutInput, userId: otherUser.id }),
            (error: unknown) => error instanceof IyzicoCheckoutError && error.code === "order_not_eligible"
        );
        assert.equal(initializeCalls, 0, "cross-owner checkout must be rejected before provider access");
        const concurrent = await Promise.allSettled([
            createIyzicoSandboxCheckoutSession(checkoutInput),
            createIyzicoSandboxCheckoutSession(checkoutInput),
        ]);
        assert.equal(initializeCalls, 1, "row lock and lease must permit one initialize request");
        const successful = concurrent.find((result) => result.status === "fulfilled");
        const blocked = concurrent.find((result) => result.status === "rejected");
        assert.ok(successful && successful.status === "fulfilled");
        assert.equal(successful.value.duplicate, false);
        assert.ok(blocked && blocked.status === "rejected");
        assert.ok(blocked.reason instanceof IyzicoCheckoutError);
        assert.equal(blocked.reason.code, "checkout_in_progress");

        const providerPayload = JSON.parse(initializeBody) as Record<string, unknown>;
        assert.equal((providerPayload.buyer as { identityNumber: string }).identityNumber, buyerData.identityNumber);
        const duplicate = await createIyzicoSandboxCheckoutSession(checkoutInput);
        assert.equal(duplicate.duplicate, true);
        assert.equal(duplicate.paymentPageUrl, paymentPageUrl);
        assert.equal(initializeCalls, 1, "durable hosted URL must resume without a second initialize");

        let retrieveCalls = 0;
        const retrieveFetch: typeof fetch = async () => {
            retrieveCalls += 1;
            return retrieveResponse({
                orderId: order.id,
                token,
                paymentId: `payment-${suffix}`,
                amount: "149.00",
            });
        };
        const verification = await verifyIyzicoSandboxCheckoutResult({
            orderId: order.id,
            token,
            credentials,
            fetchImpl: retrieveFetch,
        });
        assert.equal(verification.providerReportedSuccess, true);
        const duplicateVerification = await verifyIyzicoSandboxCheckoutResult({
            orderId: order.id,
            token,
            credentials,
            fetchImpl: retrieveFetch,
        });
        assert.equal(duplicateVerification.providerPaymentReference, verification.providerPaymentReference);
        assert.equal(retrieveCalls, 2, "retrieve is safe to repeat and proof upsert is idempotent");

        const stored = await prisma.paymentOrder.findUniqueOrThrow({
            where: { id: order.id },
            include: { attempts: true, checkoutVerification: true },
        });
        assert.equal(stored.status, "awaiting_payment", "retrieve proof must not fulfill before webhook activation");
        assert.equal(stored.attempts.length, 1);
        assert.equal(stored.attempts[0]?.status, "succeeded");
        assert.match(stored.attempts[0]?.providerRequestId ?? "", /^iyzico-token-sha256:[a-f0-9]{64}$/);
        assert.equal(stored.checkoutVerification?.providerPaymentReference, `payment-${suffix}`);
        const persisted = JSON.stringify(stored);
        for (const sensitiveValue of Object.values(buyerData)) {
            assert.equal(persisted.includes(sensitiveValue), false, `must not persist buyer value: ${sensitiveValue}`);
        }

        await assert.rejects(
            () => verifyIyzicoSandboxCheckoutResult({
                orderId: order.id,
                token: `${token}-wrong`,
                credentials,
                fetchImpl: retrieveFetch,
            }),
            (error: unknown) => error instanceof IyzicoCheckoutError && error.code === "order_not_eligible"
        );
        assert.equal(retrieveCalls, 2, "invalid callback token must be rejected before provider access");

        const mismatchOrder = await createOrder(user.id, `${suffix}:mismatch`, item.id);
        const mismatchToken = `mismatch-token-${suffix}`;
        await createIyzicoSandboxCheckoutSession({
            ...checkoutInput,
            orderId: mismatchOrder.id,
            fetchImpl: async () => initializeResponse(
                mismatchOrder.id,
                mismatchToken,
                `https://sandbox-cpp.iyzipay.com/?token=${mismatchToken}`
            ),
        });
        await assert.rejects(
            () => verifyIyzicoSandboxCheckoutResult({
                orderId: mismatchOrder.id,
                token: mismatchToken,
                credentials,
                fetchImpl: async () => retrieveResponse({
                    orderId: mismatchOrder.id,
                    token: mismatchToken,
                    paymentId: `mismatch-payment-${suffix}`,
                    amount: "148.00",
                }),
            }),
            (error: unknown) => error instanceof IyzicoCheckoutError && error.code === "invalid_provider_response"
        );
        assert.equal(await prisma.paymentCheckoutVerification.count({ where: { orderId: mismatchOrder.id } }), 0);

        const uncertainOrder = await createOrder(user.id, `${suffix}:uncertain`, item.id);
        let uncertainCalls = 0;
        const uncertainInput = {
            ...checkoutInput,
            orderId: uncertainOrder.id,
            fetchImpl: async () => {
                uncertainCalls += 1;
                throw new Error("sensitive network detail");
            },
        };
        await assert.rejects(
            () => createIyzicoSandboxCheckoutSession(uncertainInput),
            (error: unknown) => error instanceof IyzicoCheckoutError && error.code === "checkout_uncertain"
        );
        await assert.rejects(
            () => createIyzicoSandboxCheckoutSession(uncertainInput),
            (error: unknown) => error instanceof IyzicoCheckoutError && error.code === "checkout_uncertain"
        );
        assert.equal(uncertainCalls, 1, "uncertain initialize must block blind provider retry");
        const uncertainAttempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: uncertainOrder.id } });
        assert.equal(uncertainAttempt.status, "uncertain");
        assert.equal(uncertainAttempt.errorCode, "provider_unavailable");
        assert.ok(await prisma.paymentReconciliationCase.findUnique({ where: { orderId: uncertainOrder.id } }));

        const staleOrder = await createOrder(user.id, `${suffix}:stale`, item.id);
        await prisma.paymentOrder.update({ where: { id: staleOrder.id }, data: { status: "pending_provider" } });
        await prisma.paymentAttempt.create({
            data: {
                orderId: staleOrder.id,
                attemptNumber: 1,
                status: "requested",
                requestFingerprint: staleOrder.requestFingerprint,
                updatedAt: new Date(Date.now() - 120_000),
            },
        });
        let staleProviderCalls = 0;
        await assert.rejects(
            () => createIyzicoSandboxCheckoutSession({
                ...checkoutInput,
                orderId: staleOrder.id,
                fetchImpl: async () => {
                    staleProviderCalls += 1;
                    throw new Error("must not execute");
                },
            }),
            (error: unknown) => error instanceof IyzicoCheckoutError && error.code === "checkout_uncertain"
        );
        assert.equal(staleProviderCalls, 0);
        const staleAttempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: staleOrder.id } });
        assert.equal(staleAttempt.status, "uncertain", "expired request lease must commit uncertain state");
        assert.equal(staleAttempt.errorCode, "provider_request_lease_expired");
    } finally {
        await prisma.paymentCheckoutVerification.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentReconciliationCase.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentCheckoutConsent.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentAttempt.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentOrder.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: otherUser.id } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.shopItem.delete({ where: { id: item.id } });
        await prisma.$disconnect();
    }

    console.log("iyzico checkout orchestration integration checks passed");
}

void run();
