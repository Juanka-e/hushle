import { createHash, randomUUID } from "node:crypto";
import {
    getOrSetJsonCache,
    getRedisKey,
} from "@hushle/platform-cache";
import { Prisma, prisma } from "@hushle/platform-db";
import {
    INVENTORY_ITEM_TYPES,
    normalizeTemplateConfig,
    type EquippedSlots,
    type InventoryItemType,
    type TemplateConfig,
} from "@hushle/platform-inventory";
import { z } from "zod";

export type StoreCatalogPolicy = {
    storePriceMultiplier: number;
    bundlesEnabled: boolean;
    couponsEnabled: boolean;
    discountCampaignsEnabled: boolean;
    activeMatchCoinMultiplier: number;
    weekendBoostApplied: boolean;
};

export type PromotionSummaryView = {
    id: number;
    code: string;
    name: string;
    description: string | null;
    discountType: "percentage" | "fixed_coin";
    percentageOff: number | null;
    fixedCoinOff: number | null;
    stackableWithCoupon: boolean;
    usageLimit: number | null;
    usedCount: number;
};

export type StorePriceView = {
    basePriceCoin: number;
    discountCoin: number;
    finalPriceCoin: number;
    appliedPromotion: PromotionSummaryView | null;
};

export type CouponPreviewView = {
    code: string;
    name: string;
    description: string | null;
    discountType: "percentage" | "fixed_coin";
    percentageOff: number | null;
    fixedCoinOff: number | null;
};

export type StoreItemView = {
    id: number;
    code: string;
    name: string;
    type: InventoryItemType;
    rarity: "common" | "rare" | "epic" | "legendary";
    renderMode: "image" | "template";
    renderSpecVersion: number;
    priceCoin: number;
    imageUrl: string;
    thumbnailUrl: string | null;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
    badgeText: string | null;
    availabilityMode:
        | "always_on"
        | "scheduled"
        | "seasonal"
        | "limited"
        | "event_only";
    startsAt: string | null;
    endsAt: string | null;
    isFeatured: boolean;
    isActive: boolean;
    sortOrder: number;
    createdAt: string;
    owned: boolean;
    equipped: boolean;
};

export type CatalogStoreItemView = StoreItemView & {
    pricing: StorePriceView;
};

export type CatalogBundleItemView = {
    id: number;
    shopItemId: number;
    sortOrder: number;
    itemCode: string;
    itemName: string;
    itemType: InventoryItemType;
    itemRarity: "common" | "rare" | "epic" | "legendary";
};

export type CatalogBundleView = {
    id: number;
    code: string;
    name: string;
    description: string | null;
    priceCoin: number;
    isActive: boolean;
    sortOrder: number;
    createdAt: string;
    items: CatalogBundleItemView[];
    ownedItemCount: number;
    fullyOwned: boolean;
    pricing: StorePriceView;
};

export type StoreLiveopsView = {
    bundlesEnabled: boolean;
    couponsEnabled: boolean;
    discountCampaignsEnabled: boolean;
    storePriceMultiplier: number;
    activeMatchCoinMultiplier: number;
    weekendBoostApplied: boolean;
};

export type StoreCatalogView = {
    coinBalance: number;
    items: CatalogStoreItemView[];
    bundles: CatalogBundleView[];
    liveops: StoreLiveopsView;
};

export type StoreCatalogPageView = {
    coinBalance: number;
    kind: "items" | "bundles";
    items: CatalogStoreItemView[];
    bundles: CatalogBundleView[];
    liveops: StoreLiveopsView;
    page: {
        nextCursor: string | null;
        hasMore: boolean;
        limit: number;
    };
};

type TimedPromotionRecord = {
    id: number;
    code: string;
    name: string;
    description: string | null;
    targetType: "global" | "shop_item" | "bundle";
    discountType: "percentage" | "fixed_coin";
    percentageOff: number | null;
    fixedCoinOff: number | null;
    shopItemId: number | null;
    bundleId: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
    isActive: boolean;
};

export type DiscountPricingRecord = TimedPromotionRecord & {
    stackableWithCoupon: boolean;
    usageLimit: number | null;
    usedCount: number;
};

export type CouponPricingRecord = TimedPromotionRecord & {
    usageLimit: number | null;
    usedCount: number;
};

export type PromotionTargetContext = {
    kind: "shop_item" | "bundle";
    targetId: number;
};

export type CouponPricingResult =
    | {
          ok: true;
          pricing: StorePriceView;
          coupon: CouponPreviewView;
          couponDiscountCoin: number;
      }
    | { ok: false; reason: string };

