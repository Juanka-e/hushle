import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
    connectionAad,
    createFakePlatformClient,
    createMemoryStreamerConnectionStore,
    encryptToken,
    loadTokenKeyring,
    StreamerPlatformError,
    type FakePlatformClient,
    type StreamerConnectionRecord,
    type StreamerPlatform,
    type StreamerPlatformClient,
} from "@hushle/platform-streamer";
import { getStreamerHygieneConfig } from "../apps/jobs/src/config";
import { runStreamerConnectionHygiene, type StreamerHygieneAuditWriter } from "../apps/jobs/src/streamer-connection-hygiene";

// Daily hygiene: a connection nobody used for 90 days loses its tokens (spec karar 4).

let count = 0;
async function test(name: string, run: () => Promise<void> | void): Promise<void> {
    await run();
    count += 1;
    console.log(`PASS ${name}`);
}

const NOW = new Date("2026-11-05T03:40:00Z");
const DAY = 86_400_000;
const keyring = loadTokenKeyring({ STREAMER_TOKEN_KEY: randomBytes(32).toString("base64") });
const config = getStreamerHygieneConfig({});

function row(id: string, platform: StreamerPlatform, login: string, overrides: Partial<StreamerConnectionRecord> = {}): StreamerConnectionRecord {
    const aad = connectionAad(platform, `fake-${login}`);
    return {
        id,
        userId: Number(id.slice(-2)),
        platform,
        platformUserId: `fake-${login}`,
        login,
        displayName: login,
        avatarUrl: null,
        channelUrl: `https://${platform}.tv/${login}`,
        scopes: "",
        accessTokenEnc: encryptToken(`fake-access-${login}-0`, keyring, aad),
        refreshTokenEnc: encryptToken(`fake-refresh-${login}`, keyring, aad),
        tokenKeyVersion: 1,
        accessTokenExpiresAt: new Date(NOW.getTime() + 3_600_000),
        status: "active",
        statusReason: null,
        lastValidatedAt: null,
        lastUsedAt: null,
        connectedAt: new Date(NOW.getTime() - 200 * DAY),
        revokedAt: null,
        createdAt: new Date(NOW.getTime() - 200 * DAY),
        updatedAt: new Date(NOW.getTime() - 200 * DAY),
        ...overrides,
    };
}

function setup(clientOverride?: (fake: FakePlatformClient) => StreamerPlatformClient) {
    const store = createMemoryStreamerConnectionStore();
    const fakes = { twitch: createFakePlatformClient("twitch"), kick: createFakePlatformClient("kick") };
    const audits: Array<{ action: string; resourceId: string | null; metadata: Record<string, unknown> | null }> = [];
    const audit: StreamerHygieneAuditWriter = async (entry) => {
        audits.push({ action: entry.action, resourceId: entry.resourceId, metadata: entry.metadata });
    };
    const clients = (platform: StreamerPlatform) => (clientOverride ? clientOverride(fakes[platform]) : fakes[platform]);
    return { store, fakes, audits, run: (dryRun: boolean, cfg = config) => runStreamerConnectionHygiene({ dryRun, config: cfg, store, clients, keyring, audit, now: () => NOW }) };
}

