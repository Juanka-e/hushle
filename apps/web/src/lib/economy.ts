import { prisma } from "@/lib/prisma";
import { createUserNotificationWithClient } from "@/lib/notifications/service";
import { getOrSetJsonCache } from "@hushle/platform-cache";
import { Prisma } from "@hushle/platform-db";
import { getStoreCatalog as getPlatformStoreCatalog } from "@hushle/platform-store";
import {
    invalidateNotificationUnreadCountCache,
    getUserDashboardMatchSummaryCacheKey,
} from "@/lib/cache/application-cache";
import type { RoomCardCosmeticsSnapshot } from "@/lib/cosmetics/room-card-themes";
import { resolveFrameTheme } from "@/lib/cosmetics/frame";
import { normalizeTemplateConfig } from "@/lib/cosmetics/template-config";
import {
    normalizeCouponCode,
    resolveCatalogPricing,
    resolveCouponPricing,
} from "@/lib/store/pricing";
import {
    applyStorePriceMultiplier,
    getStoreLiveopsState,
} from "@/lib/system-settings/economy";
import { getSystemSettings } from "@/lib/system-settings/service";
import {
    applyWalletLedgerMutation,
    WalletLedgerInsufficientBalanceError,
} from "@/lib/wallet-ledger/service";
import type { SystemSettings } from "@/types/system-settings";
import type {
    CosmeticRenderSnapshot,
    CouponCatalogPreviewResponse,
    CouponPreviewResponse,
    DashboardDataResponse,
    PlayerAppearanceSnapshot,
    StoreItemType,
    StoreItemView,
    StoreCatalogResponse,
} from "@/types/economy";

type AppearanceProfileRecord = {
    userId: number;
    avatarItemId?: number | null;
    frameItemId?: number | null;
    avatarItem: {
        imageUrl: string;
    } | null;
    frameItem: {
        imageUrl: string;
        rarity: "common" | "rare" | "epic" | "legendary";
        renderMode: "image" | "template";
        templateKey: string | null;
        templateConfig: Prisma.JsonValue | null;
    } | null;
};

type EquippedCardThemeItemRecord = {
    imageUrl: string;
    rarity: "common" | "rare" | "epic" | "legendary";
    renderMode: "image" | "template";
    renderSpecVersion: number;
    templateKey: string | null;
    templateConfig: Prisma.JsonValue | null;
};

type CardCosmeticsProfileRecord = {
    cardBackItemId?: number | null;
    cardFaceItemId?: number | null;
    cardBackItem: EquippedCardThemeItemRecord | null;
    cardFaceItem: EquippedCardThemeItemRecord | null;
};

export async function ensureUserCore(userId: number) {
    await prisma.$transaction([
        prisma.wallet.upsert({
            where: { userId },
            update: {},
            create: { userId, coinBalance: 0 },
        }),
        prisma.userProfile.upsert({
            where: { userId },
            update: {},
            create: { userId },
        }),
    ]);
}

type DashboardMatchSummary = Omit<DashboardDataResponse, "coinBalance">;

async function loadDashboardMatchSummary(
    userId: number
): Promise<DashboardMatchSummary> {
    const [matchStats, totalWins, recentMatches] = await Promise.all([
        prisma.matchResult.aggregate({
            where: { userId },
            _count: { _all: true },
            _sum: { coinEarned: true },
        }),
        prisma.matchResult.count({
            where: { userId, won: true },
        }),
        prisma.matchResult.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 5,
        }),
    ]);

    const totalMatches = matchStats._count._all;

    return {
        totalMatches,
        totalWins,
        totalCoinEarned: matchStats._sum.coinEarned ?? 0,
        winRate: totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0,
        recentMatches: recentMatches.map((match) => ({
            id: match.id,
            roomCode: match.roomCode,
            won: match.won,
            scoreA: match.scoreA,
            scoreB: match.scoreB,
            coinEarned: match.coinEarned,
            createdAt: match.createdAt.toISOString(),
        })),
    };
}

export async function getDashboardData(
    userId: number
): Promise<DashboardDataResponse> {
    const [wallet, summaryResult] = await Promise.all([
        prisma.wallet.findUnique({
            where: { userId },
            select: { coinBalance: true },
        }),
        getOrSetJsonCache<DashboardMatchSummary>({
            key: getUserDashboardMatchSummaryCacheKey(userId),
            ttlMs: 30_000,
            loader: () => loadDashboardMatchSummary(userId),
        }),
    ]);

    return {
        coinBalance: wallet?.coinBalance ?? 0,
        ...summaryResult.value,
    };
}

export async function getProfileData(userId: number) {
    await ensureUserCore(userId);
    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        include: {
            avatarItem: true,
            frameItem: true,
            cardBackItem: true,
            cardFaceItem: true,
        },
    });

    const inventory = await prisma.inventoryItem.findMany({
        where: { userId },
        include: {
            shopItem: true,
        },
        orderBy: { acquiredAt: "desc" },
    });

    return { profile, inventory };
}

