import assert from "node:assert/strict";

// Prisma-backed stream session store (and the runtime/service over it) against a throwaway
// database. Runs only when STREAMER_INTEGRATION_DATABASE_URL names a test database (never hushle_dev).

const integrationUrl = process.env.STREAMER_INTEGRATION_DATABASE_URL;
if (!integrationUrl) {
    console.log("SKIP streamer session store integration (STREAMER_INTEGRATION_DATABASE_URL not set)");
    process.exit(0);
}
if (/hushle_dev/.test(integrationUrl)) {
    throw new Error("refusing to run integration tests against hushle_dev");
}
process.env.DATABASE_URL = integrationUrl;

const NOW = new Date("2026-11-05T12:00:00Z");
const stamp = Date.now().toString(36);

const INPUT = {
    platform: "twitch" as const,
    language: "tr" as const,
    categoryIds: [3, 7],
    difficulties: [1, 2] as Array<1 | 2 | 3>,
    duration: 60,
    tolerance: "normal" as const,
    theme: "studyo" as const,
    camera: "br" as const,
    cameraSize: "m" as const,
    clock: "ring" as const,
    cardBack: { collection: 4 },
    showCardName: true,
};

type Prisma = Awaited<ReturnType<() => Promise<typeof import("@hushle/platform-db")>>>["prisma"];

async function createUser(prisma: Prisma, suffix: string): Promise<number> {
    const user = await prisma.user.create({
        data: {
            email: `stream-session-it-${stamp}-${suffix}@example.com`,
            normalizedEmail: `stream-session-it-${stamp}-${suffix}@example.com`,
            username: `ssit${stamp}${suffix}`.slice(0, 20),
            password: null,
        },
        select: { id: true },
    });
    return user.id;
}

function hash(seed: string): string {
    return `${stamp}${seed}`.padEnd(64, "0").slice(0, 64);
}

