import assert from "node:assert/strict";
import {
    getRedisKey,
    resetRedisTestClient,
    setRedisTestClient,
    type RedisLikeClient,
} from "@hushle/platform-cache";
import {
    createRoomOwnershipCoordinator,
    getRoomOwnershipConfig,
} from "../apps/web/src/lib/socket/room-ownership";

interface StoredValue {
    value: string;
    expiresAt: number | null;
}

class FakeRedisClient implements RedisLikeClient {
    private readonly values = new Map<string, StoredValue>();
    failEval = false;

    private cleanup(key: string): void {
        const stored = this.values.get(key);
        if (stored?.expiresAt && stored.expiresAt <= Date.now()) {
            this.values.delete(key);
        }
    }

    replace(key: string, value: string): void {
        this.values.set(key, { value, expiresAt: Date.now() + 30_000 });
    }

    async ping(): Promise<string> {
        return "PONG";
    }

    async get(key: string): Promise<string | null> {
        this.cleanup(key);
        return this.values.get(key)?.value ?? null;
    }

    async set(
        key: string,
        value: string,
        options?: { PX?: number; NX?: boolean }
    ): Promise<string | null> {
        this.cleanup(key);
        if (options?.NX && this.values.has(key)) return null;
        this.values.set(key, {
            value,
            expiresAt: options?.PX ? Date.now() + options.PX : null,
        });
        return "OK";
    }

    async del(key: string): Promise<number> {
        return this.values.delete(key) ? 1 : 0;
    }

    async incr(): Promise<number> {
        throw new Error("Not implemented for room ownership test");
    }

    async pExpire(key: string, milliseconds: number): Promise<number> {
        this.cleanup(key);
        const stored = this.values.get(key);
        if (!stored) return 0;
        stored.expiresAt = Date.now() + milliseconds;
        return 1;
    }

    async pTTL(key: string): Promise<number> {
        this.cleanup(key);
        const expiresAt = this.values.get(key)?.expiresAt;
        if (expiresAt === undefined) return -2;
        if (expiresAt === null) return -1;
        return Math.max(0, expiresAt - Date.now());
    }

    async eval(
        _script: string,
        options: { keys: string[]; arguments: string[] }
    ): Promise<unknown> {
        if (this.failEval) throw new Error("simulated lease eval failure");
        const key = options.keys[0];
        const expected = options.arguments[0];
        if (!key || !expected) return 0;
        this.cleanup(key);
        if ((await this.get(key)) !== expected) return 0;

        const ttl = options.arguments[1];
        if (ttl) {
            return this.pExpire(key, Number.parseInt(ttl, 10));
        }
        return this.del(key);
    }
}

const originalRedisUrl = process.env.REDIS_URL;
const originalRedisKeyPrefix = process.env.REDIS_KEY_PREFIX;

async function run(): Promise<void> {
    assert.deepEqual(getRoomOwnershipConfig({}), {
        enabled: false,
        leaseTtlMs: 30_000,
        renewIntervalMs: 10_000,
    });
    assert.throws(
        () =>
            getRoomOwnershipConfig({
                ROOM_OWNERSHIP_LEASE_TTL_MS: "10000",
                ROOM_OWNERSHIP_RENEW_INTERVAL_MS: "5000",
            }),
        /less than half/
    );
    assert.throws(
        () =>
            getRoomOwnershipConfig({
                ROOM_OWNERSHIP_LEASE_TTL_MS: "30000ms",
            }),
        /must be between/
    );

    const disabled = await createRoomOwnershipCoordinator({
        instanceId: "disabled-instance",
        env: {},
    });
    assert.equal((await disabled.claim("ROOM00")).acquired, true);
    assert.equal(disabled.getStatus().enabled, false);
    await disabled.close();
    await assert.rejects(disabled.claim("ROOM01"), /closed/);

    delete process.env.REDIS_URL;
    resetRedisTestClient();
    await assert.rejects(
        createRoomOwnershipCoordinator({
            instanceId: "missing-redis",
            env: { ROOM_OWNERSHIP_LEASE_ENABLED: "true" },
        }),
        /requires REDIS_URL/
    );
    process.env.REDIS_URL = "redis://fake-room-ownership";
    process.env.REDIS_KEY_PREFIX = "hushle:test:room-ownership";
    const redis = new FakeRedisClient();
    setRedisTestClient(redis);
    const env = {
        ROOM_OWNERSHIP_LEASE_ENABLED: "true",
        ROOM_OWNERSHIP_LEASE_TTL_MS: "30000",
        ROOM_OWNERSHIP_RENEW_INTERVAL_MS: "10000",
    };
    const first = await createRoomOwnershipCoordinator({
        instanceId: "instance-a",
        env,
    });
    const second = await createRoomOwnershipCoordinator({
        instanceId: "instance-b",
        env,
    });

    const firstClaim = await first.claim("ROOM42");
    assert.equal(firstClaim.acquired, true);
    const conflictingClaim = await second.claim("ROOM42");
    assert.deepEqual(conflictingClaim, {
        acquired: false,
        ownerInstanceId: "instance-a",
    });
    assert.equal(second.getStatus().claimConflicts, 1);

    await first.renewOwnedRooms();
    assert.equal(first.getStatus().ownedRooms, 1);
    assert.ok(first.getStatus().lastRenewedAt);

    redis.failEval = true;
    await assert.rejects(first.renewOwnedRooms(), /simulated/);
    assert.equal(first.getStatus().available, false);
    assert.equal(first.getStatus().renewFailures, 1);
    redis.failEval = false;
    await first.renewOwnedRooms();
    assert.equal(first.getStatus().available, true);

    const key = getRedisKey("room-ownership", "ROOM42");
    redis.replace(
        key,
        JSON.stringify({
            instanceId: "instance-b",
            token: "new-owner-token",
            claimedAt: new Date().toISOString(),
        })
    );
    await first.renewOwnedRooms();
    assert.equal(first.getStatus().ownedRooms, 0);
    assert.equal(first.getStatus().lostRooms, 1);
    assert.equal(first.getStatus().lostOwnerships, 1);

    await redis.del(key);
    await first.renewOwnedRooms();
    assert.equal(await first.getOwner("ROOM42"), null);
    assert.equal(first.getStatus().lostRooms, 1);

    redis.replace(
        key,
        JSON.stringify({
            instanceId: "instance-b",
            token: "replacement-owner-token",
            claimedAt: new Date().toISOString(),
        })
    );
    await first.close();
    assert.equal(await second.getOwner("ROOM42"), "instance-b");
    await second.close();

    console.log("room ownership lease test passed");
}

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        resetRedisTestClient();
        if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
        else process.env.REDIS_URL = originalRedisUrl;
        if (originalRedisKeyPrefix === undefined) {
            delete process.env.REDIS_KEY_PREFIX;
        } else {
            process.env.REDIS_KEY_PREFIX = originalRedisKeyPrefix;
        }
    });
