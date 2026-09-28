import assert from "node:assert/strict";
import type { RedisLikeClient } from "@hushle/platform-cache";
import {
    getMatchFinalizeTelemetryKey,
    getTelemetryRollupConfig,
    getTelemetryRollupStatus,
    recordMatchFinalizeTelemetry,
    requiresDetailedMatchFinalizeAudit,
    resetTelemetryRollupState,
} from "../apps/web/src/lib/security/telemetry-rollup";

class TelemetryRedisStub implements RedisLikeClient {
    evalCalls: Array<{ keys: string[]; arguments: string[] }> = [];
    fail = false;

    async ping() { return "PONG"; }
    async get() { return null; }
    async set() { return "OK"; }
    async del() { return 0; }
    async incr() { return 0; }
    async pExpire() { return 1; }
    async pTTL() { return 1; }
    async eval(
        _script: string,
        options: { keys: string[]; arguments: string[] }
    ): Promise<unknown> {
        if (this.fail) throw new Error("simulated telemetry failure");
        this.evalCalls.push(options);
        return 1;
    }
}

async function run(): Promise<void> {
    resetTelemetryRollupState();
    assert.deepEqual(getTelemetryRollupConfig({}), {
        enabled: false,
        retentionDays: 45,
    });
    assert.throws(
        () =>
            getTelemetryRollupConfig({
                MATCH_FINALIZE_TELEMETRY_ROLLUP_ENABLED: "yes",
            }),
        /must be true or false/
    );
    assert.throws(
        () =>
            getTelemetryRollupConfig({
                TELEMETRY_ROLLUP_RETENTION_DAYS: "2",
            }),
        /between 7 and 400/
    );

    assert.equal(
        requiresDetailedMatchFinalizeAudit({
            reviewFlags: [],
            repeatedGroupTriggered: false,
            rewardGuardTriggered: false,
        }),
        false
    );
    assert.equal(
        requiresDetailedMatchFinalizeAudit({
            reviewFlags: ["guest_majority_room"],
            repeatedGroupTriggered: false,
            rewardGuardTriggered: false,
        }),
        true
    );

    const input = {
        occurredAt: new Date("2026-07-28T12:30:00.000Z"),
        gameMode: "Tabu Custom!",
        coinEarned: 120,
        durationSeconds: 90,
        totalPlayers: 6,
        authenticatedPlayers: 4,
        guestPlayers: 2,
        won: true,
    };
    assert.match(
        getMatchFinalizeTelemetryKey(input),
        /telemetry:daily:2026-07-28:game\.match\.finalize:tabu-custom-$/
    );

    const redis = new TelemetryRedisStub();
    assert.equal(
        await recordMatchFinalizeTelemetry(input, {
            env: {
                MATCH_FINALIZE_TELEMETRY_ROLLUP_ENABLED: "true",
                TELEMETRY_ROLLUP_RETENTION_DAYS: "30",
            },
            redis,
        }),
        true
    );
    assert.deepEqual(redis.evalCalls[0]?.arguments, [
        "120",
        "90",
        "6",
        "4",
        "2",
        "1",
        String(30 * 24 * 60 * 60 * 1_000),
    ]);

    redis.fail = true;
    assert.equal(
        await recordMatchFinalizeTelemetry(input, {
            env: { MATCH_FINALIZE_TELEMETRY_ROLLUP_ENABLED: "true" },
            redis,
        }),
        false
    );
    assert.equal(
        await recordMatchFinalizeTelemetry(input, {
            env: { MATCH_FINALIZE_TELEMETRY_ROLLUP_ENABLED: "true" },
            redis: null,
        }),
        false
    );
    assert.deepEqual(
        {
            enabled: getTelemetryRollupStatus(
                getTelemetryRollupConfig({
                    MATCH_FINALIZE_TELEMETRY_ROLLUP_ENABLED: "true",
                })
            ).enabled,
            attempted: getTelemetryRollupStatus().attempted,
            recorded: getTelemetryRollupStatus().recorded,
            auditFallbacks: getTelemetryRollupStatus().auditFallbacks,
        },
        {
            enabled: true,
            attempted: 3,
            recorded: 1,
            auditFallbacks: 2,
        }
    );

    console.log("Telemetry rollup checks passed.");
}

void run();
