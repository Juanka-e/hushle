import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import { buildIyzicoCfRetrieveResponseSignature } from "@hushle/platform-payments";
import { POST } from "../apps/web/src/app/api/payments/callback/iyzico/route";

const credentials = {
    apiKey: "sandbox-owner-callback-api-key",
    secretKey: "sandbox-owner-callback-secret-key",
};

function callbackRequest(orderId: string, token: string, contentType = "application/x-www-form-urlencoded") {
    return new Request(`https://play.example.test/api/payments/callback/iyzico?order=${orderId}`, {
        method: "POST",
        headers: { "content-type": contentType },
        body: new URLSearchParams({ token }).toString(),
    });
}

async function run(): Promise<void> {
    assert.equal(process.env.IYZICO_OWNER_CALLBACK_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);
    const previous = {
        apiKey: process.env.IYZICO_API_KEY,
        secretKey: process.env.IYZICO_SECRET_KEY,
        checkoutMode: process.env.IYZICO_CHECKOUT_MODE,
        callbackMode: process.env.IYZICO_CALLBACK_MODE,
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
        fetch: globalThis.fetch,
    };
    process.env.IYZICO_API_KEY = credentials.apiKey;
    process.env.IYZICO_SECRET_KEY = credentials.secretKey;
    process.env.IYZICO_CHECKOUT_MODE = "sandbox";
    process.env.IYZICO_CALLBACK_MODE = "sandbox";
    process.env.NEXT_PUBLIC_SITE_URL = "https://play.example.test";

    const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
    const user = await prisma.user.create({
        data: { username: `iyzico_callback_${suffix}`, password: "integration-test-only" },
    });
    const orderId = randomUUID();
    const reviewOrderId = randomUUID();
    const token = `owner-callback-token-${suffix}`;
    const reviewToken = `owner-review-token-${suffix}`;
    const orderIds = [orderId, reviewOrderId];
    await prisma.paymentOrder.createMany({
        data: [
            {
                id: orderId,
                userId: user.id,
                provider: "iyzico",
                status: "awaiting_payment",
                idempotencyKey: `iyzico-owner-callback:${suffix}:valid`,
                requestFingerprint: "a".repeat(64),
                productKind: "coin_pack",
                productReference: `coin_${suffix}`,
                productVersion: 1,
                productNameSnapshot: "Callback Coin Pack",
                quantity: 1,
                unitAmountMinor: 2_500,
                totalAmountMinor: 2_500,
                currency: "TRY",
                grantSnapshot: { schemaVersion: 1, coinAmount: 250 },
                providerOrderReference: orderId,
                providerSessionReference: token,
                providerHostedUrl: `https://sandbox-cpp.iyzipay.com/?token=${token}`,
            },
            {
                id: reviewOrderId,
                userId: user.id,
                provider: "iyzico",
                status: "awaiting_payment",
                idempotencyKey: `iyzico-owner-callback:${suffix}:review`,
                requestFingerprint: "b".repeat(64),
                productKind: "coin_pack",
                productReference: `coin_review_${suffix}`,
                productVersion: 1,
                productNameSnapshot: "Callback Review Coin Pack",
                quantity: 1,
                unitAmountMinor: 3_000,
                totalAmountMinor: 3_000,
                currency: "TRY",
                grantSnapshot: { schemaVersion: 1, coinAmount: 300 },
                providerOrderReference: reviewOrderId,
                providerSessionReference: reviewToken,
                providerHostedUrl: `https://sandbox-cpp.iyzipay.com/?token=${reviewToken}`,
            },
        ],
    });

    let providerCalls = 0;
    globalThis.fetch = async (_input, init) => {
        providerCalls += 1;
        const requestBody = JSON.parse(String(init?.body)) as { conversationId: string; token: string };
        const amount = requestBody.conversationId === orderId ? "25.00" : "30.00";
        const paymentId = requestBody.conversationId === orderId
            ? `payment-${suffix}`
            : `review-payment-${suffix}`;
        return new Response(JSON.stringify({
            status: "success",
            conversationId: requestBody.conversationId,
            token: requestBody.token,
            paymentId,
            basketId: requestBody.conversationId,
            price: amount,
            paidPrice: amount,
            currency: "TRY",
            fraudStatus: 1,
            paymentStatus: "SUCCESS",
            signature: requestBody.conversationId === orderId
                ? buildIyzicoCfRetrieveResponseSignature({
                    secretKey: credentials.secretKey,
                    paymentStatus: "SUCCESS",
                    paymentId,
                    currency: "TRY",
                    basketId: requestBody.conversationId,
                    conversationId: requestBody.conversationId,
                    paidPrice: amount,
                    price: amount,
                    token: requestBody.token,
                })
                : "0".repeat(64),
        }));
    };

    try {
        const valid = await POST(callbackRequest(orderId, token));
        assert.equal(valid.status, 303);
        assert.equal(valid.headers.get("location"), `https://play.example.test/checkout?order=${orderId}&result=provider-return`);
        assert.equal(valid.headers.get("cache-control"), "no-store");
        assert.equal(valid.headers.get("referrer-policy"), "no-referrer");
        assert.equal(valid.headers.get("location")?.includes(token), false);
        assert.equal(providerCalls, 1);
        const proof = await prisma.paymentCheckoutVerification.findUniqueOrThrow({ where: { orderId } });
        assert.equal(proof.providerPaymentReference, `payment-${suffix}`);
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } })).status, "awaiting_payment");
        assert.equal(await prisma.paymentFulfillment.count({ where: { orderId } }), 0);

        const duplicate = await POST(callbackRequest(orderId, token));
        assert.equal(duplicate.status, 303);
        assert.equal(providerCalls, 2);
        assert.equal(await prisma.paymentCheckoutVerification.count({ where: { orderId } }), 1);

        const wrongToken = await POST(callbackRequest(orderId, `${token}-wrong`));
        assert.equal(wrongToken.status, 400);
        assert.equal(providerCalls, 2, "token mismatch must be rejected before provider access");

        const invalidContentType = await POST(callbackRequest(orderId, token, "application/json"));
        assert.equal(invalidContentType.status, 400);
        assert.equal(providerCalls, 2);

        const invalidSignature = await POST(callbackRequest(reviewOrderId, reviewToken));
        assert.equal(invalidSignature.status, 303);
        assert.equal(invalidSignature.headers.get("location"), `https://play.example.test/checkout?order=${reviewOrderId}&result=provider-review`);
        assert.equal(await prisma.paymentCheckoutVerification.count({ where: { orderId: reviewOrderId } }), 0);
        assert.equal(await prisma.paymentFulfillment.count({ where: { orderId: reviewOrderId } }), 0);

        process.env.IYZICO_CALLBACK_MODE = "disabled";
        const disabled = await POST(callbackRequest(orderId, token));
        assert.equal(disabled.status, 404);
        assert.equal(providerCalls, 3);
    } finally {
        globalThis.fetch = previous.fetch;
        process.env.IYZICO_API_KEY = previous.apiKey;
        process.env.IYZICO_SECRET_KEY = previous.secretKey;
        process.env.IYZICO_CHECKOUT_MODE = previous.checkoutMode;
        process.env.IYZICO_CALLBACK_MODE = previous.callbackMode;
        process.env.NEXT_PUBLIC_SITE_URL = previous.siteUrl;
        await prisma.paymentCheckoutVerification.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentReconciliationCase.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentFulfillment.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentOrder.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.$disconnect();
    }
    console.log("iyzico owner-bound callback route integration checks passed");
}

void run();
