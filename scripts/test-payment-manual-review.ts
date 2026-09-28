import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
    "prisma/migrations/20260809080000_payment_manual_review_resolution/migration.sql",
    "utf8"
);
const service = readFileSync("packages/platform-payments/src/manual-review.ts", "utf8");
const reversal = readFileSync("packages/platform-payments/src/reversal.ts", "utf8");
const route = readFileSync(
    "apps/web/src/app/api/admin/payments/reversals/[id]/manual-review/route.ts",
    "utf8"
);
const page = readFileSync("apps/web/src/app/admin/(dashboard)/payments/page.tsx", "utf8");

assert.match(schema, /enum PaymentManualReviewStatus/);
assert.match(schema, /model PaymentManualReviewCase/);
assert.match(schema, /reversalId\s+String\s+@unique/);
assert.match(migration, /INSERT INTO `payment_manual_review_cases`/);
assert.match(migration, /WHERE `status` = 'manual_review'/);
assert.match(reversal, /coin_spent_unrecovered/);
assert.match(reversal, /legacy_coin_provenance_missing/);
assert.match(reversal, /paymentManualReviewCase\.create/);
assert.match(service, /FOR UPDATE/);
assert.match(service, /actor\?\.role !== "admin"/);
assert.match(service, /reviewCase\.status !== "open"/);
assert.match(service, /resourceType: "payment_manual_review_case"/);
assert.doesNotMatch(service, /wallet\.(update|upsert|create|delete)/);
assert.doesNotMatch(service, /isSuspended|economyGuard/);
assert.match(route, /confirmationReversalId !== params\.data\.id/);
assert.match(route, /admin-payment-manual-review-resolution/);
assert.match(route, /writeAuditLog/);
const auditMetadataStart = route.indexOf("metadata:");
const auditMetadataEnd = route.indexOf("request,", auditMetadataStart);
assert.ok(auditMetadataStart >= 0 && auditMetadataEnd > auditMetadataStart);
assert.doesNotMatch(route.slice(auditMetadataStart, auditMetadataEnd), /noticeMessage/);
assert.match(page, /Bu karar bakiye, askıya alma veya ekonomi guard ayarını değiştirmez/);
assert.match(page, /Açık manuel inceleme/);

console.log("Payment manual review safety checks passed");
