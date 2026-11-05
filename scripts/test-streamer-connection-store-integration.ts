import assert from "node:assert/strict";

// Prisma-backed streamer connection store against a throwaway database.
// Runs only when STREAMER_INTEGRATION_DATABASE_URL names a test database (never hushle_dev).

const integrationUrl = process.env.STREAMER_INTEGRATION_DATABASE_URL;
if (!integrationUrl) {
    console.log("SKIP streamer connection store integration (STREAMER_INTEGRATION_DATABASE_URL not set)");
    process.exit(0);
}
if (/hushle_dev/.test(integrationUrl)) {
    throw new Error("refusing to run integration tests against hushle_dev");
}
process.env.DATABASE_URL = integrationUrl;

const NOW = new Date("2026-11-05T12:00:00Z");
const stamp = Date.now().toString(36);
const identity = (login: string) => ({
    platformUserId: `it-${stamp}-${login}`,
    login,
    displayName: login.toUpperCase(),
    avatarUrl: null,
    channelUrl: `https://twitch.tv/${login}`,
});

type Prisma = Awaited<ReturnType<() => Promise<typeof import("@hushle/platform-db")>>>["prisma"];

async function createUser(prisma: Prisma, suffix: string): Promise<number> {
    const user = await prisma.user.create({
        data: {
            email: `streamer-it-${stamp}-${suffix}@example.com`,
            normalizedEmail: `streamer-it-${stamp}-${suffix}@example.com`,
            username: `sit${stamp}${suffix}`.slice(0, 20),
            password: null,
        },
        select: { id: true },
    });
    return user.id;
}

async function main(): Promise<void> {
    const { prisma, getUniqueConstraintTarget } = await import("@hushle/platform-db");
    const { prismaStreamerConnectionStore: store } = await import("@hushle/platform-streamer");
    const userIds: number[] = [];
    try {
        const first = await createUser(prisma, "a");
        const second = await createUser(prisma, "b");
        userIds.push(first, second);

        const linked = await store.upsertLinked({
            userId: first, platform: "twitch", identity: identity("alpha"), scopes: [],
            accessTokenEnc: "v1.a.b.c", refreshTokenEnc: "v1.d.e.f", tokenKeyVersion: 1, accessTokenExpiresAt: new Date(NOW.getTime() + 3_600_000), now: NOW,
        });
        assert.equal(linked.relinked, false);
        assert.equal(linked.record.status, "active");
        console.log("PASS first link creates an active row");

        await store.markNeedsReconnect(linked.record.id, "refresh_failed", NOW);
        const relinked = await store.upsertLinked({
            userId: first, platform: "twitch", identity: { ...identity("alpha"), displayName: "Alpha!" }, scopes: ["user:read:chat"],
            accessTokenEnc: "v1.a2.b2.c2", refreshTokenEnc: "v1.d2.e2.f2", tokenKeyVersion: 1, accessTokenExpiresAt: null, now: NOW,
        });
        assert.equal(relinked.relinked, true);
        assert.equal(relinked.record.id, linked.record.id);
        assert.equal(relinked.record.status, "active");
        assert.equal(relinked.record.statusReason, null);
        assert.equal(relinked.record.revokedAt, null);
        assert.equal(relinked.record.displayName, "Alpha!");
        assert.equal(relinked.record.scopes, "user:read:chat");
        console.log("PASS relink reuses the row and clears the reconnect state");

        await assert.rejects(
            () => store.upsertLinked({
                userId: second, platform: "twitch", identity: identity("alpha"), scopes: [],
                accessTokenEnc: "x", refreshTokenEnc: null, tokenKeyVersion: 1, accessTokenExpiresAt: null, now: NOW,
            }),
            (error: unknown) => getUniqueConstraintTarget(error) !== null
        );
        console.log("PASS the same platform account cannot be linked to a second user (P2002)");

        const found = await store.findByPlatformUser("twitch", identity("alpha").platformUserId);
        assert.equal(found?.userId, first);
        assert.equal((await store.findByUserAndPlatform(second, "twitch")), null);
        console.log("PASS lookups by platform user and by user/platform");

        const old = await store.upsertLinked({
            userId: second, platform: "kick", identity: { ...identity("beta"), channelUrl: "https://kick.com/beta" }, scopes: ["user:read", "channel:read"],
            accessTokenEnc: "v1.k.k.k", refreshTokenEnc: "v1.k.k.r", tokenKeyVersion: 1, accessTokenExpiresAt: null, now: new Date(NOW.getTime() - 120 * 86_400_000),
        });
        await store.touchUsed(linked.record.id, new Date(NOW.getTime() - 10 * 86_400_000));
        const cutoff = new Date(NOW.getTime() - 90 * 86_400_000);
        const dormant = await store.findDormant(cutoff, 50);
        const ids = dormant.map((row) => row.id);
        assert.ok(ids.includes(old.record.id), "never-used old connection is dormant");
        assert.ok(!ids.includes(linked.record.id), "recently used connection is not dormant");
        await store.markRevoked(old.record.id, "dormant", NOW);
        assert.ok(!(await store.findDormant(cutoff, 50)).some((row) => row.id === old.record.id), "revoked rows are never dormant candidates");
        const revoked = await store.findByUserAndPlatform(second, "kick");
        assert.equal(revoked?.status, "revoked");
        assert.equal(revoked?.accessTokenEnc, null);
        assert.equal(revoked?.refreshTokenEnc, null);
        assert.equal(revoked?.tokenKeyVersion, null);
        console.log("PASS dormant selection and revoke clear the token columns");

        await prisma.user.delete({ where: { id: second } });
        assert.equal(await store.findByPlatformUser("kick", identity("beta").platformUserId), null);
        userIds.splice(userIds.indexOf(second), 1);
        console.log("PASS deleting the user cascades to the connection");
        console.log("6 checks passed (integration).");
    } finally {
        if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
