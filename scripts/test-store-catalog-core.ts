import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    normalizeStoreCatalogPolicy,
    parseStoreCatalogQuery,
    resolveCatalogPricing,
    StoreCatalogError,
} from "@hushle/platform-store";
import { MOBILE_API_ROUTES } from "@hushle/api-contracts";

assert.deepEqual(parseStoreCatalogQuery({}), {
    kind: "items",
    limit: 25,
});
assert.deepEqual(
    parseStoreCatalogQuery({ kind: "items", type: "frame", limit: "50" }),
    { kind: "items", type: "frame", limit: 50 }
);
assert.equal(
    normalizeStoreCatalogPolicy({
        storePriceMultiplier: 1.125,
        bundlesEnabled: true,
        couponsEnabled: true,
        discountCampaignsEnabled: true,
        activeMatchCoinMultiplier: 1,
        weekendBoostApplied: false,
    }).storePriceMultiplier,
    1.125
);

for (const query of [
    { limit: 0 },
    { limit: 51 },
    { type: "coin" },
    { kind: "bundles", type: "avatar" },
    { cursor: "" },
]) {
    assert.throws(
        () => parseStoreCatalogQuery(query),
        (error: unknown) =>
            error instanceof StoreCatalogError &&
            error.code === "invalid_request"
    );
}

assert.deepEqual(
    normalizeStoreCatalogPolicy({
        storePriceMultiplier: 50,
        bundlesEnabled: true,
        couponsEnabled: false,
        discountCampaignsEnabled: true,
        activeMatchCoinMultiplier: -1,
        weekendBoostApplied: true,
    }),
    {
        storePriceMultiplier: 10,
        bundlesEnabled: true,
        couponsEnabled: false,
        discountCampaignsEnabled: true,
        activeMatchCoinMultiplier: 0,
        weekendBoostApplied: true,
    }
);

const pricing = resolveCatalogPricing(
    500,
    { kind: "shop_item", targetId: 10 },
    [
        {
            id: 1,
            code: "SALE",
            name: "Sale",
            description: null,
            targetType: "shop_item",
            discountType: "percentage",
            percentageOff: 20,
            fixedCoinOff: null,
            shopItemId: 10,
            bundleId: null,
            usageLimit: null,
            usedCount: 0,
            startsAt: null,
            endsAt: null,
            isActive: true,
            stackableWithCoupon: true,
        },
    ],
    new Date("2026-07-29T12:00:00.000Z")
);
assert.equal(pricing.finalPriceCoin, 400);
assert.equal(pricing.appliedPromotion?.code, "SALE");

assert.equal(MOBILE_API_ROUTES.storeCatalog, "/v1/store/catalog");

const pricingAdapter = readFileSync(
    resolve("apps/web/src/lib/store/pricing.ts"),
    "utf8"
);
assert.match(pricingAdapter, /@hushle\/platform-store/);
assert.doesNotMatch(pricingAdapter, /function resolveCatalogPricing/);

const economy = readFileSync(
    resolve("apps/web/src/lib/economy.ts"),
    "utf8"
);
assert.match(economy, /getStoreCatalog as getPlatformStoreCatalog/);
assert.doesNotMatch(economy, /loadSharedStoreCatalog|loadStoreUserOverlay/);

const applicationCache = readFileSync(
    resolve("apps/web/src/lib/cache/application-cache.ts"),
    "utf8"
);
assert.match(applicationCache, /store-catalog-revision/);
assert.match(
    applicationCache,
    /invalidateJsonCache\(APPLICATION_CACHE_KEYS\.storeCatalogRevision\)/
);
assert.match(applicationCache, /mobile-api[\s\S]*store-policy/);

const settingsService = readFileSync(
    resolve("apps/web/src/lib/system-settings/service.ts"),
    "utf8"
);
assert.match(settingsService, /invalidateMobileStorePolicyCache/);

const mobileRoute = readFileSync(
    resolve("apps/api/src/player-routes.ts"),
    "utf8"
);
assert.match(mobileRoute, /getStoreCatalogPage/);
assert.match(mobileRoute, /toMobileStoreCatalogData/);
assert.match(mobileRoute, /MOBILE_API_ROUTES\.storeCatalog/);
assert.doesNotMatch(mobileRoute, /apps\/web|next\/server|@\/lib/);

console.log("test:store-catalog-core ok");
