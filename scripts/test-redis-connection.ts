import assert from "node:assert/strict";
import { closeRedisClient, getRedisHealth } from "@hushle/platform-cache";

const originalRedisUrl = process.env.REDIS_URL;

async function run(): Promise<void> {
    process.env.REDIS_URL =
        process.env.REDIS_TEST_URL?.trim() ||
        process.env.REDIS_URL?.trim() ||
        "redis://127.0.0.1:6381";

    const health = await getRedisHealth();
    assert.equal(
        health.available,
        true,
        `Redis is unavailable at ${process.env.REDIS_URL}`
    );
    assert.equal(health.configured, true);
    assert.equal(typeof health.latencyMs, "number");

    console.log(
        `redis connection smoke test passed (${health.latencyMs ?? 0} ms)`
    );
}

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeRedisClient();

        if (originalRedisUrl === undefined) {
            delete process.env.REDIS_URL;
        } else {
            process.env.REDIS_URL = originalRedisUrl;
        }
    });
