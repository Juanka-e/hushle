import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    buildIyzicoEphemeralBuyer,
    getPaymentBuyerDataPolicy,
    getSafePaymentBuyerDataDiagnostics,
    iyzicoCheckoutBuyerDataSchema,
    PAYMENT_BUYER_DATA_POLICY_VERSION,
    paytrCheckoutContactSchema,
} from "@hushle/platform-payments";

const sensitive = {
    givenName: "  Test ",
    familyName: " Oyuncu  ",
    identityNumber: "11111111111",
    phone: "+90 (555) 111-22-33",
    addressLine: "  Test Mahallesi   No 1 ",
    city: " Istanbul ",
    country: " Turkiye ",
    zipCode: " 34000 ",
};

const normalized = iyzicoCheckoutBuyerDataSchema.parse(sensitive);
assert.deepEqual(normalized, {
    givenName: "Test",
    familyName: "Oyuncu",
    identityNumber: "11111111111",
    phone: "+905551112233",
    addressLine: "Test Mahallesi No 1",
    city: "Istanbul",
    country: "Turkiye",
    zipCode: "34000",
});
assert.equal(iyzicoCheckoutBuyerDataSchema.safeParse({
    ...sensitive,
    identityNumber: "123",
}).success, false);
assert.equal(iyzicoCheckoutBuyerDataSchema.safeParse({
    ...sensitive,
    phone: "javascript:alert(1)",
}).success, false);

const ephemeral = buildIyzicoEphemeralBuyer({
    userId: 42,
    verifiedEmail: "verified@example.test",
    requestIp: "203.0.113.10",
    data: sensitive,
});
assert.equal(ephemeral.buyer.id, "user:42");
assert.equal(ephemeral.buyer.name, "Test");
assert.equal(ephemeral.buyer.surname, "Oyuncu");
assert.equal(ephemeral.buyer.identityNumber, sensitive.identityNumber);
assert.equal(ephemeral.buyer.gsmNumber, "+905551112233");
assert.deepEqual(ephemeral.billingAddress, ephemeral.shippingAddress);

const policy = getPaymentBuyerDataPolicy("iyzico");
assert.equal(policy.version, PAYMENT_BUYER_DATA_POLICY_VERSION);
assert.equal(policy.checkoutPayloadPersistence, "request_only");
assert.equal(policy.localValueLogging, "forbidden");
assert.equal(policy.localValueHashing, "forbidden");
assert.equal(policy.activation, "sandbox_ui_ready_live_blocked");
assert.ok(policy.categories.includes("government_identifier"));

const diagnostics = JSON.stringify(getSafePaymentBuyerDataDiagnostics("iyzico"));
for (const value of [
    sensitive.givenName.trim(),
    sensitive.familyName.trim(),
    sensitive.identityNumber,
    sensitive.phone,
    sensitive.addressLine.trim(),
    "verified@example.test",
    "203.0.113.10",
]) {
    assert.equal(diagnostics.includes(value), false, `diagnostics leaked: ${value}`);
}

assert.deepEqual(paytrCheckoutContactSchema.parse({
    fullName: "  Test   Oyuncu ",
    phone: "+90 (555) 111-22-33",
    address: "  Test Mahallesi   Istanbul  ",
}), {
    fullName: "Test Oyuncu",
    phone: "+905551112233",
    address: "Test Mahallesi Istanbul",
});

async function run(): Promise<void> {
    const [schema, checkoutRoute, privacyNotice] = await Promise.all([
        readFile("prisma/schema.prisma", "utf8"),
        readFile("apps/web/src/app/api/payments/checkout/session/route.ts", "utf8"),
        readFile("apps/web/src/app/legal/payment-privacy-notice/page.tsx", "utf8"),
    ]);
    const forbiddenColumns = [
        "identityNumber",
        "identity_number",
        "nationalId",
        "national_id",
        "billingAddress",
        "billing_address",
        "checkoutPhone",
        "checkout_phone",
    ];
    for (const column of forbiddenColumns) assert.equal(schema.includes(column), false);
    assert.equal(checkoutRoute.includes("buildIyzicoEphemeralBuyer"), false);
    assert.equal(checkoutRoute.includes("identityNumber"), false);
    assert.match(schema, /buyerDataPolicyVersion\s+String/);
    assert.match(checkoutRoute, /buyerDataPolicyVersion: PAYMENT_BUYER_DATA_POLICY_VERSION/);
    assert.match(privacyNotice, /kimlik numarası/);
    assert.match(privacyNotice, /hash biçiminde de saklanmaz/);
    assert.equal(privacyNotice.includes(String.fromCharCode(0xc3)), false);

    console.log("iyzico request-only buyer data and no-persistence contract checks passed");
}

void run();
