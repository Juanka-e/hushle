import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    getPaymentProviderReadiness,
    requestStripeCheckoutSession,
    STRIPE_API_BASE_URL,
    STRIPE_API_VERSION,
    STRIPE_CHECKOUT_SESSIONS_PATH,
    StripeAdapterError,
} from "@hushle/platform-payments";

const orderId = "11111111-2222-4333-8444-555555555555";
const apiKey = "rk_test_checkout_session_create_only_123";
const request = {
    orderId,
    amountMinor: 1_197,
    currency: "TRY" as const,
    productName: "Avatar",
    successUrl: "https://play.example.test/checkout/success",
    cancelUrl: "https://play.example.test/checkout/cancel",
    idempotencyKey: `checkout:${orderId}:1`,
    credentials: { apiKey },
};

function providerSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "cs_test_session_123",
        object: "checkout.session",
        url: "https://checkout.stripe.com/c/pay/cs_test_session_123",
        livemode: false,
        client_reference_id: orderId,
        amount_total: 1_197,
        currency: "try",
        payment_status: "unpaid",
        status: "open",
        customer_details: { email: "must-not-escape@example.test" },
        ...overrides,
    };
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
    await assert.rejects(action, (error: unknown) => {
        assert.ok(error instanceof StripeAdapterError);
        assert.equal(error.code, code);
        return true;
    });
}

async function run(): Promise<void> {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedHeaders = new Headers();
    const result = await requestStripeCheckoutSession({
        ...request,
        fetchImpl: async (input, init) => {
            capturedUrl = String(input);
            capturedBody = String(init?.body);
            capturedHeaders = new Headers(init?.headers);
            return new Response(JSON.stringify(providerSession()));
        },
    });

    assert.equal(capturedUrl, `${STRIPE_API_BASE_URL}${STRIPE_CHECKOUT_SESSIONS_PATH}`);
    assert.equal(capturedHeaders.get("authorization"), `Bearer ${apiKey}`);
    assert.equal(capturedHeaders.get("stripe-version"), STRIPE_API_VERSION);
    assert.equal(capturedHeaders.get("idempotency-key"), request.idempotencyKey);
    assert.equal(capturedHeaders.get("content-type"), "application/x-www-form-urlencoded");
    assert.equal(capturedBody.includes(apiKey), false);
    const form = new URLSearchParams(capturedBody);
    assert.equal(form.get("mode"), "payment");
    assert.equal(form.get("client_reference_id"), orderId);
    assert.equal(form.get("metadata[order_id]"), orderId);
    assert.equal(form.get("payment_intent_data[metadata][order_id]"), orderId);
    assert.equal(form.get("line_items[0][price_data][unit_amount]"), "1197");
    assert.equal(form.get("line_items[0][price_data][currency]"), "try");
    assert.deepEqual(result, {
        orderId,
        sessionId: "cs_test_session_123",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_session_123",
        amountMinor: 1_197,
        currency: "TRY",
    });
    assert.equal(JSON.stringify(result).includes("customer_details"), false);

    await expectCode(() => requestStripeCheckoutSession({
        ...request,
        credentials: { apiKey: "sk_live_must_be_rejected" },
        fetchImpl: async () => new Response(JSON.stringify(providerSession())),
    }), "invalid_request");
    await expectCode(() => requestStripeCheckoutSession({
        ...request,
        fetchImpl: async () => new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "secret" } }), { status: 400 }),
    }), "provider_rejected");
    await expectCode(() => requestStripeCheckoutSession({
        ...request,
        fetchImpl: async () => new Response(JSON.stringify(providerSession({ url: "https://attacker.example/pay" }))),
    }), "invalid_provider_response");
    await expectCode(() => requestStripeCheckoutSession({
        ...request,
        fetchImpl: async () => new Response(JSON.stringify(providerSession({ amount_total: 1_198 }))),
    }), "invalid_provider_response");
    await expectCode(() => requestStripeCheckoutSession({
        ...request,
        fetchImpl: async () => new Response(JSON.stringify(providerSession({ client_reference_id: crypto.randomUUID() }))),
    }), "invalid_provider_response");
    await expectCode(() => requestStripeCheckoutSession({
        ...request,
        fetchImpl: async () => new Response("x".repeat(65_537)),
    }), "invalid_provider_response");

    const readiness = getPaymentProviderReadiness("stripe", {
        STRIPE_SECRET_KEY: apiKey,
        STRIPE_WEBHOOK_SECRET: "whsec_test_123",
        STRIPE_CHECKOUT_MODE: "sandbox",
    });
    assert.equal(readiness.credentialsConfigured, true);
    assert.equal(readiness.adapterAvailable, false);
    assert.equal(readiness.ready, false);
    assert.equal(getPaymentProviderReadiness("stripe", {
        STRIPE_SECRET_KEY: "sk_live_must_not_look_configured",
        STRIPE_WEBHOOK_SECRET: "whsec_test_123",
        STRIPE_CHECKOUT_MODE: "sandbox",
    }).credentialsConfigured, false);

    const checkoutRoute = await readFile(
        "apps/web/src/app/api/payments/checkout/session/route.ts",
        "utf8"
    );
    assert.equal(checkoutRoute.includes("requestStripeCheckoutSession"), false);
    assert.equal(checkoutRoute.includes("STRIPE_"), false);
    console.log("Stripe Checkout Session bounded sandbox transport checks passed");
}

void run();
