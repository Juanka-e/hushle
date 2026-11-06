import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
    callWithToken,
    connectionAad,
    createFakePlatformClient,
    createMemoryStreamerConnectionStore,
    decryptToken,
    encryptToken,
    getAccessToken,
    loadTokenKeyring,
    revokeConnectionTokens,
    StreamerPlatformError,
    StreamerReconnectRequired,
    type StreamerConnectionRecord,
    type StreamerPlatformClient,
    type TokenServiceDeps,
} from "@hushle/platform-streamer";

// Token refresh / reconnect / revoke rules (spec karar 4). Memory store, fake platform, fixed clock.

let count = 0;
async function test(name: string, run: () => Promise<void> | void): Promise<void> {
    await run();
    count += 1;
    console.log(`PASS ${name}`);
}

const NOW = new Date("2026-11-05T12:00:00Z");
const keyring = loadTokenKeyring({ STREAMER_TOKEN_KEY: randomBytes(32).toString("base64") });
const aad = connectionAad("twitch", "fake-deniz");

function row(overrides: Partial<StreamerConnectionRecord> = {}): StreamerConnectionRecord {
    const base: StreamerConnectionRecord = {
        id: "11111111-1111-4111-8111-111111111111",
        userId: 42,
        platform: "twitch",
        platformUserId: "fake-deniz",
        login: "deniz",
        displayName: "Deniz",
        avatarUrl: null,
        channelUrl: "https://twitch.tv/deniz",
        scopes: "",
        accessTokenEnc: encryptToken("fake-access-deniz-0", keyring, aad),
        refreshTokenEnc: encryptToken("fake-refresh-deniz", keyring, aad),
        tokenKeyVersion: 1,
        accessTokenExpiresAt: new Date(NOW.getTime() + 3_600_000),
        status: "active",
        statusReason: null,
        lastValidatedAt: null,
        lastUsedAt: null,
        connectedAt: new Date(NOW.getTime() - 86_400_000),
        revokedAt: null,
        createdAt: new Date(NOW.getTime() - 86_400_000),
        updatedAt: new Date(NOW.getTime() - 86_400_000),
    };
    return { ...base, ...overrides };
}

function deps(client: StreamerPlatformClient = createFakePlatformClient("twitch", { now: () => NOW.getTime() })): TokenServiceDeps & { store: ReturnType<typeof createMemoryStreamerConnectionStore> } {
    const store = createMemoryStreamerConnectionStore();
    return { store, client, keyring, now: () => NOW };
}

function deferred(): { promise: Promise<void>; resolve(): void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => (resolve = done));
    return { promise, resolve };
}