export async function getPlayerAppearanceSnapshot(userId: number): Promise<PlayerAppearanceSnapshot> {
    await ensureUserCore(userId);

    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: {
            userId: true,
            avatarItemId: true,
            frameItemId: true,
            avatarItem: {
                select: {
                    imageUrl: true,
                },
            },
            frameItem: {
                select: {
                    imageUrl: true,
                    rarity: true,
                    renderMode: true,
                    renderSpecVersion: true,
                    templateKey: true,
                    templateConfig: true,
                },
            },
        },
    });

    if (!profile) {
        return createEmptyAppearanceSnapshot();
    }

    const inventoryEntries = await prisma.inventoryItem.findMany({
        where: {
            userId,
            shopItemId: {
                in: [profile.avatarItemId, profile.frameItemId].filter(
                    (itemId): itemId is number => typeof itemId === "number"
                ),
            },
        },
        select: {
            shopItemId: true,
            renderSnapshot: true,
        },
        orderBy: { acquiredAt: "desc" },
    });

    const snapshotMap = resolveInventoryRenderSnapshot(inventoryEntries);
    const avatarSnapshot =
        typeof profile.avatarItemId === "number" ? snapshotMap.get(profile.avatarItemId) ?? null : null;
    const frameSnapshot =
        typeof profile.frameItemId === "number" ? snapshotMap.get(profile.frameItemId) ?? null : null;

    return mapPlayerAppearanceSnapshot(profile, frameSnapshot ?? null, avatarSnapshot ?? null);
}

export async function getPlayerAppearanceSnapshots(userIds: number[]): Promise<Map<number, PlayerAppearanceSnapshot>> {
    const uniqueUserIds = [...new Set(userIds.filter((userId) => Number.isInteger(userId) && userId > 0))];
    if (uniqueUserIds.length === 0) {
        return new Map();
    }

    await Promise.all(uniqueUserIds.map((userId) => ensureUserCore(userId)));

    const profiles = await prisma.userProfile.findMany({
        where: {
            userId: {
                in: uniqueUserIds,
            },
        },
        select: {
            userId: true,
            avatarItemId: true,
            frameItemId: true,
            avatarItem: {
                select: {
                    imageUrl: true,
                },
            },
            frameItem: {
                select: {
                    imageUrl: true,
                    rarity: true,
                    renderMode: true,
                    renderSpecVersion: true,
                    templateKey: true,
                    templateConfig: true,
                },
            },
        },
    });

    const inventoryEntries = await prisma.inventoryItem.findMany({
        where: {
            userId: {
                in: uniqueUserIds,
            },
        },
        select: {
            userId: true,
            shopItemId: true,
            renderSnapshot: true,
        },
        orderBy: { acquiredAt: "desc" },
    });

    const inventoryByUser = new Map<number, Array<{ shopItemId: number; renderSnapshot: Prisma.JsonValue | null }>>();
    for (const entry of inventoryEntries) {
        const current = inventoryByUser.get(entry.userId) ?? [];
        current.push({
            shopItemId: entry.shopItemId,
            renderSnapshot: entry.renderSnapshot,
        });
        inventoryByUser.set(entry.userId, current);
    }

    const profileMap = new Map<number, PlayerAppearanceSnapshot>();
    for (const profile of profiles) {
        const userSnapshots = resolveInventoryRenderSnapshot(inventoryByUser.get(profile.userId) ?? []);
        const avatarSnapshot =
            typeof profile.avatarItemId === "number" ? userSnapshots.get(profile.avatarItemId) ?? null : null;
        const frameSnapshot =
            typeof profile.frameItemId === "number" ? userSnapshots.get(profile.frameItemId) ?? null : null;
        profileMap.set(profile.userId, mapPlayerAppearanceSnapshot(profile, frameSnapshot ?? null, avatarSnapshot ?? null));
    }

    return profileMap;
}

export async function getPlayerCardCosmeticsSnapshot(userId: number): Promise<RoomCardCosmeticsSnapshot> {
    await ensureUserCore(userId);

    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: {
            cardBackItemId: true,
            cardFaceItemId: true,
            cardBackItem: {
                select: {
                    imageUrl: true,
                    rarity: true,
                    renderMode: true,
                    renderSpecVersion: true,
                    templateKey: true,
                    templateConfig: true,
                },
            },
            cardFaceItem: {
                select: {
                    imageUrl: true,
                    rarity: true,
                    renderMode: true,
                    renderSpecVersion: true,
                    templateKey: true,
                    templateConfig: true,
                },
            },
        },
    });

    if (!profile) {
        return createEmptyPlayerCardCosmeticsSnapshot();
    }

    const inventoryEntries = await prisma.inventoryItem.findMany({
        where: {
            userId,
            shopItemId: {
                in: [profile.cardBackItemId, profile.cardFaceItemId].filter(
                    (itemId): itemId is number => typeof itemId === "number"
                ),
            },
        },
        select: {
            shopItemId: true,
            renderSnapshot: true,
        },
        orderBy: { acquiredAt: "desc" },
    });

    return mapPlayerCardCosmeticsSnapshot(profile, resolveInventoryRenderSnapshot(inventoryEntries));
}

