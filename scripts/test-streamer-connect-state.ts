import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getRedisKey, type RedisLikeClient } from "@hushle/platform-cache";
import {
    CONNECT_STATE_COOKIE,
    CONNECT_STATE_COOKIE_PATH,
    CONNECT_STATE_TTL_MS,
    ConnectStateError,
    createConnectState,
    createConnectStateStore,
    createMemoryConnectStateStore,
    hashConnectState,
    pkceChallenge,
    readConnectState,
    requireConnectStateSecret,
} from "../apps/web/src/lib/streamer/connect-state";

// The signed, short-lived cookie that ties an OAuth callback to the user who started it.

let count = 0;
function test(name: string, run: () => void): void {
    run();
    count += 1;
    console.log(`PASS ${name}`);
}

const secret = "s".repeat(48);
const NOW = new Date("2026-11-05T12:00:00Z");

function expectCode(run: () => unknown, code: ConnectStateError["code"]): void {
    assert.throws(run, (error: unknown) => error instanceof ConnectStateError && error.code === code, `expected ${code}`);
}

test("constants", () => {
    assert.equal(CONNECT_STATE_COOKIE, "hushle_streamer_connect");
    assert.equal(CONNECT_STATE_COOKIE_PATH, "/api/streamer/connect");
    assert.equal(CONNECT_STATE_TTL_MS, 600_000);
});