const catalogQuerySchema = z
    .object({
        kind: z.enum(["items", "bundles"]).default("items"),
        cursor: z.string().trim().min(1).max(256).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(25),
        type: z.enum(INVENTORY_ITEM_TYPES).optional(),
    })
    .refine((value) => value.kind === "items" || value.type === undefined, {
        path: ["type"],
        message: "Type filter is only valid for item pages.",
    });

export class StoreCatalogError extends Error {
    constructor(
        public readonly code:
            | "invalid_request"
            | "invalid_cursor"
            | "user_not_found",
        message: string = code
    ) {
        super(message);
        this.name = "StoreCatalogError";
    }
}

function isWithinWindow(
    startsAt: Date | null,
    endsAt: Date | null,
    now: Date
): boolean {
    if (startsAt && startsAt.getTime() > now.getTime()) return false;
    if (endsAt && endsAt.getTime() < now.getTime()) return false;
    return true;
}

function matchesTarget(
    promotion: TimedPromotionRecord,
    target: PromotionTargetContext
): boolean {
    if (promotion.targetType === "global") return true;
    if (promotion.targetType === "shop_item") {
        return (
            target.kind === "shop_item" &&
            promotion.shopItemId === target.targetId
        );
    }
    return target.kind === "bundle" && promotion.bundleId === target.targetId;
}

function calculateDiscountAmount(
    priceCoin: number,
    discountType: "percentage" | "fixed_coin",
    percentageOff: number | null,
    fixedCoinOff: number | null
): number {
    if (priceCoin <= 0) return 0;
    if (discountType === "percentage") {
        const percentage = Math.max(0, Math.min(percentageOff ?? 0, 100));
        return Math.min(
            priceCoin,
            Math.round((priceCoin * percentage) / 100)
        );
    }
    return Math.min(priceCoin, Math.max(0, fixedCoinOff ?? 0));
}

export function resolveCatalogPricing(
    basePriceCoin: number,
    target: PromotionTargetContext,
    discounts: DiscountPricingRecord[],
    now: Date
): StorePriceView {
    let bestDiscount: DiscountPricingRecord | null = null;
    let bestDiscountCoin = 0;
    for (const discount of discounts) {
        if (
            !discount.isActive ||
            !isWithinWindow(discount.startsAt, discount.endsAt, now) ||
            !matchesTarget(discount, target) ||
            (discount.usageLimit !== null &&
                discount.usedCount >= discount.usageLimit)
        ) {
            continue;
        }
        const amount = calculateDiscountAmount(
            basePriceCoin,
            discount.discountType,
            discount.percentageOff,
            discount.fixedCoinOff
        );
        if (amount > bestDiscountCoin) {
            bestDiscount = discount;
            bestDiscountCoin = amount;
        }
    }
    return {
        basePriceCoin,
        discountCoin: bestDiscountCoin,
        finalPriceCoin: Math.max(0, basePriceCoin - bestDiscountCoin),
        appliedPromotion: bestDiscount
            ? {
                  id: bestDiscount.id,
                  code: bestDiscount.code,
                  name: bestDiscount.name,
                  description: bestDiscount.description,
                  discountType: bestDiscount.discountType,
                  percentageOff: bestDiscount.percentageOff,
                  fixedCoinOff: bestDiscount.fixedCoinOff,
                  stackableWithCoupon: bestDiscount.stackableWithCoupon,
                  usageLimit: bestDiscount.usageLimit,
                  usedCount: bestDiscount.usedCount,
              }
            : null,
    };
}

export function resolveCouponPricing(
    basePricing: StorePriceView,
    target: PromotionTargetContext,
    coupon: CouponPricingRecord | null,
    now: Date
): CouponPricingResult {
    if (!coupon) return { ok: false, reason: "Kupon bulunamadi." };
    if (
        !coupon.isActive ||
        !isWithinWindow(coupon.startsAt, coupon.endsAt, now)
    ) {
        return { ok: false, reason: "Kupon aktif degil." };
    }
    if (!matchesTarget(coupon, target)) {
        return { ok: false, reason: "Kupon bu urun icin kullanilamaz." };
    }
    if (
        coupon.usageLimit !== null &&
        coupon.usedCount >= coupon.usageLimit
    ) {
        return { ok: false, reason: "Kupon kullanim limiti doldu." };
    }
    if (
        basePricing.appliedPromotion &&
        !basePricing.appliedPromotion.stackableWithCoupon
    ) {
        return { ok: false, reason: "Bu teklif kupon ile birlestirilemez." };
    }
    const couponDiscountCoin = calculateDiscountAmount(
        basePricing.finalPriceCoin,
        coupon.discountType,
        coupon.percentageOff,
        coupon.fixedCoinOff
    );
    return {
        ok: true,
        pricing: {
            ...basePricing,
            discountCoin: basePricing.discountCoin + couponDiscountCoin,
            finalPriceCoin: Math.max(
                0,
                basePricing.finalPriceCoin - couponDiscountCoin
            ),
        },
        coupon: {
            code: coupon.code,
            name: coupon.name,
            description: coupon.description,
            discountType: coupon.discountType,
            percentageOff: coupon.percentageOff,
            fixedCoinOff: coupon.fixedCoinOff,
        },
        couponDiscountCoin,
    };
}

