import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
    connectionAad,
    createFakePlatformClient,
    createMemoryStreamerConnectionStore,
    decryptToken,
    encryptToken,
    loadTokenKeyring,
    StreamerPlatformError,
    type FakePlatformClient,
    type StreamerPlatform,
    type StreamerPlatformClient,
} from "@hushle/platform-streamer";
import { createHash } from "node:crypto";
import { createMemoryConnectStateStore, readConnectState, type ConnectStateStore } from "../apps/web/src/lib/streamer/connect-state";
import { completeConnect, startConnect, type ConnectFlowDeps, type ConnectFlowUser } from "../apps/web/src/lib/streamer/connect-flow";
import { disconnectPlatform, listConnectionsView, revokeAllForUser, verifyActiveConnections } from "../apps/web/src/lib/streamer/connections-view";
import { StreamerConfigError } from "@hushle/platform-streamer";
import { publicOriginFor, settingsRedirect, STREAMER_REDIRECT_CODES } from "../apps/web/src/lib/streamer/redirects";

// Start → platform → callback, with every refusal the spec lists (güvenlik kontrol listesi).

let count = 0;
async function test(name: string, run: () => Promise<void> | void): Promise<void> {
    await run();
    count += 1;
    console.log(`PASS ${name}`);
}

const NOW = new Date("2026-11-05T12:00:00Z");
const secret = "s".repeat(48);
const keyring = loadTokenKeyring({ STREAMER_TOKEN_KEY: randomBytes(32).toString("base64") });
const origin = "https://hushle.example";
const user1: ConnectFlowUser = { id: 1, role: "user", accountStatus: "active" };
const user2: ConnectFlowUser = { id: 2, role: "user", accountStatus: "active" };

interface Harness {
    deps: ConnectFlowDeps;
    store: ReturnType<typeof createMemoryStreamerConnectionStore>;
    fake: Record<StreamerPlatform, FakePlatformClient>;
    audits: Array<{ action: string; actorId: number | null; resourceId?: string | number | null; metadata?: Record<string, unknown> | null }>;
    events: Array<{ event: string; context?: Record<string, unknown> }>;
    rateLimited: boolean;
    enabled: boolean;
}

function harness(overrides: Partial<{ enabled: boolean; configured: StreamerPlatform[] }> = {}): Harness {
    const store = createMemoryStreamerConnectionStore();
    const fake = { twitch: createFakePlatformClient("twitch"), kick: createFakePlatformClient("kick") };
    const h: Harness = {
        store,
        fake,
        audits: [],
        events: [],
        rateLimited: false,
        enabled: overrides.enabled ?? true,
        deps: {
            store,
            keyring,
            secret,
            now: () => NOW,
            stateStore: createMemoryConnectStateStore({ now: () => (h.deps.now ? h.deps.now() : new Date()).getTime() }),
            isStreamerModeEnabled: async () => h.enabled,
            isPlatformConfigured: (platform) => (overrides.configured ?? ["twitch", "kick"]).includes(platform),
            clientFor: (platform) => fake[platform] as StreamerPlatformClient,
            consumeRateLimit: async () => ({ allowed: !h.rateLimited, limit: 10, remaining: h.rateLimited ? 0 : 9, retryAfterSeconds: h.rateLimited ? 60 : 0 }),
            writeAudit: async (entry) => {
                h.audits.push({ action: entry.action, actorId: entry.actor.id, resourceId: entry.resourceId, metadata: entry.metadata ?? null });
            },
            emitEvent: async (event) => {
                h.events.push(event);
            },
        },
    };
    return h;
}

function codeOf(redirectTo: string): { streamer: string | null; platform: string | null; code: string | null } {
    const url = new URL(redirectTo, origin);
    return { streamer: url.searchParams.get("streamer"), platform: url.searchParams.get("platform"), code: url.searchParams.get("code") };
}

