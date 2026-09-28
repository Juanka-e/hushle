import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
    closeRedisClient,
    getJsonCacheMetrics,
    getRedisClient,
} from "@hushle/platform-cache";
import { prisma } from "@hushle/platform-db";
import {
    getUserDashboardMatchSummaryCacheKey,
    invalidateUserDashboardMatchSummaryCache,
} from "../apps/web/src/lib/cache/application-cache";
import { getDashboardData } from "../apps/web/src/lib/economy";

async function createMatchResult(input: {
    userId: number;
    roomCode: string;
    playerId: string;
    won: boolean;
    coinEarned: number;
}) {
    return prisma.matchResult.create({
        data: {
            roomCode: input.roomCode,
            userId: input.userId,
            playerId: input.playerId,
            won: input.won,
            scoreA: input.won ? 10 : 5,
            scoreB: input.won ? 5 : 10,
            coinEarned: input.coinEarned,
        },
    });
}

async function run(): Promise<void> {
    assert.equal(
        process.env.USER_DASHBOARD_CACHE_MUTATION_TEST,
        "true",
        "USER_DASHBOARD_CACHE_MUTATION_TEST=true is required"
    );
    assert.ok(process.env.REDIS_URL?.trim(), "REDIS_URL is required");

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const userIds: number[] = [];

    try {
        const firstUser = await prisma.user.create({
            data: {
                username: `dashboard_cache_a_${suffix}`,
                password: "integration-test-only",
                wallet: { create: { coinBalance: 100 } },
            },
        });
        const secondUser = await prisma.user.create({
            data: {
                username: `dashboard_cache_b_${suffix}`,
                password: "integration-test-only",
                wallet: { create: { coinBalance: 200 } },
            },
        });
        userIds.push(firstUser.id, secondUser.id);
        await createMatchResult({
            userId: firstUser.id,
            roomCode: `A${suffix.slice(0, 5)}`.toUpperCase(),
            playerId: `player-a-${suffix}`,
            won: true,
            coinEarned: 40,
        });
        await Promise.all(
            userIds.map(invalidateUserDashboardMatchSummaryCache)
        );

        const metricsBefore = getJsonCacheMetrics();
        const first = await getDashboardData(firstUser.id);
        const cached = await getDashboardData(firstUser.id);
        const second = await getDashboardData(secondUser.id);
        assert.equal(first.coinBalance, 100);
        assert.equal(first.totalMatches, 1);
        assert.equal(first.totalWins, 1);
        assert.equal(cached.totalMatches, 1);
        assert.equal(second.coinBalance, 200);
        assert.equal(second.totalMatches, 0);
        assert.ok(
            getJsonCacheMetrics().redisHits > metricsBefore.redisHits,
            "the second dashboard read should reuse Redis"
        );

        const redis = await getRedisClient();
        assert.ok(redis);
        const raw = await redis.get(
            getUserDashboardMatchSummaryCacheKey(firstUser.id)
        );
        assert.ok(raw);
        const cachedSummary = JSON.parse(raw) as {
            coinBalance?: number;
            totalMatches: number;
        };
        assert.equal(cachedSummary.coinBalance, undefined);
        assert.equal(cachedSummary.totalMatches, 1);

        await prisma.wallet.update({
            where: { userId: firstUser.id },
            data: { coinBalance: 777 },
        });
        const walletRefresh = await getDashboardData(firstUser.id);
        assert.equal(walletRefresh.coinBalance, 777);
        assert.equal(walletRefresh.totalMatches, 1);

        await createMatchResult({
            userId: firstUser.id,
            roomCode: `B${suffix.slice(0, 5)}`.toUpperCase(),
            playerId: `player-b-${suffix}`,
            won: false,
            coinEarned: 10,
        });
        const staleSummary = await getDashboardData(firstUser.id);
        assert.equal(staleSummary.totalMatches, 1);
        await invalidateUserDashboardMatchSummaryCache(firstUser.id);
        const refreshedSummary = await getDashboardData(firstUser.id);
        assert.equal(refreshedSummary.totalMatches, 2);
        assert.equal(refreshedSummary.totalWins, 1);
        assert.equal(refreshedSummary.totalCoinEarned, 50);

        console.log("user dashboard cache integration test passed");
    } finally {
        if (userIds.length > 0) {
            await prisma.user.deleteMany({
                where: { id: { in: userIds } },
            });
        }
        await Promise.all(
            userIds.map(invalidateUserDashboardMatchSummaryCache)
        );
        await prisma.$disconnect();
        await closeRedisClient();
    }
}

void run();