async function main(): Promise<void> {
    const { prisma, getUniqueConstraintTarget } = await import("@hushle/platform-db");
    const { prismaStreamerConnectionStore } = await import("@hushle/platform-streamer");
    const { prismaStreamSessionStore: store } = await import("../apps/web/src/lib/streamer/session-store");
    const { createStreamerSessionRuntime } = await import("../apps/web/src/lib/streamer/session-runtime");
    const service = await import("../apps/web/src/lib/streamer/session-service");
    const { hashViewKey } = await import("../apps/web/src/lib/streamer/view-key");
    const sessionDeps = await import("../apps/web/src/lib/streamer/session-deps");
    const userIds: number[] = [];
    let checks = 0;
    const pass = (name: string) => {
        checks += 1;
        console.log(`PASS ${name}`);
    };
    try {
        const first = await createUser(prisma, "a");
        const second = await createUser(prisma, "b");
        userIds.push(first, second);
        const { record: link } = await prismaStreamerConnectionStore.upsertLinked({
            userId: first,
            platform: "twitch",
            identity: { platformUserId: `ssit-${stamp}`, login: `ssit${stamp}`, displayName: "SSIT", avatarUrl: null, channelUrl: `https://twitch.tv/ssit${stamp}` },
            scopes: [],
            accessTokenEnc: "v1.a.b.c",
            refreshTokenEnc: null,
            tokenKeyVersion: 1,
            accessTokenExpiresAt: null,
            now: NOW,
        });

        // ------------------------------------------------------------ create / find

        const created = await store.create({ userId: first, connectionId: link.id, platform: "twitch", settings: INPUT, viewKeyHash: hash("a"), startedAt: NOW });
        assert.match(created.id, /^[0-9a-f-]{36}$/);
        assert.equal(created.status, "active");
        assert.equal(created.roundCount, 0);
        assert.equal(created.summary, null);
        assert.equal(created.endedAt, null);
        assert.equal(created.startedAt.getTime(), NOW.getTime());
        assert.deepEqual(created.settings, INPUT);
        assert.equal((await store.findById(created.id))?.connectionId, link.id);
        assert.equal((await store.findActiveByUser(first))?.id, created.id);
        assert.equal(await store.findActiveByUser(second), null);
        assert.equal((await store.findByViewKeyHash(hash("a")))?.id, created.id);
        pass("create stores the row; find by id, active user and view key hash");

        await assert.rejects(
            () => store.create({ userId: second, connectionId: null, platform: "kick", settings: INPUT, viewKeyHash: hash("a"), startedAt: NOW }),
            (error: unknown) => getUniqueConstraintTarget(error) !== null,
        );
        pass("a view key hash is unique (P2002)");

        const rotated = await store.update(created.id, { viewKeyHash: hash("r") });
        assert.equal(rotated.viewKeyHash, hash("r"));
        assert.equal(await store.findByViewKeyHash(hash("a")), null);
        assert.equal((await store.findByViewKeyHash(hash("r")))?.id, created.id);
        pass("rotating the hash makes the old lookup null");

        // ------------------------------------------------------------ round results

        await store.addRoundResult({
            sessionId: created.id, round: 1, wordId: null, outcome: "solved", winnerPlatformUserId: "u".repeat(80), winnerName: "N".repeat(150),
            solveMs: 12_000, startedAt: NOW, endedAt: new Date(NOW.getTime() + 12_000),
        });
        await store.addRoundResult({
            sessionId: created.id, round: 2, wordId: null, outcome: "timeout", winnerPlatformUserId: null, winnerName: null,
            solveMs: null, startedAt: new Date(NOW.getTime() + 13_000), endedAt: new Date(NOW.getTime() + 73_000),
        });
        await assert.rejects(
            () => store.addRoundResult({
                sessionId: created.id, round: 2, wordId: null, outcome: "passed", winnerPlatformUserId: null, winnerName: null,
                solveMs: null, startedAt: NOW, endedAt: NOW,
            }),
            (error: unknown) => getUniqueConstraintTarget(error) !== null,
        );
        const results = await prisma.streamRoundResult.findMany({ where: { sessionId: created.id }, orderBy: { round: "asc" } });
        assert.deepEqual(results.map((row) => [row.round, row.outcome, row.solveMs]), [[1, "solved", 12_000], [2, "timeout", null]]);
        assert.equal(results[0].winnerPlatformUserId?.length, 64);
        assert.equal(results[0].winnerName?.length, 100);
        assert.equal(results[1].endedAt.getTime(), NOW.getTime() + 73_000);
        pass("round results: one per (session, round), winner columns clipped to their widths");

        const summary = { scores: [{ name: "Luna", points: 1, rank: 1, tied: false }], participants: 2, rounds: 2 };
        const updated = await store.update(created.id, { roundCount: 2, summary, settings: { ...INPUT, theme: "sakura" } });
        assert.equal(updated.roundCount, 2);
        assert.deepEqual(updated.summary, summary);
        assert.equal((updated.settings as { theme: string }).theme, "sakura");
        assert.equal((await store.update(created.id, { summary: null })).summary, null);
        pass("update writes counts, JSON summary (and clears it) and settings");

        // ------------------------------------------------------------ recent / interrupt

        const later = await store.create({ userId: first, connectionId: null, platform: "twitch", settings: INPUT, viewKeyHash: hash("b"), startedAt: new Date(NOW.getTime() + 60_000) });
        await store.update(later.id, { status: "ended", endedAt: new Date(NOW.getTime() + 120_000) });
        const recent = await store.listRecent(first, 5);
        assert.deepEqual(recent.map((row) => row.id), [later.id, created.id]);
        assert.deepEqual((await store.listRecent(first, 1)).map((row) => row.id), [later.id]);
        pass("listRecent is newest first and honours the limit");

        const interruptedAt = new Date(NOW.getTime() + 200_000);
        assert.ok((await store.markInterruptedAll(interruptedAt)) >= 1);
        const interrupted = await store.findById(created.id);
        assert.equal(interrupted?.status, "interrupted");
        assert.equal(interrupted?.endedAt?.getTime(), interruptedAt.getTime());
        const untouched = await store.findById(later.id);
        assert.equal(untouched?.status, "ended");
        assert.equal(untouched?.endedAt?.getTime(), NOW.getTime() + 120_000);
        assert.equal(await store.findActiveByUser(first), null);
        pass("markInterruptedAll flips active rows only");

        // ------------------------------------------------------------ runtime + service over Prisma

        // word_id carries no foreign key: any id is a valid record of the drawn word.
        const deck = [{ wordId: 900_001, target: "MANDALİNA", taboos: ["Portakal"] }, { wordId: 900_002, target: "Buzdolabı", taboos: ["Soğuk"] }];
        let drawn = 0;
        const cleared: string[] = [];
        const runtime = createStreamerSessionRuntime({
            store,
            wordSource: { next: async () => deck[drawn++ % deck.length], clear: (key) => cleared.push(key) },
            tickMs: 60_000,
        });
        const deps = { sessions: store, connections: prismaStreamerConnectionStore, runtime };
        try {
            const { session, viewKey } = await service.createSession(deps, { userId: first, settings: INPUT });
            assert.equal((await store.findByViewKeyHash(hashViewKey(viewKey)))?.id, session.id);
            await runtime.start(session.id);
            assert.equal(
                await runtime.guess(session.id, { platform: "fake", platformUserId: "luna", name: "Luna", text: "mandalina", messageId: "m1", sentAt: Date.now() }),
                "correct",
            );
            await runtime.next(session.id);
            await runtime.pass(session.id);
            const ended = await service.endCurrent(deps, first);
            const row = await store.findById(session.id);
            assert.equal(row?.status, "ended");
            assert.equal(row?.roundCount, 2);
            assert.deepEqual(row?.summary, ended.summary);
            assert.deepEqual(ended.summary, { scores: [{ name: "Luna", points: 1, rank: 1, tied: false }], participants: 1, rounds: 2 });
            const sessionResults = await prisma.streamRoundResult.findMany({ where: { sessionId: session.id }, orderBy: { round: "asc" } });
            assert.deepEqual(
                sessionResults.map((result) => [result.round, result.wordId, result.outcome, result.winnerPlatformUserId]),
                [[1, 900_001, "solved", "luna"], [2, 900_002, "passed", null]],
            );
            assert.deepEqual(cleared, [`streamer:${session.id}`]);
            assert.deepEqual(await service.lastSettings(deps, first), INPUT);
            pass("service and runtime persist a whole session through Prisma");
        } finally {
            await runtime.stop();
        }

        // ------------------------------------------------------------ real wiring

        assert.equal(await sessionDeps.wordPoolSource.next(`streamer:it-${stamp}`, { categoryIds: [2_147_483_000], difficulties: [1], locale: "tr" }), null);
        sessionDeps.wordPoolSource.clear(`streamer:it-${stamp}`);
        pass("the real word source maps an empty pool to null");

        const leftover = await store.create({ userId: second, connectionId: null, platform: "kick", settings: INPUT, viewKeyHash: hash("c"), startedAt: NOW });
        const booted = await sessionDeps.startStreamerSessionRuntime();
        assert.equal((await store.findById(leftover.id))?.status, "interrupted", "boot interrupts rows a previous process left active");
        const fresh = await store.create({ userId: second, connectionId: null, platform: "kick", settings: INPUT, viewKeyHash: hash("d"), startedAt: NOW });
        assert.equal(await sessionDeps.startStreamerSessionRuntime(), booted, "one runtime per process");
        assert.equal((await store.findById(fresh.id))?.status, "active", "a second start does not reconcile again");
        assert.equal(sessionDeps.createSessionServiceDeps().runtime, booted);
        await booted.stop();
        pass("startStreamerSessionRuntime reconciles once and is idempotent");

        await prisma.streamerConnection.delete({ where: { id: link.id } });
        assert.equal((await store.findById(created.id))?.connectionId, null);
        pass("deleting the connection keeps the session (connection_id SET NULL)");

        await prisma.user.delete({ where: { id: first } });
        userIds.splice(userIds.indexOf(first), 1);
        assert.equal(await store.findById(created.id), null);
        assert.equal(await prisma.streamRoundResult.count({ where: { sessionId: created.id } }), 0);
        pass("deleting the user cascades to sessions and round results");
        console.log(`${checks} checks passed (integration).`);
    } finally {
        if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
