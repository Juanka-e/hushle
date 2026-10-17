import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getRedisKey, type RedisLikeClient } from "@hushle/platform-cache";
import {
    getConnectionPauseAnalytics,
    getConnectionPauseAnalyticsStatus,
    recordConnectionPauseResolved,
    recordConnectionPauseStarted,
    type ConnectionPauseOutcome,
    type ConnectionPauseTrigger,
} from "../apps/web/src/lib/analytics/connection-pause-analytics";

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * In-memory Redis that emulates the recorder's Lua contract:
 * ARGV[1] = retention ms, then (field, increment) pairs applied with HINCRBY
 * to KEYS[1], followed by PEXPIRE KEYS[1] ARGV[1].
 */
class FakeRedis implements RedisLikeClient {
    hashes = new Map<string, Map<string, number>>();
    ttlMs = new Map<string, number>();
    evalCalls: Array<{ script: string; keys: string[]; arguments: string[] }> = [];
    hmGetCalls: Array<{ key: string; fields: string[] }> = [];
    failWrites = false;
    failReads = false;

    async ping() { return "PONG"; }
    async get() { return null; }
    async set() { return "OK"; }
    async del() { return 0; }
    async incr() { return 0; }
    async pExpire(key: string, milliseconds: number) {
        this.ttlMs.set(key, milliseconds);
        return 1;
    }
    async pTTL(key: string) { return this.ttlMs.get(key) ?? -1; }

