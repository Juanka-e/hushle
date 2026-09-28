import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminAuditListQuerySchema } from "../apps/web/src/lib/admin-audit/schema";
import { summarizeAuditMetadata } from "../apps/web/src/lib/admin-audit/service";

const parsedQuery = adminAuditListQuerySchema.parse({
    page: "2",
    limit: "20",
    search: "wallet",
    action: "admin.user.wallet_adjustment",
    resourceType: "user",
    actorRole: "admin",
});

assert.equal(parsedQuery.page, 2);
assert.equal(parsedQuery.limit, 20);
assert.equal(parsedQuery.search, "wallet");
assert.equal(parsedQuery.action, "admin.user.wallet_adjustment");
assert.equal(parsedQuery.resourceType, "user");
assert.equal(parsedQuery.actorRole, "admin");
assert.equal(parsedQuery.source, "hot");
assert.equal(
    adminAuditListQuerySchema.parse({ source: "archive" }).source,
    "archive"
);
assert.throws(
    () => adminAuditListQuerySchema.parse({ source: "cold-storage" }),
    /Invalid option/
);

const metadataSummary = summarizeAuditMetadata({
    amount: 250,
    mode: "credit",
    tags: ["coin", "campaign"],
    nested: { reason: "ignored" },
    active: true,
});

assert.deepEqual(metadataSummary, {
    amount: "250",
    mode: "credit",
    tags: "coin, campaign",
    nested: "[complex]",
    active: "true",
});

assert.deepEqual(summarizeAuditMetadata(null), {});
assert.deepEqual(summarizeAuditMetadata(["ignored"]), {});

const auditRouteSource = readFileSync(
    "apps/web/src/app/api/admin/audit/route.ts",
    "utf8"
);
const auditPageSource = readFileSync(
    "apps/web/src/app/admin/(dashboard)/audit/page.tsx",
    "utf8"
);
assert.match(auditRouteSource, /source: searchParams\.get\("source"\)/);
assert.match(auditPageSource, /Aktif kayıtlar/);
assert.match(auditPageSource, /Arşivlenmiş Audit Geçmişi/);

console.log("admin audit viewer smoke test passed");