export function normalizeCouponCode(value: string): string {
    return value.trim().toUpperCase();
}

function normalizeMultiplier(value: number, fallback = 1): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.round(value * 100) / 100);
}

export function normalizeStoreCatalogPolicy(
    input: StoreCatalogPolicy
): StoreCatalogPolicy {
    return {
        storePriceMultiplier: Math.min(
            10,
            Math.max(
                0.1,
                Number.isFinite(input.storePriceMultiplier)
                    ? input.storePriceMultiplier
                    : 1
            )
        ),
        bundlesEnabled: input.bundlesEnabled,
        couponsEnabled: input.couponsEnabled,
        discountCampaignsEnabled: input.discountCampaignsEnabled,
        activeMatchCoinMultiplier: Math.min(
            100,
            normalizeMultiplier(input.activeMatchCoinMultiplier)
        ),
        weekendBoostApplied: input.weekendBoostApplied,
    };
}

function applyPriceMultiplier(priceCoin: number, multiplier: number): number {
    return Math.max(0, Math.round(priceCoin * multiplier));
}

function normalizeRenderSpecVersion(value: number): number {
    return Number.isInteger(value) && value > 0 ? value : 1;
}

function getLiveops(policy: StoreCatalogPolicy): StoreLiveopsView {
    return {
        ...policy,
        storePriceMultiplier: normalizeMultiplier(
            policy.storePriceMultiplier
        ),
    };
}

const shopItemSelect = {
    id: true,
    code: true,
    name: true,
    type: true,
    rarity: true,
    renderMode: true,
    renderSpecVersion: true,
    priceCoin: true,
    imageUrl: true,
    thumbnailUrl: true,
    templateKey: true,
    templateConfig: true,
    badgeText: true,
    availabilityMode: true,
    startsAt: true,
    endsAt: true,
    isFeatured: true,
    isActive: true,
    sortOrder: true,
    createdAt: true,
} satisfies Prisma.ShopItemSelect;

const bundleInclude = {
    items: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
            shopItem: {
                select: {
                    id: true,
                    code: true,
                    name: true,
                    type: true,
                    rarity: true,
                },
            },
        },
    },
} satisfies Prisma.ShopBundleInclude;

const discountSelect = {
    id: true,
    code: true,
    name: true,
    description: true,
    targetType: true,
    discountType: true,
    percentageOff: true,
    fixedCoinOff: true,
    shopItemId: true,
    bundleId: true,
    usageLimit: true,
    usedCount: true,
    startsAt: true,
    endsAt: true,
    isActive: true,
    stackableWithCoupon: true,
} satisfies Prisma.DiscountCampaignSelect;

type ShopItemRecord = Prisma.ShopItemGetPayload<{
    select: typeof shopItemSelect;
}>;
type BundleRecord = Prisma.ShopBundleGetPayload<{
    include: typeof bundleInclude;
}>;
type DiscountRecord = Prisma.DiscountCampaignGetPayload<{
    select: typeof discountSelect;
}>;
type SharedItem = Omit<CatalogStoreItemView, "owned" | "equipped">;
type SharedBundle = Omit<
    CatalogBundleView,
    "ownedItemCount" | "fullyOwned"
>;
type CatalogCursor = { sortOrder: number; createdAt: Date; id: number };

