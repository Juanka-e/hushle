import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
    closeRedisClient,
    getJsonCacheMetrics,
    getRedisClient,
} from "@hushle/platform-cache";
import { prisma } from "@hushle/platform-db";
import {
    getNotificationUnreadCountCacheKey,
    invalidateNotificationUnreadCountCache,
} from "../apps/web/src/lib/cache/application-cache";
import {
    archiveAllNotificationsForUser,
    createUserNotificationWithClient,
    getNotificationUnreadCountForUser,
    markAllNotificationsReadForUser,
} from "../apps/web/src/lib/notifications/service";

async function run(): Promise<void> {
    assert.equal(
        process.env.NOTIFICATION_CACHE_MUTATION_TEST,
        "true",
        "NOTIFICATION_CACHE_MUTATION_TEST=true is required"
    );
    assert.ok(process.env.REDIS_URL?.trim(), "REDIS_URL is required");

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const userIds: number[] = [];

    try {
        const firstUser = await prisma.user.create({
            data: {
                username: `notify_cache_a_${suffix}`,
                password: "integration-test-only",
            },
        });
        const secondUser = await prisma.user.create({
            data: {
                username: `notify_cache_b_${suffix}`,
                password: "integration-test-only",
            },
        });
        userIds.push(firstUser.id, secondUser.id);
        await Promise.all(
            userIds.map(invalidateNotificationUnreadCountCache)
        );

        const metricsBefore = getJsonCacheMetrics();
        assert.deepEqual(
            await getNotificationUnreadCountForUser(firstUser.id),
            { unreadCount: 0 }
        );
        assert.deepEqual(
            await getNotificationUnreadCountForUser(firstUser.id),
            { unreadCount: 0 }
        );
        assert.ok(
            getJsonCacheMetrics().redisHits > metricsBefore.redisHits,
            "the second read should use Redis"
        );

        await createUserNotificationWithClient(prisma, {
            userId: firstUser.id,
            type: "system",
            title: "Cache test",
            body: "First unread notification",
        });
        await createUserNotificationWithClient(prisma, {
            userId: firstUser.id,
            type: "system",
            title: "Cache test",
            body: "Second unread notification",
        });
        assert.deepEqual(
            await getNotificationUnreadCountForUser(firstUser.id),
            { unreadCount: 2 }
        );
        assert.deepEqual(
            await getNotificationUnreadCountForUser(secondUser.id),
            { unreadCount: 0 }
        );

        await prisma.$transaction(async (tx) => {
            await createUserNotificationWithClient(
                tx,
                {
                    userId: secondUser.id,
                    type: "system",
                    title: "Deferred cache test",
                    body: "Created inside a transaction",
                },
                { deferCacheInvalidation: true }
            );
        });
        assert.deepEqual(
            await getNotificationUnreadCountForUser(secondUser.id),
            { unreadCount: 0 },
            "deferred writes require post-commit invalidation"
        );
        await invalidateNotificationUnreadCountCache(secondUser.id);
        assert.deepEqual(
            await getNotificationUnreadCountForUser(secondUser.id),
            { unreadCount: 1 }
        );

        const redis = await getRedisClient();
        assert.ok(redis);
        const raw = await redis.get(
            getNotificationUnreadCountCacheKey(firstUser.id)
        );
        assert.deepEqual(JSON.parse(raw ?? "null"), { unreadCount: 2 });

        assert.equal(
            await markAllNotificationsReadForUser(firstUser.id),
            2
        );
        assert.deepEqual(
            await getNotificationUnreadCountForUser(firstUser.id),
            { unreadCount: 0 }
        );

        await createUserNotificationWithClient(prisma, {
            userId: firstUser.id,
            type: "system",
            title: "Cache test",
            body: "Archived unread notification",
        });
        const archived = await archiveAllNotificationsForUser(firstUser.id);
        assert.equal(archived.unreadArchivedCount, 1);
        assert.deepEqual(
            await getNotificationUnreadCountForUser(firstUser.id),
            { unreadCount: 0 }
        );

        console.log("notification unread cache integration test passed");
    } finally {
        if (userIds.length > 0) {
            await prisma.user.deleteMany({
                where: { id: { in: userIds } },
            });
        }
        await Promise.all(
            userIds.map(invalidateNotificationUnreadCountCache)
        );
        await prisma.$disconnect();
        await closeRedisClient();
    }
}

void run();