async function startAndCallback(h: Harness, user: ConnectFlowUser, platform: StreamerPlatform, login = "deniz") {
    const started = await startConnect(h.deps, { user, platform, requestIp: "203.0.113.5", origin });
    assert.ok(started.setCookie, "start must set the state cookie");
    const authorizeUrl = new URL(started.redirectTo, origin);
    const state = authorizeUrl.searchParams.get("state")!;
    const query = new URLSearchParams({ code: `fake-code-${login}`, state });
    const finished = await completeConnect(h.deps, { user, platform, query, cookieValue: started.setCookie.value, requestIp: "203.0.113.5", origin });
    return { started, finished, state };
}

async function main(): Promise<void> {
    await test("redirect helper only ever targets the settings tab with allow-listed codes", () => {
        assert.equal(settingsRedirect("linked", "twitch"), "/dashboard?tab=settings&streamer=linked&platform=twitch");
        assert.equal(settingsRedirect("error", "kick", "denied"), "/dashboard?tab=settings&streamer=error&platform=kick&code=denied");
        assert.ok(STREAMER_REDIRECT_CODES.includes("state_mismatch"));
        assert.ok(STREAMER_REDIRECT_CODES.includes("already_linked_elsewhere"));
    });

    await test("start without a user → unauthenticated", async () => {
        const h = harness();
        const result = await startConnect(h.deps, { user: null, platform: "twitch", requestIp: "ip", origin });
        assert.deepEqual(codeOf(result.redirectTo), { streamer: "error", platform: "twitch", code: "unauthenticated" });
        assert.equal(result.setCookie, undefined);
    });

    await test("start with an unknown platform → platform_invalid", async () => {
        const h = harness();
        const result = await startConnect(h.deps, { user: user1, platform: "youtube", requestIp: "ip", origin });
        assert.equal(codeOf(result.redirectTo).code, "platform_invalid");
    });

    await test("start while streamer mode is off → disabled, nothing written", async () => {
        const h = harness({ enabled: false });
        const result = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        assert.equal(codeOf(result.redirectTo).code, "disabled");
        assert.equal(result.setCookie, undefined);
    });

    await test("start for an unconfigured platform → platform_unavailable", async () => {
        const h = harness({ configured: ["twitch"] });
        const result = await startConnect(h.deps, { user: user1, platform: "kick", requestIp: "ip", origin });
        assert.equal(codeOf(result.redirectTo).code, "platform_unavailable");
    });

    await test("start under rate limit → rate_limited", async () => {
        const h = harness();
        h.rateLimited = true;
        const result = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        assert.equal(codeOf(result.redirectTo).code, "rate_limited");
    });

    await test("start sets a ten-minute cookie and sends the user to the platform with the state", async () => {
        const h = harness();
        const result = await startConnect(h.deps, { user: user1, platform: "kick", requestIp: "ip", origin });
        assert.equal(result.setCookie?.maxAgeSeconds, 600);
        const url = new URL(result.redirectTo, origin);
        assert.equal(url.pathname, "/api/streamer/connect/fake/authorize");
        assert.equal(url.searchParams.get("redirect_uri"), `${origin}/api/streamer/connect/kick/callback`);
        const state = url.searchParams.get("state")!;
        const read = readConnectState(result.setCookie!.value, { userId: 1, platform: "kick", state, secret, now: NOW });
        assert.ok(read.codeVerifier, "kick state carries a PKCE verifier");
    });

    await test("callback links the channel: active row, encrypted tokens, audit linked", async () => {
        const h = harness();
        const { finished } = await startAndCallback(h, user1, "twitch");
        assert.deepEqual(codeOf(finished.redirectTo), { streamer: "linked", platform: "twitch", code: null });
        assert.equal(finished.clearCookie, true);
        const row = (await h.store.findByUserAndPlatform(1, "twitch"))!;
        assert.equal(row.status, "active");
        assert.equal(row.login, "deniz");
        assert.equal(row.platformUserId, "fake-deniz");
        assert.equal(row.channelUrl, "https://twitch.tv/deniz");
        assert.equal(row.tokenKeyVersion, 1);
        const aad = connectionAad("twitch", "fake-deniz");
        assert.match(decryptToken(row.accessTokenEnc!, keyring, aad), /^fake-access-deniz-\d+$/);
        assert.equal(decryptToken(row.refreshTokenEnc!, keyring, aad), "fake-refresh-deniz");
        assert.ok(row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() > Date.now());
        assert.equal(h.audits.length, 1);
        assert.equal(h.audits[0].action, "streamer.connection.linked");
        assert.equal(h.audits[0].actorId, 1);
        assert.equal(h.audits[0].resourceId, row.id);
        assert.deepEqual(h.audits[0].metadata, { platform: "twitch" });
        assert.ok(!JSON.stringify(h.audits).includes("fake-access"), "no token in audit");
    });

    await test("linking again is a relink on the same row", async () => {
        const h = harness();
        await startAndCallback(h, user1, "twitch");
        const first = (await h.store.findByUserAndPlatform(1, "twitch"))!;
        const { finished } = await startAndCallback(h, user1, "twitch");
        assert.equal(codeOf(finished.redirectTo).streamer, "linked");
        const second = (await h.store.findByUserAndPlatform(1, "twitch"))!;
        assert.equal(second.id, first.id);
        assert.equal(h.audits.map((a) => a.action).join(","), "streamer.connection.linked,streamer.connection.relinked");
    });

    await test("callback as a different user than the one who started → state_mismatch, no row", async () => {
        const h = harness();
        const started = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        const state = new URL(started.redirectTo, origin).searchParams.get("state")!;
        const finished = await completeConnect(h.deps, {
            user: user2, platform: "twitch", query: new URLSearchParams({ code: "fake-code-deniz", state }), cookieValue: started.setCookie!.value, requestIp: "ip", origin,
        });
        assert.equal(codeOf(finished.redirectTo).code, "state_mismatch");
        assert.equal(finished.clearCookie, true);
        assert.equal(h.store.rows.length, 0);
    });

    await test("platform denial → denied, no row", async () => {
        const h = harness();
        const started = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        const state = new URL(started.redirectTo, origin).searchParams.get("state")!;
        const finished = await completeConnect(h.deps, {
            user: user1, platform: "twitch", query: new URLSearchParams({ error: "access_denied", state }), cookieValue: started.setCookie!.value, requestIp: "ip", origin,
        });
        assert.equal(codeOf(finished.redirectTo).code, "denied");
        assert.equal(h.store.rows.length, 0);
        assert.equal(h.fake.twitch.revoked.length, 0);
    });

    await test("single use: the first callback links, the same cookie and state replayed are refused (state_invalid)", async () => {
        const h = harness();
        const { started, finished, state } = await startAndCallback(h, user1, "twitch");
        assert.equal(codeOf(finished.redirectTo).streamer, "linked");
        const replay = await completeConnect(h.deps, {
            user: user1, platform: "twitch", query: new URLSearchParams({ code: "fake-code-deniz", state }), cookieValue: started.setCookie!.value, requestIp: "ip", origin,
        });
        assert.deepEqual(codeOf(replay.redirectTo), { streamer: "error", platform: "twitch", code: "state_invalid" });
        assert.equal(replay.clearCookie, true);
        assert.equal(h.store.rows.length, 1);
        assert.deepEqual(h.audits.map((a) => a.action), ["streamer.connection.linked"], "the replay relinked nothing");
        // A denial uses the state up too: it cannot be replayed with a code afterwards.
        const second = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        const secondState = new URL(second.redirectTo, origin).searchParams.get("state")!;
        const denied = await completeConnect(h.deps, { user: user1, platform: "twitch", query: new URLSearchParams({ error: "access_denied", state: secondState }), cookieValue: second.setCookie!.value, requestIp: "ip", origin });
        assert.equal(codeOf(denied.redirectTo).code, "denied");
        const afterDenial = await completeConnect(h.deps, { user: user1, platform: "twitch", query: new URLSearchParams({ code: "fake-code-deniz", state: secondState }), cookieValue: second.setCookie!.value, requestIp: "ip", origin });
        assert.equal(codeOf(afterDenial.redirectTo).code, "state_invalid");
    });

    await test("single use: a state the server no longer holds (expired there, or never recorded) is refused even with a cookie that still reads", async () => {
        const h = harness();
        const clock = { now: NOW.getTime() };
        h.deps.stateStore = createMemoryConnectStateStore({ now: () => clock.now });
        const started = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        const state = new URL(started.redirectTo, origin).searchParams.get("state")!;
        clock.now += 10 * 60_000 + 1;
        const expired = await completeConnect(h.deps, { user: user1, platform: "twitch", query: new URLSearchParams({ code: "fake-code-deniz", state }), cookieValue: started.setCookie!.value, requestIp: "ip", origin });
        assert.equal(codeOf(expired.redirectTo).code, "state_invalid");
        // Started on one store, called back on another (a restart): nothing to consume.
        const other = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        const otherState = new URL(other.redirectTo, origin).searchParams.get("state")!;
        h.deps.stateStore = createMemoryConnectStateStore();
        const unknown = await completeConnect(h.deps, { user: user1, platform: "twitch", query: new URLSearchParams({ code: "fake-code-deniz", state: otherState }), cookieValue: other.setCookie!.value, requestIp: "ip", origin });
        assert.equal(codeOf(unknown.redirectTo).code, "state_invalid");
        assert.equal(h.store.rows.length, 0);
        assert.equal(h.fake.twitch.revoked.length, 0, "no code was exchanged");
    });

    await test("single use: the server keeps only the state's sha256, for ten minutes; a cookie refused first burns nothing", async () => {
        const h = harness();
        const inner = createMemoryConnectStateStore();
        const seen: Array<[string, string, number?]> = [];
        const spy: ConnectStateStore = {
            async record(hash, ttlMs) {
                seen.push(["record", hash, ttlMs]);
                return inner.record(hash, ttlMs);
            },
            async consume(hash) {
                seen.push(["consume", hash]);
                return inner.consume(hash);
            },
        };
        h.deps.stateStore = spy;
        const started = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        const state = new URL(started.redirectTo, origin).searchParams.get("state")!;
        const hash = createHash("sha256").update(state, "utf8").digest("hex");
        assert.deepEqual(seen, [["record", hash, 600_000]]);
        // Another user's callback fails the cookie check before the record is touched...
        const mismatch = await completeConnect(h.deps, { user: user2, platform: "twitch", query: new URLSearchParams({ code: "fake-code-deniz", state }), cookieValue: started.setCookie!.value, requestIp: "ip", origin });
        assert.equal(codeOf(mismatch.redirectTo).code, "state_mismatch");
        assert.equal(seen.length, 1);
        // ...so the right user still completes, consuming the hash once.
        const finished = await completeConnect(h.deps, { user: user1, platform: "twitch", query: new URLSearchParams({ code: "fake-code-deniz", state }), cookieValue: started.setCookie!.value, requestIp: "ip", origin });
        assert.equal(codeOf(finished.redirectTo).streamer, "linked");
        assert.deepEqual(seen[1], ["consume", hash]);
        assert.ok(seen.every(([, key]) => key !== state), "the raw state never reaches the store");
    });

    await test("single use: a start whose state cannot be recorded fails without a cookie", async () => {
        const h = harness();
        h.deps.stateStore = { record: async () => false, consume: async () => false };
        const started = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        assert.equal(codeOf(started.redirectTo).code, "internal_error");
        assert.equal(started.setCookie, undefined);
    });

    await test("a replayed callback without the cookie → state_missing", async () => {
        const h = harness();
        const { state } = await startAndCallback(h, user1, "twitch");
        const replay = await completeConnect(h.deps, {
            user: user1, platform: "twitch", query: new URLSearchParams({ code: "fake-code-deniz", state }), cookieValue: undefined, requestIp: "ip", origin,
        });
        assert.equal(codeOf(replay.redirectTo).code, "state_missing");
        assert.equal(h.store.rows.length, 1);
    });

    await test("a callback with a wrong state value → state_mismatch", async () => {
        const h = harness();
        const started = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        const finished = await completeConnect(h.deps, {
            user: user1, platform: "twitch", query: new URLSearchParams({ code: "fake-code-deniz", state: "forged" }), cookieValue: started.setCookie!.value, requestIp: "ip", origin,
        });
        assert.equal(codeOf(finished.redirectTo).code, "state_mismatch");
    });

    await test("a callback without a code → state_invalid", async () => {
        const h = harness();
        const started = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        const state = new URL(started.redirectTo, origin).searchParams.get("state")!;
        const finished = await completeConnect(h.deps, {
            user: user1, platform: "twitch", query: new URLSearchParams({ state }), cookieValue: started.setCookie!.value, requestIp: "ip", origin,
        });
        assert.equal(codeOf(finished.redirectTo).code, "state_invalid");
    });

    await test("a platform account already linked to someone else → already_linked_elsewhere + link_rejected audit", async () => {
        const h = harness();
        await startAndCallback(h, user2, "twitch", "deniz");
        const { finished } = await startAndCallback(h, user1, "twitch", "deniz");
        assert.equal(codeOf(finished.redirectTo).code, "already_linked_elsewhere");
        assert.equal(h.store.rows.length, 1);
        assert.equal(h.store.rows[0].userId, 2);
        const rejected = h.audits.find((a) => a.action === "streamer.connection.link_rejected");
        assert.ok(rejected);
        assert.equal(rejected.actorId, 1);
        assert.deepEqual(rejected.metadata, { platform: "twitch", reason: "already_linked_elsewhere" });
        assert.ok(!JSON.stringify(rejected).includes("2"), "the other user's id never leaks into the audit");
    });

    await test("callback under rate limit → rate_limited before any platform call", async () => {
        const h = harness();
        const started = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        const state = new URL(started.redirectTo, origin).searchParams.get("state")!;
        h.rateLimited = true;
        const finished = await completeConnect(h.deps, {
            user: user1, platform: "twitch", query: new URLSearchParams({ code: "fake-code-deniz", state }), cookieValue: started.setCookie!.value, requestIp: "ip", origin,
        });
        assert.equal(codeOf(finished.redirectTo).code, "rate_limited");
        assert.equal(h.store.rows.length, 0);
    });

    await test("a platform failure → platform_error, the redirect carries no error text, an event records the kind", async () => {
        const h = harness();
        const broken: StreamerPlatformClient = {
            ...h.fake.twitch,
            async exchangeCode() {
                throw new StreamerPlatformError("twitch", "exchange", "network", null);
            },
        };
        h.deps.clientFor = () => broken;
        const { finished } = await startAndCallback(h, user1, "twitch");
        assert.equal(codeOf(finished.redirectTo).code, "platform_error");
        assert.ok(!/network|SECRET/.test(finished.redirectTo));
        assert.equal(h.store.rows.length, 0);
        assert.ok(h.events.some((e) => e.event === "streamer.connect.platform_error" && e.context?.kind === "network"));
    });

    await test("callback without a user → unauthenticated", async () => {
        const h = harness();
        const finished = await completeConnect(h.deps, {
            user: null, platform: "twitch", query: new URLSearchParams({ code: "x", state: "y" }), cookieValue: "a.b", requestIp: "ip", origin,
        });
        assert.equal(codeOf(finished.redirectTo).code, "unauthenticated");
    });

    // ---- review findings on Tasks 1-5

    await test("review 1: browser redirects use the configured public origin, never the bind address", () => {
        assert.equal(publicOriginFor({ STREAMER_OAUTH_PUBLIC_ORIGIN: "https://hushle.example/" }, "http://0.0.0.0:3000"), "https://hushle.example");
        assert.equal(publicOriginFor({ NEXT_PUBLIC_SITE_URL: "https://hushle.example/path" }, "http://0.0.0.0:3000"), "https://hushle.example");
        assert.equal(publicOriginFor({ NEXT_PUBLIC_SITE_URL: "not a url" }, "http://127.0.0.1:3201"), "http://127.0.0.1:3201");
        assert.equal(publicOriginFor({}, "http://127.0.0.1:3201"), "http://127.0.0.1:3201");
    });

    await test("review 3: relinking revokes the previous tokens at the platform and audits a channel change", async () => {
        const h = harness();
        await startAndCallback(h, user1, "twitch", "deniz");
        await startAndCallback(h, user1, "twitch", "deniz");
        assert.equal(h.fake.twitch.revoked.length, 1, "the old grant is revoked on relink");
        assert.match(h.fake.twitch.revoked[0], /^fake-(access|refresh)-deniz/);
        await startAndCallback(h, user1, "twitch", "deniz2");
        assert.equal(h.fake.twitch.revoked.length, 2);
        const row = (await h.store.findByUserAndPlatform(1, "twitch"))!;
        assert.equal(row.platformUserId, "fake-deniz2");
        const last = h.audits.at(-1)!;
        assert.equal(last.action, "streamer.connection.relinked");
        assert.deepEqual(last.metadata, { platform: "twitch", reason: "channel_changed" });
    });

    await test("review 4: a unique-constraint race on the write is reported as already_linked_elsewhere and the new tokens are revoked", async () => {
        const h = harness();
        const realUpsert = h.store.upsertLinked.bind(h.store);
        let armed = true;
        h.deps.store = {
            ...h.store,
            findByUser: h.store.findByUser.bind(h.store),
            findByUserAndPlatform: h.store.findByUserAndPlatform.bind(h.store),
            findByPlatformUser: async () => null,
            upsertLinked: async (input) => {
                if (armed) {
                    armed = false;
                    const error = new Error("Unique constraint failed on the constraint: `streamer_connections_platform_platform_user_id_key`") as Error & { code: string; meta: unknown };
                    error.code = "P2002";
                    error.meta = { target: ["platform", "platform_user_id"] };
                    throw error;
                }
                return realUpsert(input);
            },
        };
        const { finished } = await startAndCallback(h, user1, "twitch");
        assert.equal(codeOf(finished.redirectTo).code, "already_linked_elsewhere");
        assert.equal(h.fake.twitch.revoked.length, 1, "tokens obtained in the lost race are revoked");
    });

    await test("review 5: a channel left behind as revoked by another user can be claimed with fresh OAuth proof", async () => {
        const h = harness();
        await startAndCallback(h, user2, "twitch", "deniz");
        await disconnectPlatform(h.deps, { user: user2, platform: "twitch", requestIp: "ip" });
        const { finished } = await startAndCallback(h, user1, "twitch", "deniz");
        assert.equal(codeOf(finished.redirectTo).streamer, "linked");
        assert.equal(h.store.rows.filter((r) => r.platformUserId === "fake-deniz").length, 1);
        assert.equal((await h.store.findByUserAndPlatform(1, "twitch"))!.status, "active");
        assert.equal(await h.store.findByUserAndPlatform(2, "twitch"), null);
    });

    await test("review 5: a needs_reconnect row of another user still blocks the channel", async () => {
        const h = harness();
        await startAndCallback(h, user2, "twitch", "deniz");
        const row = (await h.store.findByUserAndPlatform(2, "twitch"))!;
        await h.store.markNeedsReconnect(row.id, "refresh_failed", NOW);
        const { finished } = await startAndCallback(h, user1, "twitch", "deniz");
        assert.equal(codeOf(finished.redirectTo).code, "already_linked_elsewhere");
    });

    await test("review 13: the callback re-checks the streamer mode switch", async () => {
        const h = harness();
        const started = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        const state = new URL(started.redirectTo, origin).searchParams.get("state")!;
        h.enabled = false;
        const finished = await completeConnect(h.deps, { user: user1, platform: "twitch", query: new URLSearchParams({ code: "fake-code-deniz", state }), cookieValue: started.setCookie!.value, requestIp: "ip", origin });
        assert.equal(codeOf(finished.redirectTo).code, "disabled");
        assert.equal(h.store.rows.length, 0);
    });

    // ---- review 2 findings

    await test("review 2.1: an account that is not active cannot start or finish a link", async () => {
        const h = harness();
        const pending: ConnectFlowUser = { id: 9, role: "user", accountStatus: "pending_email_verification" };
        const started = await startConnect(h.deps, { user: pending, platform: "twitch", requestIp: "ip", origin });
        assert.equal(codeOf(started.redirectTo).code, "account_not_active");
        assert.equal(started.setCookie, undefined);
        const activeStart = await startConnect(h.deps, { user: user1, platform: "twitch", requestIp: "ip", origin });
        const state = new URL(activeStart.redirectTo, origin).searchParams.get("state")!;
        const finished = await completeConnect(h.deps, { user: { ...user1, accountStatus: "pending_email_verification" }, platform: "twitch", query: new URLSearchParams({ code: "fake-code-deniz", state }), cookieValue: activeStart.setCookie!.value, requestIp: "ip", origin });
        assert.equal(codeOf(finished.redirectTo).code, "account_not_active");
        assert.equal(h.store.rows.length, 0);
    });

    await test("review 2.2: opening the panel validates the active connection and stamps lastValidatedAt", async () => {
        const h = harness();
        await startAndCallback(h, user1, "twitch");
        const before = (await h.store.findByUserAndPlatform(1, "twitch"))!;
        const later = new Date(NOW.getTime() + 60_000);
        h.deps.now = () => later;
        const view = await verifyActiveConnections(h.deps, user1.id);
        assert.equal(view.platforms[0].connection?.status, "active");
        const after = (await h.store.findByUserAndPlatform(1, "twitch"))!;
        assert.equal(after.lastValidatedAt?.getTime(), later.getTime());
        assert.notEqual(after.lastValidatedAt?.getTime(), before.lastValidatedAt?.getTime());
    });

    await test("review 2.2: a connection the platform no longer honours becomes needs_reconnect when the panel opens", async () => {
        const h = harness();
        await startAndCallback(h, user1, "twitch");
        const row = (await h.store.findByUserAndPlatform(1, "twitch"))!;
        // Simulate a revoked grant: the stored access token is unknown to the platform and the refresh token is dead.
        const aad = connectionAad("twitch", "fake-deniz");
        const replaced = await h.store.updateTokens(row.id, {
            accessTokenEnc: encryptToken("not-a-fake-token", keyring, aad),
            refreshTokenEnc: encryptToken("fake-refresh-expired", keyring, aad),
            tokenKeyVersion: 1,
            accessTokenExpiresAt: new Date(NOW.getTime() + 3_600_000),
            now: NOW,
            previousRefreshTokenEnc: row.refreshTokenEnc,
        });
        assert.ok(replaced, "the simulated grant replaced the stored tokens");
        const view = await verifyActiveConnections(h.deps, user1.id);
        assert.equal(view.platforms[0].connection?.status, "needs_reconnect");
        assert.equal((await h.store.findByUserAndPlatform(1, "twitch"))!.statusReason, "refresh_failed");
    });

    await test("review 2 minor 1: 'Kaldır' still works when the platform client cannot be built", async () => {
        const h = harness();
        await startAndCallback(h, user1, "kick");
        h.deps.clientFor = () => { throw new StreamerConfigError("STREAMER_KICK_CLIENT_ID and STREAMER_KICK_CLIENT_SECRET are required"); };
        assert.deepEqual(await disconnectPlatform(h.deps, { user: user1, platform: "kick", requestIp: "ip" }), { ok: true });
        const row = (await h.store.findByUserAndPlatform(1, "kick"))!;
        assert.equal(row.status, "revoked");
        assert.equal(row.refreshTokenEnc, null);
    });

    // ---- Task 6: connections view, disconnect, account closure

    await test("the connections view lists both platforms, hides tokens and reports configuration", async () => {
        const h = harness({ configured: ["twitch"] });
        await startAndCallback(h, user1, "twitch");
        const view = await listConnectionsView(h.deps, user1.id);
        assert.equal(view.enabled, true);
        assert.deepEqual(view.platforms.map((p) => [p.platform, p.label, p.configured, p.connection?.status ?? null]), [
            ["twitch", "Twitch", true, "active"],
            ["kick", "Kick", false, null],
        ]);
        const twitch = view.platforms[0].connection!;
        assert.equal(twitch.login, "deniz");
        assert.equal(twitch.displayName, "Deniz");
        assert.equal(twitch.channelUrl, "https://twitch.tv/deniz");
        assert.equal(typeof twitch.connectedAt, "string");
        const json = JSON.stringify(view);
        assert.ok(!/TokenEnc|fake-access|fake-refresh|tokenKeyVersion|platformUserId/.test(json), json);
        h.enabled = false;
        assert.equal((await listConnectionsView(h.deps, user1.id)).enabled, false);
    });

    await test("disconnect revokes at the platform, clears tokens, audits; a second call is not_found", async () => {
        const h = harness();
        await startAndCallback(h, user1, "kick");
        const result = await disconnectPlatform(h.deps, { user: user1, platform: "kick", requestIp: "ip" });
        assert.deepEqual(result, { ok: true });
        assert.equal(h.fake.kick.revoked.length, 1);
        assert.match(h.fake.kick.revoked[0], /^fake-(access|refresh)-deniz/);
        const row = (await h.store.findByUserAndPlatform(1, "kick"))!;
        assert.equal(row.status, "revoked");
        assert.equal(row.statusReason, "user_disconnected");
        assert.equal(row.accessTokenEnc, null);
        assert.equal(row.refreshTokenEnc, null);
        const audit = h.audits.find((a) => a.action === "streamer.connection.disconnected");
        assert.ok(audit);
        assert.equal(audit.resourceId, row.id);
        assert.deepEqual(audit.metadata, { platform: "kick", reason: "user_disconnected" });
        assert.deepEqual(await disconnectPlatform(h.deps, { user: user1, platform: "kick", requestIp: "ip" }), { error: "not_found" });
        assert.deepEqual(await disconnectPlatform(h.deps, { user: user1, platform: "twitch", requestIp: "ip" }), { error: "not_found" });
        assert.deepEqual(await disconnectPlatform(h.deps, { user: user1, platform: "youtube", requestIp: "ip" }), { error: "not_found" });
        const view = await listConnectionsView(h.deps, user1.id);
        assert.equal(view.platforms[1].connection?.status, "revoked");
    });

    await test("a revoked connection can be linked again and comes back active", async () => {
        const h = harness();
        await startAndCallback(h, user1, "kick");
        await disconnectPlatform(h.deps, { user: user1, platform: "kick", requestIp: "ip" });
        const { finished } = await startAndCallback(h, user1, "kick");
        assert.equal(codeOf(finished.redirectTo).streamer, "linked");
        assert.equal((await h.store.findByUserAndPlatform(1, "kick"))!.status, "active");
    });

    await test("account closure revokes every platform of the user", async () => {
        const h = harness();
        await startAndCallback(h, user1, "twitch");
        await startAndCallback(h, user1, "kick", "deniz");
        await startAndCallback(h, user2, "twitch", "luna");
        const revoked = await revokeAllForUser(h.deps, user1.id, "account_closed");
        assert.equal(revoked, 2);
        for (const platform of ["twitch", "kick"] as const) {
            const row = (await h.store.findByUserAndPlatform(1, platform))!;
            assert.equal(row.status, "revoked");
            assert.equal(row.statusReason, "account_closed");
            assert.equal(row.refreshTokenEnc, null);
        }
        assert.equal((await h.store.findByUserAndPlatform(2, "twitch"))!.status, "active");
        assert.equal(h.fake.twitch.revoked.length, 1);
        assert.equal(h.fake.kick.revoked.length, 1);
        assert.equal(await revokeAllForUser(h.deps, user1.id, "account_closed"), 0);
    });

    console.log(`${count} checks passed.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