test("roundtrip without PKCE", () => {
    const created = createConnectState({ userId: 42, platform: "twitch", requiresPkce: false, secret, now: NOW });
    assert.match(created.state, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(created.codeChallenge, undefined);
    assert.ok(!created.cookieValue.includes("42:twitch"), "cookie is not plain text");
    const read = readConnectState(created.cookieValue, { userId: 42, platform: "twitch", state: created.state, secret, now: new Date(NOW.getTime() + 60_000) });
    assert.deepEqual(read, { codeVerifier: undefined });
});

test("roundtrip with PKCE: challenge is base64url(sha256(verifier))", () => {
    const created = createConnectState({ userId: 7, platform: "kick", requiresPkce: true, secret, now: NOW });
    assert.ok(created.codeChallenge);
    const read = readConnectState(created.cookieValue, { userId: 7, platform: "kick", state: created.state, secret, now: NOW });
    assert.ok(read.codeVerifier && read.codeVerifier.length >= 43);
    assert.equal(created.codeChallenge, createHash("sha256").update(read.codeVerifier).digest("base64url"));
    assert.equal(pkceChallenge(read.codeVerifier), created.codeChallenge);
});

test("two states never repeat", () => {
    const a = createConnectState({ userId: 1, platform: "twitch", requiresPkce: false, secret, now: NOW });
    const b = createConnectState({ userId: 1, platform: "twitch", requiresPkce: false, secret, now: NOW });
    assert.notEqual(a.state, b.state);
    assert.notEqual(a.cookieValue, b.cookieValue);
});

test("missing cookie", () => {
    expectCode(() => readConnectState(undefined, { userId: 1, platform: "twitch", state: "x", secret, now: NOW }), "state_missing");
    expectCode(() => readConnectState("", { userId: 1, platform: "twitch", state: "x", secret, now: NOW }), "state_missing");
});

test("tampered signature, payload or shape is invalid", () => {
    const { cookieValue, state } = createConnectState({ userId: 1, platform: "twitch", requiresPkce: false, secret, now: NOW });
    const [payload, signature] = cookieValue.split(".");
    const flipped = signature.at(-1) === "A" ? "B" : "A";
    expectCode(() => readConnectState(`${payload}.${signature.slice(0, -1)}${flipped}`, { userId: 1, platform: "twitch", state, secret, now: NOW }), "state_invalid");
    expectCode(() => readConnectState(`${payload}x.${signature}`, { userId: 1, platform: "twitch", state, secret, now: NOW }), "state_invalid");
    expectCode(() => readConnectState("garbage", { userId: 1, platform: "twitch", state, secret, now: NOW }), "state_invalid");
    expectCode(() => readConnectState(cookieValue, { userId: 1, platform: "twitch", state, secret: "t".repeat(48), now: NOW }), "state_invalid");
});

test("expired after ten minutes", () => {
    const { cookieValue, state } = createConnectState({ userId: 1, platform: "twitch", requiresPkce: false, secret, now: NOW });
    readConnectState(cookieValue, { userId: 1, platform: "twitch", state, secret, now: new Date(NOW.getTime() + 599_000) });
    expectCode(() => readConnectState(cookieValue, { userId: 1, platform: "twitch", state, secret, now: new Date(NOW.getTime() + 601_000) }), "state_expired");
    expectCode(() => readConnectState(cookieValue, { userId: 1, platform: "twitch", state, secret, now: new Date(NOW.getTime() - 120_000) }), "state_invalid");
});

test("another user, platform or state value is a mismatch", () => {
    const { cookieValue, state } = createConnectState({ userId: 1, platform: "twitch", requiresPkce: false, secret, now: NOW });
    expectCode(() => readConnectState(cookieValue, { userId: 2, platform: "twitch", state, secret, now: NOW }), "state_mismatch");
    expectCode(() => readConnectState(cookieValue, { userId: 1, platform: "kick", state, secret, now: NOW }), "state_mismatch");
    expectCode(() => readConnectState(cookieValue, { userId: 1, platform: "twitch", state: state.slice(0, -1) + "_", secret, now: NOW }), "state_mismatch");
    expectCode(() => readConnectState(cookieValue, { userId: 1, platform: "twitch", state: null, secret, now: NOW }), "state_mismatch");
});

test("the signing secret must be at least 32 characters", () => {
    assert.throws(() => requireConnectStateSecret({ AUTH_SECRET: "short" }), /32/);
    assert.throws(() => requireConnectStateSecret({}), /32/);
    assert.equal(requireConnectStateSecret({ AUTH_SECRET: secret }), secret);
});

// ---- single use on the server: the state's sha256, recorded at start, consumed by the callback

async function asyncTest(name: string, run: () => Promise<void>): Promise<void> {
    await run();
    count += 1;
    console.log(`PASS ${name}`);
}

/** A Redis double with the two commands the store uses, a clock for PX expiry and a call log. */
function fakeRedis(clock: { now: number }) {
    const keys = new Map<string, { value: string; expiresAt: number | null }>();
    const calls: string[] = [];
    let down = false;
    const live = (key: string) => {
        const entry = keys.get(key);
        if (entry && entry.expiresAt !== null && entry.expiresAt <= clock.now) keys.delete(key);
        return keys.get(key);
    };
    const client = {
        async set(key: string, value: string, options?: { NX?: boolean; PX?: number }) {
            calls.push(`SET ${key} ${value} ${JSON.stringify(options ?? {})}`);
            if (down) throw new Error("redis down");
            if (options?.NX && live(key)) return null;
            keys.set(key, { value, expiresAt: options?.PX ? clock.now + options.PX : null });
            return "OK";
        },
        async del(key: string) {
            calls.push(`DEL ${key}`);
            if (down) throw new Error("redis down");
            if (!live(key)) return 0;
            keys.delete(key);
            return 1;
        },
    } as unknown as RedisLikeClient;
    return {
        client,
        calls,
        keys,
        setDown(value: boolean) {
            down = value;
        },
    };
}

async function storeTests(): Promise<void> {
    await asyncTest("a state is recorded as its sha256, never its value", async () => {
        const { state } = createConnectState({ userId: 1, platform: "twitch", requiresPkce: false, secret, now: NOW });
        const hash = hashConnectState(state);
        assert.equal(hash, createHash("sha256").update(state, "utf8").digest("hex"));
        assert.match(hash, /^[0-9a-f]{64}$/);
        assert.notEqual(hash, state);
    });

    await asyncTest("in-process store: recorded once, consumed once, refused after ten minutes, bounded", async () => {
        const clock = { now: NOW.getTime() };
        const store = createMemoryConnectStateStore({ now: () => clock.now, maxEntries: 3 });
        assert.equal(await store.record("a", CONNECT_STATE_TTL_MS), true);
        assert.equal(await store.record("a", CONNECT_STATE_TTL_MS), false, "the same state cannot be recorded twice");
        assert.equal(await store.consume("a"), true, "first use");
        assert.equal(await store.consume("a"), false, "a replay finds nothing");
        assert.equal(await store.consume("never"), false, "an unknown state is refused");
        await store.record("b", CONNECT_STATE_TTL_MS);
        clock.now += CONNECT_STATE_TTL_MS - 1;
        assert.equal(await store.consume("b"), true, "still within ten minutes");
        await store.record("c", CONNECT_STATE_TTL_MS);
        clock.now += CONNECT_STATE_TTL_MS;
        assert.equal(await store.consume("c"), false, "expired after ten minutes");
        // Bounded: past the cap the oldest record goes first.
        for (const hash of ["d", "e", "f", "g"]) await store.record(hash, CONNECT_STATE_TTL_MS);
        assert.equal(await store.consume("d"), false, "the oldest was dropped at the cap");
        for (const hash of ["e", "f", "g"]) assert.equal(await store.consume(hash), true, hash);
    });

    await asyncTest("Redis store: SET NX PX at start, DEL count at the callback; only the hash is sent", async () => {
        const clock = { now: NOW.getTime() };
        const redis = fakeRedis(clock);
        const store = createConnectStateStore({ redis: async () => redis.client, fallback: createMemoryConnectStateStore({ now: () => clock.now }) });
        const { state } = createConnectState({ userId: 1, platform: "twitch", requiresPkce: false, secret, now: NOW });
        const hash = hashConnectState(state);
        assert.equal(await store.record(hash, CONNECT_STATE_TTL_MS), true);
        assert.equal(await store.record(hash, CONNECT_STATE_TTL_MS), false, "NX: a second record of the same state fails");
        // The key comes from the same helper the store uses, so any REDIS_KEY_PREFIX (CI's
        // "hushle:ci-…" has a colon) gives the same answer; the segments are pinned here.
        const key = getRedisKey("streamer", "connect-state", hash);
        assert.ok(key.endsWith(`:streamer:connect-state:${hash}`), key);
        assert.equal(redis.calls[0], `SET ${key} 1 {"NX":true,"PX":600000}`);
        assert.equal(await store.consume(hash), true);
        assert.equal(await store.consume(hash), false, "a replay finds nothing");
        assert.ok(redis.calls.every((call) => !call.includes(state)), "the raw state never reaches Redis");
        // PX: the key is gone after ten minutes.
        await store.record("expiring", CONNECT_STATE_TTL_MS);
        clock.now += CONNECT_STATE_TTL_MS;
        assert.equal(await store.consume("expiring"), false, "expired in Redis");
    });

    await asyncTest("Redis store: while Redis is away the in-process record stands in, still single use", async () => {
        const clock = { now: NOW.getTime() };
        const redis = fakeRedis(clock);
        let reachable = false;
        const store = createConnectStateStore({ redis: async () => (reachable ? redis.client : null), fallback: createMemoryConnectStateStore({ now: () => clock.now }) });
        assert.equal(await store.record("h1", CONNECT_STATE_TTL_MS), true, "recorded in process without Redis");
        reachable = true;
        assert.equal(await store.consume("h1"), true, "Redis back: the in-process record is still found once");
        assert.equal(await store.consume("h1"), false);
        redis.setDown(true);
        assert.equal(await store.record("h2", CONNECT_STATE_TTL_MS), true, "a failing Redis call falls back too");
        assert.equal(await store.consume("h2"), true);
        assert.equal(await store.consume("h2"), false);
        assert.equal(redis.keys.size, 0);
    });

    await asyncTest("Redis store: a SET that landed but whose answer was lost is recorded in process too; one consume takes both, so no replay", async () => {
        const clock = { now: NOW.getTime() };
        const redis = fakeRedis(clock);
        // The write reaches Redis, then the connection drops before the answer comes back.
        const lossy = {
            set: async (...args: Parameters<RedisLikeClient["set"]>) => {
                await redis.client.set(...args);
                throw new Error("connection reset after the write");
            },
            del: (...args: Parameters<RedisLikeClient["del"]>) => redis.client.del(...args),
        } as unknown as RedisLikeClient;
        const fallback = createMemoryConnectStateStore({ now: () => clock.now });
        const store = createConnectStateStore({ redis: async () => lossy, fallback });
        assert.equal(await store.record("lost-answer", CONNECT_STATE_TTL_MS), true, "the in-process record stands in");
        assert.equal(redis.keys.size, 1, "and the key did land in Redis");
        assert.equal(await store.consume("lost-answer"), true, "the callback consumes it once");
        assert.equal(redis.keys.size, 0);
        assert.equal(await store.consume("lost-answer"), false, "a replay finds neither record");
        assert.equal(await fallback.consume("lost-answer"), false, "the in-process twin was taken with the Redis key");
    });
}

storeTests()
    .then(() => console.log(`${count} checks passed.`))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