function createEmptyAppearanceSnapshot(): PlayerAppearanceSnapshot {
    return {
        avatarImageUrl: null,
        frameImageUrl: null,
        frameAccentColor: null,
        frameSecondaryColor: null,
        framePattern: null,
        framePatternOpacity: null,
        framePatternScale: null,
        frameGlowColor: null,
        frameGlowBlur: null,
        frameGlowOpacity: null,
        frameStyle: null,
        frameThickness: null,
        frameRadius: null,
        frameMotionPreset: null,
        frameMotionSpeedMs: null,
    };
}

function createEmptyPlayerCardCosmeticsSnapshot(): RoomCardCosmeticsSnapshot {
    return {
        cardFace: null,
        cardBack: null,
    };
}

function mapPlayerAppearanceSnapshot(
    profile: AppearanceProfileRecord,
    frameSnapshot?: CosmeticRenderSnapshot | null,
    avatarSnapshot?: CosmeticRenderSnapshot | null
): PlayerAppearanceSnapshot {
    const frameTheme = profile.frameItem
        ? resolveFrameTheme({
            renderMode: frameSnapshot?.renderMode ?? profile.frameItem.renderMode,
            imageUrl: frameSnapshot?.imageUrl ?? profile.frameItem.imageUrl,
            templateKey: frameSnapshot?.templateKey ?? profile.frameItem.templateKey,
            templateConfig: frameSnapshot?.templateConfig ?? normalizeTemplateConfig(profile.frameItem.templateConfig),
            rarity: frameSnapshot?.rarity ?? profile.frameItem.rarity,
        })
        : null;

    return {
        avatarImageUrl: avatarSnapshot?.imageUrl ?? profile.avatarItem?.imageUrl ?? null,
        frameImageUrl: frameTheme?.imageUrl ?? null,
        frameAccentColor: frameTheme?.accentColor ?? null,
        frameSecondaryColor: frameTheme?.secondaryColor ?? null,
        framePattern: frameTheme?.pattern ?? null,
        framePatternOpacity: frameTheme?.patternOpacity ?? null,
        framePatternScale: frameTheme?.patternScale ?? null,
        frameGlowColor: frameTheme?.glowColor ?? null,
        frameGlowBlur: frameTheme?.glowBlur ?? null,
        frameGlowOpacity: frameTheme?.glowOpacity ?? null,
        frameStyle: frameTheme?.frameStyle ?? null,
        frameThickness: frameTheme?.thickness ?? null,
        frameRadius: frameTheme?.radius ?? null,
        frameMotionPreset: frameTheme?.motionPreset ?? null,
        frameMotionSpeedMs: frameTheme?.motionSpeedMs ?? null,
    };
}

function mapPlayerCardCosmeticsSnapshot(
    profile: CardCosmeticsProfileRecord,
    inventorySnapshots?: Map<number, CosmeticRenderSnapshot>
): RoomCardCosmeticsSnapshot {
    const cardFaceSnapshot =
        typeof profile.cardFaceItemId === "number" ? inventorySnapshots?.get(profile.cardFaceItemId) ?? null : null;
    const cardBackSnapshot =
        typeof profile.cardBackItemId === "number" ? inventorySnapshots?.get(profile.cardBackItemId) ?? null : null;

    return {
        cardFace: profile.cardFaceItem
            ? {
                renderMode: cardFaceSnapshot?.renderMode ?? profile.cardFaceItem.renderMode,
                imageUrl: cardFaceSnapshot?.imageUrl ?? profile.cardFaceItem.imageUrl,
                templateKey: cardFaceSnapshot?.templateKey ?? profile.cardFaceItem.templateKey,
                templateConfig: cardFaceSnapshot?.templateConfig ?? normalizeTemplateConfig(profile.cardFaceItem.templateConfig),
                rarity: cardFaceSnapshot?.rarity ?? profile.cardFaceItem.rarity,
            }
            : null,
        cardBack: profile.cardBackItem
            ? {
                renderMode: cardBackSnapshot?.renderMode ?? profile.cardBackItem.renderMode,
                imageUrl: cardBackSnapshot?.imageUrl ?? profile.cardBackItem.imageUrl,
                templateKey: cardBackSnapshot?.templateKey ?? profile.cardBackItem.templateKey,
                templateConfig: cardBackSnapshot?.templateConfig ?? normalizeTemplateConfig(profile.cardBackItem.templateConfig),
                rarity: cardBackSnapshot?.rarity ?? profile.cardBackItem.rarity,
            }
            : null,
    };
}

type StoreCatalogItemRecord = Prisma.ShopItemGetPayload<{
    select: {
        id: true;
        code: true;
        name: true;
        type: true;
        rarity: true;
        renderMode: true;
        renderSpecVersion: true;
        priceCoin: true;
        imageUrl: true;
        thumbnailUrl: true;
        templateKey: true;
        templateConfig: true;
        badgeText: true;
        availabilityMode: true;
        startsAt: true;
        endsAt: true;
        isFeatured: true;
        isActive: true;
        sortOrder: true;
        createdAt: true;
    };
}>;