    async eval(script: string, options: { keys: string[]; arguments: string[] }) {
        if (this.failWrites) throw new Error("redis write failed");
        this.evalCalls.push({ script, ...options });
        assert.match(script, /for index = 2, #ARGV, 2 do/);
        assert.match(script, /redis\.call\("HINCRBY", KEYS\[1\], ARGV\[index\], ARGV\[index \+ 1\]\)/);
        assert.match(script, /redis\.call\("PEXPIRE", KEYS\[1\], ARGV\[1\]\)/);
        assert.equal(options.keys.length, 1);
        const [ttl, ...pairs] = options.arguments;
        assert.equal(pairs.length % 2, 0, "field/increment pairs");
        const key = options.keys[0];
        const hash = this.hashes.get(key) ?? new Map<string, number>();
        for (let index = 0; index < pairs.length; index += 2) {
            const amount = Number(pairs[index + 1]);
            assert.ok(Number.isSafeInteger(amount), `integer increment for ${pairs[index]}`);
            hash.set(pairs[index], (hash.get(pairs[index]) ?? 0) + amount);
        }
        this.hashes.set(key, hash);
        await this.pExpire(key, Number(ttl));
        return 1;
    }

    async hmGet(key: string, fields: string[]) {
        if (this.failReads) throw new Error("redis read failed");
        this.hmGetCalls.push({ key, fields });
        const hash = this.hashes.get(key);
        return fields.map((field) => {
            const value = hash?.get(field);
            return value === undefined ? null : String(value);
        });
    }

    field(date: string, field: string): number | undefined {
        return this.hashes.get(dayKey(date))?.get(field);
    }
}

function dayKey(date: string): string {
    return getRedisKey("telemetry", "daily", date, "connection-pause");
}

function statusDelta(
    before: ReturnType<typeof getConnectionPauseAnalyticsStatus>
) {
    const after = getConnectionPauseAnalyticsStatus();
    return {
        attempted: after.attempted - before.attempted,
        recorded: after.recorded - before.recorded,
        dropped: after.dropped - before.dropped,
        readRequests: after.readRequests - before.readRequests,
        readFailures: after.readFailures - before.readFailures,
    };
}

const at = (iso: string) => new Date(iso);

function testEnv(values: Record<string, string> = {}): NodeJS.ProcessEnv {
    return { NODE_ENV: "test", ...values } as NodeJS.ProcessEnv;
}
const ZERO_OUTCOMES: Record<ConnectionPauseOutcome, number> = {
    resumed_after_reconnect: 0,
    continued_without_missing: 0,
    ended_by_host: 0,
    reset_by_host: 0,
    abandoned: 0,
};
const ZERO_TRIGGERS: Record<ConnectionPauseTrigger, number> = {
    narrator: 0,
    inspector: 0,
    team_below_minimum: 0,
};

async function testRecordingAndReading() {
    const redis = new FakeRedis();
    const env = testEnv();
    const options = { redis, env };
    const before = getConnectionPauseAnalyticsStatus();

    // Day bucketing across midnight UTC: a pause that starts at 23:59:30 and
    // resolves at 00:00:10 lands in two different daily hashes.
    await recordConnectionPauseStarted(
        { occurredAt: at("2026-10-11T23:59:30.000Z"), trigger: "narrator", missingCount: 1 },
        options
    );
    await recordConnectionPauseResolved(
        { occurredAt: at("2026-10-12T00:00:10.000Z"), outcome: "resumed_after_reconnect", durationSeconds: 40 },
        options
    );
    assert.equal(redis.evalCalls[0]?.keys[0], dayKey("2026-10-11"));
    assert.equal(redis.evalCalls[1]?.keys[0], dayKey("2026-10-12"));
    assert.equal(redis.field("2026-10-11", "paused"), 1);
    assert.equal(redis.field("2026-10-11", "trigger:narrator"), 1);
    assert.equal(redis.field("2026-10-11", "missing_players"), 1);
    assert.equal(redis.field("2026-10-11", "outcome:resumed_after_reconnect"), undefined);
    assert.equal(redis.field("2026-10-12", "outcome:resumed_after_reconnect"), 1);
    assert.equal(redis.field("2026-10-12", "outcome:resumed_after_reconnect:duration_seconds"), 40);
    assert.equal(redis.field("2026-10-12", "paused"), undefined);

    // Retention TTL defaults to 45 days and is refreshed on every write.
    assert.equal(redis.ttlMs.get(dayKey("2026-10-11")), 45 * DAY_MS);
    assert.equal(redis.ttlMs.get(dayKey("2026-10-12")), 45 * DAY_MS);

    // More events on 2026-10-12, including clamping of bad inputs.
    await recordConnectionPauseStarted(
        { occurredAt: at("2026-10-12T08:00:00.000Z"), trigger: "team_below_minimum", missingCount: 3 },
        options
    );
    await recordConnectionPauseStarted(
        { occurredAt: at("2026-10-12T09:00:00.000Z"), trigger: "inspector", missingCount: -5 },
        options
    );
    await recordConnectionPauseStarted(
        { occurredAt: at("2026-10-12T10:00:00.000Z"), trigger: "narrator", missingCount: 1_000 },
        options
    );
    await recordConnectionPauseStarted(
        { occurredAt: at("2026-10-12T10:30:00.000Z"), trigger: "narrator", missingCount: 2.6 },
        options
    );
    await recordConnectionPauseResolved(
        { occurredAt: at("2026-10-12T08:01:15.000Z"), outcome: "resumed_after_reconnect", durationSeconds: 35 },
        options
    );
    await recordConnectionPauseResolved(
        { occurredAt: at("2026-10-12T08:02:00.000Z"), outcome: "continued_without_missing", durationSeconds: 75.6 },
        options
    );
    await recordConnectionPauseResolved(
        { occurredAt: at("2026-10-12T09:05:00.000Z"), outcome: "ended_by_host", durationSeconds: -10 },
        options
    );
    await recordConnectionPauseResolved(
        { occurredAt: at("2026-10-12T09:06:00.000Z"), outcome: "ended_by_host", durationSeconds: Number.NaN },
        options
    );
    await recordConnectionPauseResolved(
        { occurredAt: at("2026-10-12T11:00:00.000Z"), outcome: "abandoned", durationSeconds: 1e9 },
        options
    );
    await recordConnectionPauseResolved(
        { occurredAt: at("2026-10-12T11:30:00.000Z"), outcome: "abandoned", durationSeconds: Number.POSITIVE_INFINITY },
        options
    );

    assert.equal(redis.field("2026-10-12", "missing_players"), 3 + 0 + 40 + 3);
    assert.equal(redis.field("2026-10-12", "outcome:continued_without_missing:duration_seconds"), 76);
    assert.equal(redis.field("2026-10-12", "outcome:ended_by_host:duration_seconds"), 0);
    assert.equal(redis.field("2026-10-12", "outcome:abandoned:duration_seconds"), 2 * 86_400);
    for (const call of redis.evalCalls) {
        for (const value of call.arguments.slice(1).filter((_, index) => index % 2 === 1)) {
            assert.match(value, /^\d+$/, "increments are non-negative integers");
        }
    }

    // Events outside the 7-day window but inside the 30-day window.
    await recordConnectionPauseStarted(
        { occurredAt: at("2026-10-05T12:00:00.000Z"), trigger: "inspector", missingCount: 1 },
        options
    );
    await recordConnectionPauseStarted(
        { occurredAt: at("2026-09-20T12:00:00.000Z"), trigger: "team_below_minimum", missingCount: 2 },
        options
    );
    await recordConnectionPauseResolved(
        { occurredAt: at("2026-09-20T12:03:00.000Z"), outcome: "reset_by_host", durationSeconds: 180 },
        options
    );
    // Older than 30 days: never read.
    await recordConnectionPauseStarted(
        { occurredAt: at("2026-09-12T12:00:00.000Z"), trigger: "narrator", missingCount: 1 },
        options
    );

    assert.deepEqual(statusDelta(before), {
        attempted: 16,
        recorded: 16,
        dropped: 0,
        readRequests: 0,
        readFailures: 0,
    });

    const now = at("2026-10-12T12:00:00.000Z");
    const week = await getConnectionPauseAnalytics({ days: 7, now }, options);
    assert.equal(redis.hmGetCalls.length, 7);
    assert.equal(week.days, 7);
    assert.equal(week.enabled, true);
    assert.equal(week.available, true);
    assert.equal(week.paused, 5);
    assert.equal(week.missingPlayers, 1 + 3 + 0 + 40 + 3);
    assert.deepEqual(week.byTrigger, { narrator: 3, inspector: 1, team_below_minimum: 1 });
    assert.deepEqual(week.outcomes, {
        resumed_after_reconnect: 2,
        continued_without_missing: 1,
        ended_by_host: 2,
        reset_by_host: 0,
        abandoned: 2,
    });
    assert.deepEqual(week.averageResolutionSeconds, {
        resumed_after_reconnect: 37.5,
        continued_without_missing: 76,
        ended_by_host: 0,
        reset_by_host: null,
        abandoned: 86_400,
    });
    assert.deepEqual(
        week.daily.map((row) => row.date),
        [
            "2026-10-06",
            "2026-10-07",
            "2026-10-08",
            "2026-10-09",
            "2026-10-10",
            "2026-10-11",
            "2026-10-12",
        ]
    );
    assert.deepEqual(week.daily[5], {
        date: "2026-10-11",
        paused: 1,
        outcomes: { ...ZERO_OUTCOMES },
    });
    assert.deepEqual(week.daily[6], {
        date: "2026-10-12",
        paused: 4,
        outcomes: {
            resumed_after_reconnect: 2,
            continued_without_missing: 1,
            ended_by_host: 2,
            reset_by_host: 0,
            abandoned: 2,
        },
    });

    const month = await getConnectionPauseAnalytics({ days: 30, now }, options);
    assert.equal(month.days, 30);
    assert.equal(month.daily.length, 30);
    assert.equal(month.daily[0]?.date, "2026-09-13");
    assert.equal(month.daily[29]?.date, "2026-10-12");
    for (let index = 1; index < month.daily.length; index += 1) {
        assert.ok(month.daily[index - 1].date < month.daily[index].date, "daily is oldest to newest");
    }
    assert.equal(month.paused, 7);
    assert.deepEqual(month.byTrigger, { narrator: 3, inspector: 2, team_below_minimum: 2 });
    assert.equal(month.outcomes.reset_by_host, 1);
    assert.equal(month.averageResolutionSeconds.reset_by_host, 180);
    assert.equal(month.daily.find((row) => row.date === "2026-09-20")?.paused, 1);
    assert.equal(month.daily.some((row) => row.date === "2026-09-12"), false);

    // A late-evening "now" still uses the UTC calendar day.
    const lateNow = await getConnectionPauseAnalytics(
        { days: 7, now: at("2026-10-12T23:59:59.999Z") },
        options
    );
    assert.equal(lateNow.daily[6]?.date, "2026-10-12");

    const afterReads = statusDelta(before);
    assert.equal(afterReads.readRequests, 3);
    assert.equal(afterReads.readFailures, 0);
}

async function testRetentionConfig() {
    const cases: Array<[string | undefined, number]> = [
        [undefined, 45],
        ["90", 90],
        ["7", 7],
        ["400", 400],
        ["6", 45],
        ["401", 45],
        ["12.5", 45],
        ["abc", 45],
        ["", 45],
    ];
    for (const [raw, expectedDays] of cases) {
        const redis = new FakeRedis();
        const env = raw === undefined
            ? testEnv()
            : testEnv({ CONNECTION_PAUSE_ANALYTICS_RETENTION_DAYS: raw });
        await recordConnectionPauseStarted(
            { occurredAt: at("2026-10-12T12:00:00.000Z"), trigger: "narrator", missingCount: 1 },
            { redis, env }
        );
        assert.equal(
            redis.ttlMs.get(dayKey("2026-10-12")),
            expectedDays * DAY_MS,
            `retention for ${String(raw)}`
        );
    }
}

async function testDisabledFlag() {
    for (const value of ["false", "FALSE", " False "]) {
        const redis = new FakeRedis();
        const env = testEnv({ CONNECTION_PAUSE_ANALYTICS_ENABLED: value });
        const before = getConnectionPauseAnalyticsStatus();
        await recordConnectionPauseStarted(
            { occurredAt: at("2026-10-12T12:00:00.000Z"), trigger: "narrator", missingCount: 1 },
            { redis, env }
        );
        await recordConnectionPauseResolved(
            { occurredAt: at("2026-10-12T12:01:00.000Z"), outcome: "abandoned", durationSeconds: 60 },
            { redis, env }
        );
        assert.equal(redis.evalCalls.length, 0, `nothing recorded when flag is ${value}`);
        const delta = statusDelta(before);
        assert.equal(delta.attempted, 0);
        assert.equal(delta.dropped, 0);

        const summary = await getConnectionPauseAnalytics(
            { days: 7, now: at("2026-10-12T12:00:00.000Z") },
            { redis, env }
        );
        assert.equal(summary.enabled, false);
        assert.equal(summary.available, true);
        assert.equal(summary.paused, 0);
    }

    for (const value of ["true", "1", "yes", ""]) {
        const redis = new FakeRedis();
        await recordConnectionPauseStarted(
            { occurredAt: at("2026-10-12T12:00:00.000Z"), trigger: "narrator", missingCount: 1 },
            { redis, env: testEnv({ CONNECTION_PAUSE_ANALYTICS_ENABLED: value }) }
        );
        assert.equal(redis.evalCalls.length, 1, `recorded when flag is "${value}"`);
    }
}

async function testRedisFailures() {
    const env = testEnv();
    const now = at("2026-10-12T12:00:00.000Z");

    // Redis missing (explicit null): dropped, never throws.
    let before = getConnectionPauseAnalyticsStatus();
    await recordConnectionPauseStarted(
        { occurredAt: now, trigger: "narrator", missingCount: 1 },
        { redis: null, env }
    );
    await recordConnectionPauseResolved(
        { occurredAt: now, outcome: "abandoned", durationSeconds: 10 },
        { redis: null, env }
    );
    assert.deepEqual(statusDelta(before), {
        attempted: 2,
        recorded: 0,
        dropped: 2,
        readRequests: 0,
        readFailures: 0,
    });
    const missing = await getConnectionPauseAnalytics({ days: 7, now }, { redis: null, env });
    assert.equal(missing.available, false);
    assert.equal(missing.paused, 0);
    assert.equal(missing.missingPlayers, 0);
    assert.deepEqual(missing.byTrigger, ZERO_TRIGGERS);
    assert.deepEqual(missing.outcomes, ZERO_OUTCOMES);
    assert.ok(Object.values(missing.averageResolutionSeconds).every((value) => value === null));
    assert.equal(missing.daily.length, 7);
    assert.equal(missing.daily[6]?.date, "2026-10-12");
    assert.ok(missing.daily.every((row) => row.paused === 0));
    assert.equal(statusDelta(before).readFailures, 1);

    // Redis missing via the shared client (no REDIS_URL configured).
    const savedRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
        before = getConnectionPauseAnalyticsStatus();
        await recordConnectionPauseStarted(
            { occurredAt: now, trigger: "inspector", missingCount: 1 },
            { env }
        );
        assert.equal(statusDelta(before).dropped, 1);
        const shared = await getConnectionPauseAnalytics({ days: 30, now }, { env });
        assert.equal(shared.available, false);
        assert.equal(shared.daily.length, 30);
    } finally {
        if (savedRedisUrl !== undefined) process.env.REDIS_URL = savedRedisUrl;
    }

