import type { IncomingMessage } from "node:http";
import {
    authenticateAccessToken,
    canUseAccountCapability,
    consumeAuthRateLimit,
    MobileAuthError,
} from "@hushle/platform-auth";
import {
    getPlayerCore,
    PlayerCoreError,
    updatePlayerProfile,
} from "@hushle/platform-player";
import {
    equipInventoryItem,
    getInventoryPage,
    InventoryError,
} from "@hushle/platform-inventory";
import {
    getStoreCatalogPage,
    StoreCatalogError,
    type StoreCatalogPageView,
} from "@hushle/platform-store";
import {
    MOBILE_API_ROUTES,
    type MobileEquippedInventoryData,
    type MobileInventoryData,
    type MobilePlayerCoreData,
    type MobileStoreCatalogData,
} from "@hushle/api-contracts";
import type { AuthRouteResult } from "./auth-routes.js";
import {
    getMobileStorePolicy,
    isMobileStoreAvailable,
} from "./store-policy.js";

type PlayerRouteContext = {
    authEnabled: boolean;
    body: unknown;
    method: string;
    pathname: string;
    remoteIp: string;
    request: IncomingMessage;
    query: URLSearchParams;
};

function getBearerToken(request: IncomingMessage): string | null {
    const value = request.headers.authorization;
    if (!value) return null;
    return /^Bearer ([^\s]+)$/.exec(value)?.[1] ?? null;
}

function toMobileStoreCatalogData(
    catalog: StoreCatalogPageView
): MobileStoreCatalogData {
    const mapPricing = (
        pricing: StoreCatalogPageView["items"][number]["pricing"]
    ) => ({
        basePriceCoin: pricing.basePriceCoin,
        discountCoin: pricing.discountCoin,
        finalPriceCoin: pricing.finalPriceCoin,
        appliedPromotion: pricing.appliedPromotion
            ? {
                  name: pricing.appliedPromotion.name,
                  description: pricing.appliedPromotion.description,
                  discountType: pricing.appliedPromotion.discountType,
                  percentageOff: pricing.appliedPromotion.percentageOff,
                  fixedCoinOff: pricing.appliedPromotion.fixedCoinOff,
                  stackableWithCoupon:
                      pricing.appliedPromotion.stackableWithCoupon,
              }
            : null,
    });
    return {
        coinBalance: catalog.coinBalance,
        kind: catalog.kind,
        items: catalog.items.map(
            ({ isActive, sortOrder, createdAt, pricing, ...item }) => {
                void isActive;
                void sortOrder;
                void createdAt;
                return { ...item, pricing: mapPricing(pricing) };
            }
        ),
        bundles: catalog.bundles.map(
            ({ isActive, sortOrder, createdAt, pricing, ...bundle }) => {
                void isActive;
                void sortOrder;
                void createdAt;
                return {
                    ...bundle,
                    items: bundle.items.map(
                        ({ id, sortOrder: itemSortOrder, ...item }) => {
                            void id;
                            void itemSortOrder;
                            return item;
                        }
                    ),
                    pricing: mapPricing(pricing),
                };
            }
        ),
        liveops: {
            bundlesEnabled: catalog.liveops.bundlesEnabled,
            couponsEnabled: catalog.liveops.couponsEnabled,
            discountCampaignsEnabled:
                catalog.liveops.discountCampaignsEnabled,
        },
        page: catalog.page,
    };
}

function mapPlayerError(error: unknown): AuthRouteResult {
    if (error instanceof MobileAuthError) {
        return {
            status: error.code === "account_suspended" ? 403 : 401,
            error: {
                code: error.code,
                message: "Authentication failed.",
            },
        };
    }
    if (error instanceof PlayerCoreError) {
        const status =
            error.code === "invalid_profile"
                ? 422
                : 404;
        return {
            status,
            error: {
                code: error.code,
                message:
                    error.code === "invalid_profile"
                        ? error.message
                        : "User was not found.",
            },
        };
    }
    if (error instanceof InventoryError) {
        const code =
            error.code === "invalid_cursor"
                ? "invalid_request"
                : error.code === "item_not_found"
                ? "inventory_item_not_found"
                : error.code === "not_owned"
                  ? "inventory_item_not_owned"
                  : error.code === "type_mismatch"
                    ? "inventory_type_mismatch"
                    : error.code;
        const status =
            error.code === "user_not_found" ||
            error.code === "item_not_found"
                ? 404
                : error.code === "invalid_request" ||
                    error.code === "invalid_cursor"
                  ? 422
                  : 409;
        return {
            status,
            error: {
                code,
                message:
                    error.code === "invalid_cursor"
                        ? "Inventory cursor is invalid."
                        : error.message,
            },
        };
    }
    if (error instanceof StoreCatalogError) {
        return {
            status: error.code === "user_not_found" ? 404 : 422,
            error: {
                code:
                    error.code === "user_not_found"
                        ? "user_not_found"
                        : "invalid_request",
                message:
                    error.code === "invalid_cursor"
                        ? "Store catalog cursor is invalid."
                        : error.message,
            },
        };
    }
    throw error;
}

