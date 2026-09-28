import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getPaymentLegalReadiness } from "../apps/web/src/lib/payments/legal";

const missing = getPaymentLegalReadiness({});
assert.equal(missing.ready, false);
assert.deepEqual(missing.issues, [
    "legal_documents_not_approved",
    "legal_approval_evidence_missing",
    "business_name_missing",
    "business_address_missing",
    "contact_email_missing",
]);

const ready = getPaymentLegalReadiness({
    PAYMENT_LEGAL_APPROVED: "true",
    PAYMENT_LEGAL_BUSINESS_NAME: "Example Teknoloji A.S.",
    PAYMENT_LEGAL_BUSINESS_ADDRESS: "Example address",
    PAYMENT_LEGAL_CONTACT_EMAIL: "payments@example.test",
    PAYMENT_CHECKOUT_TERMS_VERSION: "terms-v4",
    PAYMENT_PRIVACY_NOTICE_VERSION: "privacy-v3",
    PAYMENT_DISTANCE_SALES_NOTICE_VERSION: "distance-v5",
    PAYMENT_LEGAL_APPROVAL_EVIDENCE_SHA256: `sha256:${"a".repeat(64)}`,
});
assert.equal(ready.ready, true);
assert.equal(ready.checkoutTermsVersion, "terms-v4");

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
    "prisma/migrations/20260808210000_payment_checkout_ui/migration.sql",
    "utf8"
);
const route = readFileSync(
    "apps/web/src/app/api/payments/checkout/session/route.ts",
    "utf8"
);
const checkout = readFileSync(
    "apps/web/src/components/payments/checkout-content.tsx",
    "utf8"
);
const offersRoute = readFileSync(
    "apps/web/src/app/api/payments/offers/route.ts",
    "utf8"
);

assert.match(schema, /model PaymentOffer/);
assert.match(schema, /model PaymentCheckoutConsent/);
assert.match(schema, /orderId\s+String\s+@unique/);
assert.match(migration, /FOREIGN KEY \(`order_id`\)[\s\S]*REFERENCES `payment_orders`/);
assert.doesNotMatch(migration, /FLOAT|DOUBLE|DECIMAL/);
assert.match(route, /payment-checkout-user/);
assert.match(route, /payment-checkout-ip/);
assert.match(route, /LEGAL_VERSION_MISMATCH/);
assert.match(route, /createPaytrSandboxCheckoutSession/);
assert.match(route, /VERIFIED_EMAIL_REQUIRED/);
assert.match(route, /contact: paytrCheckoutContactSchema/);
assert.match(checkout, /Ödeme Aydınlatma Metni/);
assert.match(checkout, /Ödeme yükümlülüğü doğuran siparişi ver/);
assert.match(checkout, /Fatura\/iletişim adresi/);
assert.doesNotMatch(checkout, /pazarlama|ticari ileti/i);
assert.doesNotMatch(route, /PRODUCT_NOT_SELLABLE/);
assert.doesNotMatch(offersRoute, /productKind !== "coin_pack"/);

console.log("payment checkout foundation checks passed");
