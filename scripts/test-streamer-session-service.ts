import assert from "node:assert/strict";
import type { ChatGuess, HostStreamSnapshot, PublicStreamSnapshot, StreamCard } from "@hushle/domain-streamer";
import {
    createMemoryStreamerConnectionStore,
    type StreamerConnectionRecord,
    type StreamerConnectionStatusValue,
    type StreamerPlatform,
} from "@hushle/platform-streamer";
import { createSessionInputSchema, type CreateSessionInput } from "../apps/web/src/lib/streamer/session-settings";
import { createMemoryStreamSessionStore, type MemoryStreamSessionStore } from "../apps/web/src/lib/streamer/session-store";
import {
    createStreamerSessionRuntime,
    isStreamerSessionError,
    StreamerSessionError,
    STREAM_SESSION_IDLE_TIMEOUT_MS,
    type StreamerSessionErrorCode,
    type StreamerSessionRuntime,
    type WordSource,
} from "../apps/web/src/lib/streamer/session-runtime";
import {
    createSession,
    currentSession,
    endCurrent,
    lastSettings,
    rotateViewKey,
    type StreamerSessionServiceDeps,
} from "../apps/web/src/lib/streamer/session-service";
import { createViewKey, hashViewKey } from "../apps/web/src/lib/streamer/view-key";

// Streamer session runtime and service (phase 2, Task 4): memory stores, a fake word source
// and a fake clock. Ticks are driven by advancing the clock and calling `tickAll`.

let count = 0;
async function test(name: string, run: () => Promise<void> | void): Promise<void> {
    await run();
    count += 1;
    console.log(`PASS ${name}`);
}

const START = Date.parse("2026-11-05T12:00:00Z");
const HOUR = 3_600_000;

const DECK: StreamCard[] = [
    { wordId: 101, target: "MANDALİNA", taboos: ["Portakal", "Kış", "Turuncu", "Meyve", "Kabuk"] },
    { wordId: 102, target: "Buzdolabı", taboos: ["Soğuk", "Mutfak", "Süt"] },
];

const INPUT: CreateSessionInput = {
    platform: "twitch",
    language: "tr",
    categoryIds: [3, 7],
    difficulties: [1, 2],
    duration: 60,
    tolerance: "normal",
    theme: "studyo",
    camera: "br",
    cameraSize: "m",
    clock: null,
    cardBack: null,
    showCardName: true,
};

interface FakeSource extends WordSource {
    calls: Array<{ poolKey: string; filters: unknown }>;
    cleared: string[];
}

function cyclingSource(deck: Array<StreamCard | null> = DECK): FakeSource {
    let index = 0;
    const source: FakeSource = {
        calls: [],
        cleared: [],
        async next(poolKey, filters) {
            source.calls.push({ poolKey, filters });
            const card = deck[index % deck.length];
            index += 1;
            return card ? { ...card, taboos: [...card.taboos] } : null;
        },
        clear(poolKey) {
            source.cleared.push(poolKey);
        },
    };
    return source;
}

function connection(userId: number, platform: StreamerPlatform, status: StreamerConnectionStatusValue = "active"): StreamerConnectionRecord {
    const at = new Date(START - 86_400_000);
    return {
        id: `00000000-0000-4000-9000-${String(userId * 10 + (platform === "kick" ? 1 : 0)).padStart(12, "0")}`,
        userId,
        platform,
        platformUserId: `pu-${platform}-${userId}`,
        login: `yayinci${userId}`,
        displayName: `Yayıncı ${userId}`,
        avatarUrl: null,
        channelUrl: `https://${platform}.example/yayinci${userId}`,
        scopes: "",
        accessTokenEnc: status === "active" ? "v1.a.b.c" : null,
        refreshTokenEnc: null,
        tokenKeyVersion: status === "active" ? 1 : null,
        accessTokenExpiresAt: null,
        status,
        statusReason: status === "active" ? null : "refresh_failed",
        lastValidatedAt: at,
        lastUsedAt: null,
        connectedAt: at,
        revokedAt: status === "active" ? null : at,
        createdAt: at,
        updatedAt: at,
    };
}

interface Harness {
    clock: { now: number };
    advance(ms: number): void;
    sessions: MemoryStreamSessionStore;
    connections: ReturnType<typeof createMemoryStreamerConnectionStore>;
    source: FakeSource;
    runtime: StreamerSessionRuntime;
    deps: StreamerSessionServiceDeps;
    emitted: Array<{ sessionId: string; kind: "host" | "public"; payload: HostStreamSnapshot | PublicStreamSnapshot }>;
    ended: Array<{ sessionId: string; reason: string }>;
    rotated: string[];
    lastHost(): HostStreamSnapshot;
    lastPublic(): PublicStreamSnapshot;
}

const runtimes: StreamerSessionRuntime[] = [];

