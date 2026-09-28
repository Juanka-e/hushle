import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
    createShopierWebhookVerifier,
    buildShopierWebhookEventId,
    getPaymentWebhookVerifier,
    PaymentWebhookError,
} from "@hushle/platform-payments";

const now = new Date("2026-08-10T16:30:00.000Z");
const credentials = {
    webhookToken: "shopier-webhook-token-at-least-twenty-characters",
    accountId: "123456",
};
const payload = {
    id: "990001",
    paymentStatus: "paid",
    dateCreated: now.toISOString(),
    currency: "TRY",
    totals: { subtotal: "11.97", shipping: "0.00", discount: "0.00", total: "11.97" },
    shippingInfo: { email: "PLAYER@Example.test", phone: "must-not-persist" },
    lineItems: [{
        productId: "689793",
        title: "120 Coin [11111111]",
        type: "digital",
        quantity: 1,
        price: "11.97",
        total: "11.97",
    }],
};

function signedHeaders(rawBody: Uint8Array, overrides: Record<string, string> = {}) {
    return {
        "shopier-account-id": credentials.accountId,
        "shopier-event": "order.created",
        "shopier-webhook-id": "hook-1001",
        "shopier-timestamp": String(Math.floor(now.getTime() / 1000)),
        "shopier-signature": createHmac("sha256", credentials.webhookToken).update(rawBody).digest("hex"),
        ...overrides,
    };
}

async function expectInvalid(action: () => Promise<unknown>): Promise<void> {
    await assert.rejects(action, (error: unknown) => error instanceof PaymentWebhookError);
}

async function run(): Promise<void> {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const verifier = createShopierWebhookVerifier(credentials, { now: () => now });
    const event = await verifier.verify({ rawBody, headers: signedHeaders(rawBody) });
    assert.equal(event.outcome, "payment_succeeded");
    assert.equal(event.providerEventId, buildShopierWebhookEventId(rawBody));
    assert.equal(event.metadata?.webhookId, "hook-1001");
    assert.equal(event.providerOrderReference, payload.id);
    assert.equal(event.providerPaymentReference, payload.id);
    assert.equal(event.amountMinor, 1_197);
    assert.equal(event.currency, "TRY");
    assert.equal(event.metadata?.productId, "689793");
    assert.match(String(event.metadata?.buyerEmailHmac), /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(event).includes("PLAYER@Example.test"), false);
    assert.equal(JSON.stringify(event).includes("must-not-persist"), false);

    const base64Headers = signedHeaders(rawBody, {
        "shopier-signature": createHmac("sha256", credentials.webhookToken).update(rawBody).digest("base64"),
    });
    assert.equal((await verifier.verify({ rawBody, headers: base64Headers })).outcome, "payment_succeeded");
    await expectInvalid(() => verifier.verify({
        rawBody,
        headers: signedHeaders(rawBody, { "shopier-account-id": "wrong" }),
    }));
    await expectInvalid(() => verifier.verify({
        rawBody,
        headers: signedHeaders(rawBody, { "shopier-signature": "0".repeat(64) }),
    }));
    await expectInvalid(() => verifier.verify({
        rawBody,
        headers: signedHeaders(rawBody, {
            "shopier-timestamp": String(Math.floor(now.getTime() / 1000) - 301),
        }),
    }));
    for (const invalidPayload of [
        { ...payload, paymentStatus: "unpaid" },
        { ...payload, totals: { ...payload.totals, total: "11.98" } },
        { ...payload, lineItems: [{ ...payload.lineItems[0], quantity: 2 }] },
        { ...payload, lineItems: [{ ...payload.lineItems[0], type: "physical" }] },
    ]) {
        const body = Buffer.from(JSON.stringify(invalidPayload));
        await expectInvalid(() => verifier.verify({ rawBody: body, headers: signedHeaders(body) }));
    }
    await expectInvalid(() => verifier.verify({
        rawBody,
        headers: signedHeaders(rawBody, { "shopier-event": "product.updated" }),
    }));

    const environment = {
        SHOPIER_CHECKOUT_MODE: "live",
        SHOPIER_WEBHOOK_MODE: "live",
        SHOPIER_WEBHOOK_TOKEN: credentials.webhookToken,
        SHOPIER_ACCOUNT_ID: credentials.accountId,
    };
    assert.equal(getPaymentWebhookVerifier("shopier_v2", environment)?.provider, "shopier_v2");
    assert.equal(getPaymentWebhookVerifier("shopier_v2", { ...environment, SHOPIER_WEBHOOK_MODE: "disabled" }), null);

    const refundPayload = {
        id: "refund-1001", type: "full", status: "pending", orderId: payload.id,
        dateCreated: now.toISOString(), currency: "TRY", total: "11.97",
    };
    const refundBody = Buffer.from(JSON.stringify(refundPayload));
    const requested = await verifier.verify({
        rawBody: refundBody,
        headers: signedHeaders(refundBody, { "shopier-event": "refund.requested" }),
    });
    assert.equal(requested.outcome, "refund");
    assert.equal(requested.providerOrderReference, payload.id);
    assert.equal(requested.providerPaymentReference, refundPayload.id);
    assert.equal(requested.metadata?.refundStatus, "pending");
    assert.equal(requested.metadata?.refundType, "full");
    assert.equal(requested.metadata?.refundCreatedAtEpochMs, now.getTime());

    const partialUpdatedBody = Buffer.from(JSON.stringify({
        ...refundPayload, type: "partial", status: "succeeded", dateRefunded: now.toISOString(),
    }));
    const partialUpdated = await verifier.verify({
        rawBody: partialUpdatedBody,
        headers: signedHeaders(partialUpdatedBody, { "shopier-event": "refund.updated" }),
    });
    assert.equal(partialUpdated.metadata?.refundType, "partial");
    await expectInvalid(() => verifier.verify({
        rawBody: refundBody,
        headers: signedHeaders(refundBody, { "shopier-event": "refund.updated" }),
    }));
    console.log("Shopier signed webhook checks passed");
}

void run();
