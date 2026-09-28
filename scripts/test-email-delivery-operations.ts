import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const worker = read("packages/platform-email/src/index.ts");
const listRoute = read("apps/web/src/app/api/admin/email-delivery/route.ts");
const retryRoute = read("apps/web/src/app/api/admin/email-delivery/[id]/retry/route.ts");
const page = read("apps/web/src/app/admin/(dashboard)/email-delivery/page.tsx");
const migration = read("prisma/migrations/20260731150000_email_delivery_operations/migration.sql");

assert.match(worker, /claimEmailOutboxMessage/);
assert.match(worker, /status:\s*EmailOutboxStatus\.processing/);
assert.match(worker, /claimExpiresAt:\s*\{\s*lte:/);
assert.match(worker, /createMany\([\s\S]*skipDuplicates:\s*true/);
assert.match(worker, /emailSuppression\.findUnique/);
assert.match(listRoute, /requireAdminSession/);
assert.match(listRoute, /maxRequests:\s*90/);
assert.match(retryRoute, /requireAdminSession/);
assert.match(retryRoute, /writeAuditLog/);
assert.match(retryRoute, /maxRequests:\s*20/);
assert.match(page, /Teslimat engeli kaldırılmadan retry yapılamaz/);
assert.match(migration, /ENUM\('pending', 'processing', 'sent', 'dead_letter'\)/);
assert.doesNotMatch(worker, /providerEvent.*raw/i);

console.log("Email delivery operations checks passed.");