async function main(): Promise<void> {
    await test("config defaults and bounds", () => {
        assert.deepEqual(config, { dormantDays: 90, batchSize: 100, leaseTtlMs: 5 * 60_000 });
        assert.equal(getStreamerHygieneConfig({ STREAMER_CONNECTION_DORMANT_DAYS: "30" }).dormantDays, 30);
        assert.throws(() => getStreamerHygieneConfig({ STREAMER_CONNECTION_DORMANT_DAYS: "0" }));
        assert.throws(() => getStreamerHygieneConfig({ STREAMER_CONNECTION_DORMANT_DAYS: "400" }));
        assert.throws(() => getStreamerHygieneConfig({ STREAMER_HYGIENE_BATCH_SIZE: "0" }));
    });

    await test("a connection unused for 91 days is revoked at the platform and marked needs_reconnect/dormant", async () => {
        const h = setup();
        h.store.seed(row("00000000-0000-4000-8000-000000000011", "twitch", "old", { lastUsedAt: new Date(NOW.getTime() - 91 * DAY) }));
        const result = await h.run(false);
        assert.equal(result.dryRun, false);
        assert.equal(result.cutoff, new Date(NOW.getTime() - 90 * DAY).toISOString());
        assert.equal(result.candidateCount, 1);
        assert.equal(result.revokedCount, 1);
        assert.equal(result.platformRevokeFailures, 0);
        assert.equal(result.hasMore, false);
        assert.deepEqual(h.fakes.twitch.revoked, ["fake-refresh-old"]);
        const stored = h.store.rows[0];
        assert.equal(stored.status, "needs_reconnect");
        assert.equal(stored.statusReason, "dormant");
        assert.equal(stored.accessTokenEnc, null);
        assert.equal(stored.refreshTokenEnc, null);
        assert.equal(stored.tokenKeyVersion, null);
        assert.deepEqual(h.audits, [{ action: "streamer.connection.dormant_revoked", resourceId: stored.id, metadata: { platform: "twitch", reason: "dormant" } }]);
    });

    await test("recent, never-used-but-fresh and already-reconnect rows are left alone", async () => {
        const h = setup();
        h.store.seed(row("00000000-0000-4000-8000-000000000021", "twitch", "recent", { lastUsedAt: new Date(NOW.getTime() - 89 * DAY) }));
        h.store.seed(row("00000000-0000-4000-8000-000000000022", "kick", "fresh", { connectedAt: new Date(NOW.getTime() - 5 * DAY) }));
        h.store.seed(row("00000000-0000-4000-8000-000000000023", "kick", "gone", { status: "needs_reconnect", statusReason: "refresh_failed", accessTokenEnc: null, refreshTokenEnc: null, tokenKeyVersion: null }));
        h.store.seed(row("00000000-0000-4000-8000-000000000024", "twitch", "left", { status: "revoked", statusReason: "user_disconnected", accessTokenEnc: null, refreshTokenEnc: null, tokenKeyVersion: null }));
        const result = await h.run(false);
        assert.equal(result.candidateCount, 0);
        assert.equal(result.revokedCount, 0);
        assert.deepEqual(h.store.rows.map((r) => r.status), ["active", "active", "needs_reconnect", "revoked"]);
        assert.equal(h.audits.length, 0);
    });

    await test("a never-used connection older than the cutoff counts as dormant", async () => {
        const h = setup();
        h.store.seed(row("00000000-0000-4000-8000-000000000031", "kick", "silent"));
        const result = await h.run(false);
        assert.equal(result.revokedCount, 1);
        assert.deepEqual(h.fakes.kick.revoked, ["fake-refresh-silent"]);
    });

    await test("a failing platform revoke still clears the tokens and is counted", async () => {
        const h = setup((fake) => ({
            ...fake,
            async revoke() {
                throw new StreamerPlatformError(fake.platform, "revoke", "network", null);
            },
        }));
        h.store.seed(row("00000000-0000-4000-8000-000000000041", "twitch", "flaky", { lastUsedAt: new Date(NOW.getTime() - 120 * DAY) }));
        const result = await h.run(false);
        assert.equal(result.revokedCount, 1);
        assert.equal(result.platformRevokeFailures, 1);
        assert.equal(h.store.rows[0].status, "needs_reconnect");
        assert.equal(h.store.rows[0].refreshTokenEnc, null);
        assert.equal(h.audits.length, 1);
    });

    await test("dry run only counts", async () => {
        const h = setup();
        h.store.seed(row("00000000-0000-4000-8000-000000000051", "twitch", "old", { lastUsedAt: new Date(NOW.getTime() - 91 * DAY) }));
        const result = await h.run(true);
        assert.equal(result.dryRun, true);
        assert.equal(result.candidateCount, 1);
        assert.equal(result.revokedCount, 0);
        assert.equal(h.store.rows[0].status, "active");
        assert.ok(h.store.rows[0].refreshTokenEnc);
        assert.equal(h.fakes.twitch.revoked.length, 0);
        assert.equal(h.audits.length, 0);
    });

    await test("hasMore is true when the batch is full", async () => {
        const h = setup();
        for (let i = 0; i < 3; i++) {
            h.store.seed(row(`00000000-0000-4000-8000-0000000000${60 + i}`, "twitch", `old${i}`, { lastUsedAt: new Date(NOW.getTime() - (100 + i) * DAY) }));
        }
        const result = await h.run(false, { ...config, batchSize: 2 });
        assert.equal(result.candidateCount, 2);
        assert.equal(result.revokedCount, 2);
        assert.equal(result.hasMore, true);
        assert.equal(h.store.rows.filter((r) => r.status === "active").length, 1);
    });

    console.log(`${count} checks passed.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
