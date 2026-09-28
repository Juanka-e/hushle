import assert from "node:assert/strict";
import {
    PromotionDiscountType,
    PromotionTargetType,
} from "@hushle/platform-db";
import {
    bundleWriteSchema,
    couponCodeWriteSchema,
    discountCampaignWriteSchema,
    toPrismaCouponCodeCreateData,
    toPrismaDiscountCampaignCreateData,
} from "../apps/web/src/lib/promotions/promotion-schema";

const bundleResult = bundleWriteSchema.safeParse({
    code: "launch_pack",
    name: "Launch Pack",
    description: "Initial cosmetics bundle",
    priceCoin: 450,
    isActive: true,
    sortOrder: 1,
    items: [
        { shopItemId: 1, sortOrder: 0 },
        { shopItemId: 2, sortOrder: 1 },
    ],
});

assert.equal(bundleResult.success, true);

const invalidDiscount = discountCampaignWriteSchema.safeParse({
    code: "wrong_target",
    name: "Wrong Target",
    targetType: "shop_item",
    discountType: "percentage",
    percentageOff: 15,
    fixedCoinOff: null,
    shopItemId: null,
    bundleId: null,
    usageLimit: null,
    startsAt: null,
    endsAt: null,
    isActive: true,
    stackableWithCoupon: false,
});

assert.equal(invalidDiscount.success, false);

const discountWithLimit = discountCampaignWriteSchema.safeParse({
    code: "launch_limit",
    name: "Launch Limit",
    description: "Limited bundle launch discount",
    targetType: "bundle",
    discountType: "percentage",
    percentageOff: 20,
    fixedCoinOff: null,
    shopItemId: null,
    bundleId: 3,
    usageLimit: 250,
    startsAt: "2026-03-09T10:00:00.000Z",
    endsAt: "2026-03-19T10:00:00.000Z",
    isActive: true,
    stackableWithCoupon: false,
});

assert.equal(discountWithLimit.success, true);
if (!discountWithLimit.success) {
    throw new Error("discount parse failed unexpectedly");
}

const discountPayload = toPrismaDiscountCampaignCreateData(discountWithLimit.data);
assert.equal(discountPayload.targetType, PromotionTargetType.bundle);
assert.equal(discountPayload.discountType, PromotionDiscountType.percentage);

const couponResult = couponCodeWriteSchema.safeParse({
    code: "spring25",
    name: "Spring 25",
    description: "Seasonal launch code",
    targetType: "global",
    discountType: "fixed_coin",
    percentageOff: null,
    fixedCoinOff: 25,
    shopItemId: null,
    bundleId: null,
    usageLimit: 100,
    startsAt: "2026-03-09T10:00:00.000Z",
    endsAt: "2026-03-19T10:00:00.000Z",
    isActive: true,
});

assert.equal(couponResult.success, true);
if (!couponResult.success) {
    throw new Error("coupon parse failed unexpectedly");
}

const couponPayload = toPrismaCouponCodeCreateData(couponResult.data);
assert.equal(couponPayload.targetType, PromotionTargetType.global);
assert.equal(couponPayload.discountType, PromotionDiscountType.fixed_coin);

console.log("promotion schema smoke test passed");
