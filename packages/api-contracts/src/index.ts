export const MOBILE_API_VERSION = "v1" as const;

export const MOBILE_API_ROUTES = {
    health: "/health",
    meta: `/${MOBILE_API_VERSION}/meta`,
    authLogin: `/${MOBILE_API_VERSION}/auth/login`,
    authRefresh: `/${MOBILE_API_VERSION}/auth/refresh`,
    authLogout: `/${MOBILE_API_VERSION}/auth/logout`,
    authSessions: `/${MOBILE_API_VERSION}/auth/sessions`,
    me: `/${MOBILE_API_VERSION}/me`,
    profile: `/${MOBILE_API_VERSION}/profile`,
    inventory: `/${MOBILE_API_VERSION}/inventory`,
    inventoryEquipped: `/${MOBILE_API_VERSION}/inventory/equipped`,
    storeCatalog: `/${MOBILE_API_VERSION}/store/catalog`,
} as const;

export type MobileApiCapabilityStatus =
    | "available"
    | "planned"
    | "web_runtime_only";

export interface MobileApiMeta {
    apiVersion: typeof MOBILE_API_VERSION;
    requestId: string;
}

export interface MobileApiSuccess<T> {
    ok: true;
    data: T;
    meta: MobileApiMeta;
}

export interface MobileApiError {
    ok: false;
    error: {
        code:
            | "cors_denied"
            | "invalid_request"
            | "invalid_credentials"
            | "invalid_token"
            | "token_expired"
            | "token_reuse_detected"
            | "account_suspended"
            | "email_verification_required"
            | "captcha_failed"
            | "rate_limited"
            | "auth_unavailable"
            | "session_not_found"
            | "invalid_profile"
            | "user_not_found"
            | "inventory_item_not_found"
            | "inventory_item_not_owned"
            | "inventory_type_mismatch"
            | "store_unavailable"
            | "method_not_allowed"
            | "not_found"
            | "internal_error";
        message: string;
    };
    meta: MobileApiMeta;
}

export interface MobileAuthTokenData {
    tokenType: "Bearer";
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshToken: string;
    refreshTokenExpiresAt: string;
    sessionId: string;
}

export interface MobileAuthUserData {
    id: number;
    username: string;
    role: string;
}

export interface MobileAuthLoginData {
    user: MobileAuthUserData;
    tokens: MobileAuthTokenData;
}

export interface MobileAuthSessionData {
    id: string;
    deviceName: string;
    createdAt: string;
    lastSeenAt: string;
    current: boolean;
}

export interface MobilePlayerCoreData {
    id: number;
    username: string;
    email: string | null;
    emailVerifiedAt: string | null;
    wallet: {
        coinBalance: number;
    };
    profile: {
        displayName: string | null;
        bio: string | null;
        avatarItemId: number | null;
        frameItemId: number | null;
        cardBackItemId: number | null;
        cardFaceItemId: number | null;
    };
}

export type MobileInventoryItemType =
    | "avatar"
    | "frame"
    | "card_back"
    | "card_face";

export interface MobileInventoryItemData {
    inventoryItemId: number;
    shopItemId: number;
    code: string;
    name: string;
    type: MobileInventoryItemType;
    rarity: "common" | "rare" | "epic" | "legendary";
    renderMode: "image" | "template";
    renderSpecVersion: number;
    priceCoin: number;
    imageUrl: string;
    thumbnailUrl: string | null;
    templateKey: string | null;
    templateConfig: Record<string, unknown> | null;
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
    source: "purchase" | "grant" | "migration";
    acquiredAt: string;
    equipped: boolean;
}

export interface MobileInventoryData {
    profile: MobilePlayerCoreData["profile"];
    items: MobileInventoryItemData[];
    page: {
        nextCursor: string | null;
        hasMore: boolean;
        limit: number;
    };
}

export interface MobileEquippedInventoryData {
    profile: MobilePlayerCoreData["profile"];
    equippedSlots: Pick<
        MobilePlayerCoreData["profile"],
        | "avatarItemId"
        | "frameItemId"
        | "cardBackItemId"
        | "cardFaceItemId"
    >;
}

export interface MobileStorePriceData {
    basePriceCoin: number;
    discountCoin: number;
    finalPriceCoin: number;
    appliedPromotion: {
        name: string;
        description: string | null;
        discountType: "percentage" | "fixed_coin";
        percentageOff: number | null;
        fixedCoinOff: number | null;
        stackableWithCoupon: boolean;
    } | null;
}

export interface MobileStoreItemData {
    id: number;
    code: string;
    name: string;
    type: MobileInventoryItemType;
    rarity: "common" | "rare" | "epic" | "legendary";
    renderMode: "image" | "template";
    renderSpecVersion: number;
    priceCoin: number;
    imageUrl: string;
    thumbnailUrl: string | null;
    templateKey: string | null;
    templateConfig: Record<string, unknown> | null;
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
    owned: boolean;
    equipped: boolean;
    pricing: MobileStorePriceData;
}

export interface MobileStoreBundleData {
    id: number;
    code: string;
    name: string;
    description: string | null;
    priceCoin: number;
    ownedItemCount: number;
    fullyOwned: boolean;
    pricing: MobileStorePriceData;
    items: Array<{
        shopItemId: number;
        itemCode: string;
        itemName: string;
        itemType: MobileInventoryItemType;
        itemRarity: "common" | "rare" | "epic" | "legendary";
    }>;
}

export interface MobileStoreCatalogData {
    coinBalance: number;
    kind: "items" | "bundles";
    items: MobileStoreItemData[];
    bundles: MobileStoreBundleData[];
    liveops: {
        bundlesEnabled: boolean;
        couponsEnabled: boolean;
        discountCampaignsEnabled: boolean;
    };
    page: {
        nextCursor: string | null;
        hasMore: boolean;
        limit: number;
    };
}

export interface MobileApiHealthData {
    service: "hushle-api";
    status: "ok";
}

export interface MobileApiRuntimeMetaData {
    service: "hushle-api";
    apiVersion: typeof MOBILE_API_VERSION;
    capabilities: {
        runtimeMeta: MobileApiCapabilityStatus;
        bearerAuth: MobileApiCapabilityStatus;
        profile: MobileApiCapabilityStatus;
        inventory: MobileApiCapabilityStatus;
        storeCatalog: MobileApiCapabilityStatus;
        progression: MobileApiCapabilityStatus;
        realtimeGameplay: MobileApiCapabilityStatus;
        admin: MobileApiCapabilityStatus;
    };
}

export function buildMobileApiSuccess<T>(
    data: T,
    requestId: string
): MobileApiSuccess<T> {
    return {
        ok: true,
        data,
        meta: {
            apiVersion: MOBILE_API_VERSION,
            requestId,
        },
    };
}

export function buildMobileApiError(
    code: MobileApiError["error"]["code"],
    message: string,
    requestId: string
): MobileApiError {
    return {
        ok: false,
        error: { code, message },
        meta: {
            apiVersion: MOBILE_API_VERSION,
            requestId,
        },
    };
}
