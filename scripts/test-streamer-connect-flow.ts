import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
    connectionAad,
    createFakePlatformClient,
    createMemoryStreamerConnectionStore,
    decryptToken,
    loadTokenKeyring,
    StreamerPlatformError,
    type FakePlatformClient,
    type StreamerPlatform,
    type StreamerPlatformClient,
} from "@hushle/platform-streamer";
import { readConnectState } from "../apps/web/src/lib/streamer/connect-state";
import { completeConnect, startConnect, type ConnectFlowDeps, type ConnectFlowUser } from "../apps/web/src/lib/streamer/connect-flow";
import { disconnectPlatform, listConnectionsView, revokeAllForUser } from "../apps/web/src/lib/streamer/connections-view";
import { settingsRedirect, STREAMER_REDIRECT_CODES } from "../apps/web/src/lib/streamer/redirects";

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
const user1: ConnectFlowUser = { id: 1, role: "user" };
const user2: ConnectFlowUser = { id: 2, role: "user" };

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
        assert.deepEqual(h.fake.kick.revoked, ["fake-refresh-deniz"]);
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
