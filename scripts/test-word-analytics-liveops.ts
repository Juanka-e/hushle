import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { RedisLikeClient } from "@hushle/platform-cache";
import {
    getCategoryWordAnalyticsKey,
    getWordAnalyticsKey,
    getWordAnalyticsStatus,
    getWordAnalyticsSummaries,
    recordWordAnalytics,
    resetWordAnalyticsState,
} from "../apps/web/src/lib/analytics/word-analytics";

class WordAnalyticsRedisStub implements RedisLikeClient {
    evalCalls: Array<{ keys: string[]; arguments: string[] }> = [];
    hmGetCalls: Array<{ key: string; fields: string[] }> = [];
    async ping() { return "PONG"; }
    async get() { return null; }
    async set() { return "OK"; }
    async del() { return 0; }
    async incr() { return 0; }
    async pExpire() { return 1; }
    async pTTL() { return 1; }
    async eval(_script: string, options: { keys: string[]; arguments: string[] }) {
        this.evalCalls.push(options);
        return 1;
    }
    async hmGet(key: string, fields: string[]) {
        this.hmGetCalls.push({ key, fields });
        return fields.map((field) => {
            if (field.endsWith(":shown")) return "2";
            if (field.endsWith(":dogru")) return "1";
            if (field.endsWith(":pas")) return "1";
            if (field.endsWith(":exposure_seconds")) return "18";
            return "0";
        });
    }
}

async function run() {
    resetWordAnalyticsState();
    const redis = new WordAnalyticsRedisStub();
    const occurredAt = new Date("2026-07-29T12:00:00.000Z");

    assert.equal(await recordWordAnalytics({
        occurredAt,
        wordId: 42,
        categoryIds: [7, 7, 8, -1],
        difficulty: 2,
        outcome: "dogru",
        exposureSeconds: 9.8,
    }, { redis, forceEnabled: true }), true);
    assert.deepEqual(redis.evalCalls[0]?.keys, [
        getWordAnalyticsKey(occurredAt),
        getCategoryWordAnalyticsKey(occurredAt),
    ]);
    assert.match(redis.evalCalls[0]?.keys[0] ?? "", /\{2026-07-29\}$/);
    assert.match(redis.evalCalls[0]?.keys[1] ?? "", /\{2026-07-29\}$/);
    assert.deepEqual(redis.evalCalls[0]?.arguments.slice(0, 7), [
        "word:42",
        "dogru",
        "9",
        "2",
        String(45 * 24 * 60 * 60 * 1_000),
        "7",
        "8",
    ]);

    const summaries = await getWordAnalyticsSummaries([42, 43, 42], 2, {
        redis,
        now: occurredAt,
    });
    assert.equal(redis.hmGetCalls.length, 2);
    assert.equal(redis.hmGetCalls[0]?.fields.length, 12);
    assert.deepEqual(summaries[42], {
        shown: 4,
        dogru: 2,
        tabu: 0,
        pas: 2,
        timeout: 0,
        exposureSeconds: 36,
    });
    assert.deepEqual({
        attempted: getWordAnalyticsStatus().attempted,
        recorded: getWordAnalyticsStatus().recorded,
        readRequests: getWordAnalyticsStatus().readRequests,
    }, {
        attempted: 1,
        recorded: 1,
        readRequests: 1,
    });

    const callsBeforeEmptyRead = redis.hmGetCalls.length;
    assert.deepEqual(
        await getWordAnalyticsSummaries([], Number.NaN, { redis, now: occurredAt }),
        {}
    );
    assert.equal(redis.hmGetCalls.length, callsBeforeEmptyRead);

    const socketSource = readFileSync(
        "apps/web/src/lib/socket/game-socket.ts",
        "utf8"
    );
    assert.match(socketSource, /activeWordAnalytics/);
    assert.match(socketSource, /remainingSecondsAtDisplay - room\.oyunDurumu\.kalanZaman/);
    assert.match(socketSource, /consumeActiveWordAnalytics\(currentRoom, "timeout"\)/);
    assert.match(socketSource, /const card = draw\?\.card \?\? null/);
    assert.match(
        socketSource,
        /if \(!room\.activeWordAnalytics \|\| !room\.oyunDurumu\.aktifKart\)/
    );
    assert.doesNotMatch(socketSource, /oyunDurumu\.activeWordAnalytics/);

    const adminRouteSource = readFileSync(
        "apps/web/src/app/api/admin/words/route.ts",
        "utf8"
    );
    assert.match(adminRouteSource, /searchParams\.get\("analyticsDays"\) === "30"/);
    assert.match(adminRouteSource, /Math\.min\(50, Math\.max\(1, requestedLimit\)\)/);
    assert.match(adminRouteSource, /getWordAnalyticsSummaries/);

    console.log("Word analytics liveops checks passed.");
}

void run();
