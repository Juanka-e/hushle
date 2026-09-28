import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
    buildIyzicoCfInitializeResponseSignature,
    buildIyzicoCfRetrieveResponseSignature,
} from "@hushle/platform-payments";
import {
    buildIyzicoOwnerCallbackUrl,
    buildOwnerCheckoutRedirect,
    getIyzicoOwnerSurfaceReadiness,
    getPublicPaymentOrigin,
} from "../apps/web/src/lib/payments/iyzico-owner-surface";

const enabled = {
    PAYMENTS_ENABLED: "true",
    PAYMENT_ACTIVE_PROVIDER: "iyzico",
    IYZICO_API_KEY: "sandbox-api-key",
    IYZICO_SECRET_KEY: "sandbox-secret-key",
    IYZICO_CHECKOUT_MODE: "sandbox",
    IYZICO_CALLBACK_MODE: "sandbox",
    IYZICO_OWNER_CHECKOUT_MODE: "sandbox",
    IYZICO_WEBHOOK_MODE: "sandbox",
    IYZICO_RECONCILIATION_MODE: "sandbox",
    IYZICO_SANDBOX_ACCEPTANCE_RECORDED: "true",
    IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256: `sha256:${"a".repeat(64)}`,
};
assert.deepEqual(getIyzicoOwnerSurfaceReadiness(enabled), {
    sessionEnabled: true,
    callbackEnabled: true,
    sessionIssues: [],
    callbackIssues: [],
});
assert.equal(getIyzicoOwnerSurfaceReadiness({ ...enabled, IYZICO_OWNER_CHECKOUT_MODE: "disabled" }).sessionEnabled, false);
assert.equal(getIyzicoOwnerSurfaceReadiness({ ...enabled, PAYMENTS_ENABLED: "false" }).callbackEnabled, true);
assert.equal(getIyzicoOwnerSurfaceReadiness({ ...enabled, IYZICO_CALLBACK_MODE: "disabled" }).callbackEnabled, false);
assert.equal(getIyzicoOwnerSurfaceReadiness({ ...enabled, IYZICO_SANDBOX_ACCEPTANCE_RECORDED: "false" }).sessionEnabled, false);
assert.equal(getIyzicoOwnerSurfaceReadiness({ ...enabled, IYZICO_SANDBOX_ACCEPTANCE_RECORDED: "false" }).callbackEnabled, true);
assert.equal(getIyzicoOwnerSurfaceReadiness({ ...enabled, IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256: "" }).sessionEnabled, false);
assert.equal(getIyzicoOwnerSurfaceReadiness({ ...enabled, IYZICO_API_KEY: "live-api-key" }).callbackEnabled, false);
assert.equal(getPublicPaymentOrigin({ NEXT_PUBLIC_SITE_URL: "https://play.example.test" }), "https://play.example.test");
assert.equal(getPublicPaymentOrigin({ NEXT_PUBLIC_SITE_URL: "http://play.example.test" }), null);
assert.equal(getPublicPaymentOrigin({ NEXT_PUBLIC_SITE_URL: "https://user@play.example.test" }), null);
const orderId = "11111111-2222-4333-8444-555555555555";
assert.equal(
    buildIyzicoOwnerCallbackUrl("https://play.example.test", orderId),
    `https://play.example.test/api/payments/callback/iyzico?order=${orderId}`
);
assert.equal(
    buildOwnerCheckoutRedirect("https://play.example.test", orderId, "provider-return"),
    `https://play.example.test/checkout?order=${orderId}&result=provider-return`
);

const secretKey = "sandbox-secret-key";
assert.equal(
    buildIyzicoCfInitializeResponseSignature({ secretKey, conversationId: orderId, token: "token" }),
    createHmac("sha256", secretKey).update(`${orderId}:token`).digest("hex")
);
assert.equal(
    buildIyzicoCfRetrieveResponseSignature({
        secretKey,
        paymentStatus: "SUCCESS",
        paymentId: "123",
        currency: "TRY",
        basketId: orderId,
        conversationId: orderId,
        paidPrice: "25.00",
        price: "25.0",
        token: "token",
    }),
    createHmac("sha256", secretKey)
        .update(`SUCCESS:123:TRY:${orderId}:${orderId}:25:25:token`)
        .digest("hex")
);

const sessionRoute = readFileSync(
    "apps/web/src/app/api/payments/checkout/iyzico/session/route.ts",
    "utf8"
);
const callbackRoute = readFileSync(
    "apps/web/src/app/api/payments/callback/iyzico/route.ts",
    "utf8"
);
const orderRoute = readFileSync("apps/web/src/app/api/payments/orders/[id]/route.ts", "utf8");
const offersRoute = readFileSync("apps/web/src/app/api/payments/offers/route.ts", "utf8");
const checkoutUi = readFileSync("apps/web/src/components/payments/checkout-content.tsx", "utf8");
assert.match(sessionRoute, /getSessionUser/);
assert.match(sessionRoute, /enforceAccountCapability/);
assert.match(sessionRoute, /VERIFIED_EMAIL_REQUIRED/);
assert.match(sessionRoute, /buyerDataDisclosure/);
assert.match(sessionRoute, /PAYMENT_BUYER_DATA_POLICY_VERSION/);
assert.match(sessionRoute, /payment-checkout-user/);
assert.match(sessionRoute, /payment-checkout-ip/);
assert.match(sessionRoute, /MAX_BODY_BYTES = 8 \* 1024/);
assert.match(sessionRoute, /contentType !== "application\/json"/);
assert.doesNotMatch(sessionRoute, /console\./);
assert.match(callbackRoute, /application\/x-www-form-urlencoded/);
assert.match(callbackRoute, /payment-iyzico-callback-token/);
assert.match(callbackRoute, /payment-iyzico-callback-order/);
assert.match(callbackRoute, /verifyIyzicoSandboxCheckoutResult/);
assert.match(callbackRoute, /MAX_BODY_BYTES = 4 \* 1024/);
assert.doesNotMatch(callbackRoute, /getSessionUser|request\.json|console\./);
assert.match(orderRoute, /isAllowedIyzicoHostedUrl/);
assert.match(orderRoute, /redirectUrl: providerHostedUrl/);
assert.doesNotMatch(orderRoute, /providerSessionReference[,}]\s*\)/);
assert.match(offersRoute, /provider: runtime\.activeProvider/);
assert.match(offersRoute, /getIyzicoOwnerSurfaceReadiness/);
assert.match(checkoutUi, /\/api\/payments\/checkout\/iyzico\/session/);
assert.match(checkoutUi, /buyerDataDisclosure/);
assert.match(checkoutUi, /isAllowedPaymentRedirect/);
assert.match(checkoutUi, /hostname === "iyzipay\.com" \|\| hostname\.endsWith\("\.iyzipay\.com"\)/);
assert.doesNotMatch(checkoutUi, /localStorage|sessionStorage|sendBeacon|console\./);

console.log("iyzico owner checkout and callback surface checks passed");
