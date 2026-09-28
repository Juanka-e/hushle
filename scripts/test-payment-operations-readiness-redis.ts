import assert from "node:assert/strict";
import {
    closeRedisClient,
    getRedisClient,
    getRedisKey,
    readOperationalHeartbeat,
    writeOperationalHeartbeat,
} from "@hushle/platform-cache";

async function run(): Promise<void> {
    const originalRedisUrl = process.env.REDIS_URL;
    const originalPrefix = process.env.REDIS_KEY_PREFIX;
    process.env.REDIS_URL = process.env.REDIS_TEST_URL?.trim()
        || process.env.REDIS_URL?.trim()
        || "redis://127.0.0.1:6381";
    process.env.REDIS_KEY_PREFIX = `hushle:test:payment-operations:${process.pid}`;
    const name = "payment-webhook";
    try {
        const completedAt = new Date();
        await writeOperationalHeartbeat({ name, completedAt, durationMs: 17 });
        const result = await readOperationalHeartbeat(name);
        assert.equal(result.available, true);
        assert.equal(result.heartbeat?.name, name);
        assert.equal(result.heartbeat?.completedAt, completedAt.toISOString());
        assert.equal(result.heartbeat?.durationMs, 17);
        const client = await getRedisClient();
        assert.ok(client);
        assert.ok(await client.pTTL(getRedisKey("operational-heartbeat", name)) > 0);
        await client.del(getRedisKey("operational-heartbeat", name));
        assert.equal((await readOperationalHeartbeat(name)).heartbeat, null);
    } finally {
        await closeRedisClient();
        if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
        else process.env.REDIS_URL = originalRedisUrl;
        if (originalPrefix === undefined) delete process.env.REDIS_KEY_PREFIX;
        else process.env.REDIS_KEY_PREFIX = originalPrefix;
    }
    console.log("payment operational heartbeat Redis integration checks passed");
}

void run();
