import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    mockBundles,
    mockCouponCodes,
    mockDiscountCampaigns,
    mockShopItems,
} from "../apps/web/src/lib/store/mock-catalog";

const itemCodes = new Set<string>();
const itemSortOrders = new Set<number>();
const webPublicRoot = path.join(process.cwd(), "apps", "web", "public");
for (const item of mockShopItems) {
    assert.equal(itemCodes.has(item.code), false, `Duplicate shop item code: ${item.code}`);
    itemCodes.add(item.code);
    assert.equal(itemSortOrders.has(item.sortOrder), false, `Duplicate shop item sortOrder: ${item.sortOrder}`);
    itemSortOrders.add(item.sortOrder);
    assert.equal(item.sortOrder >= 0, true, `Invalid sortOrder for ${item.code}`);

    if (item.badgeText !== null) {
        assert.equal(item.badgeText.length <= 24, true, `badgeText too long for ${item.code}`);
    }

    if (item.renderMode === "image") {
        const assetPath = path.join(webPublicRoot, item.imageUrl.replace(/^\//, ""));
        assert.equal(fs.existsSync(assetPath), true, `Missing asset for ${item.code}: ${assetPath}`);
    }
}

assert.equal(
    mockShopItems.some((item) => item.isFeatured),
    true,
    "At least one featured shop item is expected for dashboard discovery rail"
);

const bundleCodes = new Set<string>();
for (const bundle of mockBundles) {
    assert.equal(bundleCodes.has(bundle.code), false, `Duplicate bundle code: ${bundle.code}`);
    bundleCodes.add(bundle.code);
    assert.equal(bundle.itemCodes.length > 0, true, `Bundle ${bundle.code} must include items`);

    for (const code of bundle.itemCodes) {
        assert.equal(itemCodes.has(code), true, `Bundle ${bundle.code} references unknown item ${code}`);
    }
}

for (const campaign of mockDiscountCampaigns) {
    if (campaign.targetType === "shop_item") {
        assert.equal(itemCodes.has(String(campaign.targetCode)), true, `Discount ${campaign.code} references missing item`);
    }
    if (campaign.targetType === "bundle") {
        assert.equal(bundleCodes.has(String(campaign.targetCode)), true, `Discount ${campaign.code} references missing bundle`);
    }
}

for (const coupon of mockCouponCodes) {
    if (coupon.targetType === "shop_item") {
        assert.equal(itemCodes.has(String(coupon.targetCode)), true, `Coupon ${coupon.code} references missing item`);
    }
    if (coupon.targetType === "bundle") {
        assert.equal(bundleCodes.has(String(coupon.targetCode)), true, `Coupon ${coupon.code} references missing bundle`);
    }
}

console.log("mock catalog smoke test passed");
