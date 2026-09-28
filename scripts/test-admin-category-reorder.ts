import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateAdminCategoryReorderUpdates } from "../apps/web/src/lib/categories/admin-category-reorder";

const categories = [
    { id: 1, parentId: null },
    { id: 2, parentId: null },
    { id: 11, parentId: 1 },
];

assert.deepEqual(
    validateAdminCategoryReorderUpdates(
        [
            { id: 2, sortOrder: 10 },
            { id: 1, sortOrder: 0 },
        ],
        categories
    ),
    [
        { id: 1, sortOrder: 0 },
        { id: 2, sortOrder: 10 },
    ]
);

assert.throws(
    () =>
        validateAdminCategoryReorderUpdates(
            [
                { id: 1, sortOrder: 0 },
                { id: 1, sortOrder: 10 },
            ],
            categories
        ),
    /birden fazla/
);

assert.throws(
    () =>
        validateAdminCategoryReorderUpdates([{ id: 11, sortOrder: 0 }], categories),
    /Alt kategoriler/
);

assert.throws(
    () =>
        validateAdminCategoryReorderUpdates([{ id: 1, sortOrder: 0 }], categories),
    /tüm ana kategorileri/
);

assert.throws(
    () =>
        validateAdminCategoryReorderUpdates(
            [
                { id: 1, sortOrder: 0 },
                { id: 999, sortOrder: 10 },
            ],
            categories
        ),
    /bulunamadı/
);

assert.throws(
    () =>
        validateAdminCategoryReorderUpdates(
            [
                { id: 1, sortOrder: 0 },
                { id: 2, sortOrder: 20 },
            ],
            categories
        ),
    /10'ar artmalıdır/
);

assert.throws(
    () =>
        validateAdminCategoryReorderUpdates(
            [
                { id: 1, sortOrder: 0 },
                { id: 2, sortOrder: 0 },
            ],
            categories
        ),
    /10'ar artmalıdır/
);

const pageSource = readFileSync(
    "apps/web/src/app/admin/(dashboard)/categories/page.tsx",
    "utf8"
);
const routeSource = readFileSync(
    "apps/web/src/app/api/admin/categories/reorder/route.ts",
    "utf8"
);
assert.match(pageSource, /TouchSensor/);
assert.match(pageSource, /reorderInFlightRef/);
assert.match(pageSource, /setCategories\(previousCategories\)/);
assert.match(pageSource, /Yukarı taşı/);
assert.match(pageSource, /Aşağı taşı/);
assert.match(routeSource, /invalidateCategoryCache\(\)/);
assert.match(routeSource, /admin\.category\.reorder/);

console.log("admin-category-reorder smoke test passed");