function harness(options: { source?: FakeSource; sessions?: MemoryStreamSessionStore; tickMs?: number } = {}): Harness {
    const clock = { now: START };
    const sessions = options.sessions ?? createMemoryStreamSessionStore();
    const connections = createMemoryStreamerConnectionStore();
    const source = options.source ?? cyclingSource();
    const emitted: Harness["emitted"] = [];
    const ended: Harness["ended"] = [];
    const rotated: string[] = [];
    const runtime = createStreamerSessionRuntime({
        store: sessions,
        wordSource: source,
        now: () => clock.now,
        emit: (sessionId, kind, payload) => emitted.push({ sessionId, kind, payload }),
        onEnded: (sessionId, reason) => ended.push({ sessionId, reason }),
        tickMs: options.tickMs ?? 5,
    });
    runtime.setOnViewKeyRotated((sessionId) => rotated.push(sessionId));
    runtimes.push(runtime);
    const last = (kind: "host" | "public") => {
        const entry = [...emitted].reverse().find((item) => item.kind === kind);
        assert.ok(entry, `a ${kind} snapshot was emitted`);
        return entry.payload;
    };
    return {
        clock,
        advance: (ms) => {
            clock.now += ms;
        },
        sessions,
        connections,
        source,
        runtime,
        deps: { sessions, connections, runtime, now: () => clock.now },
        emitted,
        ended,
        rotated,
        lastHost: () => last("host") as HostStreamSnapshot,
        lastPublic: () => last("public") as PublicStreamSnapshot,
    };
}

async function opened(h: Harness, userId = 1, input: CreateSessionInput = INPUT) {
    if (!h.connections.rows.some((row) => row.userId === userId && row.platform === input.platform)) {
        h.connections.seed(connection(userId, input.platform));
    }
    return createSession(h.deps, { userId, settings: input });
}

let messageSequence = 0;
function chat(h: Harness, text: string, user = "luna", overrides: Partial<ChatGuess> = {}): ChatGuess {
    messageSequence += 1;
    return {
        platform: "fake",
        platformUserId: user,
        name: user.charAt(0).toUpperCase() + user.slice(1),
        text,
        messageId: `message-${messageSequence}`,
        sentAt: h.clock.now,
        ...overrides,
    };
}

async function rejectsWith(run: () => Promise<unknown>, code: StreamerSessionErrorCode): Promise<void> {
    await assert.rejects(run, (error: unknown) => {
        assert.ok(isStreamerSessionError(error), `expected StreamerSessionError(${code}), got ${String(error)}`);
        assert.equal(error.code, code);
        return true;
    });
}

function secretWords(card: StreamCard): string[] {
    return [card.target, ...card.taboos];
}

function assertNoSecrets(payload: unknown, card: StreamCard): void {
    const json = JSON.stringify(payload);
    const lower = json.toLocaleLowerCase("tr");
    for (const word of secretWords(card)) {
        assert.equal(json.includes(word), false, `public snapshot leaks "${word}"`);
        assert.equal(lower.includes(word.toLocaleLowerCase("tr")), false, `public snapshot leaks "${word}" (case-folded)`);
    }
}

