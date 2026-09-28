import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
    buildIyzicoCfInitializeResponseSignature,
    buildIyzicoCfRetrieveResponseSignature,
    buildIyzicoV2Authorization,
    getPaymentProviderReadiness,
    IYZICO_CF_INITIALIZE_PATH,
    IYZICO_CF_RETRIEVE_PATH,
    IYZICO_SANDBOX_BASE_URL,
    IyzicoAdapterError,
    requestIyzicoCheckoutForm,
    retrieveIyzicoCheckoutForm,
} from "@hushle/platform-payments";

const credentials = { apiKey: "sandbox-api-key", secretKey: "sandbox-secret-key" };
const randomKey = "1234567890ABCDEF1234567890ABCDEF";
const conversationId = "11111111-2222-4333-8444-555555555555";

function expectedAuthorization(path: string, body: string): string {
    const signature = createHmac("sha256", credentials.secretKey)
        .update(`${randomKey}${path}${body}`, "utf8")
        .digest("hex");
    return `IYZWSv2 ${Buffer.from(`apiKey:${credentials.apiKey}&randomKey:${randomKey}&signature:${signature}`).toString("base64")}`;
}

const directBody = JSON.stringify({ locale: "tr", conversationId });
assert.equal(buildIyzicoV2Authorization({
    ...credentials,
    randomKey,
    uriPath: IYZICO_CF_INITIALIZE_PATH,
    requestBody: directBody,
}), expectedAuthorization(IYZICO_CF_INITIALIZE_PATH, directBody));

const request = {
    conversationId,
    amountMinor: 1_197,
    currency: "TRY" as const,
    callbackUrl: "https://play.example.test/api/payments/callback/iyzico",
    buyer: {
        id: "user:42",
        name: "Test",
        surname: "Oyuncu",
        identityNumber: "11111111111",
        email: "test@example.test",
        gsmNumber: "+905551112233",
        registrationAddress: "Test Mahallesi 1",
        city: "Istanbul",
        country: "Turkey",
        ip: "203.0.113.10",
    },
    billingAddress: { address: "Test Mahallesi 1", contactName: "Test Oyuncu", city: "Istanbul", country: "Turkey" },
    shippingAddress: { address: "Test Mahallesi 1", contactName: "Test Oyuncu", city: "Istanbul", country: "Turkey" },
    basketItem: { id: "offer:avatar-1", name: "Avatar", category: "Cosmetic" },
    credentials,
    randomKey,
};

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
    await assert.rejects(action, (error: unknown) => {
        assert.ok(error instanceof IyzicoAdapterError);
        assert.equal(error.code, code);
        return true;
    });
}