    // Redis throwing on write: dropped, never throws.
    const redis = new FakeRedis();
    await recordConnectionPauseStarted(
        { occurredAt: now, trigger: "narrator", missingCount: 2 },
        { redis, env }
    );
    redis.failWrites = true;
    before = getConnectionPauseAnalyticsStatus();
    await recordConnectionPauseStarted(
        { occurredAt: now, trigger: "narrator", missingCount: 1 },
        { redis, env }
    );
    await recordConnectionPauseResolved(
        { occurredAt: now, outcome: "resumed_after_reconnect", durationSeconds: 5 },
        { redis, env }
    );
    assert.deepEqual(statusDelta(before), {
        attempted: 2,
        recorded: 0,
        dropped: 2,
        readRequests: 0,
        readFailures: 0,
    });

    // Redis throwing on read: zeros with available=false, never throws.
    redis.failReads = true;
    before = getConnectionPauseAnalyticsStatus();
    const failedRead = await getConnectionPauseAnalytics({ days: 7, now }, { redis, env });
    assert.equal(failedRead.available, false);
    assert.equal(failedRead.paused, 0, "no partial data after a failed read");
    assert.deepEqual(failedRead.byTrigger, ZERO_TRIGGERS);
    assert.deepEqual(statusDelta(before), {
        attempted: 0,
        recorded: 0,
        dropped: 0,
        readRequests: 1,
        readFailures: 1,
    });
    redis.failReads = false;
    const recovered = await getConnectionPauseAnalytics({ days: 7, now }, { redis, env });
    assert.equal(recovered.available, true);
    assert.equal(recovered.paused, 1);

