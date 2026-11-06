import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NextRequest } from "next/server";
import type { z } from "zod";
import {
    boundCardBack,
    createStreamSession,
    type ChatGuess,
    type HostStreamSnapshot,
    type PublicStreamSnapshot,
    type StreamCard,
    type StreamCardBack,
} from "@hushle/domain-streamer";
import { resetObservabilityForTests } from "@hushle/platform-observability";
import {
    createMemoryStreamerConnectionStore,
    type StreamerConnectionRecord,
    type StreamerConnectionStatusValue,
    type StreamerPlatform,
} from "@hushle/platform-streamer";
import { createSessionInputSchema, resolvedScreenPatchSchema, toScreenSettings, type CreateSessionInput } from "../apps/web/src/lib/streamer/session-settings";
import {
    createMemoryStreamSessionStore,
    streamSessionSummarySchema,
    type MemoryStreamSessionStore,
    type StreamSessionSummary,
} from "../apps/web/src/lib/streamer/session-store";
import { streamerSessionErrorResponse } from "../apps/web/src/lib/streamer/session-http";
import {
    createStreamerSessionRuntime,
    isStreamerSessionError,
    StreamerSessionError,
    STREAM_CONNECTION_CHECK_MS,
    STREAM_SESSION_IDLE_TIMEOUT_MS,
    STREAMER_MODE_CHECK_MS,
    type ConnectionCheck,
    type SessionConnection,
    type StreamerSessionErrorCode,
    type StreamerSessionRuntime,
    type WordSource,
} from "../apps/web/src/lib/streamer/session-runtime";
import {
    createSession,
    currentSession,
    endCurrent,
    INTERRUPTED_NOTICE_TTL_MS,
    lastSettings,
    reportStreamerSessionError,
    rotateViewKey,
    toSessionView,
    type StreamerSessionServiceDeps,
} from "../apps/web/src/lib/streamer/session-service";
import { resolveCardBackSelection, type CardBackCatalogItem, type CardBackLoaders } from "../apps/web/src/lib/streamer/card-backs";
import type { StreamerTimers } from "../apps/web/src/lib/streamer/session-timers";
import { createViewKey, hashViewKey } from "../apps/web/src/lib/streamer/view-key";
import * as realRateLimit from "../apps/web/src/lib/security/request-rate-limit";

// Streamer session runtime and service (phase 2, Task 4): memory stores, a fake word source
// and a fake clock. Ticks are driven by advancing the clock and calling `tickAll`; writes run off
// the action queue, so a test reads the store after `runtime.flush()`.

// The stored summary type is the schema's: they cannot drift apart (checked by tsc).
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const summaryTypeIsTheSchema: Same<StreamSessionSummary, z.infer<typeof streamSessionSummarySchema>> = true;
void summaryTypeIsTheSchema;

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

function cardBackItem(id: number, name: string): CardBackCatalogItem {
    return {
        id, name, type: "card_back", rarity: "epic", renderMode: "template", renderSpecVersion: 1, imageUrl: `/cosmetics/${id}.svg`, thumbnailUrl: null, startsAt: null, endsAt: null,
        templateKey: "ember", templateConfig: { surfaceColor: "#102030", borderColor: "#405060", pattern: "grid" }, isActive: true,
    };
}

// User 1 owns card back 10; the catalogue also has 11 and 12.
const CARD_BACK_LOADERS: CardBackLoaders = {
    inventory: async () => ({
        profile: { cardBackItemId: 10 },
        items: [{ shopItemId: 10, ...cardBackItem(10, "Kor") }],
    }),
    catalog: async () => [cardBackItem(10, "Kor"), cardBackItem(11, "Buz"), cardBackItem(12, "Orman")],
};

interface Deferred<T = void> {
    promise: Promise<T>;
    resolve(value: T): void;
}

function deferred<T = void>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
}

/**
 * Whether `promise` has settled by the next macrotask. Memory stores, the fake source and the
 * runtime only ever wait on microtasks, so an action that does not wait on a held write has
 * settled by then: no real time passes.
 */
async function settlesNow(promise: Promise<unknown>): Promise<boolean> {
    let settled = false;
    promise.then(
        () => (settled = true),
        () => (settled = true),
    );
    await new Promise((resolve) => setImmediate(resolve));
    return settled;
}

async function quick<T>(promise: Promise<T>, label: string): Promise<T> {
    assert.equal(await settlesNow(promise), true, `${label} settles without waiting for a write`);
    return promise;
}

/** A memory store whose writes log their start and, while held, wait until released. */
function holdingStore(base: MemoryStreamSessionStore = createMemoryStreamSessionStore()) {
    const log: string[] = [];
    let gate: Deferred | null = null;
    const wait = async (label: string) => {
        log.push(label);
        if (gate) await gate.promise;
    };
    const store: MemoryStreamSessionStore = {
        ...base,
        async addRoundResult(result) {
            await wait(`result:${result.round}:${result.outcome}`);
            return base.addRoundResult(result);
        },
        async update(id, patch) {
            await wait(`update:${Object.keys(patch).sort().join(",")}`);
            return base.update(id, patch);
        },
    };
    return {
        store,
        log,
        hold() {
            gate = deferred();
        },
        release() {
            gate?.resolve();
            gate = null;
        },
    };
}

/**
 * Timers that fire only when the test says so, with a wall clock the test moves. Every request
 * is logged with its delay, so a test reads how long the runtime chose to wait.
 */
function manualTimers(start = 0) {
    let now = start;
    let sequence = 0;
    const timeouts = new Map<number, { run: () => void; ms: number }>();
    const intervals = new Map<number, { run: () => void; ms: number }>();
    const requested: number[] = [];
    const timers: StreamerTimers = {
        now: () => now,
        setTimeout(run, ms) {
            requested.push(ms);
            timeouts.set(++sequence, { run, ms });
            return sequence;
        },
        clearTimeout(handle) {
            timeouts.delete(handle as number);
        },
        setInterval(run, ms) {
            intervals.set(++sequence, { run, ms });
            return sequence;
        },
        clearInterval(handle) {
            intervals.delete(handle as number);
        },
    };
    return {
        timers,
        requested,
        intervals,
        timeouts,
        advance(ms: number) {
            now += ms;
        },
        /** Runs every pending timeout once (each is removed first). */
        fireTimeouts() {
            const due = [...timeouts.entries()];
            for (const [handle, { run }] of due) {
                timeouts.delete(handle);
                run();
            }
        },
        /** Runs every interval of `ms` once. */
        fireIntervals(ms: number) {
            for (const { run, ms: every } of [...intervals.values()]) if (every === ms) run();
        },
    };
}