type StoreCatalogBundleRecord = Prisma.ShopBundleGetPayload<{
    include: {
        items: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }];
            include: {
                shopItem: {
                    select: {
                        id: true;
                        code: true;
                        name: true;
                        type: true;
                        rarity: true;
                    };
                };
            };
        };
    };
}>;

type CouponRecord = Prisma.CouponCodeGetPayload<{
    select: {
        id: true;
        code: true;
        name: true;
        description: true;
        targetType: true;
        discountType: true;
        percentageOff: true;
        fixedCoinOff: true;
        shopItemId: true;
        bundleId: true;
        usageLimit: true;
        usedCount: true;
        startsAt: true;
        endsAt: true;
        isActive: true;
    };
}>;

type PurchaseItemResult =
    | { ok: true; item: StoreCatalogItemRecord; coinBalance: number; finalPriceCoin: number }
    | { ok: false; code: "not_found" | "already_owned" | "insufficient_balance" | "invalid_coupon" | "promotion_unavailable" | "coupon_disabled" };

type PurchaseBundleResult =
    | {
        ok: true;
        bundle: StoreCatalogBundleRecord;
        awardedItems: StoreCatalogItemRecord[];
        coinBalance: number;
        finalPriceCoin: number;
    }
    | {
        ok: false;
        code:
        | "not_found"
        | "already_owned"
        | "contains_owned_items"
        | "insufficient_balance"
        | "invalid_coupon"
        | "promotion_unavailable"
        | "bundle_disabled"
        | "coupon_disabled";
    };

async function loadCouponRecord(
    tx: Prisma.TransactionClient,
    couponCode: string | undefined
): Promise<CouponRecord | null> {
    if (!couponCode) {
        return null;
    }

    return tx.couponCode.findUnique({
        where: { code: normalizeCouponCode(couponCode) },
        select: {
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
        },
    });
}

async function reserveDiscountCampaignUsage(
    tx: Prisma.TransactionClient,
    promotionId: number
): Promise<boolean> {
    const result = await tx.discountCampaign.updateMany({
        where: {
            id: promotionId,
            OR: [
                { usageLimit: null },
                {
                    AND: [
                        { usageLimit: { not: null } },
                        { usedCount: { lt: tx.discountCampaign.fields.usageLimit } },
                    ],
                },
            ],
        },
        data: {
            usedCount: { increment: 1 },
        },
    });

    return result.count === 1;
}

async function reserveCouponUsage(
    tx: Prisma.TransactionClient,
    couponId: number
): Promise<boolean> {
    const result = await tx.couponCode.updateMany({
        where: {
            id: couponId,
            OR: [
                { usageLimit: null },
                {
                    AND: [
                        { usageLimit: { not: null } },
                        { usedCount: { lt: tx.couponCode.fields.usageLimit } },
                    ],
                },
            ],
        },
        data: {
            usedCount: { increment: 1 },
        },
    });

    return result.count === 1;
}

export async function listStoreItems(type?: StoreItemType, userId?: number): Promise<StoreItemView[]> {
    const catalog = await getStoreCatalog(userId);
    const items = type
        ? catalog.items.filter((item) => item.type === type)
        : catalog.items;

    return items.map((item) => {
        const { pricing, ...itemView } = item;
        void pricing;
        return itemView;
    });
}

export async function getStoreCatalog(
    userId?: number,
    settingsInput?: SystemSettings
): Promise<StoreCatalogResponse> {
    const settings = settingsInput ?? await getSystemSettings();
    const liveops = getStoreLiveopsState(settings, new Date());
    return getPlatformStoreCatalog({
        userId,
        policy: {
            ...liveops,
            storePriceMultiplier: settings.economy.storePriceMultiplier,
        },
    });
}