    // A client without hmGet cannot serve reads.
    const noHmGet: RedisLikeClient = {
        ping: async () => "PONG",
        get: async () => null,
        set: async () => "OK",
        del: async () => 0,
        incr: async () => 0,
        pExpire: async () => 1,
        pTTL: async () => 1,
        eval: async () => 1,
    };
    const noHmGetRead = await getConnectionPauseAnalytics({ days: 7, now }, { redis: noHmGet, env });
    assert.equal(noHmGetRead.available, false);

    // Malformed input from untyped callers: dropped, never throws.
    const malformedRedis = new FakeRedis();
    before = getConnectionPauseAnalyticsStatus();
    await recordConnectionPauseStarted(
        { occurredAt: now, trigger: "spectator" as ConnectionPauseTrigger, missingCount: 1 },
        { redis: malformedRedis, env }
    );
    await recordConnectionPauseResolved(
        { occurredAt: now, outcome: "outcome:x" as ConnectionPauseOutcome, durationSeconds: 1 },
        { redis: malformedRedis, env }
    );
    await recordConnectionPauseStarted(
        { occurredAt: new Date("not a date"), trigger: "narrator", missingCount: 1 },
        { redis: malformedRedis, env }
    );
    assert.equal(malformedRedis.evalCalls.length, 0);
    assert.equal(statusDelta(before).dropped, 3);

