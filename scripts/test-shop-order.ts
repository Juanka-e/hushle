import assert from "node:assert/strict";
import { buildShopItemSortUpdates } from "../apps/web/src/lib/store/shop-admin";

const updates = buildShopItemSortUpdates([14, 7, 21, 3]);

assert.deepEqual(updates, [
    { id: 14, sortOrder: 0 },
    { id: 7, sortOrder: 10 },
    { id: 21, sortOrder: 20 },
    { id: 3, sortOrder: 30 },
]);

console.log("shop order smoke test passed");