export async function previewCouponForTarget(
    userId: number,
    targetKind: "shop_item" | "bundle",
    targetId: number,
    couponCode: string,
    settingsInput?: SystemSettings
): Promise<CouponPreviewResponse> {
    await ensureUserCore(userId);
    const settings = settingsInput ?? await getSystemSettings();

    const normalizedCode = normalizeCouponCode(couponCode);
    if (!normalizedCode) {
        return {
            valid: false,
            reason: "Kupon kodu bos olamaz.",
            targetKind,
            targetId,
            pricing: null,
            coupon: null,
        };
    }

    if (!settings.economy.couponsEnabled) {
        return {
            valid: false,
            reason: "Kupon kullanimi su anda gecici olarak kapali.",
            targetKind,
            targetId,
            pricing: null,
            coupon: null,
        };
    }

    if (targetKind === "bundle" && !settings.economy.bundlesEnabled) {
        return {
            valid: false,
            reason: "Bundle satislari su anda gecici olarak kapali.",
            targetKind,
            targetId,
            pricing: null,
            coupon: null,
        };
    }

    const now = new Date();
    const [discounts, coupon, item, bundle] = await Promise.all([
        settings.economy.discountCampaignsEnabled
            ? prisma.discountCampaign.findMany({
                where: { isActive: true },
                select: {
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
                },
            })
            : Promise.resolve([]),
        prisma.couponCode.findUnique({
            where: { code: normalizedCode },
            select: {
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
            },
        }),
        targetKind === "shop_item"
            ? prisma.shopItem.findUnique({
                where: { id: targetId },
                select: { id: true, priceCoin: true, isActive: true, availabilityMode: true, startsAt: true, endsAt: true },
            })
            : Promise.resolve(null),
        targetKind === "bundle"
            ? prisma.shopBundle.findUnique({
                where: { id: targetId },
                select: { id: true, priceCoin: true, isActive: true },
            })
            : Promise.resolve(null),
    ]);

    const basePriceCoin = targetKind === "shop_item" ? item?.priceCoin : bundle?.priceCoin;
    const isActiveTarget =
        targetKind === "shop_item"
            ? (item ? isShopItemDirectlyAvailable(item, now) : false)
            : bundle?.isActive;

    if (basePriceCoin === undefined || basePriceCoin === null || !isActiveTarget) {
        return {
            valid: false,
            reason: "Hedef urun bulunamadi.",
            targetKind,
            targetId,
            pricing: null,
            coupon: null,
        };
    }

    const effectivePriceCoin = applyStorePriceMultiplier(basePriceCoin, settings);

    const basePricing = resolveCatalogPricing(
        effectivePriceCoin,
        { kind: targetKind, targetId },
        discounts,
        now
    );
    const couponResult = resolveCouponPricing(basePricing, { kind: targetKind, targetId }, coupon, now);

    if (!couponResult.ok) {
        return {
            valid: false,
            reason: couponResult.reason,
            targetKind,
            targetId,
            pricing: basePricing,
            coupon: null,
        };
    }

    return {
        valid: true,
        reason: null,
        targetKind,
        targetId,
        pricing: couponResult.pricing,
        coupon: couponResult.coupon,
    };
}

function normalizeRenderSpecVersion(value: number | null | undefined): number {
    return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1;
}

function buildCosmeticRenderSnapshot(input: {
    type: StoreItemType;
    rarity: "common" | "rare" | "epic" | "legendary";
    renderMode: "image" | "template";
    renderSpecVersion: number;
    imageUrl: string;
    templateKey: string | null;
    templateConfig: Prisma.JsonValue | null;
    badgeText?: string | null;
}): Prisma.InputJsonObject & CosmeticRenderSnapshot {
    return {
        type: input.type,
        rarity: input.rarity,
        renderMode: input.renderMode,
        renderSpecVersion: normalizeRenderSpecVersion(input.renderSpecVersion),
        imageUrl: input.imageUrl,
        templateKey: input.templateKey,
        templateConfig: normalizeTemplateConfig(input.templateConfig),
        badgeText: input.badgeText ?? null,
    } as Prisma.InputJsonObject & CosmeticRenderSnapshot;
}

function readCosmeticRenderSnapshot(snapshot: Prisma.JsonValue | null): CosmeticRenderSnapshot | null {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        return null;
    }

    const candidate = snapshot as Record<string, unknown>;
    const type = candidate.type;
    const rarity = candidate.rarity;
    const renderMode = candidate.renderMode;
    const imageUrl = candidate.imageUrl;
    const templateKey = candidate.templateKey;
    const badgeText = candidate.badgeText;

    if (
        (type !== "avatar" && type !== "frame" && type !== "card_back" && type !== "card_face") ||
        (rarity !== "common" && rarity !== "rare" && rarity !== "epic" && rarity !== "legendary") ||
        (renderMode !== "image" && renderMode !== "template") ||
        typeof imageUrl !== "string"
    ) {
        return null;
    }

    return {
        type,
        rarity,
        renderMode,
        renderSpecVersion: normalizeRenderSpecVersion(
            typeof candidate.renderSpecVersion === "number" ? candidate.renderSpecVersion : null
        ),
        imageUrl,
        templateKey: typeof templateKey === "string" ? templateKey : null,
        templateConfig: normalizeTemplateConfig((candidate.templateConfig as Prisma.JsonValue | null | undefined) ?? null),
        badgeText: typeof badgeText === "string" ? badgeText : null,
    };
}

function resolveInventoryRenderSnapshot(
    inventoryEntries: Array<{
        shopItemId: number;
        renderSnapshot: Prisma.JsonValue | null;
    }>
): Map<number, CosmeticRenderSnapshot> {
    const snapshotMap = new Map<number, CosmeticRenderSnapshot>();

    for (const entry of inventoryEntries) {
        const snapshot = readCosmeticRenderSnapshot(entry.renderSnapshot);
        if (snapshot) {
            snapshotMap.set(entry.shopItemId, snapshot);
        }
    }

    return snapshotMap;
}

function isShopItemDirectlyAvailable(
    item: Pick<StoreCatalogItemRecord, "availabilityMode" | "startsAt" | "endsAt" | "isActive">,
    now: Date
) {
    if (!item.isActive) {
        return false;
    }

    if (item.availabilityMode === "event_only") {
        return false;
    }

    if (item.startsAt && item.startsAt.getTime() > now.getTime()) {
        return false;
    }

    if (item.endsAt && item.endsAt.getTime() < now.getTime()) {
        return false;
    }

    return true;
}