async function main(): Promise<void> {
    await test("a fresh token is returned without a refresh", async () => {
        const d = deps();
        const seeded = d.store.seed(row());
        const result = await getAccessToken(d, seeded);
        assert.equal(result.accessToken, "fake-access-deniz-0");
        assert.equal(result.connection.accessTokenEnc, seeded.accessTokenEnc);
    });

    await test("a token within 60 s of expiry is refreshed and the row re-encrypted", async () => {
        const d = deps();
        const seeded = d.store.seed(row({ accessTokenExpiresAt: new Date(NOW.getTime() + 30_000) }));
        const result = await getAccessToken(d, seeded);
        assert.match(result.accessToken, /^fake-access-deniz-\d+$/);
        assert.notEqual(result.accessToken, "fake-access-deniz-0");
        const stored = (await d.store.findByUserAndPlatform(42, "twitch"))!;
        assert.notEqual(stored.accessTokenEnc, seeded.accessTokenEnc);
        assert.equal(decryptToken(stored.accessTokenEnc!, keyring, aad), result.accessToken);
        assert.equal(stored.accessTokenExpiresAt!.getTime(), NOW.getTime() + 3_600_000);
        assert.equal(stored.status, "active");
    });

    await test("a failed refresh deletes the tokens, marks needs_reconnect and throws without the token", async () => {
        const d = deps();
        const seeded = d.store.seed(
            row({
                accessTokenExpiresAt: new Date(NOW.getTime() + 10_000),
                refreshTokenEnc: encryptToken("fake-refresh-expired", keyring, aad),
            })
        );
        await assert.rejects(
            () => getAccessToken(d, seeded),
            (error: unknown) => {
                assert.ok(error instanceof StreamerReconnectRequired);
                assert.equal(error.connectionId, seeded.id);
                assert.equal(error.reason, "refresh_failed");
                assert.ok(!error.message.includes("fake-refresh"));
                return true;
            }
        );
        const stored = (await d.store.findByUserAndPlatform(42, "twitch"))!;
        assert.equal(stored.status, "needs_reconnect");
        assert.equal(stored.statusReason, "refresh_failed");
        assert.equal(stored.accessTokenEnc, null);
        assert.equal(stored.refreshTokenEnc, null);
        assert.equal(stored.tokenKeyVersion, null);
    });

    await test("a network error during refresh leaves the row untouched and is rethrown", async () => {
        const fake = createFakePlatformClient("twitch");
        const flaky: StreamerPlatformClient = {
            ...fake,
            async refresh() {
                throw new StreamerPlatformError("twitch", "refresh", "network", null);
            },
        };
        const d = deps(flaky);
        const seeded = d.store.seed(row({ accessTokenExpiresAt: new Date(NOW.getTime() + 10_000) }));
        await assert.rejects(
            () => getAccessToken(d, seeded),
            (error: unknown) => error instanceof StreamerPlatformError && error.kind === "network"
        );
        const stored = (await d.store.findByUserAndPlatform(42, "twitch"))!;
        assert.equal(stored.status, "active");
        assert.equal(stored.accessTokenEnc, seeded.accessTokenEnc);
    });

    await test("callWithToken retries once after a 401 and records lastUsedAt", async () => {
        const d = deps();
        const seeded = d.store.seed(row());
        let calls = 0;
        const result = await callWithToken(d, seeded, async (accessToken) => {
            calls += 1;
            if (calls === 1) throw new StreamerPlatformError("twitch", "identity", "unauthorized", 401);
            return `ok:${accessToken}`;
        });
        assert.equal(calls, 2);
        assert.match(result, /^ok:fake-access-deniz-\d+$/);
        assert.notEqual(result, "ok:fake-access-deniz-0");
        const stored = (await d.store.findByUserAndPlatform(42, "twitch"))!;
        assert.equal(stored.lastUsedAt?.getTime(), NOW.getTime());
    });

    await test("callWithToken gives up after the second 401 with a reconnect error", async () => {
        const d = deps();
        const seeded = d.store.seed(row());
        await assert.rejects(
            () =>
                callWithToken(d, seeded, async () => {
                    throw new StreamerPlatformError("twitch", "identity", "unauthorized", 401);
                }),
            (error: unknown) => error instanceof StreamerReconnectRequired && error.reason === "refresh_failed"
        );
        assert.equal((await d.store.findByUserAndPlatform(42, "twitch"))!.status, "needs_reconnect");
    });

    await test("a ciphertext under an unknown key version takes the reconnect path", async () => {
        const d = deps();
        const seeded = d.store.seed(row({ accessTokenEnc: row().accessTokenEnc!.replace(/^v1\./, "v9."), tokenKeyVersion: 9 }));
        await assert.rejects(() => getAccessToken(d, seeded), StreamerReconnectRequired);
        assert.equal((await d.store.findByUserAndPlatform(42, "twitch"))!.status, "needs_reconnect");
    });

    await test("a row without tokens is a reconnect, not a crash", async () => {
        const d = deps();
        const seeded = d.store.seed(row({ accessTokenEnc: null, refreshTokenEnc: null, tokenKeyVersion: null, status: "needs_reconnect", statusReason: "dormant" }));
        await assert.rejects(() => getAccessToken(d, seeded), (error: unknown) => error instanceof StreamerReconnectRequired && error.reason === "dormant");
    });

    await test("revokeConnectionTokens revokes the refresh token at the platform and clears the row", async () => {
        const fake = createFakePlatformClient("twitch");
        const d = deps(fake);
        const seeded = d.store.seed(row());
        const result = await revokeConnectionTokens(d, seeded, "user_disconnected", "revoked");
        assert.deepEqual(result, { revokedAtPlatform: true });
        assert.deepEqual(fake.revoked, ["fake-access-deniz-0"], "the stored access token is revoked first (Twitch accepts access tokens)");
        const stored = (await d.store.findByUserAndPlatform(42, "twitch"))!;
        assert.equal(stored.status, "revoked");
        assert.equal(stored.statusReason, "user_disconnected");
        assert.equal(stored.revokedAt?.getTime(), NOW.getTime());
        assert.equal(stored.accessTokenEnc, null);
        assert.equal(stored.refreshTokenEnc, null);
    });

    await test("revokeConnectionTokens still clears the row when the platform call fails", async () => {
        const fake = createFakePlatformClient("twitch");
        const broken: StreamerPlatformClient = {
            ...fake,
            async revoke() {
                throw new StreamerPlatformError("twitch", "revoke", "network", null);
            },
        };
        const d = deps(broken);
        const seeded = d.store.seed(row());
        const result = await revokeConnectionTokens(d, seeded, "dormant", "needs_reconnect");
        assert.deepEqual(result, { revokedAtPlatform: false });
        const stored = (await d.store.findByUserAndPlatform(42, "twitch"))!;
        assert.equal(stored.status, "needs_reconnect");
        assert.equal(stored.statusReason, "dormant");
        assert.equal(stored.refreshTokenEnc, null);
    });

    await test("review 6: a refresh that returns no new refresh token re-encrypts the old one under the current key", async () => {
        const oldRing = loadTokenKeyring({ STREAMER_TOKEN_KEY: randomBytes(32).toString("base64"), STREAMER_TOKEN_KEY_VERSION: "1" });
        const rotated = loadTokenKeyring({ STREAMER_TOKEN_KEY: randomBytes(32).toString("base64"), STREAMER_TOKEN_KEY_VERSION: "2", STREAMER_TOKEN_KEY_PREVIOUS: oldRing.current.key.toString("base64"), STREAMER_TOKEN_KEY_PREVIOUS_VERSION: "1" });
        const fake = createFakePlatformClient("twitch", { now: () => NOW.getTime() });
        const noRotate: StreamerPlatformClient = { ...fake, async refresh(token) { const t = await fake.refresh(token); return { ...t, refreshToken: null }; } };
        const store = createMemoryStreamerConnectionStore();
        const seeded = store.seed(row({ accessTokenEnc: encryptToken("fake-access-deniz-0", oldRing, aad), refreshTokenEnc: encryptToken("fake-refresh-deniz", oldRing, aad), accessTokenExpiresAt: new Date(NOW.getTime() + 10_000) }));
        await getAccessToken({ store, client: noRotate, keyring: rotated, now: () => NOW }, seeded);
        const stored = (await store.findByUserAndPlatform(42, "twitch"))!;
        assert.match(stored.refreshTokenEnc!, /^v2\./);
        assert.equal(decryptToken(stored.refreshTokenEnc!, rotated, aad), "fake-refresh-deniz");
        assert.equal(stored.tokenKeyVersion, 2);
    });

    await test("review 7: a 401 from the refresh endpoint (bad client secret) leaves the row intact", async () => {
        const fake = createFakePlatformClient("twitch");
        const badClient: StreamerPlatformClient = { ...fake, async refresh() { throw new StreamerPlatformError("twitch", "refresh", "unauthorized", 401); } };
        const d = deps(badClient);
        const seeded = d.store.seed(row({ accessTokenExpiresAt: new Date(NOW.getTime() + 10_000) }));
        await assert.rejects(() => getAccessToken(d, seeded), (error: unknown) => error instanceof StreamerPlatformError && error.kind === "unauthorized");
        const stored = (await d.store.findByUserAndPlatform(42, "twitch"))!;
        assert.equal(stored.status, "active");
        assert.equal(stored.refreshTokenEnc, seeded.refreshTokenEnc);
    });

    await test("review 2: a refresh that finishes after a disconnect does not resurrect tokens and revokes the new ones", async () => {
        const fake = createFakePlatformClient("twitch", { now: () => NOW.getTime() });
        const d = deps(fake);
        const seeded = d.store.seed(row({ accessTokenExpiresAt: new Date(NOW.getTime() + 10_000) }));
        const slow: StreamerPlatformClient = { ...fake, async refresh(token) { await d.store.markRevoked(seeded.id, "user_disconnected", NOW); return fake.refresh(token); } };
        await assert.rejects(() => getAccessToken({ ...d, client: slow }, seeded), StreamerReconnectRequired);
        const stored = (await d.store.findByUserAndPlatform(42, "twitch"))!;
        assert.equal(stored.status, "revoked");
        assert.equal(stored.accessTokenEnc, null);
        assert.equal(stored.refreshTokenEnc, null);
        assert.ok(fake.revoked.some((t) => t.startsWith("fake-refresh-deniz")), "the freshly issued tokens were revoked at the platform");
    });

    await test("concurrent refreshes of one connection share a single platform refresh; a later stale caller loses the compare-and-set and gets the stored token", async () => {
        const fake = createFakePlatformClient("twitch", { now: () => NOW.getTime() });
        let refreshes = 0;
        const gate = deferred();
        const slow: StreamerPlatformClient = {
            ...fake,
            async refresh(token) {
                refreshes += 1;
                await gate.promise;
                return fake.refresh(token);
            },
        };
        const d = deps(slow);
        const seeded = d.store.seed(row({ accessTokenExpiresAt: new Date(NOW.getTime() + 10_000) }));
        const first = getAccessToken(d, seeded);
        const second = getAccessToken(d, seeded);
        const third = callWithToken(d, seeded, async (accessToken) => accessToken);
        gate.resolve();
        const [a, b, c] = await Promise.all([first, second, third]);
        assert.equal(refreshes, 1, "one platform refresh for three concurrent callers");
        assert.match(a.accessToken, /^fake-access-deniz-\d+$/);
        assert.equal(b.accessToken, a.accessToken);
        assert.equal(c, a.accessToken);
        const stored = (await d.store.findByUserAndPlatform(42, "twitch"))!;
        assert.equal(stored.status, "active");
        assert.equal(decryptToken(stored.accessTokenEnc!, keyring, aad), a.accessToken);
        // The flight is over: a caller still holding the old row refreshes again, loses the
        // conditional write (the row moved on) and gets the stored token; nothing is revoked.
        const late = await getAccessToken(d, seeded);
        assert.equal(refreshes, 2);
        assert.equal(late.accessToken, a.accessToken);
        assert.equal(late.connection.refreshTokenEnc, stored.refreshTokenEnc);
        assert.equal((await d.store.findByUserAndPlatform(42, "twitch"))!.status, "active");
        assert.deepEqual(fake.revoked, []);
    });

    await test("a refresh that loses the compare-and-set to newer tokens returns the winner's token; the row stays active, nothing is revoked", async () => {
        const fake = createFakePlatformClient("twitch", { now: () => NOW.getTime() });
        const d = deps(fake);
        const seeded = d.store.seed(row({ accessTokenExpiresAt: new Date(NOW.getTime() + 10_000) }));
        const winner = { accessTokenEnc: encryptToken("winner-access", keyring, aad), refreshTokenEnc: encryptToken("winner-refresh", keyring, aad) };
        const racing: StreamerPlatformClient = {
            ...fake,
            async refresh(token) {
                const tokens = await fake.refresh(token);
                // Another process refreshed the same connection first and stored its tokens.
                const won = await d.store.updateTokens(seeded.id, {
                    ...winner,
                    tokenKeyVersion: 1,
                    accessTokenExpiresAt: new Date(NOW.getTime() + 3_600_000),
                    now: NOW,
                    previousRefreshTokenEnc: seeded.refreshTokenEnc,
                });
                assert.ok(won, "the other writer wins the compare-and-set");
                return tokens;
            },
        };
        const result = await getAccessToken({ ...d, client: racing }, seeded);
        assert.equal(result.accessToken, "winner-access");
        const stored = (await d.store.findByUserAndPlatform(42, "twitch"))!;
        assert.equal(stored.status, "active");
        assert.equal(stored.statusReason, null);
        assert.equal(stored.accessTokenEnc, winner.accessTokenEnc, "the loser never overwrites the winner");
        assert.equal(stored.refreshTokenEnc, winner.refreshTokenEnc);
        assert.deepEqual(result.connection, stored);
        assert.deepEqual(fake.revoked, [], "revoking the loser's tokens could revoke the grant the winner's share");
    });

    await test("invalid_grant for a refresh token the row no longer holds is a lost race: the row's newer token is returned, never needs_reconnect", async () => {
        const d = deps();
        // The row already holds newer tokens; the caller's snapshot still has a refresh token
        // that was rotated away (the platform answers invalid_grant for it).
        const current = d.store.seed(row({ accessTokenEnc: encryptToken("fake-access-deniz-7", keyring, aad) }));
        const stale: StreamerConnectionRecord = {
            ...current,
            accessTokenEnc: encryptToken("fake-access-deniz-6", keyring, aad),
            refreshTokenEnc: encryptToken("fake-refresh-expired", keyring, aad),
            accessTokenExpiresAt: new Date(NOW.getTime() + 10_000),
        };
        const result = await getAccessToken(d, stale);
        assert.equal(result.accessToken, "fake-access-deniz-7");
        const stored = (await d.store.findByUserAndPlatform(42, "twitch"))!;
        assert.equal(stored.status, "active");
        assert.equal(stored.refreshTokenEnc, current.refreshTokenEnc);
        // The same answer for the refresh token the row still holds is a dead grant.
        const dead = deps();
        const held = dead.store.seed(row({ refreshTokenEnc: encryptToken("fake-refresh-expired", keyring, aad), accessTokenExpiresAt: new Date(NOW.getTime() + 10_000) }));
        await assert.rejects(() => getAccessToken(dead, held), StreamerReconnectRequired);
        assert.equal((await dead.store.findByUserAndPlatform(42, "twitch"))!.status, "needs_reconnect");
    });

    await test("memory store: updateTokens writes only over the refresh token it replaces, and only on an active row", async () => {
        const store = createMemoryStreamerConnectionStore();
        const seeded = store.seed(row());
        const input = { accessTokenEnc: "v1.n.e.w", refreshTokenEnc: "v1.n.e.r", tokenKeyVersion: 1, accessTokenExpiresAt: null, now: NOW };
        assert.equal(await store.updateTokens(seeded.id, { ...input, previousRefreshTokenEnc: "v1.o.t.h" }), null, "another refresh token: no write");
        assert.equal(await store.updateTokens(seeded.id, { ...input, previousRefreshTokenEnc: null }), null, "null is not the stored token");
        assert.equal(store.rows[0].accessTokenEnc, seeded.accessTokenEnc, "the row is unchanged");
        const written = await store.updateTokens(seeded.id, { ...input, previousRefreshTokenEnc: seeded.refreshTokenEnc });
        assert.equal(written?.accessTokenEnc, "v1.n.e.w");
        assert.equal(written?.refreshTokenEnc, "v1.n.e.r");
        await store.markNeedsReconnect(seeded.id, "refresh_failed", NOW);
        assert.equal(await store.updateTokens(seeded.id, { ...input, previousRefreshTokenEnc: null }), null, "a row that is not active is never written");
    });

    await test("review 2: markNeedsReconnect never downgrades a revoked row", async () => {
        const store = createMemoryStreamerConnectionStore();
        const seeded = store.seed(row({ status: "revoked", statusReason: "user_disconnected", accessTokenEnc: null, refreshTokenEnc: null, tokenKeyVersion: null }));
        await store.markNeedsReconnect(seeded.id, "refresh_failed", NOW);
        assert.equal(store.rows[0].status, "revoked");
        assert.equal(store.rows[0].statusReason, "user_disconnected");
    });

    await test("review 2.3: when neither stored token can be revoked, a refreshed access token is revoked instead", async () => {
        const fake = createFakePlatformClient("twitch", { now: () => NOW.getTime() });
        let attempts = 0;
        const picky: StreamerPlatformClient = {
            ...fake,
            async revoke(token, hint) {
                attempts += 1;
                // Twitch-like: only a live access token is accepted; the stored one is stale.
                if (hint !== "access_token" || token === "fake-access-deniz-0") throw new StreamerPlatformError("twitch", "revoke", "unexpected", 400);
                return fake.revoke(token, hint);
            },
        };
        const d = deps(picky);
        const seeded = d.store.seed(row());
        const result = await revokeConnectionTokens(d, seeded, "user_disconnected", "revoked");
        assert.deepEqual(result, { revokedAtPlatform: true });
        assert.ok(attempts >= 3, "stored access, stored refresh, then the refreshed access token");
        assert.equal(fake.revoked.length, 1);
        assert.match(fake.revoked[0], /^fake-access-deniz-\d+$/);
        assert.equal((await d.store.findByUserAndPlatform(42, "twitch"))!.status, "revoked");
    });

    await test("review 2 minor 3: relinking resets lastUsedAt so a dormant row is not revoked again next night", async () => {
        const store = createMemoryStreamerConnectionStore();
        const identity = { platformUserId: "fake-deniz", login: "deniz", displayName: "Deniz", avatarUrl: null, channelUrl: "https://twitch.tv/deniz" };
        const first = await store.upsertLinked({ userId: 42, platform: "twitch", identity, scopes: [], accessTokenEnc: "a", refreshTokenEnc: "r", tokenKeyVersion: 1, accessTokenExpiresAt: null, now: NOW });
        await store.touchUsed(first.record.id, new Date(NOW.getTime() - 200 * 86_400_000));
        await store.markNeedsReconnect(first.record.id, "dormant", NOW);
        const second = await store.upsertLinked({ userId: 42, platform: "twitch", identity, scopes: [], accessTokenEnc: "a2", refreshTokenEnc: "r2", tokenKeyVersion: 1, accessTokenExpiresAt: null, now: NOW });
        assert.equal(second.record.lastUsedAt, null);
        assert.equal((await store.findDormant(new Date(NOW.getTime() - 90 * 86_400_000), 10)).length, 0);
    });

    await test("memory store: upsertLinked relinks the same user/platform row and findDormant filters by status and age", async () => {
        const store = createMemoryStreamerConnectionStore();
        const identity = { platformUserId: "fake-deniz", login: "deniz", displayName: "Deniz", avatarUrl: null, channelUrl: "https://twitch.tv/deniz" };
        const first = await store.upsertLinked({ userId: 42, platform: "twitch", identity, scopes: [], accessTokenEnc: "a", refreshTokenEnc: "r", tokenKeyVersion: 1, accessTokenExpiresAt: null, now: NOW });
        assert.equal(first.relinked, false);
        await store.markNeedsReconnect(first.record.id, "refresh_failed", NOW);
        const second = await store.upsertLinked({ userId: 42, platform: "twitch", identity: { ...identity, displayName: "Deniz!" }, scopes: [], accessTokenEnc: "a2", refreshTokenEnc: "r2", tokenKeyVersion: 1, accessTokenExpiresAt: null, now: NOW });
        assert.equal(second.relinked, true);
        assert.equal(second.record.id, first.record.id);
        assert.equal(second.record.status, "active");
        assert.equal(second.record.statusReason, null);
        assert.equal(second.record.displayName, "Deniz!");
        store.seed(row({ id: "22222222-2222-4222-8222-222222222222", userId: 7, platformUserId: "fake-old", lastUsedAt: new Date(NOW.getTime() - 91 * 86_400_000) }));
        store.seed(row({ id: "33333333-3333-4333-8333-333333333333", userId: 8, platformUserId: "fake-recent", lastUsedAt: new Date(NOW.getTime() - 10 * 86_400_000) }));
        store.seed(row({ id: "44444444-4444-4444-8444-444444444444", userId: 9, platformUserId: "fake-never", lastUsedAt: null, connectedAt: new Date(NOW.getTime() - 120 * 86_400_000) }));
        const cutoff = new Date(NOW.getTime() - 90 * 86_400_000);
        const dormant = await store.findDormant(cutoff, 10);
        assert.deepEqual(dormant.map((entry) => entry.platformUserId).sort(), ["fake-never", "fake-old"]);
        assert.equal((await store.findDormant(cutoff, 1)).length, 1);
    });

    console.log(`${count} checks passed.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
