import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
    PAYTR_STATUS_QUERY_ENDPOINT,
    buildPaytrStatusQueryForm,
    queryPaytrPaymentStatus,
} from "@hushle/platform-payments";

async function run(): Promise<void> {
const credentials = { merchantId: "123456", merchantKey: "key", merchantSalt: "salt" };
const form = buildPaytrStatusQueryForm({ merchantOrderId: "ORDER123", credentials });
assert.equal(form.get("merchant_id"), "123456");
assert.equal(form.get("merchant_oid"), "ORDER123");
assert.equal(
    form.get("paytr_token"),
    createHmac("sha256", "key").update("123456ORDER123salt").digest("base64")
);

let requestedUrl = "";
const result = await queryPaytrPaymentStatus({
    merchantOrderId: "ORDER123",
    credentials,
    fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        assert.equal(init?.method, "POST");
        assert.match(String(init?.body), /merchant_oid=ORDER123/);
        return new Response(JSON.stringify({
            status: "success",
            payment_amount: "125.50",
            payment_total: "130,75",
            currency: "TL",
            test_mode: "1",
            returns: [{ merchant_oid: "redacted-by-adapter" }],
            masked_pan: "must-not-leak",
        }), { status: 200, headers: { "content-type": "application/json" } });
    },
});
assert.equal(requestedUrl, PAYTR_STATUS_QUERY_ENDPOINT);
assert.deepEqual(result, {
    status: "success",
    paymentAmountMinor: 12_550,
    paymentTotalMinor: 13_075,
    currency: "TRY",
    testMode: true,
    returnCount: 1,
    refunds: [],
});
assert.equal(JSON.stringify(result).includes("masked_pan"), false);

await assert.rejects(
    () => queryPaytrPaymentStatus({
        merchantOrderId: "ORDER123",
        credentials,
        fetchImpl: async () => new Response("x".repeat(16_385), { status: 200 }),
    }),
    (error: unknown) => error instanceof Error && error.message === "invalid_provider_response"
);

const reversal = readFileSync("packages/platform-payments/src/reversal.ts", "utf8");
const caseResolution = readFileSync("packages/platform-payments/src/case-resolution.ts", "utf8");
const reconciliation = readFileSync("packages/platform-payments/src/reconciliation.ts", "utf8");
const refunds = readFileSync("packages/platform-payments/src/refunds.ts", "utf8");
const migration = readFileSync("prisma/migrations/20260809020000_payment_reconciliation_reversal/migration.sql", "utf8");
const approvalMigration = readFileSync("prisma/migrations/20260809040000_payment_case_resolution_dual_approval/migration.sql", "utf8");
const coinLotMigration = readFileSync("prisma/migrations/20260809060000_payment_coin_lot_provenance/migration.sql", "utf8");
const reversalRoute = readFileSync("apps/web/src/app/api/admin/payments/[id]/reversal/route.ts", "utf8");
const reviewRoute = readFileSync("apps/web/src/app/api/admin/payments/reversal-requests/[id]/review/route.ts", "utf8");
const caseRoute = readFileSync("apps/web/src/app/api/admin/payments/cases/[id]/resolution/route.ts", "utf8");
const reconciliationRoute = readFileSync("apps/web/src/app/api/admin/payments/[id]/reconcile/route.ts", "utf8");
const retryRoute = readFileSync("apps/web/src/app/api/admin/payments/webhooks/[id]/retry/route.ts", "utf8");
assert.match(reversal, /FOR UPDATE/);
assert.match(reversal, /exact_payment_lot_reversal/);
assert.match(reversal, /legacy_manual_review_no_wallet_mutation/);
assert.match(reversal, /inventoryItem\.deleteMany/);
assert.doesNotMatch(reversal, /applyWalletLedgerMutation/);
assert.match(reversal, /second_approver_required/);
assert.match(reversal, /admin_actor_required/);
assert.match(reversal, /request\.requestedByUserId === value\.reviewedByUserId/);
assert.match(caseResolution, /order_not_terminal/);
assert.match(caseResolution, /FOR UPDATE/);
assert.match(reconciliation, /provider_payment_mismatch/);
assert.match(reconciliation, /returnCount > 0/);
assert.match(reconciliation, /iyzico_initialize_uncertain_manual_review/);
assert.match(reconciliation, /iyzico_exact_proof_required/);
assert.match(reconciliation, /IYZICO_RECONCILIATION_MODE/);
assert.match(reconciliation, /SHOPIER_RECONCILIATION_MODE/);
assert.match(refunds, /SHOPIER_REFUND_MODE/);
assert.match(reconciliation, /shopier_listing_match_ambiguous/);
assert.match(reconciliation, /listShopierPaidOrdersByProduct/);
assert.match(reconciliation, /SELECT id FROM payment_orders WHERE id = \$\{input\.orderId\} FOR UPDATE/);
assert.match(migration, /UNIQUE INDEX `payment_reversals_order_id_key`/);
assert.match(migration, /payment_reconciliation_cases/);
assert.match(approvalMigration, /payment_reversal_requests/);
assert.match(approvalMigration, /requested_by_user_id/);
assert.match(approvalMigration, /reviewed_by_user_id/);
assert.match(coinLotMigration, /payment_coin_lots/);
assert.match(coinLotMigration, /payment_coin_lot_allocations/);
assert.match(coinLotMigration, /payment_reversal/);
for (const route of [reversalRoute, reviewRoute, caseRoute, reconciliationRoute, retryRoute]) {
    assert.match(route, /requireAdminSession/);
    assert.match(route, /consumeRequestRateLimit/);
    assert.match(route, /writeAuditLog/);
}
assert.match(reversalRoute, /confirmationOrderId/);
assert.match(reviewRoute, /confirmationRequestId/);
assert.match(caseRoute, /confirmationCaseId/);
assert.match(reconciliationRoute, /confirmationOrderId/);
assert.match(reconciliationRoute, /reconcilePaymentOrder/);
assert.match(reconciliationRoute, /IYZICO_RECONCILIATION_MODE/);
assert.match(reconciliationRoute, /SHOPIER_RECONCILIATION_MODE/);
assert.match(retryRoute, /confirmationEventId/);

console.log("Payment reconciliation and reversal checks passed");
}

void run();