export async function previewCouponForCatalog(
    userId: number,
    couponCode: string,
    settingsInput?: SystemSettings
): Promise<CouponCatalogPreviewResponse> {
    await ensureUserCore(userId);
    const settings = settingsInput ?? await getSystemSettings();

    const normalizedCode = normalizeCouponCode(couponCode);
    if (!normalizedCode) {
        return {
            valid: false,
            reason: "Kupon kodu boş olamaz.",
            coupon: null,
            items: [],
            bundles: [],
        };
    }

    if (!settings.economy.couponsEnabled) {
        return {
            valid: false,
            reason: "Kupon kullanımı şu anda geçici olarak kapalı.",
            coupon: null,
            items: [],
            bundles: [],
        };
    }

    const now = new Date();
    const [discounts, coupon, items, bundles] = await Promise.all([
        settings.economy.discountCampaignsEnabled
            ? prisma.discountCampaign.findMany({
                where: { isActive: true },
                select: {
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
                },
            })
            : Promise.resolve([]),
        prisma.couponCode.findUnique({
            where: { code: normalizedCode },
            select: {
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
            },
        }),
        prisma.shopItem.findMany({
            where: { isActive: true },
            select: { id: true, priceCoin: true, isActive: true, availabilityMode: true, startsAt: true, endsAt: true },
        }),
        settings.economy.bundlesEnabled
            ? prisma.shopBundle.findMany({
                where: { isActive: true },
                select: { id: true, priceCoin: true },
            })
            : Promise.resolve([]),
    ]);

    if (!coupon) {
        return {
            valid: false,
            reason: "Kupon doğrulanamadı.",
            coupon: null,
            items: [],
            bundles: [],
        };
    }

    const previewItems = items.flatMap((item) => {
        if (!isShopItemDirectlyAvailable(item, now)) {
            return [];
        }

        const basePricing = resolveCatalogPricing(
            applyStorePriceMultiplier(item.priceCoin, settings),
            { kind: "shop_item", targetId: item.id },
            discounts,
            now
        );
        const result = resolveCouponPricing(basePricing, { kind: "shop_item", targetId: item.id }, coupon, now);
        return result.ok ? [{ targetId: item.id, pricing: result.pricing }] : [];
    });

    const previewBundles = bundles.flatMap((bundle) => {
        const basePricing = resolveCatalogPricing(
            applyStorePriceMultiplier(bundle.priceCoin, settings),
            { kind: "bundle", targetId: bundle.id },
            discounts,
            now
        );
        const result = resolveCouponPricing(basePricing, { kind: "bundle", targetId: bundle.id }, coupon, now);
        return result.ok ? [{ targetId: bundle.id, pricing: result.pricing }] : [];
    });

    if (previewItems.length === 0 && previewBundles.length === 0) {
        return {
            valid: false,
            reason: "Bu kupon mağazada geçerli bir ürün ya da paket bulamadı.",
            coupon: null,
            items: [],
            bundles: [],
        };
    }

    return {
        valid: true,
        reason: null,
        coupon: {
            code: coupon.code,
            name: coupon.name,
            description: coupon.description,
            discountType: coupon.discountType,
            percentageOff: coupon.percentageOff,
            fixedCoinOff: coupon.fixedCoinOff,
        },
        items: previewItems,
        bundles: previewBundles,
    };
}

