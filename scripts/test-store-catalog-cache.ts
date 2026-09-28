import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
    closeRedisClient,
    getRedisKey,
    getJsonCacheMetrics,
    getRedisClient,
} from "@hushle/platform-cache";
import { prisma } from "@hushle/platform-db";
import {
    APPLICATION_CACHE_KEYS,
    invalidateStoreCatalogCache,
} from "../apps/web/src/lib/cache/application-cache";
import { getStoreCatalog } from "../apps/web/src/lib/economy";
import {
    DEFAULT_SYSTEM_SETTINGS,
    normalizeSystemSettings,
} from "../apps/web/src/lib/system-settings/schema";

async function run(): Promise<void> {
    assert.equal(
        process.env.STORE_CATALOG_CACHE_MUTATION_TEST,
        "true",
        "STORE_CATALOG_CACHE_MUTATION_TEST=true is required"
    );
    assert.ok(process.env.REDIS_URL?.trim(), "REDIS_URL is required");

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const userIds: number[] = [];
    const itemIds: number[] = [];
    const settings = normalizeSystemSettings(DEFAULT_SYSTEM_SETTINGS);

    try {
        const item = await prisma.shopItem.create({
            data: {
                code: `cache-avatar-${suffix}`,
                type: "avatar",
                name: `Cache avatar ${suffix}`,
                priceCoin: 250,
                imageUrl: `/test/cache-avatar-${suffix}.png`,
                isActive: true,
                sortOrder: 99_000,
            },
        });
        itemIds.push(item.id);

        const firstUser = await prisma.user.create({
            data: {
                username: `catalog_a_${suffix}`,
                password: "integration-test-only",
                wallet: { create: { coinBalance: 111 } },
                profile: { create: { avatarItemId: item.id } },
                inventory: {
                    create: {
                        shopItemId: item.id,
                        source: "grant",
                    },
                },
            },
        });
        userIds.push(firstUser.id);
        const secondUser = await prisma.user.create({
            data: {
                username: `catalog_b_${suffix}`,
                password: "integration-test-only",
                wallet: { create: { coinBalance: 222 } },
                profile: { create: {} },
            },
        });
        userIds.push(secondUser.id);

        await invalidateStoreCatalogCache();
        const metricsBefore = getJsonCacheMetrics();
        const firstCatalog = await getStoreCatalog(firstUser.id, settings);
        const secondCatalog = await getStoreCatalog(secondUser.id, settings);
        const firstItem = firstCatalog.items.find(
            (entry) => entry.id === item.id
        );
        const secondItem = secondCatalog.items.find(
            (entry) => entry.id === item.id
        );

        assert.equal(firstCatalog.coinBalance, 111);
        assert.equal(secondCatalog.coinBalance, 222);
        assert.equal(firstItem?.owned, true);
        assert.equal(firstItem?.equipped, true);
        assert.equal(secondItem?.owned, false);
        assert.equal(secondItem?.equipped, false);
        assert.ok(
            getJsonCacheMetrics().redisHits > metricsBefore.redisHits,
            "the second user should reuse the shared Redis snapshot"
        );

        const redis = await getRedisClient();
        assert.ok(redis);
        const redisWithKeys = redis as typeof redis & {
            keys(pattern: string): Promise<string[]>;
        };
        const rawRevision = await redis.get(
            APPLICATION_CACHE_KEYS.storeCatalogRevision
        );
        assert.ok(rawRevision);
        const revision = JSON.parse(rawRevision) as string;
        const snapshotKeys = await redisWithKeys.keys(
            getRedisKey(
                "cache",
                "store-catalog-full",
                "v2",
                revision,
                "*"
            )
        );
        assert.equal(snapshotKeys.length, 1);
        const rawSnapshot = await redis.get(snapshotKeys[0]!);
        assert.ok(rawSnapshot);
        const snapshot = JSON.parse(rawSnapshot) as {
            coinBalance?: number;
            items: Array<{
                id: number;
                owned?: boolean;
                equipped?: boolean;
            }>;
        };
        assert.equal(snapshot.coinBalance, undefined);
        const sharedItem = snapshot.items.find(
            (entry) => entry.id === item.id
        );
        assert.equal(sharedItem?.owned, undefined);
        assert.equal(sharedItem?.equipped, undefined);

        const addedAfterLoad = await prisma.shopItem.create({
            data: {
                code: `cache-frame-${suffix}`,
                type: "frame",
                name: `Cache frame ${suffix}`,
                priceCoin: 350,
                imageUrl: `/test/cache-frame-${suffix}.png`,
                isActive: true,
                sortOrder: 99_001,
            },
        });
        itemIds.push(addedAfterLoad.id);
        const staleCatalog = await getStoreCatalog(secondUser.id, settings);
        assert.equal(
            staleCatalog.items.some(
                (entry) => entry.id === addedAfterLoad.id
            ),
            false
        );

        await invalidateStoreCatalogCache();
        const refreshedCatalog = await getStoreCatalog(
            secondUser.id,
            settings
        );
        assert.equal(
            refreshedCatalog.items.some(
                (entry) => entry.id === addedAfterLoad.id
            ),
            true
        );

        console.log("store catalog cache integration test passed");
    } finally {
        if (userIds.length > 0) {
            await prisma.user.deleteMany({
                where: { id: { in: userIds } },
            });
        }
        if (itemIds.length > 0) {
            await prisma.shopItem.deleteMany({
                where: { id: { in: itemIds } },
            });
        }
        await invalidateStoreCatalogCache();
        await prisma.$disconnect();
        await closeRedisClient();
    }
}

void run();