function mapSharedItem(
    item: ShopItemRecord,
    discounts: DiscountRecord[],
    now: Date,
    policy: StoreCatalogPolicy
): SharedItem {
    const priceCoin = applyPriceMultiplier(
        item.priceCoin,
        policy.storePriceMultiplier
    );
    return {
        id: item.id,
        code: item.code,
        name: item.name,
        type: item.type,
        rarity: item.rarity,
        renderMode: item.renderMode,
        renderSpecVersion: normalizeRenderSpecVersion(item.renderSpecVersion),
        priceCoin,
        imageUrl: item.imageUrl,
        thumbnailUrl: item.thumbnailUrl,
        templateKey: item.templateKey,
        templateConfig: normalizeTemplateConfig(item.templateConfig),
        badgeText: item.badgeText,
        availabilityMode: item.availabilityMode,
        startsAt: item.startsAt?.toISOString() ?? null,
        endsAt: item.endsAt?.toISOString() ?? null,
        isFeatured: item.isFeatured,
        isActive: item.isActive,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt.toISOString(),
        pricing: resolveCatalogPricing(
            priceCoin,
            { kind: "shop_item", targetId: item.id },
            discounts,
            now
        ),
    };
}

function mapSharedBundle(
    bundle: BundleRecord,
    discounts: DiscountRecord[],
    now: Date,
    policy: StoreCatalogPolicy
): SharedBundle {
    const priceCoin = applyPriceMultiplier(
        bundle.priceCoin,
        policy.storePriceMultiplier
    );
    return {
        id: bundle.id,
        code: bundle.code,
        name: bundle.name,
        description: bundle.description,
        priceCoin,
        isActive: bundle.isActive,
        sortOrder: bundle.sortOrder,
        createdAt: bundle.createdAt.toISOString(),
        pricing: resolveCatalogPricing(
            priceCoin,
            { kind: "bundle", targetId: bundle.id },
            discounts,
            now
        ),
        items: bundle.items.map((entry) => ({
            id: entry.id,
            shopItemId: entry.shopItemId,
            sortOrder: entry.sortOrder,
            itemCode: entry.shopItem.code,
            itemName: entry.shopItem.name,
            itemType: entry.shopItem.type,
            itemRarity: entry.shopItem.rarity,
        })),
    };
}

function decodeCursor(value: string): CatalogCursor {
    try {
        const parsed = JSON.parse(
            Buffer.from(value, "base64url").toString("utf8")
        ) as Record<string, unknown>;
        const createdAt = new Date(String(parsed.createdAt ?? ""));
        if (
            !Number.isInteger(parsed.sortOrder) ||
            !Number.isInteger(parsed.id) ||
            Number(parsed.id) <= 0 ||
            !Number.isFinite(createdAt.getTime())
        ) {
            throw new Error("invalid");
        }
        return {
            sortOrder: Number(parsed.sortOrder),
            createdAt,
            id: Number(parsed.id),
        };
    } catch {
        throw new StoreCatalogError("invalid_cursor");
    }
}

function encodeCursor(record: {
    sortOrder: number;
    createdAt: Date | string;
    id: number;
}): string {
    const createdAt =
        record.createdAt instanceof Date
            ? record.createdAt.toISOString()
            : record.createdAt;
    return Buffer.from(
        JSON.stringify({
            sortOrder: record.sortOrder,
            createdAt,
            id: record.id,
        })
    ).toString("base64url");
}

function cursorWhere(cursor: CatalogCursor) {
    return {
        OR: [
            { sortOrder: { gt: cursor.sortOrder } },
            {
                sortOrder: cursor.sortOrder,
                createdAt: { gt: cursor.createdAt },
            },
            {
                sortOrder: cursor.sortOrder,
                createdAt: cursor.createdAt,
                id: { gt: cursor.id },
            },
        ],
    };
}

export function parseStoreCatalogQuery(input: unknown): {
    kind: "items" | "bundles";
    cursor?: string;
    limit: number;
    type?: InventoryItemType;
} {
    const parsed = catalogQuerySchema.safeParse(input);
    if (!parsed.success) {
        throw new StoreCatalogError(
            "invalid_request",
            parsed.error.issues[0]?.message
        );
    }
    return parsed.data;
}

function policyHash(policy: StoreCatalogPolicy): string {
    return createHash("sha256")
        .update(JSON.stringify(policy))
        .digest("hex")
        .slice(0, 16);
}

async function getCatalogRevision(): Promise<string> {
    const result = await getOrSetJsonCache<string>({
        key: getRedisKey("cache", "store-catalog-revision", "v2"),
        ttlMs: 24 * 60 * 60_000,
        loader: async () => randomUUID(),
    });
    return result.value;
}

