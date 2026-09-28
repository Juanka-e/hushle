import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { RedisLikeClient } from "@hushle/platform-cache";
import {
    getProductAnalyticsConfig,
    getProductAnalyticsKey,
    getProductAnalyticsStatus,
    recordProductAnalyticsEvent,
    resetProductAnalyticsState,
} from "../apps/web/src/lib/analytics/product-events";

class AnalyticsRedisStub implements RedisLikeClient {
    calls: Array<{ keys: string[]; arguments: string[] }> = [];
    fail = false;
    async ping() { return "PONG"; }
    async get() { return null; }
    async set() { return "OK"; }
    async del() { return 0; }
    async incr() { return 0; }
    async pExpire() { return 1; }
    async pTTL() { return 1; }
    async eval(_script: string, options: { keys: string[]; arguments: string[] }) {
        if (this.fail) throw new Error("simulated failure");
        this.calls.push(options);
        return 1;
    }
}

async function run() {
    resetProductAnalyticsState();
    assert.deepEqual(getProductAnalyticsConfig({}), {
        enabled: false,
        retentionDays: 45,
    });
    assert.deepEqual(getProductAnalyticsConfig({
        PRODUCT_ANALYTICS_ENABLED: " TRUE ",
        PRODUCT_ANALYTICS_RETENTION_DAYS: "30",
    }), {
        enabled: true,
        retentionDays: 30,
    });
    assert.throws(
        () => getProductAnalyticsConfig({ PRODUCT_ANALYTICS_ENABLED: "yes" }),
        /must be true or false/
    );

    const event = {
        name: "store.item_purchased" as const,
        version: 1 as const,
        trust: "server_verified" as const,
        occurredAt: new Date("2026-07-29T10:00:00.000Z"),
        itemType: "frame" as const,
        rarity: "epic" as const,
        finalPriceCoin: 420,
        couponApplied: true,
    };
    assert.match(
        getProductAnalyticsKey(event),
        /analytics:daily:2026-07-29:store\.item_purchased\.v1$/
    );

    const redis = new AnalyticsRedisStub();
    assert.equal(await recordProductAnalyticsEvent(event, {
        config: { enabled: true, retentionDays: 30 },
        redis,
    }), true);
    assert.deepEqual(redis.calls[0]?.arguments, [
        "dimension:item_type:frame", "1",
        "dimension:rarity:epic", "1",
        "dimension:coupon:yes", "1",
        "sum:coin_spent", "420",
        String(30 * 24 * 60 * 60 * 1_000),
    ]);

    assert.equal(await recordProductAnalyticsEvent({
        name: "navigation.screen_viewed",
        version: 1,
        trust: "client_observed",
        occurredAt: event.occurredAt,
        screen: "store",
    }, {
        config: { enabled: true, retentionDays: 30 },
        redis,
    }), true);
    assert.deepEqual(redis.calls[1]?.arguments.slice(0, 2), [
        "dimension:screen:store", "1",
    ]);

    redis.fail = true;
    assert.equal(await recordProductAnalyticsEvent(event, {
        config: { enabled: true, retentionDays: 30 },
        redis,
    }), false);
    assert.equal(await recordProductAnalyticsEvent(event, {
        config: { enabled: true, retentionDays: 30 },
        redis: null,
    }), false);
    assert.deepEqual({
        attempted: getProductAnalyticsStatus().attempted,
        recorded: getProductAnalyticsStatus().recorded,
        dropped: getProductAnalyticsStatus().dropped,
        rawEventsStored: getProductAnalyticsStatus().rawEventsStored,
    }, {
        attempted: 4,
        recorded: 2,
        dropped: 2,
        rawEventsStored: false,
    });

    const routeSource = readFileSync(
        "apps/web/src/app/api/analytics/navigation/route.ts",
        "utf8"
    );
    assert.match(routeSource, /\.strict\(\)/);
    assert.match(routeSource, /maxRequests:\s*30/);
    assert.doesNotMatch(routeSource, /userId|displayName|roomCode|ipAddress/);

    console.log("Product analytics checks passed.");
}

void run();
