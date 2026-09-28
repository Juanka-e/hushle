import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    InventoryError,
    parseEquipRequest,
    parseInventoryQuery,
} from "@hushle/platform-inventory";
import { MOBILE_API_ROUTES } from "@hushle/api-contracts";

assert.deepEqual(parseInventoryQuery({}), { limit: 25 });
assert.deepEqual(parseInventoryQuery({ limit: "50", type: "frame" }), {
    limit: 50,
    type: "frame",
});
assert.deepEqual(parseEquipRequest({ itemType: "avatar", shopItemId: null }), {
    itemType: "avatar",
    shopItemId: null,
});

for (const invalid of [
    { limit: 0 },
    { limit: 51 },
    { type: "coin" },
    { cursor: "" },
]) {
    assert.throws(
        () => parseInventoryQuery(invalid),
        (error: unknown) =>
            error instanceof InventoryError &&
            error.code === "invalid_request"
    );
}

for (const invalid of [
    {},
    { itemType: "coin", shopItemId: 1 },
    { itemType: "frame", shopItemId: 0 },
    { itemType: "frame", shopItemId: "1" },
]) {
    assert.throws(
        () => parseEquipRequest(invalid),
        (error: unknown) =>
            error instanceof InventoryError &&
            error.code === "invalid_request"
    );
}

assert.equal(MOBILE_API_ROUTES.inventory, "/v1/inventory");
assert.equal(
    MOBILE_API_ROUTES.inventoryEquipped,
    "/v1/inventory/equipped"
);

for (const path of [
    "apps/web/src/app/api/user/inventory/route.ts",
    "apps/web/src/app/api/user/me/route.ts",
    "apps/web/src/app/api/store/equip/route.ts",
]) {
    const source = readFileSync(resolve(path), "utf8");
    assert.match(source, /@hushle\/platform-inventory/);
    assert.doesNotMatch(source, /@\/lib\/economy|from "zod"/);
}

const adminService = readFileSync(
    resolve("apps/web/src/lib/admin-inventory-operations/service.ts"),
    "utf8"
);
assert.match(adminService, /@hushle\/platform-inventory/);
assert.doesNotMatch(adminService, /getInventoryData/);

const legacyEconomy = readFileSync(
    resolve("apps/web/src/lib/economy.ts"),
    "utf8"
);
assert.doesNotMatch(legacyEconomy, /export async function getInventoryData/);
assert.doesNotMatch(legacyEconomy, /export async function equipStoreItem/);

const mobileRoute = readFileSync(
    resolve("apps/api/src/player-routes.ts"),
    "utf8"
);
assert.match(mobileRoute, /getInventoryPage/);
assert.match(mobileRoute, /equipInventoryItem/);
assert.match(mobileRoute, /authenticateAccessToken/);
assert.doesNotMatch(mobileRoute, /apps\/web|next\/server|@\/lib/);

console.log("test:inventory-core ok");
