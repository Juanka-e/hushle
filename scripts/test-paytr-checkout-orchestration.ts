import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    getPaymentProviderReadiness,
    getPaymentRuntimeReadiness,
    paytrCheckoutContactSchema,
} from "@hushle/platform-payments";
import { translate } from "../apps/web/src/lib/i18n/dictionaries";

const credentials = {
    PAYMENTS_ENABLED: "true",
    PAYMENT_ACTIVE_PROVIDER: "paytr",
    PAYTR_MERCHANT_ID: "123456",
    PAYTR_MERCHANT_KEY: "key",
    PAYTR_MERCHANT_SALT: "salt",
};

assert.equal(getPaymentProviderReadiness("paytr", credentials).ready, false);
assert.deepEqual(
    getPaymentProviderReadiness("paytr", credentials).missingEnvironment,
    ["PAYTR_CHECKOUT_MODE"]
);
assert.equal(
    getPaymentProviderReadiness("paytr", {
        ...credentials,
        PAYTR_CHECKOUT_MODE: "sandbox",
    }).ready,
    true
);
assert.equal(
    getPaymentProviderReadiness("paytr", {
        ...credentials,
        PAYTR_CHECKOUT_MODE: "live",
    }).ready,
    false,
    "live checkout must remain fail-closed"
);
assert.equal(
    getPaymentRuntimeReadiness({
        ...credentials,
        PAYTR_CHECKOUT_MODE: "sandbox",
    }).ready,
    true
);

assert.deepEqual(
    paytrCheckoutContactSchema.parse({
        fullName: "  Test   Oyuncu ",
        phone: "+90 (555) 111-22-33",
        address: "  Test Mahallesi   Istanbul  ",
    }),
    {
        fullName: "Test Oyuncu",
        phone: "+905551112233",
        address: "Test Mahallesi Istanbul",
    }
);
assert.equal(
    paytrCheckoutContactSchema.safeParse({
        fullName: "X",
        phone: "javascript:alert(1)",
        address: "short",
    }).success,
    false
);

const route = readFileSync(
    "apps/web/src/app/api/payments/checkout/session/route.ts",
    "utf8"
);
const orderRoute = readFileSync(
    "apps/web/src/app/api/payments/orders/[id]/route.ts",
    "utf8"
);
const checkout = readFileSync(
    "apps/web/src/components/payments/checkout-content.tsx",
    "utf8"
);
assert.match(route, /VERIFIED_EMAIL_REQUIRED/);
assert.match(route, /PAYTR_SANDBOX_USER_IP/);
assert.match(route, /normalizePaymentGrantSnapshot/);
assert.match(route, /INVALID_GRANT_SNAPSHOT/);
assert.match(orderRoute, /userId: sessionUser\.id/);
assert.match(checkout, /SANDBOX TEST/);
// Checkout copy lives in the i18n dictionary; the component must render the PayTR
// request-only disclosure and both locales must keep its meaning.
assert.match(checkout, /t\("checkout\.paytrPrivacy"\)/);
assert.match(
    translate("tr", "checkout.paytrPrivacy"),
    /^Bu iletişim bilgileri yalnız ödeme oturumu için PayTR'ye iletilir; Hushle sipariş, audit veya log kayıtlarına kopyalanmaz\.$/
);
assert.match(
    translate("en", "checkout.paytrPrivacy"),
    /sent to PayTR only for this payment session and is not copied into Hushle orders, audit records, or logs/
);

console.log("PayTR checkout orchestration checks passed");