async function main(): Promise<void> {
    // ------------------------------------------------------------ create

    await test("create refuses without an active connection for the chosen platform", async () => {
        const h = harness();
        await rejectsWith(() => createSession(h.deps, { userId: 1, settings: INPUT }), "connection_required");
        h.connections.seed(connection(1, "twitch", "needs_reconnect"));
        await rejectsWith(() => createSession(h.deps, { userId: 1, settings: INPUT }), "connection_required");
        h.connections.seed(connection(2, "twitch", "revoked"));
        await rejectsWith(() => createSession(h.deps, { userId: 2, settings: INPUT }), "connection_required");
        h.connections.seed(connection(3, "kick"));
        await rejectsWith(() => createSession(h.deps, { userId: 3, settings: INPUT }), "connection_required");
        assert.equal(h.sessions.rows.length, 0);
        assert.equal(h.runtime.forUser(1), null);
    });

    await test("create refuses while the user has an active session (any platform)", async () => {
        const h = harness();
        await opened(h);
        await rejectsWith(() => createSession(h.deps, { userId: 1, settings: INPUT }), "session_active");
        h.connections.seed(connection(1, "kick"));
        await rejectsWith(() => createSession(h.deps, { userId: 1, settings: { ...INPUT, platform: "kick" } }), "session_active");
        assert.equal(h.sessions.rows.length, 1);
    });

    await test("two concurrent creates for one user open exactly one session", async () => {
        const h = harness();
        h.connections.seed(connection(1, "twitch"));
        const results = await Promise.allSettled([
            createSession(h.deps, { userId: 1, settings: INPUT }),
            createSession(h.deps, { userId: 1, settings: INPUT }),
        ]);
        assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
        const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
        assert.ok(isStreamerSessionError(rejected.reason) && rejected.reason.code === "session_active");
        assert.equal(h.sessions.rows.length, 1);
    });

    await test("create stores the validated input, only the view key hash and the channel login", async () => {
        const h = harness();
        const { session, viewKey } = await opened(h);
        assert.match(viewKey, /^[A-Za-z0-9_-]{43}$/);
        const row = await h.sessions.findById(session.id);
        assert.equal(row?.viewKeyHash, hashViewKey(viewKey));
        assert.match(row?.viewKeyHash ?? "", /^[0-9a-f]{64}$/);
        assert.equal(JSON.stringify(h.sessions.rows).includes(viewKey), false, "the raw view key is never stored");
        assert.equal(row?.connectionId, connection(1, "twitch").id);
        assert.deepEqual(row?.settings, INPUT);
        assert.deepEqual(session, {
            id: row?.id,
            status: "active",
            interrupted: false,
            platform: "twitch",
            settings: INPUT,
            startedAt: new Date(START).toISOString(),
            endedAt: null,
            roundCount: 0,
            summary: null,
        });
        const live = h.runtime.forUser(1);
        assert.ok(live);
        assert.equal(live.id, session.id);
        const snapshot = live.publicSnapshot();
        assert.equal(snapshot.phase, "ready");
        assert.equal(snapshot.theme, "studyo");
        assert.equal(snapshot.duration, 60);
        assert.equal(snapshot.connected, true);
        assert.deepEqual(snapshot.channel, { platform: "twitch", name: "yayinci1" });
        assert.equal(h.lastPublic().phase, "ready");
    });

    await test("view keys are 32 random bytes (base64url) hashed with sha256", () => {
        const first = createViewKey();
        const second = createViewKey();
        assert.equal(Buffer.from(first.viewKey, "base64url").length, 32);
        assert.notEqual(first.viewKey, second.viewKey);
        assert.equal(first.hash, hashViewKey(first.viewKey));
        assert.match(first.hash, /^[0-9a-f]{64}$/);
    });

    await test("CreateSessionInput is strict and bounded", async () => {
        assert.equal(createSessionInputSchema.safeParse(INPUT).success, true);
        assert.equal(createSessionInputSchema.safeParse({ ...INPUT, clock: "ring", cardBack: { collection: -1 } }).success, true);
        const bad: Array<[string, unknown]> = [
            ["unknown key", { ...INPUT, extra: true }],
            ["youtube platform", { ...INPUT, platform: "youtube" }],
            ["language de", { ...INPUT, language: "de" }],
            ["duration 29", { ...INPUT, duration: 29 }],
            ["duration 121", { ...INPUT, duration: 121 }],
            ["duration 45.5", { ...INPUT, duration: 45.5 }],
            ["no categories", { ...INPUT, categoryIds: [] }],
            ["21 categories", { ...INPUT, categoryIds: Array.from({ length: 21 }, (_, index) => index + 1) }],
            ["category 0", { ...INPUT, categoryIds: [0] }],
            ["category 1.5", { ...INPUT, categoryIds: [1.5] }],
            ["no difficulties", { ...INPUT, difficulties: [] }],
            ["difficulty 4", { ...INPUT, difficulties: [4] }],
            ["tolerance flexible", { ...INPUT, tolerance: "flexible" }],
            ["theme unknown", { ...INPUT, theme: "neon" }],
            ["camera unknown", { ...INPUT, camera: "center" }],
            ["camera size xl", { ...INPUT, cameraSize: "xl" }],
            ["clock unknown", { ...INPUT, clock: "sundial" }],
            ["card back -2", { ...INPUT, cardBack: { collection: -2 } }],
            ["card back extra key", { ...INPUT, cardBack: { collection: 1, variant: 2 } }],
            ["showCardName string", { ...INPUT, showCardName: "yes" }],
            ["missing theme", { ...INPUT, theme: undefined }],
        ];
        for (const [label, value] of bad) {
            assert.equal(createSessionInputSchema.safeParse(value).success, false, `${label} must be rejected`);
        }
        const h = harness();
        h.connections.seed(connection(1, "twitch"));
        await assert.rejects(() => createSession(h.deps, { userId: 1, settings: { ...INPUT, duration: 500 } }));
        assert.equal(h.sessions.rows.length, 0);
    });

    // ------------------------------------------------------------ rounds

    await test("start draws a card: the host snapshot has it, the public one does not", async () => {
        const h = harness();
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        assert.deepEqual(h.source.calls[0], {
            poolKey: `streamer:${session.id}`,
            filters: { categoryIds: [3, 7], difficulties: [1, 2], locale: "tr" },
        });
        const host = h.lastHost();
        const pub = h.lastPublic();
        assert.equal(host.phase, "running");
        assert.deepEqual(host.card, DECK[0]);
        assert.equal(pub.phase, "running");
        assert.equal(pub.reveal, null);
        assert.equal("card" in pub, false);
        assertNoSecrets(pub, DECK[0]);
        assertNoSecrets(h.runtime.get(session.id)?.publicSnapshot(), DECK[0]);
        const hostJson = JSON.stringify(host);
        for (const word of secretWords(DECK[0])) assert.ok(hostJson.includes(word), `host snapshot carries "${word}"`);
        await rejectsWith(() => h.runtime.start(session.id), "invalid_phase");
    });

    await test("tick to zero → finished with reveal; a timeout result is persisted", async () => {
        const h = harness();
        const { session } = await opened(h);
        h.advance(2_000);
        await h.runtime.start(session.id);
        h.advance(1_500);
        await h.runtime.tickAll();
        assert.equal(h.lastPublic().remaining, 59);
        assert.equal(h.sessions.results.length, 0);
        h.advance(58_500);
        await h.runtime.tickAll();
        const pub = h.lastPublic();
        assert.equal(pub.phase, "finished");
        assert.equal(pub.remaining, 0);
        assert.deepEqual(pub.reveal, { target: DECK[0].target, taboos: DECK[0].taboos, solved: false });
        assert.equal(h.sessions.results.length, 1);
        const result = h.sessions.results[0];
        assert.equal(result.sessionId, session.id);
        assert.equal(result.round, 1);
        assert.equal(result.wordId, 101);
        assert.equal(result.outcome, "timeout");
        assert.equal(result.winnerPlatformUserId, null);
        assert.equal(result.winnerName, null);
        assert.equal(result.solveMs, null);
        assert.equal(result.startedAt.getTime(), START + 2_000);
        assert.equal(result.endedAt.getTime(), START + 62_000);
        assert.equal((await h.sessions.findById(session.id))?.roundCount, 1);
        await h.runtime.tickAll();
        assert.equal(h.sessions.results.length, 1, "a finished round is recorded once");
    });

    await test("correct guess → finished, solved with solveMs, scores updated; a second correct guess is closed", async () => {
        const h = harness();
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        h.advance(12_000);
        assert.equal(await h.runtime.guess(session.id, chat(h, "portakal", "mira")), "wrong");
        assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina!", "luna")), "correct");
        const pub = h.lastPublic();
        assert.equal(pub.phase, "finished");
        assert.equal(pub.participants, 2);
        assert.deepEqual(pub.scores, [{ name: "Luna", points: 1, rank: 1, tied: false }]);
        assert.equal(pub.lastCorrect?.name, "Luna");
        assert.equal(pub.lastCorrect?.solveMs, 12_000);
        assert.deepEqual(pub.reveal, { target: DECK[0].target, taboos: DECK[0].taboos, solved: true });
        assert.equal(h.sessions.results.length, 1);
        const result = h.sessions.results[0];
        assert.equal(result.outcome, "solved");
        assert.equal(result.winnerPlatformUserId, "luna");
        assert.equal(result.winnerName, "Luna");
        assert.equal(result.solveMs, 12_000);
        assert.equal(result.wordId, 101);
        assert.equal(await h.runtime.guess(session.id, chat(h, "MANDALİNA", "mira")), "closed");
        assert.equal(h.sessions.results.length, 1);
        assert.deepEqual(h.lastPublic().scores, [{ name: "Luna", points: 1, rank: 1, tied: false }]);
    });

    await test("a guess after the deadline but before the tick is closed and the round records a timeout", async () => {
        const h = harness();
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        h.advance(61_000);
        assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina")), "closed");
        assert.equal(h.lastPublic().phase, "finished");
        assert.equal(h.sessions.results.length, 1);
        assert.equal(h.sessions.results[0].outcome, "timeout");
    });

    await test("pass → passed result and the passed word in the next public snapshot", async () => {
        const h = harness();
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        h.advance(5_000);
        await h.runtime.pass(session.id);
        assert.equal(h.sessions.results.length, 1);
        const result = h.sessions.results[0];
        assert.equal(result.outcome, "passed");
        assert.equal(result.round, 1);
        assert.equal(result.wordId, 101);
        assert.equal(result.endedAt.getTime(), START + 5_000);
        const pub = h.lastPublic();
        assert.deepEqual(pub.passed, { round: 1, target: DECK[0].target });
        assert.equal(pub.passedRound, 1);
        assert.equal(pub.round, 2);
        assert.equal(pub.phase, "running");
        assert.equal(pub.remaining, 60);
        assertNoSecrets(pub, DECK[1]);
        assert.deepEqual(h.lastHost().card, DECK[1]);
        assert.equal((await h.sessions.findById(session.id))?.roundCount, 1);
        h.advance(60_000);
        await h.runtime.tickAll();
        assert.equal(h.sessions.results[1].outcome, "timeout");
        assert.equal(h.sessions.results[1].round, 2);
        assert.equal(h.sessions.results[1].startedAt.getTime(), START + 5_000);
        await rejectsWith(() => h.runtime.pass(session.id), "invalid_phase");
    });

    await test("next after finished → new round, reveal gone; next while running is refused", async () => {
        const h = harness();
        const { session } = await opened(h);
        await rejectsWith(() => h.runtime.next(session.id), "invalid_phase");
        await h.runtime.start(session.id);
        await rejectsWith(() => h.runtime.next(session.id), "invalid_phase");
        h.advance(60_000);
        await h.runtime.tickAll();
        assert.ok(h.lastPublic().reveal);
        await h.runtime.next(session.id);
        const pub = h.lastPublic();
        assert.equal(pub.phase, "running");
        assert.equal(pub.round, 2);
        assert.equal(pub.reveal, null);
        assertNoSecrets(pub, DECK[1]);
        assert.deepEqual(h.lastHost().card, DECK[1]);
        await rejectsWith(() => h.runtime.start(session.id), "invalid_phase");
    });

    await test("pause stops the clock, resume continues it; solveMs ignores the pause", async () => {
        const h = harness();
        const { session } = await opened(h);
        await rejectsWith(() => h.runtime.pause(session.id), "invalid_phase");
        await rejectsWith(() => h.runtime.resume(session.id), "invalid_phase");
        await h.runtime.start(session.id);
        h.advance(10_000);
        await h.runtime.pause(session.id);
        assert.equal(h.lastPublic().phase, "paused");
        assert.equal(h.lastPublic().remaining, 50);
        h.advance(100_000);
        await h.runtime.tickAll();
        assert.equal(h.lastPublic().phase, "paused");
        assert.equal(h.lastPublic().remaining, 50);
        assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina")), "closed");
        await h.runtime.resume(session.id);
        assert.equal(h.lastPublic().phase, "running");
        h.advance(5_000);
        assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina")), "correct");
        assert.equal(h.sessions.results[0].solveMs, 15_000);
    });

    await test("every mutation bumps the revision and emits both a host and a public snapshot", async () => {
        const h = harness();
        const { session } = await opened(h);
        const revisions: number[] = [];
        const step = async (label: string, run: () => Promise<unknown>) => {
            const before = h.emitted.length;
            await run();
            const fresh = h.emitted.slice(before);
            const host = fresh.filter((item) => item.kind === "host");
            const pub = fresh.filter((item) => item.kind === "public");
            assert.ok(host.length >= 1 && pub.length >= 1, `${label} emits host and public`);
            assert.equal(host.at(-1)?.payload.revision, pub.at(-1)?.payload.revision, `${label}: same revision in both rooms`);
            assert.ok(fresh.every((item) => item.sessionId === session.id));
            revisions.push(pub.at(-1)!.payload.revision);
        };
        revisions.push(h.lastPublic().revision);
        await step("start", () => h.runtime.start(session.id));
        await step("pause", () => h.runtime.pause(session.id));
        await step("resume", () => h.runtime.resume(session.id));
        await step("settings", () => h.runtime.applySettings(session.id, { theme: "sakura" }));
        await step("pass", () => h.runtime.pass(session.id));
        await step("guess", () => h.runtime.guess(session.id, chat(h, "buzdolabi")));
        await step("next", () => h.runtime.next(session.id));
        await step("end", () => h.runtime.end(session.id, "ended"));
        for (let index = 1; index < revisions.length; index++) {
            assert.ok(revisions[index] > revisions[index - 1], `revision grows (${revisions.join(",")})`);
        }
        assert.equal(h.lastHost().type, "host-state");
        assert.equal(h.lastPublic().type, "public-state");
        assert.equal(h.lastPublic().phase, "ended");
    });

    await test("settings changes reach the stream at once (any phase) and become the next prefill", async () => {
        const h = harness();
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        await h.runtime.applySettings(session.id, { theme: "gece-altini", camera: "left", clock: "candle", showCardName: false });
        const pub = h.lastPublic();
        assert.equal(pub.theme, "gece-altini");
        assert.equal(pub.camera, "left");
        assert.equal(pub.clock, "candle");
        assert.equal(pub.showCardName, false);
        assert.equal(pub.phase, "running");
        const stored = await lastSettings(h.deps, 1);
        assert.deepEqual(stored, { ...INPUT, theme: "gece-altini", camera: "left", clock: "candle", showCardName: false });
    });

    await test("end → summary (top 10, participants), pool cleared, status ended", async () => {
        const h = harness();
        const { session } = await opened(h);
        const users = Array.from({ length: 12 }, (_, index) => `u${String(index + 1).padStart(2, "0")}`);
        const winners = [...users, "u01", "u01", "u02"];
        for (const [index, user] of winners.entries()) {
            if (index === 0) await h.runtime.start(session.id);
            else await h.runtime.next(session.id);
            const target = h.lastHost().card!.target;
            if (index === 0) assert.equal(await h.runtime.guess(session.id, chat(h, "yanlis", "bystander")), "wrong");
            h.advance(1_000);
            assert.equal(await h.runtime.guess(session.id, chat(h, target, user)), "correct");
        }
        await h.runtime.next(session.id);
        h.advance(3_000);
        const ended = await endCurrent(h.deps, 1);
        assert.equal(ended.sessionId, session.id);
        const expectedScores = [
            { name: "U01", points: 3, rank: 1, tied: false },
            { name: "U02", points: 2, rank: 2, tied: false },
            ...["U03", "U04", "U05", "U06", "U07", "U08", "U09", "U10"].map((name) => ({ name, points: 1, rank: 3, tied: true })),
        ];
        assert.deepEqual(ended.summary, { scores: expectedScores, participants: 13, rounds: 15 });
        const row = await h.sessions.findById(session.id);
        assert.equal(row?.status, "ended");
        assert.equal(row?.endedAt?.getTime(), h.clock.now);
        assert.deepEqual(row?.summary, ended.summary);
        assert.equal(row?.roundCount, 15);
        assert.equal(h.sessions.results.length, 15, "the unfinished last round is not recorded");
        assert.ok(h.source.cleared.includes(`streamer:${session.id}`), "word pool cleared");
        assert.equal(h.runtime.get(session.id), null);
        assert.deepEqual(h.ended, [{ sessionId: session.id, reason: "ended" }]);
        assert.equal(h.lastPublic().phase, "ended");
        assert.equal(await currentSession(h.deps, 1), null);
        await rejectsWith(() => endCurrent(h.deps, 1), "not_found");
        await rejectsWith(() => h.runtime.start(session.id), "not_found");
        await rejectsWith(() => h.runtime.guess(session.id, chat(h, "x")), "not_found");
        const again = await opened(h);
        assert.notEqual(again.session.id, session.id, "a new session can be opened after the end");
    });

    await test("idle for 6 h since the last host action or guess → auto end with reason idle", async () => {
        const h = harness();
        const { session } = await opened(h);
        h.advance(5 * HOUR);
        assert.equal(await h.runtime.guess(session.id, chat(h, "merhaba")), "closed");
        h.advance(2 * HOUR);
        await h.runtime.tickAll();
        assert.ok(h.runtime.get(session.id), "a guess counts as activity");
        h.advance(STREAM_SESSION_IDLE_TIMEOUT_MS - 2 * HOUR - 1);
        await h.runtime.tickAll();
        assert.ok(h.runtime.get(session.id));
        h.advance(1);
        await h.runtime.tickAll();
        assert.equal(h.runtime.get(session.id), null);
        assert.deepEqual(h.ended, [{ sessionId: session.id, reason: "idle" }]);
        const row = await h.sessions.findById(session.id);
        assert.equal(row?.status, "ended");
        assert.deepEqual(row?.summary, { scores: [], participants: 0, rounds: 0 }, "a closed guess adds no participant");
        assert.ok(h.source.cleared.includes(`streamer:${session.id}`));
        assert.equal(STREAM_SESSION_IDLE_TIMEOUT_MS, 6 * HOUR);
    });

    await test("word pool exhaustion: the source cycles and rounds keep coming", async () => {
        const h = harness();
        const { session } = await opened(h);
        const drawn: number[] = [];
        for (let round = 0; round < 5; round++) {
            if (round === 0) await h.runtime.start(session.id);
            else await h.runtime.next(session.id);
            drawn.push(h.lastHost().card!.wordId);
            h.advance(60_000);
            await h.runtime.tickAll();
            assert.equal(h.lastPublic().phase, "finished");
        }
        assert.deepEqual(drawn, [101, 102, 101, 102, 101]);
        assert.deepEqual(h.sessions.results.map((result) => result.round), [1, 2, 3, 4, 5]);
        assert.equal(h.lastPublic().round, 5);
    });

    await test("an empty word source is a typed error: the round does not start and nothing crashes", async () => {
        const h = harness({ source: cyclingSource([null]) });
        const { session } = await opened(h);
        const before = h.lastPublic().revision;
        await rejectsWith(() => h.runtime.start(session.id), "word_source_empty");
        const live = h.runtime.get(session.id);
        assert.ok(live);
        assert.equal(live.phase, "ready");
        assert.equal(live.hostSnapshot().card, null);
        assert.equal(h.lastPublic().revision, before, "a failed draw changes nothing");
        h.advance(120_000);
        await h.runtime.tickAll();
        assert.equal(h.sessions.results.length, 0);
    });

    await test("pass with an empty source keeps the current round untouched", async () => {
        const h = harness({ source: cyclingSource([DECK[0], null]) });
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        h.advance(4_000);
        await rejectsWith(() => h.runtime.pass(session.id), "word_source_empty");
        const host = h.runtime.get(session.id)!.hostSnapshot();
        assert.equal(host.phase, "running");
        assert.equal(host.round, 1);
        assert.deepEqual(host.card, DECK[0]);
        assert.equal(h.sessions.results.length, 0);
    });

    // ------------------------------------------------------------ view key, store, restarts

    await test("rotate view key → new hash, the old key no longer resolves", async () => {
        const h = harness();
        const { session, viewKey } = await opened(h);
        await rejectsWith(() => rotateViewKey(h.deps, 2), "not_found");
        const rotated = await rotateViewKey(h.deps, 1);
        assert.match(rotated.viewKey, /^[A-Za-z0-9_-]{43}$/);
        assert.notEqual(rotated.viewKey, viewKey);
        assert.equal(await h.sessions.findByViewKeyHash(hashViewKey(viewKey)), null);
        assert.equal((await h.sessions.findByViewKeyHash(hashViewKey(rotated.viewKey)))?.id, session.id);
        assert.equal(h.runtime.get(session.id)?.viewKeyHash, hashViewKey(rotated.viewKey));
        assert.deepEqual(h.rotated, [session.id]);
    });

    await test("markInterruptedAll flips only active rows", async () => {
        const sessions = createMemoryStreamSessionStore();
        const base = { connectionId: null, platform: "twitch" as const, settings: INPUT, startedAt: new Date(START) };
        const first = await sessions.create({ ...base, userId: 1, viewKeyHash: "a".repeat(64) });
        const second = await sessions.create({ ...base, userId: 2, viewKeyHash: "b".repeat(64) });
        const third = await sessions.create({ ...base, userId: 3, viewKeyHash: "c".repeat(64) });
        await sessions.update(third.id, { status: "ended", endedAt: new Date(START + 1_000) });
        const at = new Date(START + 5_000);
        assert.equal(await sessions.markInterruptedAll(at), 2);
        assert.equal((await sessions.findById(first.id))?.status, "interrupted");
        assert.equal((await sessions.findById(second.id))?.endedAt?.getTime(), at.getTime());
        const ended = await sessions.findById(third.id);
        assert.equal(ended?.status, "ended");
        assert.equal(ended?.endedAt?.getTime(), START + 1_000);
        assert.equal(await sessions.findActiveByUser(1), null);
        assert.equal(await sessions.markInterruptedAll(at), 0);
    });

    await test("session views never carry the view key hash", async () => {
        const h = harness();
        const created = await opened(h);
        const hash = hashViewKey(created.viewKey);
        const assertHashFree = (value: unknown, label: string) => {
            const json = JSON.stringify(value);
            assert.equal(json.includes("viewKeyHash"), false, `${label} has no viewKeyHash key`);
            assert.equal(json.includes(hash), false, `${label} has no hash value`);
            assert.equal(json.includes("connectionId") || json.includes("userId"), false, `${label} has no owner or link ids`);
        };
        assertHashFree(created.session, "createSession().session");
        assertHashFree(await currentSession(h.deps, 1), "currentSession (active)");
        await h.sessions.markInterruptedAll(new Date(h.clock.now));
        const second = harness({ sessions: h.sessions });
        const interrupted = await currentSession(second.deps, 1);
        assert.equal(interrupted?.interrupted, true);
        assert.equal(interrupted?.status, "interrupted");
        assertHashFree(interrupted, "currentSession (interrupted)");
    });

    await test("the stale-row interrupt is conditional: only an active row flips", async () => {
        const sessions = createMemoryStreamSessionStore();
        const base = { connectionId: null, platform: "twitch" as const, settings: INPUT, startedAt: new Date(START) };
        const active = await sessions.create({ ...base, userId: 1, viewKeyHash: "f".repeat(64) });
        const ended = await sessions.create({ ...base, userId: 2, viewKeyHash: "9".repeat(64) });
        await sessions.update(ended.id, { status: "ended", endedAt: new Date(START + 1_000), summary: { scores: [], participants: 0, rounds: 0 } });
        const flipped = await sessions.markInterrupted(active.id, new Date(START + 2_000));
        assert.equal(flipped?.status, "interrupted");
        assert.equal(flipped?.endedAt?.getTime(), START + 2_000);
        assert.equal(await sessions.markInterrupted(active.id, new Date(START + 3_000)), null);
        assert.equal((await sessions.findById(active.id))?.endedAt?.getTime(), START + 2_000);
        assert.equal(await sessions.markInterrupted(ended.id, new Date(START + 3_000)), null);
        const untouched = await sessions.findById(ended.id);
        assert.equal(untouched?.status, "ended");
        assert.equal(untouched?.endedAt?.getTime(), START + 1_000);
        assert.equal(await sessions.markInterrupted("00000000-0000-4000-8000-000000000999", new Date(START)), null);
    });

    for (const order of ["end write lands first", "stale interrupt lands first"] as const) {
        await test(`an end still being written is never turned into interrupted (${order})`, async () => {
            const base = createMemoryStreamSessionStore();
            const gate = () => {
                let open!: () => void;
                let seen!: () => void;
                const released = new Promise<void>((resolve) => (open = resolve));
                const reached = new Promise<void>((resolve) => (seen = resolve));
                return { open: () => open(), reached, wait: () => (seen(), released) };
            };
            const endWrite = gate();
            const interrupt = gate();
            const sessions: MemoryStreamSessionStore = {
                ...base,
                async update(id, patch) {
                    if (patch.status === "ended") await endWrite.wait();
                    return base.update(id, patch);
                },
                async markInterrupted(id, now) {
                    await interrupt.wait();
                    return base.markInterrupted(id, now);
                },
            };
            const h = harness({ sessions });
            const { session } = await opened(h);
            await h.runtime.start(session.id);
            assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina")), "correct");
            h.advance(2_000);
            const ending = endCurrent(h.deps, 1);
            await endWrite.reached;
            assert.equal(h.runtime.get(session.id), null, "the runtime let go before the write landed");
            const current = currentSession(h.deps, 1);
            await interrupt.reached;
            let summary;
            if (order === "end write lands first") {
                endWrite.open();
                ({ summary } = await ending);
                interrupt.open();
                assert.equal(await current, null, "an ended session is no current session");
            } else {
                interrupt.open();
                assert.equal((await current)?.status, "interrupted");
                endWrite.open();
                ({ summary } = await ending);
            }
            const row = await base.findById(session.id);
            assert.equal(row?.status, "ended");
            assert.equal(row?.endedAt?.getTime(), START + 2_000);
            assert.deepEqual(row?.summary, summary);
            assert.deepEqual(summary, { scores: [{ name: "Luna", points: 1, rank: 1, tied: false }], participants: 1, rounds: 1 });
            assert.equal(await currentSession(h.deps, 1), null);
        });
    }

    await test("isStreamerSessionError recognises errors from another copy of the module", () => {
        const brand = Symbol.for("hushle.streamer-session-error");
        // What a route bundle sees when the server's copy of the runtime throws: same shape, other class.
        class ForeignStreamerSessionError extends Error {
            readonly code = "not_found";
            constructor() {
                super("streamer session: not_found");
                Object.defineProperty(this, brand, { value: true });
            }
        }
        const foreign = new ForeignStreamerSessionError();
        assert.equal(foreign instanceof StreamerSessionError, false);
        assert.equal(isStreamerSessionError(foreign), true);
        assert.equal(isStreamerSessionError(new StreamerSessionError("invalid_phase")), true);
        assert.equal(isStreamerSessionError(new Error("not_found")), false, "a plain Error is not one");
        assert.equal(isStreamerSessionError(Object.assign(new Error("x"), { code: "not_found" })), false, "a code without the brand is not one");
        const unknownCode = Object.assign(new Error("x"), { code: "teapot" });
        Object.defineProperty(unknownCode, brand, { value: true });
        assert.equal(isStreamerSessionError(unknownCode), false, "a branded error with an unknown code is not one");
        for (const value of [null, undefined, "not_found", 42, { code: "not_found" }]) {
            assert.equal(isStreamerSessionError(value), false);
        }
        assert.deepEqual(JSON.parse(JSON.stringify(new StreamerSessionError("not_found"))), { code: "not_found", name: "StreamerSessionError" }, "the brand is not enumerable");
    });

    await test("restart during a round: boot reconciliation interrupts the row, the panel sees it, a new session can open", async () => {
        const first = harness();
        const { session } = await opened(first);
        await first.runtime.start(session.id);
        first.advance(7_000);
        // The process dies: nothing in memory survives. The next boot sees only the database.
        const second = harness({ sessions: first.sessions });
        second.connections.seed(connection(1, "twitch"));
        assert.equal(await second.sessions.markInterruptedAll(new Date(second.clock.now)), 1);
        const current = await currentSession(second.deps, 1);
        assert.equal(current?.id, session.id);
        assert.equal(current?.status, "interrupted");
        assert.equal(second.runtime.get(session.id), null);
        await rejectsWith(() => endCurrent(second.deps, 1), "not_found");
        const reopened = await createSession(second.deps, { userId: 1, settings: INPUT });
        assert.equal((await currentSession(second.deps, 1))?.id, reopened.session.id);
        await first.runtime.stop();
    });

    await test("a stale active row with no live session is reconciled as interrupted", async () => {
        const h = harness();
        h.connections.seed(connection(1, "twitch"));
        const stale = await h.sessions.create({ userId: 1, connectionId: null, platform: "twitch", settings: INPUT, viewKeyHash: "d".repeat(64), startedAt: new Date(START - HOUR) });
        assert.equal((await currentSession(h.deps, 1))?.status, "interrupted");
        assert.equal((await h.sessions.findById(stale.id))?.status, "interrupted");
        const { session } = await createSession(h.deps, { userId: 1, settings: INPUT });
        assert.equal((await currentSession(h.deps, 1))?.id, session.id);
        assert.equal((await currentSession(h.deps, 1))?.status, "active");
    });

    await test("stop clears every timer, marks open sessions interrupted and leaves no stray intervals", async () => {
        const realSetInterval = globalThis.setInterval;
        const realClearInterval = globalThis.clearInterval;
        const live = new Set<unknown>();
        globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
            const handle = realSetInterval(...args);
            live.add(handle);
            return handle;
        }) as typeof setInterval;
        globalThis.clearInterval = ((handle?: Parameters<typeof clearInterval>[0]) => {
            live.delete(handle);
            realClearInterval(handle);
        }) as typeof clearInterval;
        try {
            const h = harness();
            const { session } = await opened(h);
            h.connections.seed(connection(2, "twitch"));
            const other = await createSession(h.deps, { userId: 2, settings: INPUT });
            await h.runtime.start(session.id);
            await h.runtime.pause(session.id);
            await h.runtime.resume(session.id);
            assert.ok(live.size >= 1, "running sessions own a timer");
            await h.runtime.end(other.session.id, "ended");
            await h.runtime.stop();
            assert.equal(live.size, 0, "no timer survives stop()");
            assert.equal((await h.sessions.findById(session.id))?.status, "interrupted");
            assert.equal((await h.sessions.findById(other.session.id))?.status, "ended");
            assert.equal(h.runtime.get(session.id), null);
            assert.ok(h.source.cleared.includes(`streamer:${session.id}`));
            await rejectsWith(() => h.runtime.start(session.id), "not_found");
        } finally {
            globalThis.setInterval = realSetInterval;
            globalThis.clearInterval = realClearInterval;
        }
    });

    await test("the runtime's own interval ticks a running round without tickAll", async () => {
        const h = harness({ tickMs: 5 });
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        h.advance(60_000);
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(h.runtime.get(session.id)?.phase, "finished");
        assert.equal(h.sessions.results[0]?.outcome, "timeout");
    });

    await test("the connection needing a reconnect mid-session does not stop the session; a new one is refused", async () => {
        const h = harness();
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        await h.connections.markNeedsReconnect(connection(1, "twitch").id, "refresh_failed", new Date(h.clock.now));
        h.advance(3_000);
        await h.runtime.tickAll();
        assert.equal(h.lastPublic().phase, "running");
        assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina")), "correct");
        await endCurrent(h.deps, 1);
        await rejectsWith(() => createSession(h.deps, { userId: 1, settings: INPUT }), "connection_required");
    });

    await test("lastSettings prefills from the most recent session, null before any", async () => {
        const h = harness();
        assert.equal(await lastSettings(h.deps, 1), null);
        await opened(h);
        assert.deepEqual(await lastSettings(h.deps, 1), INPUT);
        await endCurrent(h.deps, 1);
        h.advance(1_000);
        const english: CreateSessionInput = { ...INPUT, language: "en", duration: 90, tolerance: "strict", categoryIds: [9] };
        await opened(h, 1, english);
        assert.deepEqual(await lastSettings(h.deps, 1), english);
        assert.equal(await lastSettings(h.deps, 2), null);
        const corrupt = createMemoryStreamSessionStore();
        await corrupt.create({ userId: 5, connectionId: null, platform: "kick", settings: { theme: 42 }, viewKeyHash: "e".repeat(64), startedAt: new Date(START) });
        assert.equal(await lastSettings({ ...h.deps, sessions: corrupt }, 5), null, "an unreadable stored setting is no prefill");
    });

    await test("unknown sessions and empty current state", async () => {
        const h = harness();
        await rejectsWith(() => h.runtime.start("00000000-0000-4000-8000-000000000999"), "not_found");
        await rejectsWith(() => h.runtime.guess("00000000-0000-4000-8000-000000000999", chat(h, "x")), "not_found");
        await rejectsWith(() => h.runtime.applySettings("00000000-0000-4000-8000-000000000999", { theme: "sade" }), "not_found");
        assert.equal(h.runtime.get("00000000-0000-4000-8000-000000000999"), null);
        assert.equal(await currentSession(h.deps, 1), null);
        await rejectsWith(() => endCurrent(h.deps, 1), "not_found");
    });

    await test("setEmitter swaps the emitter without touching the sessions", async () => {
        const h = harness();
        const { session } = await opened(h);
        const swapped: string[] = [];
        h.runtime.setEmitter((sessionId, kind) => swapped.push(`${sessionId}:${kind}`));
        await h.runtime.start(session.id);
        assert.deepEqual(swapped, [`${session.id}:host`, `${session.id}:public`]);
        const endedReasons: string[] = [];
        h.runtime.setOnEnded((_sessionId, reason) => endedReasons.push(reason));
        await h.runtime.end(session.id, "ended");
        assert.deepEqual(endedReasons, ["ended"]);
    });

    for (const runtime of runtimes) await runtime.stop();
    console.log(`${count} checks passed.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