async function run(): Promise<void> {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedRandomKey = "";
    let capturedAuthorization = "";
    const initialized = await requestIyzicoCheckoutForm({
        ...request,
        fetchImpl: async (input, init) => {
            capturedUrl = String(input);
            capturedBody = String(init?.body);
            const headers = new Headers(init?.headers);
            capturedRandomKey = headers.get("x-iyzi-rnd") ?? "";
            capturedAuthorization = headers.get("authorization") ?? "";
            return new Response(JSON.stringify({
                status: "success",
                conversationId,
                token: "sandboxToken_123456",
                paymentPageUrl: "https://sandbox-cpp.iyzipay.com/pay/sandboxToken_123456",
                signature: buildIyzicoCfInitializeResponseSignature({
                    secretKey: credentials.secretKey,
                    conversationId,
                    token: "sandboxToken_123456",
                }),
                checkoutFormContent: "must-not-escape",
            }));
        },
    });
    assert.equal(capturedUrl, `${IYZICO_SANDBOX_BASE_URL}${IYZICO_CF_INITIALIZE_PATH}`);
    const parsedBody = JSON.parse(capturedBody) as Record<string, unknown>;
    assert.equal(parsedBody.price, "11.97");
    assert.equal(parsedBody.paidPrice, "11.97");
    assert.equal(parsedBody.currency, "TRY");
    assert.equal(capturedRandomKey, randomKey);
    assert.equal(capturedAuthorization, expectedAuthorization(IYZICO_CF_INITIALIZE_PATH, capturedBody));
    assert.equal(capturedBody.includes(credentials.apiKey), false);
    assert.equal(capturedBody.includes(credentials.secretKey), false);
    assert.deepEqual(initialized, {
        conversationId,
        token: "sandboxToken_123456",
        paymentPageUrl: "https://sandbox-cpp.iyzipay.com/pay/sandboxToken_123456",
    });
    assert.equal(JSON.stringify(initialized).includes("checkoutFormContent"), false);

    const retrieved = await retrieveIyzicoCheckoutForm({
        conversationId,
        token: initialized.token,
        credentials,
        randomKey,
        fetchImpl: async (input, init) => {
            assert.equal(String(input), `${IYZICO_SANDBOX_BASE_URL}${IYZICO_CF_RETRIEVE_PATH}`);
            const body = String(init?.body);
            assert.equal(new Headers(init?.headers).get("authorization"), expectedAuthorization(IYZICO_CF_RETRIEVE_PATH, body));
            return new Response(JSON.stringify({
                status: "success",
                conversationId,
                token: initialized.token,
                paymentId: "987654",
                basketId: conversationId,
                price: "11.97",
                paidPrice: 11.97,
                currency: "TRY",
                fraudStatus: 1,
                paymentStatus: "SUCCESS",
                signature: buildIyzicoCfRetrieveResponseSignature({
                    secretKey: credentials.secretKey,
                    paymentStatus: "SUCCESS",
                    paymentId: "987654",
                    currency: "TRY",
                    basketId: conversationId,
                    conversationId,
                    paidPrice: 11.97,
                    price: "11.97",
                    token: initialized.token,
                }),
                cardAssociation: "must-not-escape",
            }));
        },
    });
    assert.deepEqual(retrieved, {
        conversationId,
        token: initialized.token,
        paymentId: "987654",
        amountMinor: 1_197,
        paidAmountMinor: 1_197,
        currency: "TRY",
        fraudStatus: 1,
        paymentStatus: "SUCCESS",
    });

    await expectCode(() => requestIyzicoCheckoutForm({
        ...request,
        fetchImpl: async () => new Response(JSON.stringify({ status: "failure", errorCode: "1001", errorMessage: "must-not-escape" })),
    }), "provider_rejected");
    await expectCode(() => requestIyzicoCheckoutForm({
        ...request,
        fetchImpl: async () => new Response(JSON.stringify({
            status: "success",
            conversationId,
            token: "token",
            paymentPageUrl: "https://sandbox-cpp.iyzipay.com/pay/token",
            signature: "0".repeat(64),
        })),
    }), "invalid_provider_response");
    await expectCode(() => requestIyzicoCheckoutForm({
        ...request,
        fetchImpl: async () => new Response(JSON.stringify({
            status: "success", conversationId, token: "token", paymentPageUrl: "https://attacker.example/pay",
        })),
    }), "invalid_provider_response");
    await expectCode(() => requestIyzicoCheckoutForm({
        ...request,
        fetchImpl: async () => new Response(JSON.stringify({
            status: "success", conversationId, token: "token", paymentPageUrl: "https://attacker@sandbox-cpp.iyzipay.com/pay",
        })),
    }), "invalid_provider_response");
    await expectCode(() => requestIyzicoCheckoutForm({
        ...request,
        fetchImpl: async () => new Response("x".repeat(65_537)),
    }), "invalid_provider_response");
    await expectCode(() => retrieveIyzicoCheckoutForm({
        conversationId,
        token: initialized.token,
        credentials,
        randomKey,
        fetchImpl: async () => new Response(JSON.stringify({
            status: "success", conversationId, token: "differentToken", paymentId: "1",
            price: "11.97", paidPrice: "11.97", currency: "TRY", fraudStatus: 1, paymentStatus: "SUCCESS",
        })),
    }), "invalid_provider_response");
    await expectCode(() => retrieveIyzicoCheckoutForm({
        conversationId,
        token: initialized.token,
        credentials,
        randomKey,
        fetchImpl: async () => new Response(JSON.stringify({
            status: "success",
            conversationId,
            token: initialized.token,
            paymentId: "987654",
            basketId: conversationId,
            price: "11.970",
            paidPrice: "11.9700",
            currency: "TRY",
            fraudStatus: 1,
            paymentStatus: "SUCCESS",
            signature: "0".repeat(64),
        })),
    }), "invalid_provider_response");

    const readiness = getPaymentProviderReadiness("iyzico", {
        IYZICO_API_KEY: credentials.apiKey,
        IYZICO_SECRET_KEY: credentials.secretKey,
        IYZICO_MERCHANT_ID: "3404590",
        IYZICO_CHECKOUT_MODE: "sandbox",
        IYZICO_WEBHOOK_MODE: "sandbox",
        IYZICO_RECONCILIATION_MODE: "sandbox",
        IYZICO_OWNER_CHECKOUT_MODE: "sandbox",
        IYZICO_CALLBACK_MODE: "sandbox",
        IYZICO_SANDBOX_ACCEPTANCE_RECORDED: "true",
        IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256: `sha256:${"a".repeat(64)}`,
    });
    assert.equal(readiness.adapterAvailable, true);
    assert.equal(readiness.credentialsConfigured, true);
    assert.equal(readiness.ready, true);
    assert.equal(getPaymentProviderReadiness("iyzico", {
        IYZICO_API_KEY: credentials.apiKey,
        IYZICO_SECRET_KEY: credentials.secretKey,
        IYZICO_MERCHANT_ID: "3404590",
        IYZICO_CHECKOUT_MODE: "live",
        IYZICO_WEBHOOK_MODE: "sandbox",
        IYZICO_RECONCILIATION_MODE: "sandbox",
        IYZICO_OWNER_CHECKOUT_MODE: "sandbox",
        IYZICO_CALLBACK_MODE: "sandbox",
        IYZICO_SANDBOX_ACCEPTANCE_RECORDED: "true",
        IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256: `sha256:${"a".repeat(64)}`,
    }).credentialsConfigured, false);
    assert.equal(getPaymentProviderReadiness("iyzico", {
        IYZICO_API_KEY: credentials.apiKey,
        IYZICO_SECRET_KEY: credentials.secretKey,
        IYZICO_MERCHANT_ID: "3404590",
        IYZICO_CHECKOUT_MODE: "sandbox",
        IYZICO_WEBHOOK_MODE: "sandbox",
        IYZICO_RECONCILIATION_MODE: "disabled",
        IYZICO_OWNER_CHECKOUT_MODE: "sandbox",
        IYZICO_CALLBACK_MODE: "sandbox",
        IYZICO_SANDBOX_ACCEPTANCE_RECORDED: "true",
        IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256: `sha256:${"a".repeat(64)}`,
    }).credentialsConfigured, false);
    assert.equal(getPaymentProviderReadiness("iyzico", {
        IYZICO_API_KEY: credentials.apiKey,
        IYZICO_SECRET_KEY: credentials.secretKey,
        IYZICO_MERCHANT_ID: "invalid",
        IYZICO_CHECKOUT_MODE: "sandbox",
        IYZICO_WEBHOOK_MODE: "sandbox",
        IYZICO_RECONCILIATION_MODE: "sandbox",
        IYZICO_OWNER_CHECKOUT_MODE: "sandbox",
        IYZICO_CALLBACK_MODE: "sandbox",
        IYZICO_SANDBOX_ACCEPTANCE_RECORDED: "true",
        IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256: `sha256:${"a".repeat(64)}`,
    }).credentialsConfigured, false);

    const checkoutRoute = await readFile(
        "apps/web/src/app/api/payments/checkout/session/route.ts",
        "utf8"
    );
    assert.equal(checkoutRoute.includes("requestIyzicoCheckoutForm"), false);
    assert.equal(checkoutRoute.includes("IYZICO_"), false);
    console.log("iyzico Checkout Form auth and bounded transport foundation checks passed");
}

void run();
