export const STORE_ITEM_TYPES = ["avatar", "frame", "card_back", "card_face"] as const;
export const STORE_ITEM_RARITIES = ["common", "rare", "epic", "legendary"] as const;
export const INVENTORY_ITEM_SOURCES = ["purchase", "grant", "migration"] as const;
export const STORE_ITEM_RENDER_MODES = ["image", "template"] as const;
export const SHOP_ITEM_AVAILABILITY_MODES = ["always_on", "scheduled", "seasonal", "limited", "event_only"] as const;
export const PROMOTION_TARGET_TYPES = ["global", "shop_item", "bundle"] as const;
export const PROMOTION_DISCOUNT_TYPES = ["percentage", "fixed_coin"] as const;

export type StoreItemType = (typeof STORE_ITEM_TYPES)[number];
export type StoreItemRarity = (typeof STORE_ITEM_RARITIES)[number];
export type InventoryItemSource = (typeof INVENTORY_ITEM_SOURCES)[number];
export type StoreItemRenderMode = (typeof STORE_ITEM_RENDER_MODES)[number];
export type ShopItemAvailabilityMode = (typeof SHOP_ITEM_AVAILABILITY_MODES)[number];
export type TemplateConfigScalar = string | number | boolean | null;
export type TemplateConfigArray = TemplateConfigScalar[];
export interface TemplateConfigObject {
    [key: string]: TemplateConfigValue;
}
export type TemplateConfigValue = TemplateConfigScalar | TemplateConfigArray | TemplateConfigObject;
export type TemplateConfig = TemplateConfigObject;
export type CosmeticPattern =
    | "none"
    | "grid"
    | "dots"
    | "diagonal"
    | "chevrons"
    | "rings"
    | "noise";
export type CosmeticMotionPreset = "none" | "pulse" | "drift" | "shimmer";
export type CosmeticFrameStyle = "solid" | "double" | "ornate";
export type PromotionTargetType = (typeof PROMOTION_TARGET_TYPES)[number];
export type PromotionDiscountType = (typeof PROMOTION_DISCOUNT_TYPES)[number];

export interface CosmeticRenderSnapshot {
    type: StoreItemType;
    rarity: StoreItemRarity;
    renderMode: StoreItemRenderMode;
    renderSpecVersion: number;
    imageUrl: string;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
    badgeText: string | null;
}

export interface EquippedSlots {
    avatarItemId: number | null;
    frameItemId: number | null;
    cardBackItemId: number | null;
    cardFaceItemId: number | null;
}

export interface StoreItemView {
    id: number;
    code: string;
    name: string;
    type: StoreItemType;
    rarity: StoreItemRarity;
    renderMode: StoreItemRenderMode;
    renderSpecVersion: number;
    priceCoin: number;
    imageUrl: string;
    thumbnailUrl: string | null;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
    badgeText: string | null;
    availabilityMode: ShopItemAvailabilityMode;
    startsAt: string | null;
    endsAt: string | null;
    isFeatured: boolean;
    isActive: boolean;
    sortOrder: number;
    createdAt: string;
    owned: boolean;
    equipped: boolean;
}

export interface PromotionSummaryView {
    id: number;
    code: string;
    name: string;
    description: string | null;
    discountType: PromotionDiscountType;
    percentageOff: number | null;
    fixedCoinOff: number | null;
    stackableWithCoupon: boolean;
    usageLimit: number | null;
    usedCount: number;
}

export interface StorePriceView {
    basePriceCoin: number;
    discountCoin: number;
    finalPriceCoin: number;
    appliedPromotion: PromotionSummaryView | null;
}

export interface CatalogStoreItemView extends StoreItemView {
    pricing: StorePriceView;
}

export interface InventoryItemView {
    inventoryItemId: number;
    shopItemId: number;
    code: string;
    name: string;
    type: StoreItemType;
    rarity: StoreItemRarity;
    renderMode: StoreItemRenderMode;
    renderSpecVersion: number;
    priceCoin: number;
    imageUrl: string;
    thumbnailUrl: string | null;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
    badgeText: string | null;
    availabilityMode: ShopItemAvailabilityMode;
    startsAt: string | null;
    endsAt: string | null;
    isFeatured: boolean;
    source: InventoryItemSource;
    acquiredAt: string;
    equipped: boolean;
}

