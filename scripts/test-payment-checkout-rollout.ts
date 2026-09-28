import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    DEFAULT_PAYMENT_CHECKOUT_CONTROL,
    evaluatePaymentCheckoutAccess,
    getPaymentRolloutBucket,
    isPaymentRolloutSeedConfigured,
} from "@hushle/platform-payments";

const seed = "checkout-rollout-test-seed-v1";
assert.equal(isPaymentRolloutSeedConfigured(seed), true);
assert.equal(isPaymentRolloutSeedConfigured("replace_with_seed"), false);
assert.equal(isPaymentRolloutSeedConfigured("short"), false);

const firstBucket = getPaymentRolloutBucket(42, seed);
assert.equal(getPaymentRolloutBucket(42, seed), firstBucket);
assert.ok(firstBucket >= 0 && firstBucket <= 99);

const baseline = {
    userId: 42,
    control: DEFAULT_PAYMENT_CHECKOUT_CONTROL,
    runtimeReady: true,
    legalReady: true,
    providerSurfaceReady: true,
    rolloutSeed: seed,
};
assert.equal(evaluatePaymentCheckoutAccess(baseline).reason, "checkout_paused");
assert.equal(evaluatePaymentCheckoutAccess({
    ...baseline,
    controlAvailable: false,
}).reason, "control_unavailable");
assert.equal(evaluatePaymentCheckoutAccess({
    ...baseline,
    control: { ...baseline.control, paused: false },
}).reason, "rollout_closed");
assert.equal(evaluatePaymentCheckoutAccess({
    ...baseline,
    control: { ...baseline.control, paused: false, rolloutPercent: 100 },
}).available, true);
assert.equal(evaluatePaymentCheckoutAccess({
    ...baseline,
    control: { ...baseline.control, paused: false, rolloutPercent: 100 },
    rolloutSeed: "",
}).reason, "rollout_seed_missing");

const outsideUserId = Array.from({ length: 1_000 }, (_, index) => index + 1)
    .find((userId) => getPaymentRolloutBucket(userId, seed) >= 10);
assert.ok(outsideUserId);
assert.equal(evaluatePaymentCheckoutAccess({
    ...baseline,
    userId: outsideUserId!,
    control: { ...baseline.control, paused: false, rolloutPercent: 10 },
}).reason, "outside_rollout");

const paytrRoute = readFileSync("apps/web/src/app/api/payments/checkout/session/route.ts", "utf8");
const iyzicoRoute = readFileSync("apps/web/src/app/api/payments/checkout/iyzico/session/route.ts", "utf8");
const callbackRoute = readFileSync("apps/web/src/app/api/payments/callback/iyzico/route.ts", "utf8");
const webhookRoute = readFileSync("apps/web/src/app/api/payments/webhooks/[provider]/route.ts", "utf8");
const adminRoute = readFileSync("apps/web/src/app/api/admin/payments/checkout-control/route.ts", "utf8");
for (const route of [paytrRoute, iyzicoRoute]) {
    assert.match(route, /getPaymentCheckoutAccess\(sessionUser\.id, \{ fresh: true \}\)/);
}
assert.doesNotMatch(callbackRoute, /checkout-control|getPaymentCheckoutAccess/);
assert.doesNotMatch(webhookRoute, /checkout-control|getPaymentCheckoutAccess/);
assert.match(adminRoute, /ODEMEYI AC/);
assert.match(adminRoute, /isPaymentCheckoutExpansion/);

console.log("Payment checkout rollout policy checks passed.");
