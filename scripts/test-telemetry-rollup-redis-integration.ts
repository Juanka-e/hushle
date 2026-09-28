import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDedicatedRedisConnectionPair } from "@hushle/platform-cache";
import {
    getMatchFinalizeTelemetryKey,
    recordMatchFinalizeTelemetry,
} from "../apps/web/src/lib/security/telemetry-rollup";

async function run(): Promise<void> {
    assert.equal(
        process.env.TELEMETRY_ROLLUP_REDIS_TEST,
        "true",
        "TELEMETRY_ROLLUP_REDIS_TEST=true is required"
    );
    const redisUrl = process.env.REDIS_URL?.trim();
    assert.ok(redisUrl, "REDIS_URL is required");

    const originalPrefix = process.env.REDIS_KEY_PREFIX;
    process.env.REDIS_KEY_PREFIX = `hushle:test:telemetry:${randomUUID()}`;
    const connections = await createDedicatedRedisConnectionPair({
        url: redisUrl,
        maxReconnectAttempts: 1,
    });
    const client = connections.publisher;

    const input = {
        occurredAt: new Date("2026-07-28T12:30:00.000Z"),
        gameMode: "tabu",
        coinEarned: 120,
        durationSeconds: 90,
        totalPlayers: 6,
        authenticatedPlayers: 4,
        guestPlayers: 2,
        won: true,
    };
    const key = getMatchFinalizeTelemetryKey(input);

    try {
        for (let index = 0; index < 2; index += 1) {
            assert.equal(
                await recordMatchFinalizeTelemetry(input, {
                    env: {
                        MATCH_FINALIZE_TELEMETRY_ROLLUP_ENABLED: "true",
                        TELEMETRY_ROLLUP_RETENTION_DAYS: "30",
                    },
                    redis: client,
                }),
                true
            );
        }

        assert.deepEqual({ ...(await client.hGetAll(key)) }, {
            matches: "2",
            coin_earned: "240",
            duration_seconds: "180",
            players: "12",
            registered_players: "8",
            guest_players: "4",
            wins: "2",
        });
        const ttl = await client.pTTL(key);
        assert.ok(ttl > 29 * 24 * 60 * 60 * 1_000);
        assert.ok(ttl <= 30 * 24 * 60 * 60 * 1_000);
    } finally {
        await client.del(key);
        await connections.close();
        if (originalPrefix === undefined) {
            delete process.env.REDIS_KEY_PREFIX;
        } else {
            process.env.REDIS_KEY_PREFIX = originalPrefix;
        }
    }

    console.log("Telemetry Redis rollup integration test passed.");
}

void run();