    // Out-of-contract day windows fall back to 7.
    const coerced = await getConnectionPauseAnalytics(
        { days: 14 as unknown as 7, now },
        { redis: malformedRedis, env }
    );
    assert.equal(coerced.days, 7);
    assert.equal(coerced.daily.length, 7);
}

function testStatusShape() {
    const status = getConnectionPauseAnalyticsStatus();
    assert.deepEqual(Object.keys(status).sort(), [
        "attempted",
        "dropped",
        "enabled",
        "readFailures",
        "readRequests",
        "recorded",
    ]);
    assert.equal(typeof status.enabled, "boolean");
}

function testStaticContracts() {
    const moduleSource = readFileSync(
        "apps/web/src/lib/analytics/connection-pause-analytics.ts",
        "utf8"
    );
    assert.doesNotMatch(
        moduleSource,
        /\b(userId|playerId|roomCode|socketId|ip|ipAddress|ad|name|username|email)\b/i,
        "analytics module must not reference personal or room identifiers"
    );
    assert.match(moduleSource, /getRedisKey\("telemetry", "daily", utcDay\(date\), "connection-pause"\)/);
    assert.match(moduleSource, /CONNECTION_PAUSE_ANALYTICS_ENABLED/);
    assert.match(moduleSource, /CONNECTION_PAUSE_ANALYTICS_RETENTION_DAYS/);

    const routeSource = readFileSync(
        "apps/web/src/app/api/admin/lab/connection-pauses/route.ts",
        "utf8"
    );
    assert.match(routeSource, /export async function GET\(/);
    assert.match(routeSource, /const adminSession = await requireAdminSession\(\);/);
    assert.match(routeSource, /if \(adminSession instanceof NextResponse\) return adminSession;/);
    assert.match(routeSource, /consumeRequestRateLimit\(\{/);
    assert.match(routeSource, /key: `admin:\$\{adminSession\.id\}`/);
    assert.match(routeSource, /if \(value === null \|\| value === "7"\) return 7;/);
    assert.match(routeSource, /if \(value === "30"\) return 30;/);
    assert.match(routeSource, /if \(days === null\) \{[\s\S]*?status: 400/);
    assert.match(routeSource, /"Cache-Control": "no-store"/);
    assert.ok(
        routeSource.indexOf("requireAdminSession()") < routeSource.indexOf("getConnectionPauseAnalytics({"),
        "auth runs before analytics are read"
    );

    const sidebarSource = readFileSync("apps/web/src/components/admin/admin-sidebar.tsx", "utf8");
    assert.match(sidebarSource, /\{ href: "\/admin\/lab", icon: FlaskConical, label: "Lab" \}/);
    assert.match(sidebarSource, /\bFlaskConical,/);

    const pageSource = readFileSync("apps/web/src/app/admin/(dashboard)/lab/page.tsx", "utf8");
    assert.match(pageSource, /title="Lab"/);
    assert.match(pageSource, /Oyun içi davranış verileri\. Kişisel veri tutulmaz\./);
    assert.match(pageSource, /<ConnectionPauseCard \/>/);

    const cardSource = readFileSync(
        "apps/web/src/components/admin/lab/connection-pause-card.tsx",
        "utf8"
    );
    assert.match(cardSource, /Bağlantı kopmaları/);
    assert.match(cardSource, /Redis bağlı değil; veri toplanamıyor\./);
    assert.match(cardSource, /\/api\/admin\/lab\/connection-pauses\?days=\$\{range\}/);
    // The 7/30 toggle is shared by every Lab card.
    assert.match(cardSource, /<LabRangeActions\s+label="Bağlantı kopmaları zaman aralığı"/);
    assert.match(cardSource, /data-testid="connection-pause-lab"/);
    const partsSource = readFileSync("apps/web/src/components/admin/lab/lab-card-parts.tsx", "utf8");
    assert.match(partsSource, /aria-pressed=\{active\}/);
    assert.match(cardSource, /import type \{[\s\S]*?\} from "@\/lib\/analytics\/connection-pause-analytics";/);
}

async function run() {
    await testRecordingAndReading();
    await testRetentionConfig();
    await testDisabledFlag();
    await testRedisFailures();
    testStatusShape();
    testStaticContracts();
    console.log("Connection pause analytics checks passed.");
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