async function loadDiscounts(
    policy: StoreCatalogPolicy
): Promise<DiscountRecord[]> {
    return policy.discountCampaignsEnabled
        ? prisma.discountCampaign.findMany({
              where: { isActive: true },
              select: discountSelect,
          })
        : [];
}

async function getUserOverlay(
    userId?: number,
    relevantItemIds?: number[]
): Promise<{
    coinBalance: number;
    equippedSlots: EquippedSlots;
    ownedIds: Set<number>;
}> {
    if (!userId) {
        return {
            coinBalance: 0,
            equippedSlots: {
                avatarItemId: null,
                frameItemId: null,
                cardBackItemId: null,
                cardFaceItemId: null,
            },
            ownedIds: new Set<number>(),
        };
    }
    const [user, inventory] = await Promise.all([
        prisma.user.findUnique({
            where: { id: userId },
            select: {
                wallet: { select: { coinBalance: true } },
                profile: {
                    select: {
                        avatarItemId: true,
                        frameItemId: true,
                        cardBackItemId: true,
                        cardFaceItemId: true,
                    },
                },
            },
        }),
        relevantItemIds?.length === 0
            ? Promise.resolve([])
            : prisma.inventoryItem.findMany({
                  where: {
                      userId,
                      ...(relevantItemIds
                          ? { shopItemId: { in: relevantItemIds } }
                          : {}),
                  },
                  select: { shopItemId: true },
              }),
    ]);
    if (!user) throw new StoreCatalogError("user_not_found");
    return {
        coinBalance: user.wallet?.coinBalance ?? 0,
        equippedSlots: {
            avatarItemId: user.profile?.avatarItemId ?? null,
            frameItemId: user.profile?.frameItemId ?? null,
            cardBackItemId: user.profile?.cardBackItemId ?? null,
            cardFaceItemId: user.profile?.cardFaceItemId ?? null,
        },
        ownedIds: new Set(inventory.map((entry) => entry.shopItemId)),
    };
}

function isEquipped(
    itemId: number,
    type: InventoryItemType,
    slots: EquippedSlots
): boolean {
    if (type === "avatar") return slots.avatarItemId === itemId;
    if (type === "frame") return slots.frameItemId === itemId;
    if (type === "card_back") return slots.cardBackItemId === itemId;
    return slots.cardFaceItemId === itemId;
}

function applyItemOverlay(
    item: SharedItem,
    overlay: Awaited<ReturnType<typeof getUserOverlay>>
): CatalogStoreItemView {
    return {
        ...item,
        owned: overlay.ownedIds.has(item.id),
        equipped: isEquipped(item.id, item.type, overlay.equippedSlots),
    };
}

function applyBundleOverlay(
    bundle: SharedBundle,
    overlay: Awaited<ReturnType<typeof getUserOverlay>>
): CatalogBundleView {
    const ownedItemCount = bundle.items.filter((entry) =>
        overlay.ownedIds.has(entry.shopItemId)
    ).length;
    return {
        ...bundle,
        ownedItemCount,
        fullyOwned:
            ownedItemCount === bundle.items.length && bundle.items.length > 0,
    };
}

async function loadSharedFullCatalog(
    policy: StoreCatalogPolicy
): Promise<{ items: SharedItem[]; bundles: SharedBundle[] }> {
    const now = new Date();
    const [items, bundles, discounts] = await Promise.all([
        prisma.shopItem.findMany({
            where: { isActive: true },
            orderBy: [
                { sortOrder: "asc" },
                { createdAt: "asc" },
                { id: "asc" },
            ],
            select: shopItemSelect,
        }),
        policy.bundlesEnabled
            ? prisma.shopBundle.findMany({
                  where: { isActive: true },
                  orderBy: [
                      { sortOrder: "asc" },
                      { createdAt: "asc" },
                      { id: "asc" },
                  ],
                  include: bundleInclude,
              })
            : [],
        loadDiscounts(policy),
    ]);
    return {
        items: items.map((item) =>
            mapSharedItem(item, discounts, now, policy)
        ),
        bundles: bundles.map((bundle) =>
            mapSharedBundle(bundle, discounts, now, policy)
        ),
    };
}