export interface UserInventoryProfile {
    displayName: string | null;
    bio: string | null;
    avatarItemId: number | null;
    frameItemId: number | null;
    cardBackItemId: number | null;
    cardFaceItemId: number | null;
}

export interface UserInventoryResponse {
    id: number;
    name: string;
    email: string | null;
    emailVerifiedAt: string | null;
    role: string;
    wallet: {
        coinBalance: number;
    };
    profile: UserInventoryProfile;
    items: InventoryItemView[];
}

export interface DashboardMatchView {
    id: number;
    roomCode: string;
    won: boolean;
    scoreA: number;
    scoreB: number;
    coinEarned: number;
    createdAt: string;
}

export interface DashboardDataResponse {
    coinBalance: number;
    totalMatches: number;
    totalWins: number;
    totalCoinEarned: number;
    winRate: number;
    recentMatches: DashboardMatchView[];
}

export interface PlayerAppearanceSnapshot {
    avatarImageUrl: string | null;
    frameImageUrl: string | null;
    frameAccentColor: string | null;
    frameSecondaryColor: string | null;
    framePattern: CosmeticPattern | null;
    framePatternOpacity: number | null;
    framePatternScale: number | null;
    frameGlowColor: string | null;
    frameGlowBlur: number | null;
    frameGlowOpacity: number | null;
    frameStyle: CosmeticFrameStyle | null;
    frameThickness: number | null;
    frameRadius: number | null;
    frameMotionPreset: CosmeticMotionPreset | null;
    frameMotionSpeedMs: number | null;
}

export interface ShopBundleItemView {
    id: number;
    shopItemId: number;
    sortOrder: number;
    itemCode: string;
    itemName: string;
    itemType: StoreItemType;
    itemRarity: StoreItemRarity;
}

export interface ShopBundleView {
    id: number;
    code: string;
    name: string;
    description: string | null;
    priceCoin: number;
    isActive: boolean;
    sortOrder: number;
    createdAt: string;
    items: ShopBundleItemView[];
}

export interface CatalogBundleView extends ShopBundleView {
    ownedItemCount: number;
    fullyOwned: boolean;
    pricing: StorePriceView;
}

export interface DiscountCampaignView {
    id: number;
    code: string;
    name: string;
    description: string | null;
    targetType: PromotionTargetType;
    discountType: PromotionDiscountType;
    percentageOff: number | null;
    fixedCoinOff: number | null;
    shopItemId: number | null;
    bundleId: number | null;
    usageLimit: number | null;
    usedCount: number;
    startsAt: string | null;
    endsAt: string | null;
    isActive: boolean;
    stackableWithCoupon: boolean;
    createdAt: string;
}

export interface CouponCodeView {
    id: number;
    code: string;
    name: string;
    description: string | null;
    targetType: PromotionTargetType;
    discountType: PromotionDiscountType;
    percentageOff: number | null;
    fixedCoinOff: number | null;
    shopItemId: number | null;
    bundleId: number | null;
    usageLimit: number | null;
    usedCount: number;
    startsAt: string | null;
    endsAt: string | null;
    isActive: boolean;
    createdAt: string;
}

export interface CouponPreviewView {
    code: string;
    name: string;
    description: string | null;
    discountType: PromotionDiscountType;
    percentageOff: number | null;
    fixedCoinOff: number | null;
}

export interface CouponPreviewResponse {
    valid: boolean;
    reason: string | null;
    targetKind: "shop_item" | "bundle";
    targetId: number;
    pricing: StorePriceView | null;
    coupon: CouponPreviewView | null;
}

export interface CouponCatalogPreviewEntry {
    targetId: number;
    pricing: StorePriceView;
}

export interface CouponCatalogPreviewResponse {
    valid: boolean;
    reason: string | null;
    coupon: CouponPreviewView | null;
    items: CouponCatalogPreviewEntry[];
    bundles: CouponCatalogPreviewEntry[];
}

export interface StoreLiveopsView {
    bundlesEnabled: boolean;
    couponsEnabled: boolean;
    discountCampaignsEnabled: boolean;
    storePriceMultiplier: number;
    activeMatchCoinMultiplier: number;
    weekendBoostApplied: boolean;
}

export interface StoreCatalogResponse {
    coinBalance: number;
    items: CatalogStoreItemView[];
    bundles: CatalogBundleView[];
    liveops: StoreLiveopsView;
}
