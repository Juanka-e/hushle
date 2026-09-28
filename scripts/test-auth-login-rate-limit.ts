import assert from "node:assert/strict";
import {
    checkPasswordLoginRateLimit,
    clearPasswordLoginAccountFailures,
    recordPasswordLoginFailure,
} from "@hushle/platform-auth";
import {
    resetRedisTestClient,
    setRedisTestClient,
    type RedisLikeClient,
} from "@hushle/platform-cache";

type Entry = { value: string; expiresAt: number | null };

class FakeRedisClient implements RedisLikeClient {
    private readonly store = new Map<string, Entry>();

    async ping(): Promise<string> {
        return "PONG";
    }

    private read(key: string): Entry | null {
        const entry = this.store.get(key) ?? null;
        if (
            entry &&
            entry.expiresAt !== null &&
            entry.expiresAt <= Date.now()
        ) {
            this.store.delete(key);
            return null;
        }
        return entry;
    }

    async get(key: string): Promise<string | null> {
        return this.read(key)?.value ?? null;
    }

    async set(
        key: string,
        value: string,
        options?: { PX?: number; NX?: boolean }
    ): Promise<string | null> {
        if (options?.NX && this.read(key)) return null;
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
        const count = Number.parseInt((await this.get(key)) ?? "0", 10) + 1;
        const expiresAt = this.read(key)?.expiresAt ?? null;
        this.store.set(key, { value: String(count), expiresAt });
        return count;
    }

    async pExpire(key: string, milliseconds: number): Promise<number> {
        const entry = this.read(key);
        if (!entry) return 0;
        entry.expiresAt = Date.now() + milliseconds;
        return 1;
    }

    async pTTL(key: string): Promise<number> {
        const entry = this.read(key);
        if (!entry) return -2;
        if (entry.expiresAt === null) return -1;
        return Math.max(0, entry.expiresAt - Date.now());
    }

    async eval(
        _script: string,
        options: { keys: string[]; arguments: string[] }
    ): Promise<unknown> {
        const key = options.keys[0]!;
        const windowMs = Number.parseInt(options.arguments[0]!, 10);
        const count = await this.incr(key);
        if (count === 1) {
            await this.pExpire(key, windowMs);
        }
        return [count, await this.pTTL(key)];
    }
}

async function run(): Promise<void> {
    process.env.REDIS_KEY_PREFIX = `hushle:test:auth-rate:${Date.now()}`;
    setRedisTestClient(new FakeRedisClient());

    try {
        assert.equal(
            (
                await checkPasswordLoginRateLimit({
                    remoteIp: "198.51.100.1",
                    username: "Player",
                })
            ).allowed,
            true
        );

        for (let attempt = 0; attempt < 8; attempt += 1) {
            await recordPasswordLoginFailure({
                remoteIp: `198.51.100.${attempt + 1}`,
                username: attempt % 2 === 0 ? "Player" : "player",
            });
        }
        const accountBlocked = await checkPasswordLoginRateLimit({
            remoteIp: "203.0.113.50",
            username: "PLAYER",
        });
        assert.equal(accountBlocked.allowed, false);
        assert.equal(accountBlocked.blockedBy, "account");

        assert.equal(
            (
                await checkPasswordLoginRateLimit({
                    remoteIp: "203.0.113.50",
                    username: "another-player",
                })
            ).allowed,
            true
        );

        await clearPasswordLoginAccountFailures("player");
        assert.equal(
            (
                await checkPasswordLoginRateLimit({
                    remoteIp: "203.0.113.50",
                    username: "Player",
                })
            ).allowed,
            true
        );

        const sharedIp = "192.0.2.99";
        for (let attempt = 0; attempt < 30; attempt += 1) {
            await recordPasswordLoginFailure({
                remoteIp: sharedIp,
                username: `target-${attempt}`,
            });
        }
        const ipBlocked = await checkPasswordLoginRateLimit({
            remoteIp: sharedIp,
            username: "fresh-target",
        });
        assert.equal(ipBlocked.allowed, false);
        assert.equal(ipBlocked.blockedBy, "ip");

        console.log("auth login rate limit test passed");
    } finally {
        resetRedisTestClient();
    }
}

void run();