async function applyLimit(input: {
    scope: string;
    identifier: string;
    limit: number;
}): Promise<AuthRouteResult | null> {
    const result = await consumeAuthRateLimit({
        scope: input.scope,
        identifier: input.identifier,
        limit: input.limit,
        windowMs: 60_000,
    });
    if (result.allowed) return null;
    return {
        status: 429,
        headers: { "Retry-After": String(result.retryAfterSeconds) },
        error: {
            code: "rate_limited",
            message: "Too many requests. Try again later.",
        },
    };
}

export function isPlayerRoute(pathname: string): boolean {
    return (
        pathname === MOBILE_API_ROUTES.me ||
        pathname === MOBILE_API_ROUTES.profile ||
        pathname === MOBILE_API_ROUTES.inventory ||
        pathname === MOBILE_API_ROUTES.inventoryEquipped ||
        pathname === MOBILE_API_ROUTES.storeCatalog
    );
}

export async function handlePlayerRoute(
    context: PlayerRouteContext
): Promise<AuthRouteResult> {
    if (!context.authEnabled) {
        return {
            status: 503,
            error: {
                code: "auth_unavailable",
                message: "Mobile authentication is not enabled.",
            },
        };
    }

    try {
        const ipLimit = await applyLimit({
            scope: "player-ip",
            identifier: context.remoteIp,
            limit: 300,
        });
        if (ipLimit) return ipLimit;

        const accessToken = getBearerToken(context.request);
        if (!accessToken) throw new MobileAuthError("invalid_token");
        const auth = await authenticateAccessToken(accessToken);

        if (
            context.pathname === MOBILE_API_ROUTES.me &&
            context.method === "GET"
        ) {
            const limit = await applyLimit({
                scope: "player-me",
                identifier: `${auth.user.id}:${context.remoteIp}`,
                limit: 120,
            });
            if (limit) return limit;
            const data: MobilePlayerCoreData = await getPlayerCore(
                auth.user.id
            );
            return { status: 200, data };
        }

        if (
            context.pathname === MOBILE_API_ROUTES.storeCatalog &&
            context.method === "GET"
        ) {
            const limit = await applyLimit({
                scope: "player-store-catalog",
                identifier: `${auth.user.id}:${context.remoteIp}`,
                limit: 60,
            });
            if (limit) return limit;
            const storePolicy = await getMobileStorePolicy();
            if (!storePolicy.available) {
                return {
                    status: 409,
                    error: {
                        code: "store_unavailable",
                        message: "Store is currently unavailable.",
                    },
                };
            }
            const data = toMobileStoreCatalogData(
                await getStoreCatalogPage({
                    userId: auth.user.id,
                    policy: storePolicy.catalog,
                    query: Object.fromEntries(context.query.entries()),
                })
            );
            return { status: 200, data };
        }

        if (
            context.pathname === MOBILE_API_ROUTES.inventory &&
            context.method === "GET"
        ) {
            const limit = await applyLimit({
                scope: "player-inventory",
                identifier: `${auth.user.id}:${context.remoteIp}`,
                limit: 120,
            });
            if (limit) return limit;
            const data: MobileInventoryData = await getInventoryPage({
                userId: auth.user.id,
                query: Object.fromEntries(context.query.entries()),
            });
            return { status: 200, data };
        }

        if (
            context.pathname === MOBILE_API_ROUTES.inventoryEquipped &&
            context.method === "PATCH"
        ) {
            if (
                !canUseAccountCapability(
                    auth.user,
                    "store_mutation"
                )
            ) {
                return {
                    status: 403,
                    error: {
                        code: "email_verification_required",
                        message:
                            "Email verification is required for this action.",
                    },
                };
            }
            const limit = await applyLimit({
                scope: "player-inventory-equip",
                identifier: `${auth.user.id}:${context.remoteIp}`,
                limit: 30,
            });
            if (limit) return limit;
            if (!(await isMobileStoreAvailable())) {
                return {
                    status: 409,
                    error: {
                        code: "store_unavailable",
                        message: "Store is currently unavailable.",
                    },
                };
            }
            const data: MobileEquippedInventoryData =
                await equipInventoryItem({
                    userId: auth.user.id,
                    request: context.body,
                });
            return { status: 200, data };
        }

        if (
            context.pathname === MOBILE_API_ROUTES.profile &&
            context.method === "PATCH"
        ) {
            const limit = await applyLimit({
                scope: "player-profile",
                identifier: `${auth.user.id}:${context.remoteIp}`,
                limit: 20,
            });
            if (limit) return limit;
            const result = await updatePlayerProfile({
                userId: auth.user.id,
                patch: context.body,
                auditContext: {
                    actorRole: auth.user.role,
                    ipAddress: context.remoteIp,
                    userAgent:
                        typeof context.request.headers["user-agent"] ===
                        "string"
                            ? context.request.headers["user-agent"]
                            : null,
                },
            });
            const data: MobilePlayerCoreData = await getPlayerCore(
                auth.user.id
            );
            return {
                status: 200,
                data: {
                    ...data,
                    profile: {
                        ...data.profile,
                        displayName: result.profile.displayName,
                        bio: result.profile.bio,
                    },
                },
            };
        }

        return {
            status: 405,
            error: {
                code: "method_not_allowed",
                message: "Method is not allowed for this endpoint.",
            },
        };
    } catch (error) {
        return mapPlayerError(error);
    }
}
