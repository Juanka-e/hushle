import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    PAYMENT_WEBHOOK_OUTCOMES,
    PaymentWebhookError,
    verifiedPaymentWebhookSchema,
} from "@hushle/platform-payments";
import { POST } from "../apps/web/src/app/api/payments/webhooks/[provider]/route";

assert.deepEqual(PAYMENT_WEBHOOK_OUTCOMES, [
    "payment_succeeded",
    "payment_failed",
    "refund",
    "chargeback",
    "ignored",
]);
assert.equal(verifiedPaymentWebhookSchema.safeParse({
    providerEventId: "evt_1",
    eventType: "payment.succeeded",
    outcome: "payment_succeeded",
    amountMinor: 12_500,
    currency: "TRY",
    metadata: { apiVersion: "2026-08" },
}).success, true);
assert.equal(verifiedPaymentWebhookSchema.safeParse({
    providerEventId: "evt_1",
    eventType: "payment.succeeded",
    outcome: "payment_succeeded",
    metadata: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`k${index}`, index])),
}).success, false);
assert.equal(new PaymentWebhookError("invalid_signature").message, "invalid_signature");

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
    "prisma/migrations/20260808190000_payment_webhook_inbox/migration.sql",
    "utf8"
);
const route = readFileSync(
    "apps/web/src/app/api/payments/webhooks/[provider]/route.ts",
    "utf8"
);
assert.match(schema, /model PaymentWebhookEvent/);
assert.match(schema, /@@unique\(\[provider, providerEventId\]\)/);
assert.match(migration, /CREATE TABLE `payment_webhook_events`/);
assert.match(route, /request\.body\.getReader\(\)/);
assert.doesNotMatch(route, /request\.arrayBuffer\(\)/);
assert.doesNotMatch(route, /request\.json\(\)|req\.json\(\)/);
assert.doesNotMatch(route, /captcha|session|isTrustedStateChangeRequest/i);
assert.match(route, /PAYMENT_WEBHOOK_MAX_BODY_BYTES/);

async function main(): Promise<void> {
    const disabledResponse = await POST(
        new Request("http://localhost/api/payments/webhooks/stripe", {
            method: "POST",
            body: "{}",
        }),
        { params: Promise.resolve({ provider: "stripe" }) }
    );
    assert.equal(disabledResponse.status, 404);
    const unknownResponse = await POST(
        new Request("http://localhost/api/payments/webhooks/unknown", {
            method: "POST",
            body: "{}",
        }),
        { params: Promise.resolve({ provider: "unknown" }) }
    );
    assert.equal(unknownResponse.status, 404);

    console.log("payment webhook inbox checks passed");
}

void main();
