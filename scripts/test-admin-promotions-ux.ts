import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    normalizePromotionBulkIds,
    promotionBulkStatusSchema,
} from "../apps/web/src/lib/promotions/bulk-status";

const pageSource = readFileSync(
    "apps/web/src/app/admin/(dashboard)/promotions/page.tsx",
    "utf8"
);
const routeSource = readFileSync(
    "apps/web/src/app/api/admin/promotions/bulk-status/route.ts",
    "utf8"
);

assert.deepEqual(normalizePromotionBulkIds([4, 4, 2, 4]), [4, 2]);
assert.deepEqual(
    promotionBulkStatusSchema.parse({
        kind: "discounts",
        ids: [1, 2],
        isActive: false,
    }),
    {
        kind: "discounts",
        ids: [1, 2],
        isActive: false,
    }
);
assert.throws(() =>
    promotionBulkStatusSchema.parse({
        kind: "items",
        ids: [1],
        isActive: true,
    })
);
assert.throws(() =>
    promotionBulkStatusSchema.parse({
        kind: "bundles",
        ids: Array.from({ length: 101 }, (_, index) => index + 1),
        isActive: true,
    })
);

assert.match(pageSource, /<Sheet[\s\S]*<BundleEditor/);
assert.match(pageSource, /<Sheet[\s\S]*<DiscountEditor/);
assert.match(pageSource, /<Sheet[\s\S]*<CouponEditor/);
assert.match(pageSource, /<Dialog[\s\S]*Kalıcı Olarak Sil/);
assert.doesNotMatch(pageSource, /window\.alert/);
assert.match(pageSource, /\/api\/admin\/promotions\/bulk-status/);
assert.match(pageSource, /changedEntries\s*\.slice\(0,\s*100\)/);
assert.match(pageSource, /aria-pressed=/);

assert.match(routeSource, /requireAdminSession/);
assert.match(routeSource, /admin-promotions-bulk-status/);
assert.match(routeSource, /maxRequests:\s*10/);
assert.match(routeSource, /writeAuditLog/);
assert.match(routeSource, /invalidateStoreCatalogCache/);

console.log("Admin promotions UX checks passed.");