export async function getStoreCatalog(input: {
    userId?: number;
    policy: StoreCatalogPolicy;
}): Promise<StoreCatalogView> {
    const policy = normalizeStoreCatalogPolicy(input.policy);
    const revision = await getCatalogRevision();
    const [sharedResult, overlay] = await Promise.all([
        getOrSetJsonCache<{
            items: SharedItem[];
            bundles: SharedBundle[];
        }>({
            key: getRedisKey(
                "cache",
                "store-catalog-full",
                "v2",
                revision,
                policyHash(policy)
            ),
            ttlMs: 30_000,
            loader: () => loadSharedFullCatalog(policy),
        }),
        getUserOverlay(input.userId),
    ]);
    return {
        coinBalance: overlay.coinBalance,
        items: sharedResult.value.items.map((item) =>
            applyItemOverlay(item, overlay)
        ),
        bundles: sharedResult.value.bundles.map((bundle) =>
            applyBundleOverlay(bundle, overlay)
        ),
        liveops: getLiveops(policy),
    };
}

export async function getStoreCatalogPage(input: {
    userId?: number;
    policy: StoreCatalogPolicy;
    query?: unknown;
}): Promise<StoreCatalogPageView> {
    const query = parseStoreCatalogQuery(input.query ?? {});
    const policy = normalizeStoreCatalogPolicy(input.policy);
    if (query.kind === "bundles" && !policy.bundlesEnabled) {
        const overlay = await getUserOverlay(input.userId, []);
        return {
            coinBalance: overlay.coinBalance,
            kind: "bundles",
            items: [],
            bundles: [],
            liveops: getLiveops(policy),
            page: { nextCursor: null, hasMore: false, limit: query.limit },
        };
    }
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const revision = await getCatalogRevision();
    const sharedResult = await getOrSetJsonCache<{
        items: SharedItem[];
        bundles: SharedBundle[];
        page: { nextCursor: string | null; hasMore: boolean };
    }>({
        key: getRedisKey(
            "cache",
            "store-catalog-page",
            "v2",
            revision,
            policyHash(policy),
            query.kind,
            query.type ?? "all",
            createHash("sha256")
                .update(query.cursor ?? "first")
                .digest("hex")
                .slice(0, 12),
            query.limit
        ),
        ttlMs: 30_000,
        loader: async () => {
            const now = new Date();
            if (query.kind === "items") {
                const [discounts, rows] = await Promise.all([
                    loadDiscounts(policy),
                    prisma.shopItem.findMany({
                        where: {
                            isActive: true,
                            ...(query.type ? { type: query.type } : {}),
                            ...(cursor ? cursorWhere(cursor) : {}),
                        },
                        orderBy: [
                            { sortOrder: "asc" },
                            { createdAt: "asc" },
                            { id: "asc" },
                        ],
                        select: shopItemSelect,
                        take: query.limit + 1,
                    }),
                ]);
                const hasMore = rows.length > query.limit;
                const visible = hasMore ? rows.slice(0, query.limit) : rows;
                const last = visible.at(-1);
                return {
                    items: visible.map((item) =>
                        mapSharedItem(item, discounts, now, policy)
                    ),
                    bundles: [],
                    page: {
                        hasMore,
                        nextCursor:
                            hasMore && last ? encodeCursor(last) : null,
                    },
                };
            }
            const [discounts, rows] = await Promise.all([
                loadDiscounts(policy),
                prisma.shopBundle.findMany({
                    where: {
                        isActive: true,
                        ...(cursor ? cursorWhere(cursor) : {}),
                    },
                    orderBy: [
                        { sortOrder: "asc" },
                        { createdAt: "asc" },
                        { id: "asc" },
                    ],
                    include: bundleInclude,
                    take: query.limit + 1,
                }),
            ]);
            const hasMore = rows.length > query.limit;
            const visible = hasMore ? rows.slice(0, query.limit) : rows;
            const last = visible.at(-1);
            return {
                items: [],
                bundles: visible.map((bundle) =>
                    mapSharedBundle(bundle, discounts, now, policy)
                ),
                page: {
                    hasMore,
                    nextCursor: hasMore && last ? encodeCursor(last) : null,
                },
            };
        },
    });
    const relevantItemIds =
        query.kind === "items"
            ? sharedResult.value.items.map((item) => item.id)
            : sharedResult.value.bundles.flatMap((bundle) =>
                  bundle.items.map((entry) => entry.shopItemId)
              );
    const overlay = await getUserOverlay(input.userId, relevantItemIds);
    return {
        coinBalance: overlay.coinBalance,
        kind: query.kind,
        items: sharedResult.value.items.map((item) =>
            applyItemOverlay(item, overlay)
        ),
        bundles: sharedResult.value.bundles.map((bundle) =>
            applyBundleOverlay(bundle, overlay)
        ),
        liveops: getLiveops(policy),
        page: { ...sharedResult.value.page, limit: query.limit },
    };
}
