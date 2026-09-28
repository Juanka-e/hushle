import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    getPaymentWebhookProcessor,
    getPaymentWebhookVerifier,
} from "@hushle/platform-payments";

const environment = {
    PAYTR_CHECKOUT_MODE: "sandbox",
    PAYTR_MERCHANT_ID: "123456",
    PAYTR_MERCHANT_KEY: "sandbox-key",
    PAYTR_MERCHANT_SALT: "sandbox-salt",
};

assert.equal(getPaymentWebhookVerifier("stripe", environment), null);
assert.equal(getPaymentWebhookVerifier("paytr", { ...environment, PAYTR_CHECKOUT_MODE: "live" }), null);
assert.equal(getPaymentWebhookVerifier("paytr", { ...environment, PAYTR_MERCHANT_KEY: "" }), null);
assert.equal(getPaymentWebhookVerifier("paytr", environment)?.provider, "paytr");
assert.equal(typeof getPaymentWebhookProcessor(), "function");

const processor = readFileSync("packages/platform-payments/src/paytr-webhook-processor.ts", "utf8");
const fulfillmentEffects = readFileSync("packages/platform-payments/src/fulfillment-effects.ts", "utf8");
const jobs = readFileSync("apps/jobs/src/payment-webhook.ts", "utf8");
const migration = readFileSync(
    "prisma/migrations/20260809000000_paytr_webhook_processor/migration.sql",
    "utf8"
);
assert.match(processor, /FOR UPDATE/);
assert.match(processor, /amount_mismatch/);
assert.match(processor, /currency_mismatch/);
assert.match(processor, /sandbox_mode_mismatch/);
assert.match(processor, /fulfillPaidPaymentOrder/);
assert.match(fulfillmentEffects, /notificationSentAt/);
assert.match(jobs, /getPaymentWebhookProcessor/);
assert.match(migration, /notification_sent_at/);

console.log("PayTR webhook processor checks passed");
