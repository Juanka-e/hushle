import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    PAYMENT_ORDER_STATUSES,
    PAYMENT_PROVIDER_IDS,
    PaymentOrderTransitionError,
    assertPaymentOrderTransition,
    canTransitionPaymentOrder,
    fingerprintPaymentOrderRequest,
    getPaymentRuntimeReadiness,
    getPaymentProviderReadiness,
    listPaymentProviderReadiness,
    normalizePaymentOrderQuote,
} from "@hushle/platform-payments";

const quote = {
    productKind: "coin_pack" as const,
    productReference: "coin_launch_01",
    productVersion: 3,
    productName: "Launch Avatar",
    quantity: 2,
    unitAmountMinor: 12_500,
    currency: "try",
    grantSnapshot: { schemaVersion: 1 as const, coinAmount: 42 },
};

assert.deepEqual(normalizePaymentOrderQuote(quote), {
    ...quote,
    currency: "TRY",
    totalAmountMinor: 25_000,
});

const firstFingerprint = fingerprintPaymentOrderRequest({
    provider: "iyzico",
    providerConfigVersion: 1,
    quote,
});
const reorderedFingerprint = fingerprintPaymentOrderRequest({
    provider: "iyzico",
    providerConfigVersion: 1,
    quote: {
        ...quote,
        grantSnapshot: {
            coinAmount: 42,
            schemaVersion: 1 as const,
        },
    },
});
assert.match(firstFingerprint, /^[a-f0-9]{64}$/);
assert.equal(firstFingerprint, reorderedFingerprint);
assert.notEqual(
    firstFingerprint,
    fingerprintPaymentOrderRequest({
        provider: "iyzico",
        providerConfigVersion: 1,
        quote: { ...quote, unitAmountMinor: 12_501 },
    })
);

assert.equal(canTransitionPaymentOrder("created", "pending_provider"), true);
assert.equal(canTransitionPaymentOrder("awaiting_payment", "paid"), true);
assert.equal(canTransitionPaymentOrder("fulfilled", "chargeback"), true);
assert.equal(canTransitionPaymentOrder("created", "paid"), false);
assert.equal(canTransitionPaymentOrder("fulfilled", "awaiting_payment"), false);
assert.throws(
    () => assertPaymentOrderTransition("created", "fulfilled"),
    PaymentOrderTransitionError
);
assert.equal(PAYMENT_ORDER_STATUSES.length, 9);

const emptyEnvironment = {};
const readiness = listPaymentProviderReadiness(emptyEnvironment);
assert.deepEqual(readiness.map((item) => item.id), PAYMENT_PROVIDER_IDS);
assert.equal(readiness.every((item) => !item.ready), true);
assert.equal(getPaymentProviderReadiness("stripe", emptyEnvironment).missingEnvironment.length, 3);
assert.equal(
    getPaymentProviderReadiness("stripe", {
        STRIPE_SECRET_KEY: "sk_test_example",
        STRIPE_WEBHOOK_SECRET: "whsec_example",
        STRIPE_CHECKOUT_MODE: "sandbox",
    }).credentialsConfigured,
    true
);
assert.equal(
    getPaymentProviderReadiness("stripe", {
        STRIPE_SECRET_KEY: "sk_test_example",
        STRIPE_WEBHOOK_SECRET: "whsec_example",
        STRIPE_CHECKOUT_MODE: "sandbox",
    }).ready,
    false,
    "credentials alone must not enable an unimplemented adapter"
);
assert.equal(
    getPaymentProviderReadiness("stripe", {
        STRIPE_SECRET_KEY: "sk_live_example",
        STRIPE_WEBHOOK_SECRET: "whsec_example",
        STRIPE_CHECKOUT_MODE: "sandbox",
    }).credentialsConfigured,
    false,
    "live Stripe keys must not appear configured in the sandbox-only foundation"
);
assert.deepEqual(getPaymentRuntimeReadiness(emptyEnvironment), {
    enabled: false,
    activeProvider: null,
    ready: false,
    issues: ["checkout_disabled", "active_provider_missing_or_invalid"],
});
const enabledWithoutAdapter = getPaymentRuntimeReadiness({
    PAYMENTS_ENABLED: "true",
    PAYMENT_ACTIVE_PROVIDER: "stripe",
    STRIPE_SECRET_KEY: "sk_test_example",
    STRIPE_WEBHOOK_SECRET: "whsec_example",
    STRIPE_CHECKOUT_MODE: "sandbox",
});
assert.equal(enabledWithoutAdapter.ready, false);
assert.deepEqual(enabledWithoutAdapter.issues, ["active_provider_adapter_unavailable"]);

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
    "prisma/migrations/20260808160000_payment_orders_foundation/migration.sql",
    "utf8"
);
assert.match(schema, /model PaymentOrder/);
assert.match(schema, /@@unique\(\[userId, idempotencyKey\]\)/);
assert.match(schema, /model PaymentFulfillment/);
assert.match(schema, /orderId\s+String\s+@unique/);
assert.match(migration, /CREATE TABLE `payment_orders`/);
assert.match(migration, /UNIQUE INDEX `payment_fulfillments_order_id_key`/);
assert.doesNotMatch(migration, /FLOAT|DOUBLE|DECIMAL/);

console.log("payment order foundation checks passed");