/** Lets every pending microtask and the I/O phase run once: what an awaited memory store needs. */
function turn(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

interface ReportedError {
    event: string;
    error: unknown;
    context?: { sessionId: string };
}

interface Harness {
    clock: { now: number };
    advance(ms: number): void;
    sessions: MemoryStreamSessionStore;
    connections: ReturnType<typeof createMemoryStreamerConnectionStore>;
    source: FakeSource;
    runtime: StreamerSessionRuntime;
    deps: StreamerSessionServiceDeps;
    features: { streamerShowcaseAllCosmetics: boolean };
    emitted: Array<{ sessionId: string; kind: "host" | "public"; payload: HostStreamSnapshot | PublicStreamSnapshot }>;
    ended: Array<{ sessionId: string; reason: string }>;
    rotated: string[];
    errors: ReportedError[];
    lastHost(): HostStreamSnapshot;
    lastPublic(): PublicStreamSnapshot;
}

const runtimes: StreamerSessionRuntime[] = [];

function harness(
    options: {
        source?: FakeSource;
        sessions?: MemoryStreamSessionStore;
        tickMs?: number;
        drainTimeoutMs?: number;
        timers?: StreamerTimers;
        checkConnection?: (connection: SessionConnection) => Promise<ConnectionCheck>;
    } = {},
): Harness {
    const clock = { now: START };
    const sessions = options.sessions ?? createMemoryStreamSessionStore();
    const connections = createMemoryStreamerConnectionStore();
    const source = options.source ?? cyclingSource();
    const features = { streamerShowcaseAllCosmetics: false };
    const emitted: Harness["emitted"] = [];
    const ended: Harness["ended"] = [];
    const rotated: string[] = [];
    const errors: ReportedError[] = [];
    const onError = (event: string, error: unknown, context?: { sessionId: string }) => errors.push({ event, error, context });
    const runtime = createStreamerSessionRuntime({
        store: sessions,
        wordSource: source,
        now: () => clock.now,
        emit: (sessionId, kind, payload) => emitted.push({ sessionId, kind, payload }),
        onEnded: (sessionId, reason) => ended.push({ sessionId, reason }),
        onError,
        tickMs: options.tickMs ?? 5,
        drainTimeoutMs: options.drainTimeoutMs,
        timers: options.timers,
        checkConnection: options.checkConnection,
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
        deps: { sessions, connections, runtime, now: () => clock.now, getFeatureFlags: async () => features, cardBackLoaders: CARD_BACK_LOADERS, onError },
        features,
        emitted,
        ended,
        rotated,
        errors,
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

// ------------------------------------------------------------ HTTP route harness
//
// The route handlers run as they are; only the modules that need a Next request (the session
// cookie), the database (system settings), Redis (rate limits) or the real wiring (session deps)
// are replaced, through the CommonJS module cache, before a route is first loaded. Every fake
// logs what was asked of it, so a test reads the order of the checks.

interface RouteWorld {
    user: { id: number; role: string; accountStatus: string } | null;
    modeOn: boolean;
    limited: boolean;
    calls: string[];
    deps: StreamerSessionServiceDeps | null;
}

const routeWorld: RouteWorld = { user: null, modeOn: true, limited: false, calls: [], deps: null };

function fakeModule(relativePath: string, exports: Record<string, unknown>): void {
    const filename = require.resolve(path.resolve(relativePath));
    const fake = new Module(filename);
    fake.filename = filename;
    fake.loaded = true;
    fake.exports = exports;
    require.cache[filename] = fake;
}

function worldDeps(): StreamerSessionServiceDeps {
    routeWorld.calls.push("work");
    assert.ok(routeWorld.deps, "a test set the route deps");
    return routeWorld.deps;
}

let routeFakesInstalled = false;
function installRouteFakes(): void {
    if (routeFakesInstalled) return;
    routeFakesInstalled = true;
    fakeModule("apps/web/src/lib/session.ts", {
        getSessionUser: async () => {
            routeWorld.calls.push("auth");
            return routeWorld.user;
        },
    });
    fakeModule("apps/web/src/lib/system-settings/service.ts", {
        getSystemSettings: async () => {
            routeWorld.calls.push("mode");
            return { features: { streamerModeEnabled: routeWorld.modeOn, streamerShowcaseAllCosmetics: false } };
        },
    });
    fakeModule("apps/web/src/lib/security/request-rate-limit.ts", {
        ...realRateLimit,
        consumeDistributedRequestRateLimit: async (options: { bucket: string; maxRequests: number }) => {
            routeWorld.calls.push(`limit:${options.bucket}`);
            return routeWorld.limited
                ? { allowed: false, limit: options.maxRequests, remaining: 0, retryAfterSeconds: 60 }
                : { allowed: true, limit: options.maxRequests, remaining: options.maxRequests - 1, retryAfterSeconds: 0 };
        },
    });
    fakeModule("apps/web/src/lib/streamer/session-deps.ts", {
        createSessionServiceDeps: worldDeps,
        getStreamerSessionRuntime: () => worldDeps().runtime,
    });
}

interface StreamerRoutes {
    collection: typeof import("../apps/web/src/app/api/streamer/sessions/route");
    end: typeof import("../apps/web/src/app/api/streamer/sessions/current/end/route");
    viewKey: typeof import("../apps/web/src/app/api/streamer/sessions/current/view-key/route");
    testGuess: typeof import("../apps/web/src/app/api/streamer/sessions/current/test-guess/route");
}

async function loadRoutes(): Promise<StreamerRoutes> {
    installRouteFakes();
    const load = (file: string) => import(pathToFileURL(path.resolve(`apps/web/src/app/api/streamer/sessions/${file}`)).href);
    return {
        collection: await load("route.ts"),
        end: await load("current/end/route.ts"),
        viewKey: await load("current/view-key/route.ts"),
        testGuess: await load("current/test-guess/route.ts"),
    };
}

const ROUTE_ORIGIN = "http://localhost:3000";

function routeRequest(pathname: string, body?: unknown, origin = ROUTE_ORIGIN): NextRequest {
    return new NextRequest(`${ROUTE_ORIGIN}/api/streamer/sessions${pathname}`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

async function answerOf(response: Response): Promise<{ status: number; body: Record<string, unknown> | null }> {
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

/** Resets the fakes for one request: an active user 1, the mode on, quota left. */
function resetRouteWorld(h: Harness, overrides: Partial<RouteWorld> = {}): void {
    Object.assign(routeWorld, { user: { id: 1, role: "user", accountStatus: "active" }, modeOn: true, limited: false, calls: [], deps: h.deps }, overrides);
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
        assert.equal(createSessionInputSchema.safeParse({ ...INPUT, clock: "ring", cardBack: { itemId: 10 } }).success, true);
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
            ["card back 0", { ...INPUT, cardBack: { itemId: 0 } }],
            ["card back old collection", { ...INPUT, cardBack: { collection: 1 } }],
            ["card back extra key", { ...INPUT, cardBack: { itemId: 1, variant: 2 } }],
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

    await test("CreateSessionInput dedupes categories and difficulties: at most 100 raw entries, then 3 difficulties and 20 distinct categories", async () => {
        // Difficulties dedupe first, then the cap of 3 applies (same shape as categories).
        for (const [difficulties, expected] of [
            [[1, 2, 3, 1], [1, 2, 3]],
            [[1, 1, 1, 1], [1]],
            [[1, 2, 3, 3, 2, 1], [1, 2, 3]],
            [[3, 3, 1], [3, 1]],
        ] as const) {
            const parsed = createSessionInputSchema.safeParse({ ...INPUT, difficulties });
            assert.ok(parsed.success, `${JSON.stringify(difficulties)} is accepted`);
            assert.deepEqual(parsed.data.difficulties, expected);
        }
        const twice = createSessionInputSchema.safeParse({ ...INPUT, difficulties: [1, 1, 2] });
        assert.ok(twice.success, "[1, 1, 2] is accepted");
        assert.deepEqual(twice.data.difficulties, [1, 2]);
        // The raw lists are capped before the dedupe: 100 entries pass, 101 never do, however few are distinct.
        assert.deepEqual(createSessionInputSchema.parse({ ...INPUT, categoryIds: Array.from({ length: 100 }, () => 5) }).categoryIds, [5]);
        assert.equal(createSessionInputSchema.safeParse({ ...INPUT, categoryIds: Array.from({ length: 101 }, () => 5) }).success, false, "101 raw ids must be rejected");
        assert.equal(
            createSessionInputSchema.safeParse({ ...INPUT, categoryIds: Array.from({ length: 101 }, (_, index) => (index % 20) + 1) }).success,
            false,
            "101 raw ids with 20 distinct must be rejected",
        );
        assert.deepEqual(createSessionInputSchema.parse({ ...INPUT, difficulties: Array.from({ length: 100 }, () => 2) }).difficulties, [2]);
        assert.equal(createSessionInputSchema.safeParse({ ...INPUT, difficulties: Array.from({ length: 101 }, () => 2) }).success, false, "101 raw difficulties must be rejected");
        // 25 ids, 20 distinct: repeats collapse before the cap of 20, first-seen order kept.
        const twenty = Array.from({ length: 20 }, (_, index) => index + 1);
        const repeated = [...twenty, 5, 1, 20, 5, 3];
        assert.equal(repeated.length, 25);
        const collapsed = createSessionInputSchema.safeParse({ ...INPUT, categoryIds: repeated });
        assert.ok(collapsed.success, "25 ids with 20 distinct are accepted");
        assert.deepEqual(collapsed.data.categoryIds, twenty);
        assert.deepEqual(createSessionInputSchema.parse({ ...INPUT, categoryIds: [7, 7, 7, 7] }).categoryIds, [7]);
        const tooMany = Array.from({ length: 21 }, (_, index) => index + 1);
        assert.equal(createSessionInputSchema.safeParse({ ...INPUT, categoryIds: tooMany }).success, false, "21 distinct ids must be rejected");
        assert.equal(
            createSessionInputSchema.safeParse({ ...INPUT, categoryIds: [...tooMany, 1, 21] }).success,
            false,
            "21 distinct ids with repeats must be rejected",
        );
        // The stored row, the session view, the word filters and the next form's prefill all get the deduplicated lists.
        const h = harness();
        const { session } = await opened(h, 1, { ...INPUT, categoryIds: repeated, difficulties: [2, 2, 1] });
        const stored = h.sessions.rows[0].settings as CreateSessionInput;
        assert.deepEqual(stored.categoryIds, twenty);
        assert.deepEqual(stored.difficulties, [2, 1]);
        assert.deepEqual(session.settings?.categoryIds, twenty);
        assert.deepEqual(session.settings?.difficulties, [2, 1]);
        await h.runtime.start(session.id);
        assert.deepEqual(h.source.calls[0].filters, { categoryIds: twenty, difficulties: [2, 1], locale: "tr" });
        await h.runtime.end(session.id, "ended");
        const last = await lastSettings(h.deps, 1);
        assert.deepEqual(last?.categoryIds, twenty);
        assert.deepEqual(last?.difficulties, [2, 1]);
    });

    await test("card back: an owned item opens the session; the public snapshot carries the resolved theme", async () => {
        const h = harness();
        const { session } = await opened(h, 1, { ...INPUT, cardBack: { itemId: 10 } });
        assert.deepEqual(session.settings?.cardBack, { itemId: 10 });
        const back = h.lastPublic().cardBack;
        assert.deepEqual(back, await resolveCardBackSelection(1, 10, h.features, CARD_BACK_LOADERS));
        assert.deepEqual([back?.itemId, back?.name, back?.imageUrl], [10, "Kor", "/cosmetics/10.svg"]);
        // The colours come from the item's template config; the pattern is the epic rarity's (a top-level `pattern` is no template path).
        assert.deepEqual([back?.theme.surfaceColor, back?.theme.borderColor, back?.theme.pattern], ["#102030", "#405060", "dots"]);
        // The row keeps the choice, never the resolved theme.
        assert.deepEqual((h.sessions.rows[0].settings as { cardBack: unknown }).cardBack, { itemId: 10 });
    });

    await test("card back: a non-owned item is refused while the showcase switch is off, accepted when on", async () => {
        const h = harness();
        h.connections.seed(connection(1, "twitch"));
        await rejectsWith(() => createSession(h.deps, { userId: 1, settings: { ...INPUT, cardBack: { itemId: 11 } } }), "card_not_allowed");
        assert.equal(h.sessions.rows.length, 0);
        assert.ok(!h.runtime.forUser(1));
        h.features.streamerShowcaseAllCosmetics = true;
        const { session } = await createSession(h.deps, { userId: 1, settings: { ...INPUT, cardBack: { itemId: 11 } } });
        assert.deepEqual(session.settings?.cardBack, { itemId: 11 });
        const back = h.lastPublic().cardBack;
        assert.deepEqual(back, await resolveCardBackSelection(1, 11, h.features, CARD_BACK_LOADERS));
        assert.deepEqual([back?.itemId, back?.name, back?.imageUrl], [11, "Buz", "/cosmetics/11.svg"]);
        assert.deepEqual([back?.theme.surfaceColor, back?.theme.borderColor, back?.theme.pattern], ["#102030", "#405060", "dots"]);
    });

    await test("card back: the availability window is judged by the service clock, on both sides of each edge", async () => {
        // Real time is already past both edges: only the injected clock can make these selectable.
        const closes = START + HOUR;
        const opens = START + 2 * HOUR;
        const h = harness();
        h.features.streamerShowcaseAllCosmetics = true;
        h.deps.cardBackLoaders = {
            ...CARD_BACK_LOADERS,
            catalog: async () => [
                { ...cardBackItem(13, "Son"), endsAt: new Date(closes).toISOString() },
                { ...cardBackItem(14, "Ilk"), startsAt: new Date(opens).toISOString() },
            ],
        };
        const tryOpen = async (itemId: number) => {
            const { session } = await opened(h, 1, { ...INPUT, cardBack: { itemId } });
            const back = h.lastPublic().cardBack;
            await h.runtime.end(session.id, "ended");
            return back;
        };
        assert.equal((await tryOpen(13))?.name, "Son", "before the end of its window");
        h.clock.now = closes;
        assert.equal((await tryOpen(13))?.name, "Son", "at the last instant of its window");
        h.clock.now = closes + 1;
        await rejectsWith(() => tryOpen(13), "card_not_allowed");
        h.clock.now = opens - 1;
        await rejectsWith(() => tryOpen(14), "card_not_allowed");
        h.clock.now = opens;
        assert.equal((await tryOpen(14))?.name, "Ilk", "from the first instant of its window");
        assert.ok(!h.runtime.forUser(1));
    });

    await test("card back: a failing loader or flag read opens no session (card_catalogue_unavailable)", async () => {
        const h = harness();
        h.connections.seed(connection(1, "twitch"));
        const input = { ...INPUT, cardBack: { itemId: 10 } };
        const broken = [
            { ...h.deps, cardBackLoaders: { ...CARD_BACK_LOADERS, inventory: async () => { throw new Error("db down"); } } },
            { ...h.deps, getFeatureFlags: async () => { throw new Error("settings down"); } },
        ];
        for (const deps of broken) await rejectsWith(() => createSession(deps, { userId: 1, settings: input }), "card_catalogue_unavailable");
        assert.equal(h.sessions.rows.length, 0);
        assert.ok(!h.runtime.forUser(1));
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
        await h.runtime.flush();
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
        await h.runtime.flush();
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
        await h.runtime.flush();
        assert.equal(h.lastPublic().phase, "finished");
        assert.equal(h.sessions.results.length, 1);
        assert.equal(h.sessions.results[0].outcome, "timeout");
        assert.equal(h.sessions.results[0].endedAt.getTime(), START + 60_000, "it ended at its deadline");
        assert.equal(h.lastPublic().reveal?.solved, false);
        await h.runtime.tickAll();
        await h.runtime.flush();
        assert.equal(h.sessions.results.length, 1, "the tick that follows records nothing more");
    });

    await test("a timed-out round ends at its deadline, however late the tick, guess, host action or end comes", async () => {
        for (const late of ["tick", "guess", "pause", "end"] as const) {
            const h = harness();
            const { session } = await opened(h);
            h.advance(2_000);
            await h.runtime.start(session.id);
            h.advance(60_000 + 7_500);
            if (late === "tick") await h.runtime.tickAll();
            if (late === "guess") assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina")), "closed");
            if (late === "pause") await rejectsWith(() => h.runtime.pause(session.id), "invalid_phase");
            if (late === "end") await h.runtime.end(session.id, "ended");
            await h.runtime.flush();
            assert.equal(h.sessions.results.length, 1, late);
            const [result] = h.sessions.results;
            assert.equal(result.outcome, "timeout", late);
            assert.equal(result.startedAt.getTime(), START + 2_000, late);
            assert.equal(result.endedAt.getTime(), START + 62_000, `${late}: the round ended at its deadline, not when it was noticed`);
        }
    });

    await test("pass → passed result and the passed word in the next public snapshot", async () => {
        const h = harness();
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        h.advance(5_000);
        await h.runtime.pass(session.id);
        await h.runtime.flush();
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
        await h.runtime.flush();
        assert.equal(h.sessions.results[1].outcome, "timeout");
        assert.equal(h.sessions.results[1].round, 2);
        assert.equal(h.sessions.results[1].startedAt.getTime(), START + 5_000);
        await rejectsWith(() => h.runtime.pass(session.id), "invalid_phase");
    });

    await test("a pass after the deadline records the timeout and draws no card", async () => {
        const h = harness();
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        assert.equal(h.source.calls.length, 1);
        h.advance(60_000 + 3_000);
        await rejectsWith(() => h.runtime.pass(session.id), "invalid_phase");
        await h.runtime.flush();
        assert.equal(h.source.calls.length, 1, "the late pass consumed no word of the pool");
        assert.deepEqual(h.sessions.results.map((result) => [result.round, result.outcome]), [[1, "timeout"]]);
        assert.equal(h.sessions.results[0].endedAt.getTime(), START + 60_000);
        const pub = h.lastPublic();
        assert.equal(pub.phase, "finished");
        assert.equal(pub.round, 1);
        assert.equal(pub.passed, null);
        await h.runtime.next(session.id);
        assert.deepEqual(h.lastHost().card, DECK[1], "the next round gets the word the late pass did not take");
    });

    await test("a pass in time keeps the card it drew, even when the draw outlasts the deadline", async () => {
        const source = cyclingSource();
        const h = harness({ source });
        const draw = source.next.bind(source);
        // The second draw (the pass) is slow: the round's deadline goes by while it runs.
        source.next = async (poolKey, filters) => {
            if (source.calls.length === 1) h.advance(10_000);
            return draw(poolKey, filters);
        };
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        h.advance(55_000);
        await h.runtime.pass(session.id);
        await h.runtime.flush();
        assert.equal(source.calls.length, 2, "one draw for the pass");
        assert.deepEqual(h.sessions.results.map((result) => [result.round, result.outcome]), [[1, "passed"]], "the pass came in time: no timeout");
        assert.equal(h.sessions.results[0].endedAt.getTime(), START + 55_000, "the pass took effect when it was handled");
        const host = h.lastHost();
        assert.equal(host.phase, "running");
        assert.equal(host.round, 2);
        assert.deepEqual(host.card, DECK[1], "the drawn card is the new round's card, not lost");
        assert.deepEqual(host.passed, { round: 1, target: DECK[0].target });
    });

    await test("a slow pass draw does not shorten the new round: it starts when the card arrived; chat sent meanwhile is stale", async () => {
        const source = cyclingSource();
        const h = harness({ source });
        const draw = source.next.bind(source);
        // The pass's draw takes 10 s.
        source.next = async (poolKey, filters) => {
            if (source.calls.length === 1) h.advance(10_000);
            return draw(poolKey, filters);
        };
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        h.advance(30_000);
        const handledAt = h.clock.now;
        await h.runtime.pass(session.id);
        const arrivedAt = handledAt + 10_000;
        assert.equal(h.clock.now, arrivedAt);
        await h.runtime.flush();
        assert.equal(h.sessions.results[0].endedAt.getTime(), handledAt, "the passed round ended when the pass was handled");
        assert.equal(await h.runtime.guess(session.id, chat(h, "buzdolabi", "mira", { sentAt: handledAt + 5_000 })), "stale", "sent during the draw");
        h.advance(59_000);
        await h.runtime.tickAll();
        assert.equal(h.lastHost().phase, "running", "59 s after the card arrived the round still runs");
        assert.equal(h.lastHost().remaining, 1);
        assert.equal(await h.runtime.guess(session.id, chat(h, "buzdolabi", "luna", { sentAt: arrivedAt })), "correct");
        assert.equal(h.lastHost().lastCorrect?.solveMs, 59_000, "the solve time counts from when the card arrived");
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
        await h.runtime.flush();
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
        await h.runtime.flush();
        const stored = await lastSettings(h.deps, 1);
        assert.deepEqual(stored, { ...INPUT, theme: "gece-altini", camera: "left", clock: "candle", showCardName: false });
    });

    await test("applySettings parses its patch: anything off the schema is invalid_settings and changes nothing", async () => {
        const h = harness();
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        const theme = (await resolveCardBackSelection(1, 10, h.features, CARD_BACK_LOADERS)).theme;
        const bad: Array<[string, unknown]> = [
            ["unknown theme", { theme: "neon" }],
            ["unknown camera", { camera: "center" }],
            ["camera size xl", { cameraSize: "xl" }],
            ["unknown clock", { clock: "sundial" }],
            ["showCardName string", { showCardName: "yes" }],
            ["unknown key", { theme: "sade", duration: 30 }],
            ["an unresolved card back", { cardBack: { itemId: 10 } }],
            ["card back item 0", { cardBack: { itemId: 0, name: "Kor", theme, imageUrl: null } }],
            ["card back without a theme", { cardBack: { itemId: 10, name: "Kor", theme: null, imageUrl: null } }],
            ["card back with a bad theme value", { cardBack: { itemId: 10, name: "Kor", theme: { ...theme, glowBlur: "x" }, imageUrl: null } }],
            ["null", null],
            ["a string", "sakura"],
            ["an array", [{ theme: "sakura" }]],
        ];
        const revision = h.lastPublic().revision;
        for (const [label, patch] of bad) {
            await assert.rejects(
                () => h.runtime.applySettings(session.id, patch as never),
                (error: unknown) => isStreamerSessionError(error) && error.code === "invalid_settings",
                label,
            );
        }
        await h.runtime.flush();
        assert.equal(h.lastPublic().revision, revision, "a refused patch emits nothing");
        assert.equal(h.lastPublic().theme, "studyo");
        assert.deepEqual(await lastSettings(h.deps, 1), INPUT, "nor is it stored");
        // A resolved card back is what the socket passes on; it is accepted.
        await h.runtime.applySettings(session.id, { theme: "sade", cardBack: { itemId: 10, name: "Kor", theme, imageUrl: "/cosmetics/10.svg" } });
        assert.equal(h.lastPublic().theme, "sade");
        assert.equal(h.lastPublic().cardBack?.itemId, 10);
        await h.runtime.applySettings(session.id, { cardBack: null });
        assert.equal(h.lastPublic().cardBack, null);
        // The code maps to the generic invalid request answer.
        const response = streamerSessionErrorResponse(new StreamerSessionError("invalid_settings"));
        assert.equal(response?.status, 400);
        assert.equal(((await response?.json()) as { code: string }).code, "INVALID_REQUEST");
        assert.deepEqual(h.errors, []);
    });

    await test("applySettings bounds a resolved card back with the public projection's own rules before it is kept", async () => {
        const h = harness();
        const row = await h.sessions.create({ userId: 1, connectionId: null, platform: "twitch", settings: INPUT, viewKeyHash: "f".repeat(64), startedAt: new Date(START) });
        const state = createStreamSession(toScreenSettings(INPUT, null), START);
        h.runtime.open(row, state);
        const theme = (await resolveCardBackSelection(1, 10, h.features, CARD_BACK_LOADERS)).theme;
        const hostile: StreamCardBack = {
            itemId: 10,
            name: `  Kor\u0007${"x".repeat(200)}`,
            theme: {
                ...theme,
                surfaceColor: "red; background:url(https://evil.example/x)",
                borderColor: "#12345",
                pattern: "spiral",
                motionPreset: "explode",
                patternScale: 9_999,
                patternOpacity: -3,
                motionSpeedMs: 1e12,
                glowBlur: 1.7,
                renderSpecVersion: -2.5,
                overlayImageUrl: "javascript:alert(1)",
                overlayOpacity: 9,
            },
            imageUrl: "//evil.example/back.png",
        };
        await h.runtime.applySettings(row.id, { cardBack: hostile });
        const kept = state.settings.cardBack;
        assert.deepEqual(kept, boundCardBack(hostile), "the session keeps exactly what the public projection makes of it");
        assert.ok(kept);
        assert.equal(kept.name.length, 60);
        assert.equal(kept.name.startsWith("Korx"), true, "control characters dropped, trimmed");
        assert.equal(kept.theme.surfaceColor, "#0f172a", "a colour that is no hex colour takes its default");
        assert.equal(kept.theme.borderColor, "#475569");
        assert.equal(kept.theme.pattern, "none");
        assert.equal(kept.theme.motionPreset, "none");
        assert.equal(kept.theme.patternScale, 42);
        assert.equal(kept.theme.patternOpacity, 0);
        assert.equal(kept.theme.motionSpeedMs, 12_000);
        assert.equal(kept.theme.glowBlur, 8);
        assert.equal(kept.theme.renderSpecVersion, 0);
        assert.equal(kept.theme.overlayImageUrl, null);
        assert.equal(kept.theme.overlayOpacity, 0.45);
        assert.equal(kept.imageUrl, null);
        assert.deepEqual(h.lastPublic().cardBack, kept, "the stream screen shows what the session keeps");
        assert.deepEqual(h.lastHost().cardBack, kept);
        // One validator: the schema's output is the domain projection, a well-formed card back passes unchanged.
        const owned = await resolveCardBackSelection(1, 10, h.features, CARD_BACK_LOADERS);
        assert.deepEqual(resolvedScreenPatchSchema.parse({ cardBack: owned }).cardBack, boundCardBack(owned));
        assert.deepEqual(boundCardBack(owned), owned, "a resolved card back is already within the bounds");
        await h.runtime.applySettings(row.id, { cardBack: owned });
        assert.deepEqual(state.settings.cardBack, owned);
        assert.deepEqual(h.errors, []);
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
        const endedAt = h.clock.now;
        const ended = await endCurrent(h.deps, 1);
        assert.equal(ended.sessionId, session.id);
        // The ended view is what the end call produced: status, end time, rounds and summary.
        assert.deepEqual(ended.session, {
            ...session,
            status: "ended",
            interrupted: false,
            endedAt: new Date(endedAt).toISOString(),
            roundCount: 15,
            summary: ended.summary,
        });
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

    await test("idle for 6 h since the last host action → auto end with reason idle; closed chat keeps nothing alive", async () => {
        const h = harness();
        const { session } = await opened(h);
        h.advance(5 * HOUR);
        assert.equal(await h.runtime.guess(session.id, chat(h, "merhaba")), "closed");
        h.advance(HOUR - 1);
        await h.runtime.tickAll();
        assert.ok(h.runtime.get(session.id));
        h.advance(1);
        await h.runtime.tickAll();
        assert.equal(h.runtime.get(session.id), null, "a closed guess is no activity");
        assert.deepEqual(h.ended, [{ sessionId: session.id, reason: "idle" }]);
        const row = await h.sessions.findById(session.id);
        assert.equal(row?.status, "ended");
        assert.deepEqual(row?.summary, { scores: [], participants: 0, rounds: 0 }, "a closed guess adds no participant");
        assert.ok(h.source.cleared.includes(`streamer:${session.id}`));
        assert.equal(STREAM_SESSION_IDLE_TIMEOUT_MS, 6 * HOUR);
    });

    await test("idle clock: stale, duplicate, invalid and closed guesses of a live round do not reset it", async () => {
        const h = harness();
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        h.advance(30_000);
        const counted = chat(h, "yanlis", "mira");
        assert.equal(await h.runtime.guess(session.id, counted), "wrong", "the last activity: START + 30 s");
        h.advance(1_000);
        assert.equal(await h.runtime.guess(session.id, { ...counted, text: "portakal" }), "duplicate");
        assert.equal(await h.runtime.guess(session.id, chat(h, "portakal", "eski", { sentAt: START - 1 })), "stale");
        assert.equal(await h.runtime.guess(session.id, chat(h, "🎉🎉", "emoji")), "invalid");
        h.advance(40_000);
        assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina", "geç")), "closed");
        for (let hour = 1; hour < 6; hour++) {
            h.advance(HOUR);
            assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina", `spam${hour}`)), "closed");
        }
        h.clock.now = START + 30_000 + STREAM_SESSION_IDLE_TIMEOUT_MS - 1;
        await h.runtime.tickAll();
        assert.ok(h.runtime.get(session.id), "6 h since the wrong guess are not over yet");
        h.advance(1);
        await h.runtime.tickAll();
        assert.equal(h.runtime.get(session.id), null, "only the wrong guess counted");
        assert.deepEqual(h.ended, [{ sessionId: session.id, reason: "idle" }]);
    });

    for (const kind of ["wrong", "correct"] as const) {
        await test(`idle clock: a ${kind} guess resets it`, async () => {
            const h = harness();
            const { session } = await opened(h);
            await h.runtime.start(session.id);
            h.advance(HOUR);
            await h.runtime.tickAll();
            await h.runtime.next(session.id);
            const hostAt = h.clock.now;
            h.advance(10_000);
            assert.equal(await h.runtime.guess(session.id, chat(h, kind === "correct" ? DECK[1].target : "yanlis")), kind);
            h.clock.now = hostAt + STREAM_SESSION_IDLE_TIMEOUT_MS;
            await h.runtime.tickAll();
            assert.ok(h.runtime.get(session.id), `6 h after the host action, the ${kind} guess keeps it alive`);
            h.clock.now = hostAt + 10_000 + STREAM_SESSION_IDLE_TIMEOUT_MS;
            await h.runtime.tickAll();
            assert.equal(h.runtime.get(session.id), null);
            assert.deepEqual(h.ended, [{ sessionId: session.id, reason: "idle" }]);
        });
    }

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
        await h.runtime.flush();
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

    await test("a pass that gets no next card is refused atomically: same card, nothing recorded or emitted (running and paused)", async () => {
        for (const paused of [false, true]) {
            const h = harness({ source: cyclingSource([DECK[0], null]) });
            const { session } = await opened(h);
            await h.runtime.start(session.id);
            h.advance(4_000);
            if (paused) await h.runtime.pause(session.id);
            const revision = h.lastPublic().revision;
            await rejectsWith(() => h.runtime.pass(session.id), "word_source_empty");
            await h.runtime.flush();
            const host = h.runtime.get(session.id)!.hostSnapshot();
            assert.equal(host.phase, paused ? "paused" : "running");
            assert.equal(host.round, 1);
            assert.deepEqual(host.card, DECK[0], "a live round never goes on without its card");
            assert.equal(host.passed, null);
            assert.equal(host.passedRound, null);
            assert.equal(h.lastPublic().revision, revision, "nothing emitted");
            assert.equal(h.sessions.results.length, 0, "nothing recorded");
            assert.equal((await h.sessions.findById(session.id))?.roundCount, 0);
            if (paused) await h.runtime.resume(session.id);
            assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina")), "correct", "the round goes on");
        }
    });

    // ------------------------------------------------------------ persistence off the action queue

    await test("persistence: a store whose writes hang delays no tick, guess or host action", async () => {
        const held = holdingStore();
        const h = harness({ sessions: held.store });
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        held.hold();
        try {
            assert.equal(await quick(h.runtime.guess(session.id, chat(h, "mandalina")), "the correct guess"), "correct");
            assert.deepEqual(held.log, ["result:1:solved"], "the round-1 write started and hangs");
            const steps: Array<[string, () => Promise<unknown>]> = [
                ["next", () => h.runtime.next(session.id)],
                ["a wrong guess", () => h.runtime.guess(session.id, chat(h, "yanlis", "mira"))],
                ["settings", () => h.runtime.applySettings(session.id, { theme: "sakura" })],
                ["a tick", () => (h.advance(1_000), h.runtime.tickAll())],
                ["pause", () => h.runtime.pause(session.id)],
                ["resume", () => h.runtime.resume(session.id)],
                ["pass", () => h.runtime.pass(session.id)],
            ];
            for (const [label, step] of steps) await quick(step(), label);
            const pub = h.lastPublic();
            assert.equal(pub.round, 3);
            assert.equal(pub.phase, "running");
            assert.equal(pub.theme, "sakura");
            assert.equal(pub.remaining, 60);
            assert.deepEqual(held.log, ["result:1:solved"], "later writes wait their turn");
            assert.equal(h.sessions.results.length, 0);
        } finally {
            held.release();
        }
        await h.runtime.flush();
        assert.deepEqual(h.sessions.results.map((result) => [result.round, result.outcome]), [[1, "solved"], [2, "passed"]]);
        const row = await h.sessions.findById(session.id);
        assert.equal(row?.roundCount, 2);
        assert.equal((row?.settings as CreateSessionInput).theme, "sakura");
        assert.deepEqual(h.errors, []);
    });

    await test("persistence: writes land one at a time, in the order they were queued", async () => {
        const held = holdingStore();
        const h = harness({ sessions: held.store });
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        held.hold();
        try {
            await quick(h.runtime.guess(session.id, chat(h, "mandalina")), "the correct guess");
            await quick(h.runtime.applySettings(session.id, { camera: "left" }), "settings");
            await quick(h.runtime.next(session.id), "next");
            await quick(h.runtime.pass(session.id), "pass");
            assert.deepEqual(held.log, ["result:1:solved"], "nothing overtakes the first write");
        } finally {
            held.release();
        }
        await h.runtime.flush();
        assert.deepEqual(held.log, ["result:1:solved", "update:roundCount", "update:settings", "result:2:passed", "update:roundCount"]);
        const row = await h.sessions.findById(session.id);
        assert.equal(row?.roundCount, 2);
        assert.equal((row?.settings as CreateSessionInput).camera, "left");
    });

    await test("persistence: end waits for the pending writes of its session; the summary counts them", async () => {
        const held = holdingStore();
        const h = harness({ sessions: held.store });
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        held.hold();
        let ending: Promise<StreamSessionSummary> | null = null;
        try {
            await quick(h.runtime.guess(session.id, chat(h, "mandalina")), "the correct guess");
            ending = h.runtime.end(session.id, "ended");
            assert.equal(await settlesNow(ending), false, "end waits for the round-1 write");
            assert.equal(h.runtime.get(session.id), null, "the session is closed meanwhile");
            assert.deepEqual(h.ended, [], "and not reported ended yet");
        } finally {
            held.release();
        }
        const summary = await ending!;
        assert.deepEqual(summary, { scores: [{ name: "Luna", points: 1, rank: 1, tied: false }], participants: 1, rounds: 1 });
        assert.deepEqual(held.log, ["result:1:solved", "update:roundCount", "update:endedAt,roundCount,status,summary"]);
        const row = await h.sessions.findById(session.id);
        assert.equal(row?.status, "ended");
        assert.equal(row?.roundCount, 1);
        assert.deepEqual(row?.summary, summary);
        assert.deepEqual(h.ended, [{ sessionId: session.id, reason: "ended" }]);
    });

    await test("persistence: idle end and stop wait for the pending writes too", async () => {
        for (const how of ["idle", "stop"] as const) {
            const held = holdingStore();
            const h = harness({ sessions: held.store });
            const { session } = await opened(h);
            await h.runtime.start(session.id);
            held.hold();
            let closing: Promise<unknown> | null = null;
            try {
                await quick(h.runtime.guess(session.id, chat(h, "mandalina")), "the correct guess");
                if (how === "idle") {
                    h.advance(STREAM_SESSION_IDLE_TIMEOUT_MS);
                    closing = h.runtime.tickAll();
                } else {
                    closing = h.runtime.stop();
                }
                assert.equal(await settlesNow(closing), false, `${how} waits for the round-1 write`);
            } finally {
                held.release();
            }
            await closing;
            await h.runtime.flush();
            const row = await h.sessions.findById(session.id);
            assert.equal(row?.status, how === "idle" ? "ended" : "interrupted", how);
            assert.equal(row?.roundCount, 1, how);
            assert.deepEqual(held.log.slice(0, 2), ["result:1:solved", "update:roundCount"], how);
            assert.equal(held.log.length, 3, how);
            if (how === "idle") assert.equal((row?.summary as StreamSessionSummary).rounds, 1);
        }
    });

    await test("persistence: a failing round write is reported once with the session id; it is not counted; the session goes on", async () => {
        const base = createMemoryStreamSessionStore();
        const sessions: MemoryStreamSessionStore = {
            ...base,
            async addRoundResult(result) {
                if (result.round === 1) throw new Error("db down");
                return base.addRoundResult(result);
            },
        };
        const h = harness({ sessions });
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina")), "correct");
        await h.runtime.flush();
        assert.equal((await h.sessions.findById(session.id))?.roundCount, 0, "a result that was not written is not counted");
        assert.equal(h.errors.length, 1);
        assert.equal(h.errors[0].event, "streamer_session.round_result_failed");
        assert.deepEqual(h.errors[0].context, { sessionId: session.id });
        await h.runtime.next(session.id);
        assert.equal(await h.runtime.guess(session.id, chat(h, "buzdolabi", "mira")), "correct");
        const summary = await h.runtime.end(session.id, "ended");
        assert.equal(summary.rounds, 1, "the summary counts written rounds only");
        const row = await h.sessions.findById(session.id);
        assert.equal(row?.status, "ended");
        assert.equal(row?.roundCount, 1);
        assert.deepEqual(h.sessions.results.map((result) => [result.round, result.outcome]), [[2, "solved"]]);
        assert.equal(h.errors.length, 1, "reported once");
    });

    await test("persistence: a failing settings or end write is reported with the session id and changes nothing else", async () => {
        const base = createMemoryStreamSessionStore();
        let failing = false;
        const sessions: MemoryStreamSessionStore = {
            ...base,
            async update(id, patch) {
                if (failing) throw new Error("db down");
                return base.update(id, patch);
            },
        };
        const h = harness({ sessions });
        const { session } = await opened(h);
        failing = true;
        await h.runtime.applySettings(session.id, { theme: "sakura" });
        assert.equal(h.lastPublic().theme, "sakura", "the stream screen has the change");
        await h.runtime.start(session.id);
        const summary = await h.runtime.end(session.id, "ended");
        assert.deepEqual(summary, { scores: [], participants: 0, rounds: 0 });
        assert.deepEqual(h.errors.map((error) => [error.event, error.context?.sessionId]), [
            ["streamer_session.settings_failed", session.id],
            ["streamer_session.end_failed", session.id],
        ]);
        assert.deepEqual(h.ended, [{ sessionId: session.id, reason: "ended" }], "the session still ends");
    });

    await test("persistence: end waits at most the drain bound for a hanging write, reports it once and finishes", async () => {
        const held = holdingStore();
        const h = harness({ sessions: held.store, drainTimeoutMs: 1 });
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        held.hold();
        try {
            await quick(h.runtime.guess(session.id, chat(h, "mandalina")), "the correct guess");
            const summary = await h.runtime.end(session.id, "ended");
            assert.equal(summary.rounds, 0, "the hanging result is not written yet");
            assert.deepEqual(h.ended, [{ sessionId: session.id, reason: "ended" }]);
            assert.equal(h.runtime.get(session.id), null);
            assert.deepEqual(h.errors.map((error) => [error.event, error.context]), [["streamer_session.persist_drain_timeout", { sessionId: session.id }]]);
            assert.equal(h.sessions.rows[0].status, "active", "the end write waits behind the hanging one");
        } finally {
            held.release();
        }
        await h.runtime.flush();
        const row = await h.sessions.findById(session.id);
        assert.equal(row?.status, "ended", "the end write lands once the database answers");
        assert.equal(row?.roundCount, 1);
        assert.equal((row?.summary as StreamSessionSummary).rounds, 1, "the stored summary counts what was written");
        assert.equal(h.errors.length, 1);
    });

    await test("persistence: end waits for the pending writes and for its own write within one shared deadline", async () => {
        const held = holdingStore();
        const finalGate = deferred();
        const sessions: MemoryStreamSessionStore = {
            ...held.store,
            async update(id, patch) {
                // The end write itself hangs, after the writes before it landed.
                if (patch.status === "ended") await finalGate.promise;
                return held.store.update(id, patch);
            },
        };
        const clock = manualTimers();
        const h = harness({ sessions, timers: clock.timers, drainTimeoutMs: 10_000 });
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        held.hold();
        await quick(h.runtime.guess(session.id, chat(h, "mandalina")), "the correct guess");
        const ending = h.runtime.end(session.id, "ended");
        await turn();
        assert.deepEqual(clock.requested, [10_000], "the drain waits at most the bound");
        // The pending write lands 6 s in; the end write then gets what is left of the bound.
        clock.advance(6_000);
        held.release();
        await turn();
        await turn();
        assert.deepEqual(clock.requested, [10_000, 4_000], "one deadline: the end write waits only the 4 s left");
        assert.equal(await settlesNow(ending), false, "the end write still hangs");
        clock.fireTimeouts();
        await ending;
        assert.deepEqual(h.errors.map((error) => error.event), ["streamer_session.persist_drain_timeout"], "the bound is reported once");
        assert.deepEqual(h.ended, [{ sessionId: session.id, reason: "ended" }]);
        finalGate.resolve();
        await h.runtime.flush();
        assert.equal((await h.sessions.findById(session.id))?.status, "ended", "the end write lands once the database answers");
    });

    await test("persistence: a rotate behind a hung write answers busy within the drain bound; the old key stays live", async () => {
        const held = holdingStore();
        const clock = manualTimers();
        const h = harness({ sessions: held.store, timers: clock.timers, drainTimeoutMs: 10_000 });
        const { session, viewKey } = await opened(h);
        const oldHash = hashViewKey(viewKey);
        await h.runtime.start(session.id);
        held.hold();
        await quick(h.runtime.guess(session.id, chat(h, "mandalina")), "the correct guess");
        const rotating = h.runtime.rotateViewKey(session.id);
        rotating.catch(() => undefined);
        await turn();
        assert.equal(await settlesNow(rotating), false, "the rotate waits for its turn behind the hung write");
        assert.deepEqual(clock.requested, [10_000], "bounded by the drain timeout");
        clock.fireTimeouts();
        await rejectsWith(() => rotating, "busy");
        assert.equal(h.runtime.get(session.id)?.viewKeyHash, oldHash, "the old key stays live");
        assert.deepEqual(h.rotated, [], "no stream screen was closed");
        held.release();
        await h.runtime.flush();
        assert.ok(!held.log.includes("update:viewKeyHash"), "a write given up before its turn never runs");
        assert.equal((await h.sessions.findByViewKeyHash(oldHash))?.id, session.id, "the stored key is still the live one");
        assert.equal(streamerSessionErrorResponse(new StreamerSessionError("busy"))?.status, 503);
        assert.equal((await streamerSessionErrorResponse(new StreamerSessionError("busy"))?.json())?.code, "SERVER_BUSY");
        assert.deepEqual(h.errors, []);
    });

    await test("persistence: a rotate whose own write lands after the bound is undone: the stored key goes back to the live one", async () => {
        const held = holdingStore();
        const clock = manualTimers();
        const h = harness({ sessions: held.store, timers: clock.timers, drainTimeoutMs: 10_000 });
        const { session, viewKey } = await opened(h);
        const oldHash = hashViewKey(viewKey);
        held.hold();
        const rotating = h.runtime.rotateViewKey(session.id);
        rotating.catch(() => undefined);
        await turn();
        assert.deepEqual(held.log, ["update:viewKeyHash"], "the rotate's own write started and hangs");
        clock.fireTimeouts();
        await rejectsWith(() => rotating, "busy");
        held.release();
        await h.runtime.flush();
        assert.deepEqual(held.log, ["update:viewKeyHash", "update:viewKeyHash"], "the late write landed, then the live key was written back");
        assert.equal((await h.sessions.findByViewKeyHash(oldHash))?.id, session.id, "the old key opens the stream screen again");
        assert.equal(h.runtime.get(session.id)?.viewKeyHash, oldHash);
        assert.deepEqual(h.rotated, []);
        // The database answers again: a rotation goes through.
        const rotated = await h.runtime.rotateViewKey(session.id);
        assert.equal((await h.sessions.findByViewKeyHash(hashViewKey(rotated.viewKey)))?.id, session.id);
        assert.deepEqual(h.rotated, [session.id]);
        assert.deepEqual(h.errors, []);
    });

    await test("persistence: a failed write is reported sanitized (name, Prisma code, a fixed message), never with its arguments", async () => {
        const planted = "PLANTED-Ayşe-yayin-ozeti";
        const prismaError = (name: string, code?: string) => {
            const error = Object.assign(new Error(`Invalid \`prisma.streamSession.update()\` invocation: { data: { summary: { scores: [{ name: "${planted}" }] } } }`), {
                meta: { target: planted },
                clientVersion: "6.0.0",
                ...(code ? { code } : {}),
            });
            error.name = name;
            return error;
        };
        const base = createMemoryStreamSessionStore();
        let failing = false;
        const sessions: MemoryStreamSessionStore = {
            ...base,
            async update(id, patch) {
                if (failing) throw prismaError("PrismaClientValidationError");
                return base.update(id, patch);
            },
            async addRoundResult() {
                throw prismaError("PrismaClientKnownRequestError", "P2000");
            },
        };
        const h = harness({ sessions });
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina")), "correct");
        failing = true;
        await h.runtime.applySettings(session.id, { theme: "sakura" });
        await h.runtime.end(session.id, "ended");
        assert.deepEqual(
            h.errors.map((error) => [error.event, (error.error as Error).name, (error.error as { code?: unknown }).code]),
            [
                ["streamer_session.round_result_failed", "PrismaClientKnownRequestError", "P2000"],
                ["streamer_session.settings_failed", "PrismaClientValidationError", undefined],
                ["streamer_session.end_failed", "PrismaClientValidationError", undefined],
            ],
        );
        for (const { error, context } of h.errors) {
            assert.ok(error instanceof Error, "an Error is reported");
            assert.equal(error.message, "stream session write failed");
            assert.deepEqual(context, { sessionId: session.id });
            for (const text of [error.message, String(error.stack), JSON.stringify(error), JSON.stringify(Object.getOwnPropertyNames(error).map((key) => Reflect.get(error, key)))]) {
                assert.ok(!text.includes(planted), `the report carries none of the call arguments: ${text.slice(0, 120)}`);
            }
        }
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

    await test("create interrupts every stale active row of the user, more than one batch, before it opens", async () => {
        const h = harness();
        h.connections.seed(connection(1, "twitch"));
        const stale = [];
        for (let index = 0; index < 25; index++) {
            stale.push(await h.sessions.create({ userId: 1, connectionId: null, platform: "twitch", settings: INPUT, viewKeyHash: index.toString(16).padStart(64, "a"), startedAt: new Date(START - (index + 1) * 60_000) }));
        }
        const other = await h.sessions.create({ userId: 2, connectionId: null, platform: "twitch", settings: INPUT, viewKeyHash: "b".repeat(64), startedAt: new Date(START) });
        const { session } = await createSession(h.deps, { userId: 1, settings: INPUT });
        for (const row of stale) assert.equal((await h.sessions.findById(row.id))?.status, "interrupted", "every stale row is interrupted");
        const active = h.sessions.rows.filter((row) => row.userId === 1 && row.status === "active");
        assert.deepEqual(active.map((row) => row.id), [session.id], "exactly one active row: the new one");
        assert.equal((await h.sessions.findById(other.id))?.status, "active", "rows of other users are untouched");
    });

    await test("create refuses rather than opening a second active row when a stale row will not flip", async () => {
        const base = createMemoryStreamSessionStore();
        const sessions: MemoryStreamSessionStore = { ...base, markInterrupted: async () => null };
        const h = harness({ sessions });
        h.connections.seed(connection(1, "twitch"));
        await sessions.create({ userId: 1, connectionId: null, platform: "twitch", settings: INPUT, viewKeyHash: "c".repeat(64), startedAt: new Date(START - HOUR) });
        await assert.rejects(() => createSession(h.deps, { userId: 1, settings: INPUT }));
        assert.equal(base.rows.filter((row) => row.status === "active").length, 1, "no second active row");
        assert.equal(h.runtime.forUser(1), null);
    });

    await test("currentSession: an interrupted row is shown for 24 h after it ended, then no longer", async () => {
        assert.equal(INTERRUPTED_NOTICE_TTL_MS, 24 * 60 * 60 * 1000);
        const cases: Array<[string, number | null, number, boolean]> = [
            ["ended exactly 24 h ago", START - INTERRUPTED_NOTICE_TTL_MS, START - 2 * INTERRUPTED_NOTICE_TTL_MS, true],
            ["ended 24 h and 1 ms ago", START - INTERRUPTED_NOTICE_TTL_MS - 1, START - 2 * INTERRUPTED_NOTICE_TTL_MS, false],
            ["no end time, started exactly 24 h ago", null, START - INTERRUPTED_NOTICE_TTL_MS, true],
            ["no end time, started 24 h and 1 ms ago", null, START - INTERRUPTED_NOTICE_TTL_MS - 1, false],
            ["ended 1 min ago after starting days ago", START - 60_000, START - 5 * INTERRUPTED_NOTICE_TTL_MS, true],
        ];
        for (const [label, endedAt, startedAt, shown] of cases) {
            const h = harness();
            const row = await h.sessions.create({ userId: 1, connectionId: null, platform: "twitch", settings: INPUT, viewKeyHash: "d".repeat(64), startedAt: new Date(startedAt) });
            await h.sessions.update(row.id, { status: "interrupted", endedAt: endedAt === null ? null : new Date(endedAt) });
            const current = await currentSession(h.deps, 1);
            if (shown) {
                assert.equal(current?.id, row.id, label);
                assert.equal(current?.interrupted, true, label);
            } else {
                assert.equal(current, null, `${label}: the panel shows the setup form`);
            }
        }
        // A row interrupted right now (a stale active one) is always shown.
        const h = harness();
        const old = await h.sessions.create({ userId: 1, connectionId: null, platform: "twitch", settings: INPUT, viewKeyHash: "e".repeat(64), startedAt: new Date(START - 3 * INTERRUPTED_NOTICE_TTL_MS) });
        assert.equal((await currentSession(h.deps, 1))?.id, old.id);
    });

    await test("an unreadable stored settings or summary reads as null and is reported once per row (session id only)", async () => {
        const h = harness();
        const row = await h.sessions.create({ userId: 1, connectionId: null, platform: "twitch", settings: { theme: "GIZLI-AYAR" }, viewKeyHash: "f".repeat(64), startedAt: new Date(START - HOUR) });
        await h.sessions.update(row.id, { status: "interrupted", endedAt: new Date(START - 60_000), summary: { scores: "GIZLI-ISIM" } as never });
        for (let read = 0; read < 3; read++) {
            const view = await currentSession(h.deps, 1);
            assert.equal(view?.id, row.id);
            assert.equal(view?.settings, null);
            assert.equal(view?.summary, null);
        }
        assert.equal(h.errors.length, 1, "one report for the row, however often it is read");
        const [report] = h.errors;
        assert.equal(report.event, "streamer_session.row_unreadable");
        assert.deepEqual(report.context, { sessionId: row.id });
        const text = `${JSON.stringify(report)} ${(report.error as Error).message}`;
        assert.ok(!text.includes("GIZLI"), "the report carries no stored content");
        // A row whose summary is simply not written yet is no unreadable row.
        const fresh = harness();
        await opened(fresh);
        assert.equal((await currentSession(fresh.deps, 1))?.summary, null);
        assert.deepEqual(fresh.errors, []);
    });

    await test("session failures reach observability with the session id (as streamId) and no row content", async () => {
        const lines: string[] = [];
        resetObservabilityForTests({ sink: (_level, line) => lines.push(line) });
        try {
            const id = "00000000-0000-4000-8000-0000000000a1";
            reportStreamerSessionError("streamer_session.round_result_failed", new Error("db down"), { sessionId: id });
            const event = JSON.parse(lines[0]) as { event: string; level: string; context?: Record<string, unknown> };
            assert.equal(event.event, "streamer_session.round_result_failed");
            assert.equal(event.level, "error");
            assert.deepEqual(event.context, { streamId: id }, "the session id survives the sanitizer");
            // Without a reporter of its own, toSessionView reports an unreadable row on this path.
            const store = createMemoryStreamSessionStore();
            const row = await store.create({ userId: 7, connectionId: null, platform: "kick", settings: { theme: "GIZLI-AYAR" }, viewKeyHash: "9".repeat(64), startedAt: new Date(START) });
            assert.equal(toSessionView(row).settings, null);
            assert.equal(toSessionView(row).settings, null);
            const reported = lines.slice(1).map((line) => JSON.parse(line) as { event: string; context?: Record<string, unknown> });
            assert.equal(reported.length, 1, "once per row");
            assert.equal(reported[0].event, "streamer_session.row_unreadable");
            assert.deepEqual(reported[0].context, { streamId: row.id });
            assert.ok(!lines.join("\n").includes("GIZLI"), "no stored content reaches observability");
        } finally {
            resetObservabilityForTests();
        }
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

    await test("stop: every live session is reported ended with reason interrupted, its row interrupted; no timer is left", async () => {
        const clock = manualTimers();
        const h = harness({ timers: clock.timers });
        const { session } = await opened(h);
        h.connections.seed(connection(2, "twitch"));
        const other = await createSession(h.deps, { userId: 2, settings: INPUT });
        h.connections.seed(connection(3, "twitch"));
        const done = await createSession(h.deps, { userId: 3, settings: INPUT });
        await h.runtime.start(session.id);
        await h.runtime.end(done.session.id, "ended");
        h.runtime.watchMode(async () => true);
        assert.ok(clock.intervals.size > 0, "ticks, connection checks and the mode watch run on the injected timers");
        await h.runtime.stop();
        const byId = (a: { sessionId: string }, b: { sessionId: string }) => a.sessionId.localeCompare(b.sessionId);
        assert.deepEqual(
            [...h.ended].sort(byId),
            [
                { sessionId: done.session.id, reason: "ended" },
                { sessionId: session.id, reason: "interrupted" },
                { sessionId: other.session.id, reason: "interrupted" },
            ].sort(byId),
        );
        assert.equal((await h.sessions.findById(session.id))?.status, "interrupted");
        assert.equal((await h.sessions.findById(other.session.id))?.status, "interrupted");
        assert.equal((await h.sessions.findById(done.session.id))?.status, "ended", "an ended row stays ended");
        assert.equal(clock.intervals.size, 0, "no interval survives stop()");
        assert.equal(clock.timeouts.size, 0, "no bound is left pending");
        assert.equal(h.runtime.get(session.id), null);
        await h.runtime.stop();
        assert.equal(h.ended.length, 3, "a second stop reports nothing again");
    });

    await test("streamer mode switched off: the 15 s check ends every live session with reason stopped; a failed check changes nothing", async () => {
        assert.equal(STREAMER_MODE_CHECK_MS, 15_000);
        const clock = manualTimers();
        const h = harness({ timers: clock.timers });
        const { session } = await opened(h);
        h.connections.seed(connection(2, "twitch"));
        const other = await createSession(h.deps, { userId: 2, settings: INPUT });
        await h.runtime.start(session.id);
        assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina")), "correct");
        let mode: boolean | Error = true;
        let checks = 0;
        const unwatch = h.runtime.watchMode(async () => {
            checks += 1;
            if (mode instanceof Error) throw mode;
            return mode;
        });
        clock.fireIntervals(STREAMER_MODE_CHECK_MS);
        await turn();
        assert.equal(checks, 1);
        assert.equal(h.ended.length, 0, "the mode is on: nothing ends");
        mode = new Error("settings unreadable");
        clock.fireIntervals(STREAMER_MODE_CHECK_MS);
        await turn();
        assert.equal(h.ended.length, 0, "a check that fails ends nothing");
        assert.deepEqual(h.errors.map((error) => error.event), ["streamer_session.mode_check_failed"]);
        mode = false;
        clock.fireIntervals(STREAMER_MODE_CHECK_MS);
        await turn();
        await h.runtime.flush();
        const reasons = new Map(h.ended.map((entry) => [entry.sessionId, entry.reason]));
        assert.deepEqual([...reasons.entries()].sort(), [[session.id, "stopped"], [other.session.id, "stopped"]].sort());
        for (const id of [session.id, other.session.id]) {
            const row = await h.sessions.findById(id);
            assert.equal(row?.status, "ended", "stopped sessions end, they are not interrupted");
            assert.ok(row?.endedAt);
            assert.equal(h.runtime.get(id), null);
        }
        assert.deepEqual((await h.sessions.findById(session.id))?.summary, { scores: [{ name: "Luna", points: 1, rank: 1, tied: false }], participants: 1, rounds: 1 });
        // Unwatched, or stopped with the runtime: the check never runs again.
        unwatch();
        assert.ok(![...clock.intervals.values()].some((interval) => interval.ms === STREAMER_MODE_CHECK_MS));
        const watchAgain = h.runtime.watchMode(async () => false);
        void watchAgain;
        await h.runtime.stop();
        assert.equal(clock.intervals.size, 0, "stop() clears the mode watch");
        assert.equal(checks, 3);
    });

    await test("hourly connection check: needs_reconnect tells the host once and the session goes on; nothing is checked after the end", async () => {
        assert.equal(STREAM_CONNECTION_CHECK_MS, 3_600_000);
        const clock = manualTimers();
        const answers: Array<ConnectionCheck | Error | Promise<ConnectionCheck>> = [];
        const calls: SessionConnection[] = [];
        const h = harness({
            timers: clock.timers,
            checkConnection: async (link) => {
                calls.push(link);
                const answer = answers.shift() ?? "valid";
                if (answer instanceof Error) throw answer;
                return answer;
            },
        });
        const notices: Array<[string, unknown]> = [];
        h.runtime.setOnHostNotice((sessionId, notice) => notices.push([sessionId, notice]));
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        const hourly = async (answer?: ConnectionCheck | Error | Promise<ConnectionCheck>) => {
            if (answer !== undefined) answers.push(answer);
            clock.fireIntervals(STREAM_CONNECTION_CHECK_MS);
            await turn();
        };
        await hourly("valid");
        await hourly("unavailable");
        assert.deepEqual(notices, [], "a valid link and a transient platform error tell nothing");
        assert.deepEqual(calls[0], { id: connection(1, "twitch").id, userId: 1, platform: "twitch" }, "the link the session was opened on");
        await hourly("needs_reconnect");
        assert.deepEqual(notices, [[session.id, { kind: "connection-needs-reconnect", platform: "twitch" }]]);
        assert.equal(h.runtime.get(session.id)?.phase, "running", "the session keeps running");
        assert.equal(await h.runtime.guess(session.id, chat(h, "mandalina")), "correct");
        await hourly("needs_reconnect");
        assert.equal(notices.length, 1, "told once while the link stays broken");
        await hourly("valid");
        await hourly("needs_reconnect");
        assert.equal(notices.length, 2, "told again after the link came back and broke again");
        await hourly(new Error("store down"));
        assert.deepEqual(h.errors.map((error) => [error.event, error.context]), [["streamer_session.connection_check_failed", { sessionId: session.id }]]);
        // A check still running when the session ends tells nothing, whatever it finds.
        await hourly("valid");
        let answerLate!: (answer: ConnectionCheck) => void;
        await hourly(new Promise<ConnectionCheck>((resolve) => (answerLate = resolve)));
        await h.runtime.end(session.id, "ended");
        answerLate("needs_reconnect");
        await turn();
        const callsAtEnd = calls.length;
        await hourly("needs_reconnect");
        assert.equal(calls.length, callsAtEnd, "no platform call once the session ended");
        assert.ok(![...clock.intervals.values()].some((interval) => interval.ms === STREAM_CONNECTION_CHECK_MS), "its interval is cleared");
        assert.equal(notices.length, 2);
        // A session opened without a link has nothing to check.
        const row = await h.sessions.create({ userId: 7, connectionId: null, platform: "kick", settings: { ...INPUT, platform: "kick" }, viewKeyHash: "9".repeat(64), startedAt: new Date(START) });
        h.runtime.open(row, createStreamSession(toScreenSettings({ ...INPUT, platform: "kick" }, null), START));
        assert.ok(![...clock.intervals.values()].some((interval) => interval.ms === STREAM_CONNECTION_CHECK_MS));
        await h.runtime.stop();
    });

    await test("the runtime's own interval ticks a running round without tickAll", async () => {
        const h = harness({ tickMs: 5 });
        const { session } = await opened(h);
        await h.runtime.start(session.id);
        // Resolved by the emit of the interval's tick: no fixed wait. The runtime's interval is
        // unref'd, so a bound (that only fires on failure) keeps the process up meanwhile.
        const finished = deferred();
        h.runtime.setEmitter((sessionId, kind, payload) => {
            h.emitted.push({ sessionId, kind, payload });
            if (payload.phase === "finished") finished.resolve();
        });
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        const bound = new Promise<never>((_, reject) => {
            watchdog = setTimeout(() => reject(new Error("the interval never ticked the round to its end")), 10_000);
        });
        h.advance(60_000);
        try {
            await Promise.race([finished.promise, bound]);
        } finally {
            clearTimeout(watchdog);
        }
        await h.runtime.flush();
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

    // ------------------------------------------------------------ HTTP routes

    const routes = await loadRoutes();
    const fakePlatform = process.env.STREAMER_FAKE_PLATFORM;
    process.env.STREAMER_FAKE_PLATFORM = "1";

    await test("routes: a foreign origin is refused before anything is read; test-guess is a bare 404 first while the fake platform is off", async () => {
        const h = harness();
        const foreign = "https://evil.example";
        const attempts: Array<[string, () => Promise<Response>]> = [
            ["create", () => routes.collection.POST(routeRequest("", INPUT, foreign))],
            ["end", () => routes.end.POST(routeRequest("/current/end", undefined, foreign))],
            ["view-key", () => routes.viewKey.POST(routeRequest("/current/view-key", undefined, foreign))],
            ["test-guess", () => routes.testGuess.POST(routeRequest("/current/test-guess", { name: "Luna", text: "x" }, foreign))],
        ];
        for (const [label, attempt] of attempts) {
            resetRouteWorld(h);
            const answer = await answerOf(await attempt());
            assert.deepEqual([answer.status, answer.body?.code], [403, "ORIGIN_REJECTED"], label);
            assert.deepEqual(routeWorld.calls, [], `${label}: nothing read before the origin check`);
        }
        delete process.env.STREAMER_FAKE_PLATFORM;
        try {
            for (const origin of [foreign, ROUTE_ORIGIN]) {
                resetRouteWorld(h);
                const answer = await answerOf(await routes.testGuess.POST(routeRequest("/current/test-guess", { name: "Luna", text: "x" }, origin)));
                assert.deepEqual([answer.status, answer.body], [404, null], `fake platform off (${origin}): the route does not exist`);
                assert.deepEqual(routeWorld.calls, [], "nothing else is checked or read");
            }
        } finally {
            process.env.STREAMER_FAKE_PLATFORM = "1";
        }
    });

    await test("routes: origin, then account, then streamer mode, then rate limit, then the work", async () => {
        const h = harness();
        h.connections.seed(connection(1, "twitch"));
        const cases: Array<[string, string, () => Promise<Response>]> = [
            ["create", "streamer-session-create", () => routes.collection.POST(routeRequest("", INPUT))],
            ["view-key", "streamer-view-key", () => routes.viewKey.POST(routeRequest("/current/view-key"))],
            ["test-guess", "streamer-test-guess", () => routes.testGuess.POST(routeRequest("/current/test-guess", { name: "Luna", text: "merhaba" }))],
        ];
        for (const [label, bucket, attempt] of cases) {
            resetRouteWorld(h, { modeOn: false });
            const off = await answerOf(await attempt());
            assert.deepEqual([off.status, off.body?.code], [403, "STREAMER_MODE_DISABLED"], `${label}: mode off`);
            assert.deepEqual(routeWorld.calls, ["auth", "mode"], `${label}: the mode is checked before any quota is spent`);

            resetRouteWorld(h, { limited: true });
            const limited = await answerOf(await attempt());
            assert.deepEqual([limited.status, limited.body?.code], [429, "RATE_LIMITED"], `${label}: no quota left`);
            assert.deepEqual(routeWorld.calls, ["auth", "mode", `limit:${bucket}`], `${label}: no work without quota`);
        }
        // With everything in order the work runs last: create opens, rotate and a test guess act on it.
        resetRouteWorld(h);
        const created = await answerOf(await routes.collection.POST(routeRequest("", INPUT)));
        assert.equal(created.status, 201);
        assert.deepEqual(routeWorld.calls, ["auth", "mode", "limit:streamer-session-create", "work"]);
        resetRouteWorld(h);
        const rotated = await answerOf(await routes.viewKey.POST(routeRequest("/current/view-key")));
        assert.equal(rotated.status, 200);
        assert.notEqual(rotated.body?.viewKey, created.body?.viewKey);
        assert.deepEqual(routeWorld.calls, ["auth", "mode", "limit:streamer-view-key", "work"]);
        resetRouteWorld(h);
        const guessed = await answerOf(await routes.testGuess.POST(routeRequest("/current/test-guess", { name: "Luna", text: "merhaba" })));
        assert.deepEqual([guessed.status, guessed.body], [200, { result: "closed" }]);
        assert.deepEqual(routeWorld.calls, ["auth", "mode", "limit:streamer-test-guess", "work"]);
        // Ending is never gated by the mode switch or a quota.
        resetRouteWorld(h, { modeOn: false, limited: true });
        const ended = await answerOf(await routes.end.POST(routeRequest("/current/end")));
        assert.equal(ended.status, 200);
        assert.deepEqual(routeWorld.calls, ["auth", "work"]);
    });

    await test("routes: view-key and test-guess need an active account, as create does; end takes any signed-in owner", async () => {
        const h = harness();
        h.connections.seed(connection(1, "twitch"));
        resetRouteWorld(h);
        assert.equal((await routes.collection.POST(routeRequest("", INPUT))).status, 201);
        const pending = { id: 1, role: "user", accountStatus: "pending_email_verification" };
        const gated: Array<[string, () => Promise<Response>]> = [
            ["create", () => routes.collection.POST(routeRequest("", INPUT))],
            ["view-key", () => routes.viewKey.POST(routeRequest("/current/view-key"))],
            ["test-guess", () => routes.testGuess.POST(routeRequest("/current/test-guess", { name: "Luna", text: "merhaba" }))],
        ];
        for (const [label, attempt] of gated) {
            for (const user of [null, pending]) {
                resetRouteWorld(h, { user });
                const answer = await answerOf(await attempt());
                assert.deepEqual([answer.status, answer.body?.code], [401, "AUTH_REQUIRED"], `${label}: ${user ? user.accountStatus : "signed out"}`);
                assert.deepEqual(routeWorld.calls, ["auth"], `${label}: refused before the mode, the quota or the work`);
            }
        }
        resetRouteWorld(h, { user: null });
        const anonymous = await answerOf(await routes.end.POST(routeRequest("/current/end")));
        assert.deepEqual([anonymous.status, anonymous.body?.code], [401, "AUTH_REQUIRED"]);
        assert.ok(h.runtime.forUser(1), "a signed-out request ends nothing");
        resetRouteWorld(h, { user: pending });
        const ended = await answerOf(await routes.end.POST(routeRequest("/current/end")));
        assert.equal(ended.status, 200, "a signed-in owner whose account is no longer active can still end");
        assert.equal((ended.body?.session as { status: string }).status, "ended");
        assert.equal(h.runtime.forUser(1), null);
    });

    await test("routes: end answers with the ended view from the end call, never a read-back; nothing live is a typed 404", async () => {
        const holding = holdingStore();
        const h = harness({ sessions: holding.store, drainTimeoutMs: 1 });
        const { session } = await opened(h);
        await h.runtime.flush();
        h.advance(5_000);
        // The end write hangs: the row still reads `active` when the answer is sent.
        holding.hold();
        resetRouteWorld(h);
        const ended = await answerOf(await routes.end.POST(routeRequest("/current/end")));
        assert.equal(ended.status, 200);
        assert.deepEqual(ended.body, {
            ok: true,
            session: {
                ...session,
                status: "ended",
                interrupted: false,
                endedAt: new Date(h.clock.now).toISOString(),
                roundCount: 0,
                summary: { scores: [], participants: 0, rounds: 0 },
            },
        });
        assert.equal((await h.sessions.findById(session.id))?.status, "active", "the row had not caught up when the answer left");
        holding.release();
        await h.runtime.flush();
        assert.equal((await h.sessions.findById(session.id))?.status, "ended");
        resetRouteWorld(h);
        const again = await answerOf(await routes.end.POST(routeRequest("/current/end")));
        assert.deepEqual([again.status, again.body?.code], [404, "STREAMER_SESSION_NOT_FOUND"]);
    });

    if (fakePlatform === undefined) delete process.env.STREAMER_FAKE_PLATFORM;
    else process.env.STREAMER_FAKE_PLATFORM = fakePlatform;

    for (const runtime of runtimes) await runtime.stop();
    console.log(`${count} checks passed.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
