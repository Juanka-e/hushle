import assert from "node:assert/strict";
import {
    getJsonCacheMetrics,
    getOrSetJsonCache,
    getRedisKey,
    invalidateJsonCache,
    resetJsonCacheState,
    resetRedisTestClient,
    setRedisTestClient,
    type RedisLikeClient,
} from "@hushle/platform-cache";

interface StoredValue {
    value: string;
    expiresAt: number | null;
}

class FakeRedisClient implements RedisLikeClient {
    readonly store = new Map<string, StoredValue>();
    failReads = false;
    failWrites = false;

    async ping(): Promise<string> {
        return "PONG";
    }

    private cleanup(key: string): void {
        const entry = this.store.get(key);
        if (
            entry &&
            entry.expiresAt !== null &&
            entry.expiresAt <= Date.now()
        ) {
            this.store.delete(key);
        }
    }

    async get(key: string): Promise<string | null> {
        if (this.failReads) throw new Error("redis read unavailable");
        this.cleanup(key);
        return this.store.get(key)?.value ?? null;
    }

    async set(
        key: string,
        value: string,
        options?: { PX?: number; NX?: boolean }
    ): Promise<string | null> {
        if (this.failWrites) throw new Error("redis write unavailable");
        this.cleanup(key);
        if (options?.NX && this.store.has(key)) return null;
        this.store.set(key, {
            value,
            expiresAt: options?.PX ? Date.now() + options.PX : null,
        });
        return "OK";
    }

    async del(key: string): Promise<number> {
        return this.store.delete(key) ? 1 : 0;
    }

    async incr(key: string): Promise<number> {
        const value = Number.parseInt((await this.get(key)) ?? "0", 10) + 1;
        await this.set(key, String(value));
        return value;
    }

    async pExpire(key: string, milliseconds: number): Promise<number> {
        const entry = this.store.get(key);
        if (!entry) return 0;
        entry.expiresAt = Date.now() + milliseconds;
        return 1;
    }

    async pTTL(key: string): Promise<number> {
        this.cleanup(key);
        const entry = this.store.get(key);
        if (!entry) return -2;
        if (entry.expiresAt === null) return -1;
        return Math.max(0, entry.expiresAt - Date.now());
    }

    async eval(
        _script: string,
        options: { keys: string[]; arguments: string[] }
    ): Promise<number> {
        const key = options.keys[0];
        if (!key || this.store.get(key)?.value !== options.arguments[0]) {
            return 0;
        }
        return this.store.delete(key) ? 1 : 0;
    }
}

const originalRedisUrl = process.env.REDIS_URL;
const originalPrefix = process.env.REDIS_KEY_PREFIX;
const originalMemoryLimit = process.env.CACHE_MEMORY_MAX_ENTRIES;

async function run(): Promise<void> {
    process.env.REDIS_KEY_PREFIX = "hushle:test:json-cache";
    const redis = new FakeRedisClient();
    setRedisTestClient(redis);
    resetJsonCacheState();

    const redisKey = getRedisKey("cache", "redis-hit");
    let redisLoads = 0;
    const first = await getOrSetJsonCache({
        key: redisKey,
        ttlMs: 5_000,
        loader: async () => ({ value: ++redisLoads }),
    });
    const second = await getOrSetJsonCache({
        key: redisKey,
        ttlMs: 5_000,
        loader: async () => ({ value: ++redisLoads }),
    });
    assert.equal(first.source, "loader");
    assert.equal(second.source, "redis");
    assert.deepEqual(second.value, { value: 1 });
    assert.equal(redisLoads, 1);

    redis.store.set(redisKey, {
        value: "{not-json",
        expiresAt: Date.now() + 5_000,
    });
    const repaired = await getOrSetJsonCache({
        key: redisKey,
        ttlMs: 5_000,
        loader: async () => ({ value: ++redisLoads }),
    });
    assert.equal(repaired.source, "loader");
    assert.deepEqual(repaired.value, { value: 2 });

    await invalidateJsonCache(redisKey);
    assert.equal(redis.store.has(redisKey), false);

    redis.failReads = true;
    redis.failWrites = true;
    const fallbackKey = getRedisKey("cache", "fault-fallback");
    let fallbackLoads = 0;
    const fallbackLoad = await getOrSetJsonCache({
        key: fallbackKey,
        ttlMs: 5_000,
        loader: async () => ({ value: ++fallbackLoads }),
    });
    const fallbackHit = await getOrSetJsonCache({
        key: fallbackKey,
        ttlMs: 5_000,
        loader: async () => ({ value: ++fallbackLoads }),
    });
    assert.equal(fallbackLoad.source, "loader");
    assert.equal(fallbackHit.source, "memory");
    assert.equal(fallbackLoads, 1);

    resetRedisTestClient();
    delete process.env.REDIS_URL;
    resetJsonCacheState();
    const singleFlightKey = getRedisKey("cache", "single-flight");
    let singleFlightLoads = 0;
    const loader = async () => {
        singleFlightLoads += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { value: singleFlightLoads };
    };
    const [parallelA, parallelB] = await Promise.all([
        getOrSetJsonCache({
            key: singleFlightKey,
            ttlMs: 5_000,
            loader,
        }),
        getOrSetJsonCache({
            key: singleFlightKey,
            ttlMs: 5_000,
            loader,
        }),
    ]);
    assert.equal(singleFlightLoads, 1);
    assert.deepEqual(parallelA.value, parallelB.value);
    assert.equal(
        parallelA.coalesced || parallelB.coalesced,
        true
    );

    process.env.CACHE_MEMORY_MAX_ENTRIES = "2";
    for (const key of ["one", "two", "three"]) {
        await getOrSetJsonCache({
            key: getRedisKey("cache", "bounded", key),
            ttlMs: 5_000,
            loader: async () => ({ key }),
        });
    }

    const metrics = getJsonCacheMetrics();
    assert.equal(metrics.memoryEntries, 2);
    assert.ok(metrics.coalescedLoads >= 1);
    assert.ok(metrics.loads >= 4);

    console.log("json cache foundation smoke test passed");
}

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        resetRedisTestClient();
        resetJsonCacheState();
        if (originalRedisUrl === undefined) {
            delete process.env.REDIS_URL;
        } else {
            process.env.REDIS_URL = originalRedisUrl;
        }
        if (originalPrefix === undefined) {
            delete process.env.REDIS_KEY_PREFIX;
        } else {
            process.env.REDIS_KEY_PREFIX = originalPrefix;
        }
        if (originalMemoryLimit === undefined) {
            delete process.env.CACHE_MEMORY_MAX_ENTRIES;
        } else {
            process.env.CACHE_MEMORY_MAX_ENTRIES = originalMemoryLimit;
        }
    });
