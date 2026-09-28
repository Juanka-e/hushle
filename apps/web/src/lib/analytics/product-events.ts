import {
    getRedisClient,
    getRedisKey,
    type RedisLikeClient,
} from "@hushle/platform-cache";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RETENTION_DAYS = 45;
const RECORD_EVENT_SCRIPT = `
redis.call("HINCRBY", KEYS[1], "events", 1)
for index = 1, #ARGV - 1, 2 do
  redis.call("HINCRBY", KEYS[1], ARGV[index], ARGV[index + 1])
end
redis.call("PEXPIRE", KEYS[1], ARGV[#ARGV])
return 1
`;

export type AnalyticsTrustLevel = "server_verified" | "client_observed";
export type NavigationScreen =
    | "home"
    | "dashboard"
    | "store"
    | "inventory"
    | "profile"
    | "room_lobby"
    | "room_game";

export type ProductAnalyticsEvent =
    | {
        name: "store.item_purchased";
        version: 1;
        trust: "server_verified";
        occurredAt: Date;
        itemType: "avatar" | "frame" | "card_back" | "card_face";
        rarity: "common" | "rare" | "epic" | "legendary";
        finalPriceCoin: number;
        couponApplied: boolean;
    }
    | {
        name: "store.bundle_purchased";
        version: 1;
        trust: "server_verified";
        occurredAt: Date;
        awardedItemCount: number;
        finalPriceCoin: number;
        couponApplied: boolean;
    }
    | {
        name: "navigation.screen_viewed";
        version: 1;
        trust: "client_observed";
        occurredAt: Date;
        screen: NavigationScreen;
    };

export interface ProductAnalyticsConfig {
    enabled: boolean;
    retentionDays: number;
}

export interface ProductAnalyticsEnvironment {
    PRODUCT_ANALYTICS_ENABLED?: string;
    PRODUCT_ANALYTICS_RETENTION_DAYS?: string;
}

interface AnalyticsState {
    attempted: number;
    recorded: number;
    dropped: number;
    lastRecordedAt: string | null;
    lastDroppedAt: string | null;
}

type AnalyticsGlobal = typeof globalThis & {
    __hushleProductAnalyticsState?: AnalyticsState;
};

function state(): AnalyticsState {
    const globalState = globalThis as AnalyticsGlobal;
    globalState.__hushleProductAnalyticsState ??= {
        attempted: 0,
        recorded: 0,
        dropped: 0,
        lastRecordedAt: null,
        lastDroppedAt: null,
    };
    return globalState.__hushleProductAnalyticsState;
}

function parseBoolean(value: string | undefined): boolean {
    if (!value?.trim()) return false;
    const normalized = value.trim().toLowerCase();
    if (normalized !== "true" && normalized !== "false") {
        throw new Error("PRODUCT_ANALYTICS_ENABLED must be true or false");
    }
    return normalized === "true";
}

function parseRetentionDays(value: string | undefined): number {
    if (!value?.trim()) return DEFAULT_RETENTION_DAYS;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 7 || parsed > 400) {
        throw new Error("PRODUCT_ANALYTICS_RETENTION_DAYS must be between 7 and 400");
    }
    return parsed;
}

export function getProductAnalyticsConfig(
    env?: ProductAnalyticsEnvironment
): ProductAnalyticsConfig {
    const runtimeEnv = env ?? {
        PRODUCT_ANALYTICS_ENABLED: process.env.PRODUCT_ANALYTICS_ENABLED,
        PRODUCT_ANALYTICS_RETENTION_DAYS:
            process.env.PRODUCT_ANALYTICS_RETENTION_DAYS,
    };
    return {
        enabled: parseBoolean(runtimeEnv.PRODUCT_ANALYTICS_ENABLED),
        retentionDays: parseRetentionDays(
            runtimeEnv.PRODUCT_ANALYTICS_RETENTION_DAYS
        ),
    };
}

export function getProductAnalyticsKey(event: ProductAnalyticsEvent): string {
    return getRedisKey(
        "analytics",
        "daily",
        event.occurredAt.toISOString().slice(0, 10),
        `${event.name}.v${event.version}`
    );
}

function nonNegativeInteger(value: number): number {
    return Math.max(0, Math.trunc(value));
}

function eventFields(event: ProductAnalyticsEvent): Array<[string, number]> {
    if (event.name === "store.item_purchased") {
        return [
            [`dimension:item_type:${event.itemType}`, 1],
            [`dimension:rarity:${event.rarity}`, 1],
            [`dimension:coupon:${event.couponApplied ? "yes" : "no"}`, 1],
            ["sum:coin_spent", nonNegativeInteger(event.finalPriceCoin)],
        ];
    }
    if (event.name === "store.bundle_purchased") {
        return [
            [`dimension:coupon:${event.couponApplied ? "yes" : "no"}`, 1],
            ["sum:coin_spent", nonNegativeInteger(event.finalPriceCoin)],
            ["sum:awarded_items", nonNegativeInteger(event.awardedItemCount)],
        ];
    }
    return [[`dimension:screen:${event.screen}`, 1]];
}

export async function recordProductAnalyticsEvent(
    event: ProductAnalyticsEvent,
    options?: {
        config?: ProductAnalyticsConfig;
        redis?: RedisLikeClient | null;
    }
): Promise<boolean> {
    let config: ProductAnalyticsConfig;
    try {
        config = options?.config ?? getProductAnalyticsConfig();
    } catch {
        const currentState = state();
        currentState.attempted += 1;
        currentState.dropped += 1;
        currentState.lastDroppedAt = new Date().toISOString();
        return false;
    }
    if (!config.enabled) return false;

    const currentState = state();
    currentState.attempted += 1;
    let redis: RedisLikeClient | null;
    try {
        redis = options && "redis" in options
            ? options.redis ?? null
            : await getRedisClient();
    } catch {
        currentState.dropped += 1;
        currentState.lastDroppedAt = new Date().toISOString();
        return false;
    }
    if (!redis) {
        currentState.dropped += 1;
        currentState.lastDroppedAt = new Date().toISOString();
        return false;
    }

    const argumentsList = eventFields(event)
        .flatMap(([field, amount]) => [field, String(amount)]);
    argumentsList.push(String(config.retentionDays * DAY_MS));

    try {
        await redis.eval(RECORD_EVENT_SCRIPT, {
            keys: [getProductAnalyticsKey(event)],
            arguments: argumentsList,
        });
        currentState.recorded += 1;
        currentState.lastRecordedAt = new Date().toISOString();
        return true;
    } catch {
        currentState.dropped += 1;
        currentState.lastDroppedAt = new Date().toISOString();
        return false;
    }
}

export function getProductAnalyticsStatus() {
    let config: ProductAnalyticsConfig;
    try {
        config = getProductAnalyticsConfig();
    } catch {
        config = { enabled: false, retentionDays: DEFAULT_RETENTION_DAYS };
    }
    return {
        backend: "redis" as const,
        rawEventsStored: false,
        ...config,
        ...state(),
    };
}

export function resetProductAnalyticsState(): void {
    const currentState = state();
    currentState.attempted = 0;
    currentState.recorded = 0;
    currentState.dropped = 0;
    currentState.lastRecordedAt = null;
    currentState.lastDroppedAt = null;
}