export async function purchaseStoreItem(
    userId: number,
    shopItemId: number,
    couponCode?: string,
    settingsInput?: SystemSettings
): Promise<PurchaseItemResult> {
    const settings = settingsInput ?? await getSystemSettings();

    let result: PurchaseItemResult;
    try {
        result = await prisma.$transaction<PurchaseItemResult>(async (tx) => {
        await tx.wallet.upsert({
            where: { userId },
            update: {},
            create: { userId, coinBalance: 0 },
        });
        await tx.userProfile.upsert({
            where: { userId },
            update: {},
            create: { userId },
        });

        const now = new Date();
        const normalizedCouponCode = couponCode ? normalizeCouponCode(couponCode) : "";

        const [item, wallet, owned, discounts, coupon] = await Promise.all([
            tx.shopItem.findUnique({
                where: { id: shopItemId },
                select: {
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
                },
            }),
            tx.wallet.findUnique({ where: { userId } }),
            tx.inventoryItem.findUnique({
                where: {
                    userId_shopItemId: { userId, shopItemId },
                },
            }),
            settings.economy.discountCampaignsEnabled
                ? tx.discountCampaign.findMany({
                    where: { isActive: true },
                    select: {
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
                    },
                })
                : Promise.resolve([]),
            settings.economy.couponsEnabled
                ? loadCouponRecord(tx, normalizedCouponCode || undefined)
                : Promise.resolve(null),
        ]);

        if (!item || !isShopItemDirectlyAvailable(item, now)) {
            return { ok: false, code: "not_found" };
        }
        if (owned) {
            return { ok: false, code: "already_owned" };
        }
        if (normalizedCouponCode && !settings.economy.couponsEnabled) {
            return { ok: false, code: "coupon_disabled" };
        }

        const effectivePriceCoin = applyStorePriceMultiplier(item.priceCoin, settings);

        const catalogPricing = resolveCatalogPricing(
            effectivePriceCoin,
            { kind: "shop_item", targetId: item.id },
            discounts,
            now
        );

        const resolvedPricing = normalizedCouponCode
            ? resolveCouponPricing(catalogPricing, { kind: "shop_item", targetId: item.id }, coupon, now)
            : null;

        if (resolvedPricing && !resolvedPricing.ok) {
            return { ok: false, code: "invalid_coupon" };
        }

        const finalPriceCoin = resolvedPricing?.ok ? resolvedPricing.pricing.finalPriceCoin : catalogPricing.finalPriceCoin;
        if (!wallet || wallet.coinBalance < finalPriceCoin) {
            return { ok: false, code: "insufficient_balance" };
        }

        if (catalogPricing.appliedPromotion) {
            const reservedPromotion = await reserveDiscountCampaignUsage(tx, catalogPricing.appliedPromotion.id);
            if (!reservedPromotion) {
                return { ok: false, code: "promotion_unavailable" };
            }
        }

        if (resolvedPricing?.ok && coupon) {
            const reservedCoupon = await reserveCouponUsage(tx, coupon.id);
            if (!reservedCoupon) {
                return { ok: false, code: "invalid_coupon" };
            }
        }

        const purchase = await tx.purchase.create({
            data: {
                userId,
                shopItemId,
                couponCodeId: resolvedPricing?.ok ? coupon?.id ?? null : null,
                priceCoin: finalPriceCoin,
                listPriceCoin: effectivePriceCoin,
                discountCoin: effectivePriceCoin - finalPriceCoin,
                status: "completed",
            },
        });
        const walletMutation =
            finalPriceCoin > 0
                ? await applyWalletLedgerMutation(tx, {
                      userId,
                      source: "store_item_purchase",
                      deltaCoin: -finalPriceCoin,
                      idempotencyKey: `purchase:${purchase.id}:spend`,
                      referenceType: "purchase",
                      referenceId: purchase.id,
                      metadata: { shopItemId },
                  })
                : null;

        await tx.inventoryItem.create({
            data: {
                userId,
                shopItemId,
                source: "purchase",
                renderSnapshot: buildCosmeticRenderSnapshot({
                    type: item.type,
                    rarity: item.rarity,
                    renderMode: item.renderMode,
                    renderSpecVersion: item.renderSpecVersion,
                    imageUrl: item.imageUrl,
                    templateKey: item.templateKey,
                    templateConfig: item.templateConfig,
                    badgeText: item.badgeText,
                }),
            },
        });

        await createUserNotificationWithClient(tx, {
            userId,
            type: "economy",
            title: "Satın alma tamamlandı",
            body: `${item.name} envanterine eklendi.${resolvedPricing?.ok && coupon ? ` ${coupon.code} kuponu uygulandı.` : ""}`,
            resourceType: "shop_item",
            resourceId: item.id,
            actionLabel: "Envanteri Aç",
            actionHref: "/dashboard?tab=inventory",
            metadata: {
                kind: "store_purchase",
                finalPriceCoin,
                couponCode: resolvedPricing?.ok ? coupon?.code ?? null : null,
            },
        }, { deferCacheInvalidation: true });

        return {
            ok: true,
            item,
            coinBalance: walletMutation?.balanceAfter ?? wallet.coinBalance,
            finalPriceCoin,
        };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
        if (error instanceof WalletLedgerInsufficientBalanceError) {
            return { ok: false, code: "insufficient_balance" };
        }
        throw error;
    }
    if (result.ok) {
        await invalidateNotificationUnreadCountCache(userId);
    }
    return result;
}

export async function purchaseStoreBundle(
    userId: number,
    bundleId: number,
    couponCode?: string,
    settingsInput?: SystemSettings
): Promise<PurchaseBundleResult> {
    const settings = settingsInput ?? await getSystemSettings();

    let result: PurchaseBundleResult;
    try {
        result = await prisma.$transaction<PurchaseBundleResult>(async (tx) => {
        await tx.wallet.upsert({
            where: { userId },
            update: {},
            create: { userId, coinBalance: 0 },
        });
        await tx.userProfile.upsert({
            where: { userId },
            update: {},
            create: { userId },
        });

        const now = new Date();
        const normalizedCouponCode = couponCode ? normalizeCouponCode(couponCode) : "";

        const [bundle, wallet, inventory, discounts, coupon] = await Promise.all([
            tx.shopBundle.findUnique({
                where: { id: bundleId },
                include: {
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
                                },
                            },
                        },
                    },
                },
            }),
            tx.wallet.findUnique({ where: { userId } }),
            tx.inventoryItem.findMany({
                where: { userId },
                select: { shopItemId: true },
            }),
            settings.economy.discountCampaignsEnabled
                ? tx.discountCampaign.findMany({
                    where: { isActive: true },
                    select: {
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
                    },
                })
                : Promise.resolve([]),
            settings.economy.couponsEnabled
                ? loadCouponRecord(tx, normalizedCouponCode || undefined)
                : Promise.resolve(null),
        ]);

        if (!bundle || !bundle.isActive) {
            return { ok: false, code: "not_found" };
        }
        if (!settings.economy.bundlesEnabled) {
            return { ok: false, code: "bundle_disabled" };
        }
        if (normalizedCouponCode && !settings.economy.couponsEnabled) {
            return { ok: false, code: "coupon_disabled" };
        }

        const ownedIds = new Set(inventory.map((entry) => entry.shopItemId));
        const awardedEntries = bundle.items.filter((entry) => !ownedIds.has(entry.shopItemId));

        if (awardedEntries.length === 0) {
            return { ok: false, code: "already_owned" };
        }

        if (awardedEntries.length !== bundle.items.length) {
            return { ok: false, code: "contains_owned_items" };
        }

        const effectivePriceCoin = applyStorePriceMultiplier(bundle.priceCoin, settings);

        const catalogPricing = resolveCatalogPricing(
            effectivePriceCoin,
            { kind: "bundle", targetId: bundle.id },
            discounts,
            now
        );

        const resolvedPricing = normalizedCouponCode
            ? resolveCouponPricing(catalogPricing, { kind: "bundle", targetId: bundle.id }, coupon, now)
            : null;

        if (resolvedPricing && !resolvedPricing.ok) {
            return { ok: false, code: "invalid_coupon" };
        }

        const finalPriceCoin = resolvedPricing?.ok ? resolvedPricing.pricing.finalPriceCoin : catalogPricing.finalPriceCoin;
        if (!wallet || wallet.coinBalance < finalPriceCoin) {
            return { ok: false, code: "insufficient_balance" };
        }

        if (catalogPricing.appliedPromotion) {
            const reservedPromotion = await reserveDiscountCampaignUsage(tx, catalogPricing.appliedPromotion.id);
            if (!reservedPromotion) {
                return { ok: false, code: "promotion_unavailable" };
            }
        }

        if (resolvedPricing?.ok && coupon) {
            const reservedCoupon = await reserveCouponUsage(tx, coupon.id);
            if (!reservedCoupon) {
                return { ok: false, code: "invalid_coupon" };
            }
        }

        const purchase = await tx.purchase.create({
            data: {
                userId,
                bundleId: bundle.id,
                couponCodeId: resolvedPricing?.ok ? coupon?.id ?? null : null,
                priceCoin: finalPriceCoin,
                listPriceCoin: effectivePriceCoin,
                discountCoin: effectivePriceCoin - finalPriceCoin,
                status: "completed",
            },
        });
        const walletMutation =
            finalPriceCoin > 0
                ? await applyWalletLedgerMutation(tx, {
                      userId,
                      source: "store_bundle_purchase",
                      deltaCoin: -finalPriceCoin,
                      idempotencyKey: `purchase:${purchase.id}:spend`,
                      referenceType: "purchase",
                      referenceId: purchase.id,
                      metadata: {
                          bundleId: bundle.id,
                          awardedItemCount: awardedEntries.length,
                      },
                  })
                : null;

        await tx.inventoryItem.createMany({
            data: awardedEntries.map((entry) => ({
                userId,
                shopItemId: entry.shopItemId,
                source: "purchase",
                renderSnapshot: buildCosmeticRenderSnapshot({
                    type: entry.shopItem.type,
                    rarity: entry.shopItem.rarity,
                    renderMode: entry.shopItem.renderMode,
                    renderSpecVersion: entry.shopItem.renderSpecVersion,
                    imageUrl: entry.shopItem.imageUrl,
                    templateKey: entry.shopItem.templateKey,
                    templateConfig: entry.shopItem.templateConfig,
                    badgeText: entry.shopItem.badgeText,
                }),
            })),
        });

        await createUserNotificationWithClient(tx, {
            userId,
            type: "economy",
            title: "Paket satın alındı",
            body: `${bundle.name} paketi envanterine işlendi.${resolvedPricing?.ok && coupon ? ` ${coupon.code} kuponu uygulandı.` : ""}`,
            resourceType: "shop_bundle",
            resourceId: bundle.id,
            actionLabel: "Envanteri Aç",
            actionHref: "/dashboard?tab=inventory",
            metadata: {
                kind: "bundle_purchase",
                finalPriceCoin,
                awardedItemCount: awardedEntries.length,
                couponCode: resolvedPricing?.ok ? coupon?.code ?? null : null,
            },
        }, { deferCacheInvalidation: true });

        return {
            ok: true,
            bundle,
            awardedItems: awardedEntries.map((entry) => entry.shopItem),
            coinBalance: walletMutation?.balanceAfter ?? wallet.coinBalance,
            finalPriceCoin,
        };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
        if (error instanceof WalletLedgerInsufficientBalanceError) {
            return { ok: false, code: "insufficient_balance" };
        }
        throw error;
    }
    if (result.ok) {
        await invalidateNotificationUnreadCountCache(userId);
    }
    return result;
}
