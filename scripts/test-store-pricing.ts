import assert from "node:assert/strict";
import { PromotionDiscountType, PromotionTargetType } from "@hushle/platform-db";
import { resolveCatalogPricing, resolveCouponPricing } from "../apps/web/src/lib/store/pricing";

const now = new Date("2026-03-09T12:00:00.000Z");

const itemDiscount = {
    id: 1,
    code: "item_launch",
    name: "Item Launch",
    description: "Launch markdown",
    targetType: PromotionTargetType.shop_item,
    discountType: PromotionDiscountType.fixed_coin,
    percentageOff: null,
    fixedCoinOff: 60,
    shopItemId: 42,
    bundleId: null,
    usageLimit: 3,
    usedCount: 1,
    startsAt: new Date("2026-03-09T00:00:00.000Z"),
    endsAt: new Date("2026-03-19T00:00:00.000Z"),
    isActive: true,
    stackableWithCoupon: true,
};

const basePricing = resolveCatalogPricing(340, { kind: "shop_item", targetId: 42 }, [itemDiscount], now);
assert.equal(basePricing.basePriceCoin, 340);
assert.equal(basePricing.discountCoin, 60);
assert.equal(basePricing.finalPriceCoin, 280);
assert.equal(basePricing.appliedPromotion?.id, 1);
assert.equal(basePricing.appliedPromotion?.code, "item_launch");

const stackableCoupon = {
    id: 7,
    code: "WELCOME25",
    name: "Welcome 25",
    description: "Global launch code",
    targetType: PromotionTargetType.global,
    discountType: PromotionDiscountType.fixed_coin,
    percentageOff: null,
    fixedCoinOff: 25,
    shopItemId: null,
    bundleId: null,
    usageLimit: 100,
    usedCount: 2,
    startsAt: new Date("2026-03-09T00:00:00.000Z"),
    endsAt: new Date("2026-04-09T00:00:00.000Z"),
    isActive: true,
};

const couponPricing = resolveCouponPricing(basePricing, { kind: "shop_item", targetId: 42 }, stackableCoupon, now);
assert.equal(couponPricing.ok, true);
if (couponPricing.ok) {
    assert.equal(couponPricing.pricing.finalPriceCoin, 255);
    assert.equal(couponPricing.coupon.code, "WELCOME25");
}

const nonStackableBase = resolveCatalogPricing(780, { kind: "bundle", targetId: 8 }, [
    {
        ...itemDiscount,
        code: "bundle_week",
        name: "Bundle Week",
        targetType: PromotionTargetType.bundle,
        shopItemId: null,
        bundleId: 8,
        discountType: PromotionDiscountType.percentage,
        percentageOff: 15,
        fixedCoinOff: null,
        stackableWithCoupon: false,
    },
], now);

const blockedCoupon = resolveCouponPricing(nonStackableBase, { kind: "bundle", targetId: 8 }, stackableCoupon, now);
assert.equal(blockedCoupon.ok, false);
if (!blockedCoupon.ok) {
    assert.match(blockedCoupon.reason, /birlestirilemez/i);
}

const exhaustedDiscountPricing = resolveCatalogPricing(500, { kind: "shop_item", targetId: 42 }, [
    {
        ...itemDiscount,
        id: 2,
        code: "exhausted_discount",
        usageLimit: 1,
        usedCount: 1,
        fixedCoinOff: 120,
    },
], now);

assert.equal(exhaustedDiscountPricing.discountCoin, 0);
assert.equal(exhaustedDiscountPricing.appliedPromotion, null);

console.log("store pricing smoke test passed");
