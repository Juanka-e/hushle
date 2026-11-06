import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as connectClient, type Socket as ClientSocket } from "socket.io-client";
import {
    BROADCAST_THEMES,
    CAMERA_SIZES,
    CAMERA_SLOTS,
    CHANNEL_PLATFORMS,
    TIMER_STYLES,
    type HostStreamSnapshot,
    type PublicStreamSnapshot,
    type StreamCard,
} from "@hushle/domain-streamer";
import {
    createMemoryStreamerConnectionStore,
    type StreamerConnectionRecord,
    type StreamerPlatform,
} from "@hushle/platform-streamer";
import { SOCKET_CLIENT_AUTH } from "../apps/web/src/lib/socket/protocol-version";
import { assertNoSecret } from "../apps/web/src/lib/socket/streamer-leak-guard";
import {
    createBurstLimiter,
    MAX_BURST_WINDOWS,
    setupStreamerSocket,
    STREAMER_HOST_ACTION_BURST,
    STREAMER_HOST_JOIN_BURST,
    streamerHostRoom,
    streamerPublicRoom,
    type StreamerSocketOptions,
} from "../apps/web/src/lib/socket/streamer-socket";
import type { consumeDistributedRequestRateLimit } from "../apps/web/src/lib/security/request-rate-limit";
import { resolveCardBackSelection, type CardBackCatalogItem, type CardBackLoaders } from "../apps/web/src/lib/streamer/card-backs";
import type { CreateSessionInput } from "../apps/web/src/lib/streamer/session-settings";
import { createMemoryStreamSessionStore } from "../apps/web/src/lib/streamer/session-store";
import { endStreamerSessionsForUser } from "../apps/web/src/lib/streamer/session-deps";
import {
    createStreamerSessionRuntime,
    STREAM_CONNECTION_CHECK_MS,
    type ConnectionCheck,
    type StreamerEmitter,
    type StreamerSessionRuntime,
    type WordSource,
} from "../apps/web/src/lib/streamer/session-runtime";
import { realStreamerTimers } from "../apps/web/src/lib/streamer/session-timers";
import type { StreamerModeState } from "../apps/web/src/lib/streamer/streamer-mode";
import { createSession, type StreamerSessionServiceDeps } from "../apps/web/src/lib/streamer/session-service";
import { hashViewKey } from "../apps/web/src/lib/streamer/view-key";
import { disconnectUserSockets, registerSocketServer, userSessionRoom } from "../apps/web/src/lib/socket/user-session-control";

// Streamer socket layer (phase 2, Task 6): host and public Socket.IO rooms on an in-process
// server. Memory stores, a fake word source, a fake clock shared by the runtime and the socket
// layer, and a stub auth resolver keyed by the handshake's `auth.testUser`.

const SUITE_TIMEOUT_MS = 20_000;
const STEP_TIMEOUT_MS = 3_000;
const SOCKET_PATH = "/api/socketio";

const watchdog = setTimeout(() => {
    console.error(`FAIL streamer socket integration did not finish within ${SUITE_TIMEOUT_MS / 1000} s`);
    process.exit(1);
}, SUITE_TIMEOUT_MS);
watchdog.unref();

// The socket layer's own clock (host-action burst windows), apart from the round clock: every
// check starts with a fresh 10 s window, so only the burst check itself meets the limit.
const socketClock = { now: Date.now() };

let count = 0;
async function test(name: string, run: () => Promise<void> | void): Promise<void> {
    socketClock.now += 10_001;
    await run();
    count += 1;
    console.log(`PASS ${name}`);
}

function within<T>(promise: Promise<T>, label: string, ms = STEP_TIMEOUT_MS): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`step timed out after ${ms} ms: ${label}`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}


// ---------------------------------------------------------------- fixtures

// Every word of the deck is distinct, so a round's words never show up in another card's fields.
const DECK: StreamCard[] = [
    { wordId: 101, target: "MANDALİNA", taboos: ["Portakal", "Turuncu", "Meyve", "Kabuk", "Narenciye"] },
    { wordId: 102, target: "BUZDOLABI", taboos: ["Soğuk", "Mutfak", "Dondurucu", "Saklamak", "Beyaz eşya"] },
    { wordId: 103, target: "ŞEMSİYE", taboos: ["Yağmur", "Islanmak", "Bulut", "Şemsiyelik", "Sağanak"] },
    { wordId: 104, target: "KARINCA", taboos: ["Böcek", "Çalışkan", "Yuva", "Kolonistan", "Ağustosböceği"] },
    { wordId: 105, target: "PUSULA", taboos: ["Kuzey", "Yönelim", "Mıknatıs", "Harita", "Denizci"] },
    { wordId: 106, target: "TELESKOP", taboos: ["Yıldız", "Gökyüzü", "Mercek", "Gözlemevi", "Uzaklık"] },
];

// Cards a check deals on purpose. LANTERN's taboos hold DECK[2]'s word; DOOR is a filler.
const LANTERN: StreamCard = { wordId: 201, target: "FENER", taboos: [DECK[2].target, "Işık", "Karanlık", "Liman", "Gemici"] };
const DOOR: StreamCard = { wordId: 202, target: "KAPI", taboos: ["Kilit", "Anahtar", "Tokmak", "Menteşe", "Eşik"] };

interface FakeSource extends WordSource {
    empty: boolean;
    draws: number;
    /** Dealt before the deck, first in first out; they do not move the deck. */
    forced: StreamCard[];
}

function deckSource(): FakeSource {
    const source: FakeSource = {
        empty: false,
        draws: 0,
        forced: [],
        async next() {
            if (source.empty) return null;
            const forced = source.forced.shift();
            if (forced) return { ...forced, taboos: [...forced.taboos] };
            const card = DECK[source.draws % DECK.length];
            source.draws += 1;
            return { ...card, taboos: [...card.taboos] };
        },
        clear() {},
    };
    return source;
}

const INPUT: CreateSessionInput = {
    platform: "twitch",
    language: "tr",
    categoryIds: [3],
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

function connection(userId: number, platform: StreamerPlatform = "twitch"): StreamerConnectionRecord {
    const at = new Date(Date.now() - 86_400_000);
    return {
        id: `00000000-0000-4000-9000-${String(userId).padStart(12, "0")}`,
        userId,
        platform,
        platformUserId: `pu-${platform}-${userId}`,
        login: `yayinci${userId}`,
        displayName: `Yayıncı ${userId}`,
        avatarUrl: null,
        channelUrl: `https://${platform}.example/yayinci${userId}`,
        scopes: "",
        accessTokenEnc: "v1.a.b.c",
        refreshTokenEnc: null,
        tokenKeyVersion: 1,
        accessTokenExpiresAt: null,
        status: "active",
        statusReason: null,
        lastValidatedAt: at,
        lastUsedAt: null,
        connectedAt: at,
        revokedAt: null,
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

// User 1 owns card back 10; the catalogue also has 11.
const CARD_BACK_LOADERS: CardBackLoaders = {
    inventory: async () => ({ profile: { cardBackItemId: 10 }, items: [{ shopItemId: 10, ...cardBackItem(10, "Kor") }] }),
    catalog: async () => [cardBackItem(10, "Kor"), cardBackItem(11, "Buz")],
};

// "owner" → user 1, "stranger" → 2, "second" → 3 (owns the second session), "suspended" → 4.
const TEST_USERS: Record<string, { userId: number; isSuspended: boolean }> = {
    owner: { userId: 1, isSuspended: false },
    stranger: { userId: 2, isSuspended: false },
    second: { userId: 3, isSuspended: false },
    suspended: { userId: 4, isSuspended: true },
};

type RateLimit = typeof consumeDistributedRequestRateLimit;
type RateLimitOptions = Parameters<RateLimit>[0];

function countingLimiter() {
    const calls: RateLimitOptions[] = [];
    const counts = new Map<string, number>();
    // A bucket capped here refuses after that many calls per key, below its own maxRequests.
    const caps = new Map<string, number>();
    const consume: RateLimit = async (options) => {
        calls.push(options);
        const key = `${options.bucket}|${options.key}`;
        const used = (counts.get(key) ?? 0) + 1;
        counts.set(key, used);
        const max = Math.min(options.maxRequests, caps.get(options.bucket) ?? Infinity);
        const allowed = used <= max;
        return { allowed, limit: options.maxRequests, remaining: Math.max(0, max - used), retryAfterSeconds: allowed ? 0 : 60 };
    };
    return {
        calls,
        consume,
        refuseAfter: (bucket: string, allowed: number) => caps.set(bucket, allowed),
        reset: () => {
            counts.clear();
            caps.clear();
        },
    };
}

// ---------------------------------------------------------------- client helpers

type Ack = { ok: true; state?: unknown; viewKey?: string } | { ok: false; error: string; code: string };

interface Recorded {
    event: string;
    args: unknown[];
}

interface Client {
    socket: ClientSocket;
    events: Recorded[];
}

const clients: Client[] = [];

async function connect(baseUrl: string, testUser?: string, origin = baseUrl): Promise<Client> {
    const socket = connectClient(baseUrl, {
        path: SOCKET_PATH,
        auth: testUser ? { ...SOCKET_CLIENT_AUTH, testUser } : { ...SOCKET_CLIENT_AUTH },
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
        extraHeaders: { Origin: origin },
    });
    const client: Client = { socket, events: [] };
    socket.onAny((event: string, ...args: unknown[]) => client.events.push({ event, args }));
    clients.push(client);
    await within(
        new Promise<void>((resolve, reject) => {
            socket.once("connect", () => resolve());
            socket.once("connect_error", reject);
        }),
        `connect ${testUser ?? "anonymous"}`,
    );
    return client;
}

async function ask(client: Client, event: string, ...payload: unknown[]): Promise<Ack> {
    return (await within(client.socket.timeout(STEP_TIMEOUT_MS - 500).emitWithAck(event, ...payload), `ack of ${event}`)) as Ack;
}

function nextEvent<T>(client: Client, event: string, predicate: (payload: T) => boolean = () => true): Promise<T[]> {
    return within(
        new Promise<T[]>((resolve) => {
            const handler = (...args: T[]) => {
                if (!predicate(args[0])) return;
                client.socket.off(event, handler);
                resolve(args);
            };
            client.socket.on(event, handler);
        }),
        `event ${event}`,
    );
}

async function nextState<T>(client: Client, event: string, predicate: (payload: T) => boolean = () => true): Promise<T> {
    const [payload] = await nextEvent<T>(client, event, predicate);
    return payload;
}

function received(client: Client, event: string, since = 0): Recorded[] {
    return client.events.slice(since).filter((entry) => entry.event === event);
}

/**
 * A round trip on `client`'s own socket: a malformed public join, refused before any limit or
 * room is touched. Socket.IO keeps one socket's packets in order, so once its reply is in, every
 * event the server sent this socket before it has arrived too: "nothing came" can be asserted
 * after it without a fixed sleep.
 */
async function barrier(client: Client): Promise<void> {
    assertError(await ask(client, "streamer:public:join", { viewKey: "barrier" }), "INVALID_REQUEST", "barrier");
}

function assertError(ack: Ack, code: string, label: string): void {
    assert.equal(ack.ok, false, `${label}: expected a failure ack, got ${JSON.stringify(ack)}`);
    if (ack.ok) return;
    assert.equal(ack.code, code, `${label}: ${JSON.stringify(ack)}`);
    assert.equal(typeof ack.error, "string");
}

function assertOk(ack: Ack, label: string): asserts ack is Extract<Ack, { ok: true }> {
    assert.equal(ack.ok, true, `${label}: expected { ok: true }, got ${JSON.stringify(ack)}`);
}

/** A string search on the serialized payload: none of the card's words, in any letter case. */
function assertNoWords(payload: unknown, card: StreamCard, label: string): void {
    const json = JSON.stringify(payload).toLocaleLowerCase("tr");
    for (const word of [card.target, ...card.taboos]) {
        assert.ok(!json.includes(word.toLocaleLowerCase("tr")), `${label}: the public payload carries "${word}"`);
    }
}

function assertPublicShape(state: unknown, label: string): asserts state is PublicStreamSnapshot {
    assert.ok(state && typeof state === "object", `${label}: a public state`);
    const record = state as Record<string, unknown>;
    assert.equal(record.type, "public-state", label);
    for (const key of ["card", "players", "tolerance", "pool"]) assert.ok(!(key in record), `${label}: public state has "${key}"`);
}

/** The guard refuses `payload` with exactly `rule` (the rule id it carries, not its message). */
function assertTrips(payload: unknown, rule: string, label: string, against: Parameters<typeof assertNoSecret>[1]): void {
    assert.throws(
        () => assertNoSecret(payload, against),
        (error: unknown) => {
            assert.equal((error as { rule?: unknown } | null)?.rule, rule, `${label}: ${String(error)}`);
            return true;
        },
        label,
    );
}

function roomOf(io: Server, room: string): Set<string> {
    return io.sockets.adapter.rooms.get(room) ?? new Set<string>();
}

// ---------------------------------------------------------------- suite

async function main(): Promise<void> {
    const clock = { now: Date.now() };
    const sessions = createMemoryStreamSessionStore();
    const connections = createMemoryStreamerConnectionStore();
    connections.seed(connection(1));
    connections.seed(connection(3));
    const source = deckSource();
    const features = { streamerShowcaseAllCosmetics: false };
    // What the authoritative streamer-mode read answers (the database row, or unknown when it is away).
    const mode: { state: StreamerModeState } = { state: "on" };
    // The hourly link check runs every 25 ms here; each user's link answers valid unless set.
    const linkAnswers = new Map<number, ConnectionCheck>();
    const runtimeErrors: Array<{ event: string; error: unknown }> = [];
    // The runtime's row writes can be held (a database that stops answering) and watched.
    const writeGate: { held: Promise<void> | null; onUpdate: ((patch: object) => void) | null; failKey: Error | null } = { held: null, onUpdate: null, failKey: null };
    const runtimeStore: typeof sessions = {
        ...sessions,
        async update(id, patch) {
            writeGate.onUpdate?.(patch);
            if (writeGate.held) await writeGate.held;
            if (writeGate.failKey && patch.viewKeyHash) throw writeGate.failKey;
            return sessions.update(id, patch);
        },
    };
    const runtime = createStreamerSessionRuntime({
        store: runtimeStore,
        wordSource: source,
        now: () => clock.now,
        tickMs: 50,
        onError: (event, error) => runtimeErrors.push({ event, error }),
        checkConnection: async (link) => linkAnswers.get(link.userId) ?? "valid",
        timers: { ...realStreamerTimers, setInterval: (run, ms) => realStreamerTimers.setInterval(run, ms === STREAM_CONNECTION_CHECK_MS ? 25 : ms) },
    });
    const deps: StreamerSessionServiceDeps = {
        sessions,
        connections,
        runtime,
        now: () => clock.now,
        getFeatureFlags: async () => features,
        cardBackLoaders: CARD_BACK_LOADERS,
    };

    // The socket layer sees the runtime through this wrapper so the test can replay its emitter.
    let wiredEmit: StreamerEmitter | null = null;
    // When set, the public projection a join reads is replaced (to test what the ack sends).
    let joinSnapshot: (() => unknown) | null = null;
    const wiredRuntime: StreamerSessionRuntime = {
        ...runtime,
        get(id) {
            const live = runtime.get(id);
            const replace = joinSnapshot;
            return live && replace ? { ...live, publicSnapshot: () => replace() as PublicStreamSnapshot } : live;
        },
        setEmitter(emit) {
            wiredEmit = emit;
            runtime.setEmitter(emit);
        },
    };

    const limiter = countingLimiter();
    const socketErrors: Array<{ event: string; error: unknown }> = [];
    // Failure switches: a reporter that throws after recording, a limiter and a row lookup that throw.
    const failing = { reporter: false, limiter: false, lookup: false };
    // Errors the row lookup and the features read throw when set (a Prisma error naming its call).
    const planted: { lookup: Error | null; features: Error | null } = { lookup: null, features: null };
    const options: StreamerSocketOptions = {
        resolveUser: async (socket) => {
            const who = (socket.handshake.auth as { testUser?: unknown } | undefined)?.testUser;
            return typeof who === "string" && TEST_USERS[who] ? { ...TEST_USERS[who] } : { userId: null, isSuspended: false };
        },
        rateLimit: async (limit) => {
            if (failing.limiter) throw new Error("limiter down");
            return limiter.consume(limit);
        },
        features: async () => {
            if (planted.features) throw planted.features;
            return { ...features };
        },
        streamerMode: async () => mode.state,
        resolveCardBack: (userId, itemId, flags) => resolveCardBackSelection(userId, itemId, flags, CARD_BACK_LOADERS),
        now: () => socketClock.now,
        onError: (event, error) => {
            socketErrors.push({ event, error });
            if (failing.reporter) throw new Error("reporter down");
        },
    };
    const lookup: Parameters<typeof setupStreamerSocket>[2] = {
        async findByViewKeyHash(hash) {
            if (failing.lookup) throw new Error("db down");
            if (planted.lookup) throw planted.lookup;
            return sessions.findByViewKeyHash(hash);
        },
    };

    const httpServer: HttpServer = createServer();
    const io = new Server(httpServer, { path: SOCKET_PATH });
    setupStreamerSocket(io, wiredRuntime, lookup, options);
    await within(new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve())), "listen");
    const { port } = httpServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}`;

    const first = await createSession(deps, { userId: 1, settings: INPUT });
    const sessionId = first.session.id;
    let viewKey = first.viewKey;
    const hostRoom = streamerHostRoom(sessionId);
    const publicRoom = streamerPublicRoom(sessionId);
    const liveCard = (): StreamCard => {
        const card = runtime.get(sessionId)?.hostSnapshot().card;
        assert.ok(card, "the live session has a card");
        return card;
    };
    const liveRound = (): number => runtime.get(sessionId)?.hostSnapshot().round ?? 0;

    try {
        const owner = await connect(url, "owner");
        const stranger = await connect(url, "stranger");
        const anonymous = await connect(url);
        const suspended = await connect(url, "suspended");
        const viewer = await connect(url);

        await test("the owner joins the host room and gets the host projection", async () => {
            const ack = await ask(owner, "streamer:host:join", { sessionId });
            assertOk(ack, "owner join");
            const state = ack.state as HostStreamSnapshot;
            assert.equal(state.type, "host-state");
            assert.equal(state.phase, "ready");
            assert.ok("card" in state && Array.isArray(state.players) && typeof state.tolerance === "string");
            assert.ok(roomOf(io, hostRoom).has(owner.socket.id!));
            const again = await ask(owner, "streamer:host:join", { sessionId });
            assertOk(again, "joining the same host room again");
            assert.equal(roomOf(io, hostRoom).size, 1);
        });

        await test("a stranger's host join is refused with STREAMER_SESSION_NOT_OWNED and joins nothing", async () => {
            const ack = await ask(stranger, "streamer:host:join", { sessionId });
            assertError(ack, "STREAMER_SESSION_NOT_OWNED", "stranger join");
            assert.ok(!("state" in ack));
            assert.ok(!roomOf(io, hostRoom).has(stranger.socket.id!));
            assert.equal(received(stranger, "streamer:host:state").length, 0);
        });

        await test("a host join without a signed-in user, or from a suspended one, is refused with AUTH_REQUIRED", async () => {
            assertError(await ask(anonymous, "streamer:host:join", { sessionId }), "AUTH_REQUIRED", "anonymous join");
            assertError(await ask(suspended, "streamer:host:join", { sessionId }), "AUTH_REQUIRED", "suspended join");
            assert.ok(!roomOf(io, hostRoom).has(anonymous.socket.id!) && !roomOf(io, hostRoom).has(suspended.socket.id!));
        });

        await test("malformed host join payloads are refused with INVALID_REQUEST", async () => {
            assertError(await ask(owner, "streamer:host:join", { sessionId: "not-a-uuid" }), "INVALID_REQUEST", "bad uuid");
            assertError(await ask(owner, "streamer:host:join", { sessionId, extra: 1 }), "INVALID_REQUEST", "extra key");
            assertError(await ask(owner, "streamer:host:join"), "INVALID_REQUEST", "no payload");
        });

        await test("a host join for a session that is not live is refused with STREAMER_SESSION_NOT_FOUND", async () => {
            assertError(await ask(owner, "streamer:host:join", { sessionId: randomUUID() }), "STREAMER_SESSION_NOT_FOUND", "unknown id");
            assert.ok(roomOf(io, hostRoom).has(owner.socket.id!), "a failed join keeps the room the socket is in");
        });

        await test("host actions from a socket outside the host room are refused; without an ack the error comes as hata", async () => {
            assertError(await ask(stranger, "streamer:host:start"), "STREAMER_SESSION_NOT_FOUND", "stranger start");
            assertError(await ask(stranger, "streamer:host:rotate-key"), "STREAMER_SESSION_NOT_FOUND", "stranger rotate");
            assertError(await ask(stranger, "streamer:host:settings", { theme: "sakura" }), "STREAMER_SESSION_NOT_FOUND", "stranger settings");
            const hata = nextEvent<string>(stranger, "hata");
            stranger.socket.emit("streamer:host:end");
            const [message, meta] = (await hata) as unknown as [string, { code: string }];
            assert.equal(typeof message, "string");
            assert.equal(meta.code, "STREAMER_SESSION_NOT_FOUND");
            assert.equal(runtime.get(sessionId)?.phase, "ready", "nothing changed");
        });

        await test("public joins with a malformed key are refused with INVALID_REQUEST", async () => {
            assertError(await ask(viewer, "streamer:public:join", { viewKey: "short" }), "INVALID_REQUEST", "short key");
            assertError(await ask(viewer, "streamer:public:join", { viewKey, extra: true }), "INVALID_REQUEST", "extra key");
            assertError(await ask(viewer, "streamer:public:join", viewKey), "INVALID_REQUEST", "bare string");
        });

        await test("a public join with a wrong key is refused with STREAMER_VIEW_KEY_INVALID", async () => {
            const wrong = randomBytes(32).toString("base64url");
            assert.equal(wrong.length, 43);
            assertError(await ask(viewer, "streamer:public:join", { viewKey: wrong }), "STREAMER_VIEW_KEY_INVALID", "wrong key");
            assert.equal(roomOf(io, publicRoom).size, 0);
        });

        await test("a public join with the right key gets the public projection", async () => {
            const ack = await ask(viewer, "streamer:public:join", { viewKey });
            assertOk(ack, "viewer join");
            assertPublicShape(ack.state, "join ack");
            assert.equal(ack.state.phase, "ready");
            assert.ok(roomOf(io, publicRoom).has(viewer.socket.id!));
            assert.ok(!roomOf(io, hostRoom).has(viewer.socket.id!));
        });

        await test("host start: both rooms get a state; the host state has the card, the public state has no word", async () => {
            const strangerMark = stranger.events.length;
            const hostState = nextState<HostStreamSnapshot>(owner, "streamer:host:state", (s) => s.phase === "running");
            const publicState = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.phase === "running");
            assertOk(await ask(owner, "streamer:host:start"), "start");
            const host = await hostState;
            const pub = await publicState;
            assert.equal(host.card?.target, DECK[0].target);
            assert.deepEqual(host.card?.taboos, DECK[0].taboos);
            assert.equal(pub.revision, host.revision);
            assertPublicShape(pub, "running public state");
            assert.equal(pub.reveal, null);
            assertNoWords(pub, DECK[0], "running public state");
            const anonymousMark = anonymous.events.length;
            await barrier(stranger);
            await barrier(anonymous);
            assert.deepEqual(stranger.events.slice(strangerMark).map((entry) => entry.event), [], "the stranger got nothing before its barrier reply");
            assert.deepEqual(anonymous.events.slice(anonymousMark).map((entry) => entry.event), []);
            assert.equal(received(anonymous, "streamer:host:state").length + received(anonymous, "streamer:public:state").length, 0);
        });

        await test("a public join while a round runs gets no word in its ack", async () => {
            const late = await connect(url);
            const ack = await ask(late, "streamer:public:join", { viewKey });
            assertOk(ack, "late join");
            assertPublicShape(ack.state, "late join ack");
            assert.equal(ack.state.phase, "running");
            assertNoWords(ack.state, liveCard(), "late join ack");
        });

        await test("pause and resume reach both rooms; an action in the wrong phase is STREAMER_ACTION_INVALID_PHASE", async () => {
            const paused = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.phase === "paused");
            assertOk(await ask(owner, "streamer:host:pause"), "pause");
            assertNoWords(await paused, liveCard(), "paused public state");
            assertError(await ask(owner, "streamer:host:pause"), "STREAMER_ACTION_INVALID_PHASE", "pause while paused");
            assertError(await ask(owner, "streamer:host:start"), "STREAMER_ACTION_INVALID_PHASE", "start while paused");
            const resumed = nextState<HostStreamSnapshot>(owner, "streamer:host:state", (s) => s.phase === "running");
            assertOk(await ask(owner, "streamer:host:resume"), "resume");
            assert.equal((await resumed).card?.target, DECK[0].target);
            assertError(await ask(owner, "streamer:host:resume"), "STREAMER_ACTION_INVALID_PHASE", "resume while running");
            assertError(await ask(owner, "streamer:host:next"), "STREAMER_ACTION_INVALID_PHASE", "next while running");
            assertError(await ask(owner, "streamer:host:start", { now: true }), "INVALID_REQUEST", "payload on a no-payload action");
        });

        await test("pass: the host gets the next card, the public state shows only the passed one", async () => {
            const hostState = nextState<HostStreamSnapshot>(owner, "streamer:host:state", (s) => s.round === 2);
            const publicState = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.round === 2);
            assertOk(await ask(owner, "streamer:host:pass"), "pass");
            const host = await hostState;
            const pub = await publicState;
            assert.equal(host.card?.target, DECK[1].target);
            assert.equal(pub.passed?.target, DECK[0].target, "the passed card is turned face up");
            assertNoWords(pub, DECK[1], "public state after a pass");
        });

        await test("settings: a theme change reaches both rooms; bad patches are refused with INVALID_REQUEST", async () => {
            const publicState = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.theme === "sakura");
            const hostState = nextState<HostStreamSnapshot>(owner, "streamer:host:state", (s) => s.theme === "sakura");
            assertOk(await ask(owner, "streamer:host:settings", { theme: "sakura", clock: "ring", showCardName: false }), "theme");
            const pub = await publicState;
            assert.equal(pub.clock, "ring");
            assert.equal(pub.showCardName, false);
            await hostState;
            assertError(await ask(owner, "streamer:host:settings", { theme: "neon" }), "INVALID_REQUEST", "bad theme");
            assertError(await ask(owner, "streamer:host:settings", { theme: "sade", volume: 3 }), "INVALID_REQUEST", "extra key");
            assertError(await ask(owner, "streamer:host:settings", {}), "INVALID_REQUEST", "empty patch");
            assertError(await ask(owner, "streamer:host:settings", { cardBack: { itemId: -1 } }), "INVALID_REQUEST", "bad item id");
            assert.equal(runtime.get(sessionId)?.hostSnapshot().theme, "sakura");
        });

        await test("settings: card backs are resolved — owned ok, catalogue-only refused unless the showcase is on, null clears", async () => {
            const owned = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.cardBack?.itemId === 10);
            assertOk(await ask(owner, "streamer:host:settings", { cardBack: { itemId: 10 } }), "owned card back");
            const pub = await owned;
            // Exactly the inventory item's resolved look, bounded by the public projection.
            assert.deepEqual(pub.cardBack, {
                itemId: 10,
                name: "Kor",
                theme: {
                    renderSpecVersion: 1,
                    requestedRenderSpecVersion: 1,
                    usedRenderSpecFallback: false,
                    surfaceColor: "#102030",
                    borderColor: "#405060",
                    accentColor: "#c084fc",
                    secondaryColor: "#ddd6fe",
                    titleColor: "#f5f3ff",
                    detailColor: "#ddd6fe",
                    pattern: "dots",
                    patternOpacity: 0.22,
                    patternScale: 18,
                    motionPreset: "pulse",
                    motionSpeedMs: 5000,
                    glowColor: "#a855f7",
                    glowBlur: 28,
                    glowOpacity: 0.24,
                    overlayImageUrl: null,
                    overlayOpacity: 0,
                },
                imageUrl: "/cosmetics/10.svg",
            });
            assert.deepEqual(pub.cardBack, (await resolveCardBackSelection(1, 10, { streamerShowcaseAllCosmetics: false }, CARD_BACK_LOADERS)), "the resolver's own answer");
            assertError(
                await ask(owner, "streamer:host:settings", { cardBack: { itemId: 11 } }),
                "STREAMER_CARD_NOT_ALLOWED",
                "catalogue card back without the showcase",
            );
            assert.equal(runtime.get(sessionId)?.hostSnapshot().cardBack?.itemId, 10, "a refused patch changes nothing");
            features.streamerShowcaseAllCosmetics = true;
            assertOk(await ask(owner, "streamer:host:settings", { cardBack: { itemId: 11 } }), "catalogue card back with the showcase");
            assert.equal(runtime.get(sessionId)?.hostSnapshot().cardBack?.itemId, 11);
            features.streamerShowcaseAllCosmetics = false;
            assertError(await ask(owner, "streamer:host:settings", { cardBack: { itemId: 999 } }), "STREAMER_CARD_NOT_ALLOWED", "unknown card back");
            assertOk(await ask(owner, "streamer:host:settings", { cardBack: null }), "clear card back");
            assert.equal(runtime.get(sessionId)?.hostSnapshot().cardBack, null);
        });

        await test("an empty word pool is STREAMER_WORD_POOL_EMPTY and the round keeps running", async () => {
            source.empty = true;
            assertError(await ask(owner, "streamer:host:pass"), "STREAMER_WORD_POOL_EMPTY", "pass on an empty pool");
            source.empty = false;
            const live = runtime.get(sessionId);
            assert.equal(live?.phase, "running");
            assert.equal(live?.hostSnapshot().card?.target, DECK[1].target);
        });

        await test("a finished round reveals its card on the public screen; next deals a new hidden card", async () => {
            const finished = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.phase === "finished");
            clock.now += 61_000;
            await runtime.tickAll();
            const pub = await finished;
            assert.equal(pub.reveal?.target, DECK[1].target, "the guard lets the finished-round reveal through");
            const running = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.phase === "running");
            assertOk(await ask(owner, "streamer:host:next"), "next");
            const next = await running;
            assert.equal(liveCard().target, DECK[2].target);
            assert.equal(next.reveal, null);
            assertNoWords(next, DECK[2], "public state of the new round");
        });

        await test("a passed word that is a taboo of the next card stays face up; the public states keep flowing", async () => {
            const passedWord = liveCard().target;
            assert.ok(LANTERN.taboos.includes(passedWord), "the next card's taboos hold the passed word");
            const blocked = socketErrors.length;
            const round = liveRound() + 1;
            source.forced.push(LANTERN);
            const afterPass = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.round === round);
            assertOk(await ask(owner, "streamer:host:pass"), "pass");
            const pub = await afterPass;
            assert.equal(liveCard().target, LANTERN.target);
            assert.equal(pub.passed?.target, passedWord, "the passed card is turned face up");
            assertNoWords(pub, { ...LANTERN, taboos: LANTERN.taboos.filter((word) => word !== passedWord) }, "public state after the pass");
            const ticked = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.round === round && s.remaining < pub.remaining);
            clock.now += 1_000;
            await runtime.tickAll();
            assert.equal((await ticked).passed?.target, passedWord, "the next tick reaches the stream screen too");
            const reload = await connect(url);
            const ack = await ask(reload, "streamer:public:join", { viewKey });
            assertOk(ack, "a reload of the stream screen");
            assertPublicShape(ack.state, "reload ack");
            assert.equal(ack.state.passed?.target, passedWord);
            assert.equal(socketErrors.length, blocked, "no public state was blocked");
        });

        await test("a pass that deals the passed word again drops the passed card; the public states keep flowing", async () => {
            const word = liveCard();
            const blocked = socketErrors.length;
            const round = liveRound() + 1;
            source.forced.push(word);
            const afterPass = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.round === round);
            assertOk(await ask(owner, "streamer:host:pass"), "pass");
            const pub = await afterPass;
            assert.equal(liveCard().target, word.target, "the pool dealt the passed word again");
            assert.equal(pub.passed, null, "the passed card would show the live word");
            assert.equal(pub.passedRound, round - 1);
            assertNoWords(pub, word, "public state after the pass");
            const ticked = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.round === round && s.remaining < pub.remaining);
            clock.now += 1_000;
            await runtime.tickAll();
            assertNoWords(await ticked, word, "the next tick");
            assert.equal(socketErrors.length, blocked, "no public state was blocked");
        });

        await test("next dealing the passed word again drops the passed card; the public states keep flowing", async () => {
            const word = liveCard();
            const passRound = liveRound() + 1;
            source.forced.push(DOOR);
            const afterPass = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.round === passRound);
            assertOk(await ask(owner, "streamer:host:pass"), "pass");
            assert.equal((await afterPass).passed?.target, word.target);
            const finished = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.phase === "finished");
            clock.now += 61_000;
            await runtime.tickAll();
            assert.equal((await finished).reveal?.target, DOOR.target);
            const blocked = socketErrors.length;
            source.forced.push(word);
            const running = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.phase === "running");
            assertOk(await ask(owner, "streamer:host:next"), "next");
            const pub = await running;
            assert.equal(liveCard().target, word.target, "the pool dealt the passed word again");
            assert.equal(pub.passed, null, "the passed card would show the live word");
            assertNoWords(pub, word, "public state of the new round");
            const ticked = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.phase === "running" && s.remaining < pub.remaining);
            clock.now += 1_000;
            await runtime.tickAll();
            assertNoWords(await ticked, word, "the next tick");
            assert.equal(socketErrors.length, blocked, "no public state was blocked");
        });

        await test("host actions are limited to 10 per 10 s per socket (RATE_LIMITED), then the window resets", async () => {
            for (let action = 1; action <= 10; action++) {
                assertError(await ask(owner, "streamer:host:resume"), "STREAMER_ACTION_INVALID_PHASE", `action ${action}`);
            }
            assertError(await ask(owner, "streamer:host:resume"), "RATE_LIMITED", "11th action");
            assertError(await ask(owner, "streamer:host:pause"), "RATE_LIMITED", "12th action, another event");
            assert.equal(runtime.get(sessionId)?.phase, "running", "a limited pause did not run");
            const other = await connect(url, "stranger");
            assertError(await ask(other, "streamer:host:start"), "STREAMER_SESSION_NOT_FOUND", "the limit is per socket");
            socketClock.now += 10_001;
            assertError(await ask(owner, "streamer:host:resume"), "STREAMER_ACTION_INVALID_PHASE", "after the window");
        });

        await test("host actions are limited per user too: a second tab of the owner shares the same 10 / 10 s", async () => {
            const tab = await connect(url, "owner");
            assertOk(await ask(tab, "streamer:host:join", { sessionId }), "a second owner tab");
            for (let action = 1; action <= 6; action++) {
                assertError(await ask(owner, "streamer:host:resume"), "STREAMER_ACTION_INVALID_PHASE", `first tab, action ${action}`);
            }
            for (let action = 1; action <= 4; action++) {
                assertError(await ask(tab, "streamer:host:resume"), "STREAMER_ACTION_INVALID_PHASE", `second tab, action ${action}`);
            }
            assertError(await ask(tab, "streamer:host:resume"), "RATE_LIMITED", "the user's 11th action, from the second tab");
            assertError(await ask(owner, "streamer:host:pause"), "RATE_LIMITED", "and from the first tab, which used 6 of its own 10");
            assert.equal(runtime.get(sessionId)?.phase, "running", "a limited pause did not run");
            // A socket that joined no host room has only its own window: the user's is not touched.
            const unjoined = await connect(url, "owner");
            assertError(await ask(unjoined, "streamer:host:start"), "STREAMER_SESSION_NOT_FOUND", "an owner socket outside the host room");
            socketClock.now += 10_001;
            assertError(await ask(tab, "streamer:host:resume"), "STREAMER_ACTION_INVALID_PHASE", "after the window");
            assertError(await ask(owner, "streamer:host:resume"), "STREAMER_ACTION_INVALID_PHASE", "after the window, the first tab too");
        });

        await test("Z7 the burst limiter sweeps expired windows at most once per window length, however many keys it holds", () => {
            const at = { now: 1_000_000 };
            let sweeps = 0;
            const burst = createBurstLimiter(() => at.now, { onSweep: () => (sweeps += 1) });
            let consumes = 0;
            const consume = (key: string) => {
                consumes += 1;
                return burst.consume(key, STREAMER_HOST_ACTION_BURST);
            };
            for (let key = 0; key < 5_000; key++) assert.equal(consume(`s${key}:host-action`), true, `key ${key}`);
            assert.equal(sweeps, 1, "one sweep when the map reached the threshold, none on each later consume");
            for (let key = 0; key < 5_000; key++) consume(`s${key}:host-action`);
            assert.equal(sweeps, 1, "the same keys again within the window: no sweep");
            at.now += STREAMER_HOST_ACTION_BURST.windowMs - 1;
            consume("late:host-action");
            assert.equal(sweeps, 1, "not before a window length has passed since the last sweep");
            assert.equal(burst.size(), 5_001);
            at.now += 1;
            consume("later:host-action");
            assert.equal(sweeps, 2, "a window length later: one more sweep");
            assert.equal(burst.size(), 2, "it removed every expired window and kept the two still open");
            for (let key = 0; key < 3_000; key++) consume(`t${key}:host-action`);
            assert.equal(sweeps, 2, "the map refilled within the window: still no sweep per consume");
            assert.ok(consumes / sweeps > 5_000, `amortised: ${consumes} consumes, ${sweeps} sweeps`);
            assert.equal(MAX_BURST_WINDOWS, 10_000);
        });

        await test("Z7 a full burst map refuses a new window to a socket that joined no host room; the owner's windows still open; a sweep makes room", () => {
            const at = { now: 2_000_000 };
            const burst = createBurstLimiter(() => at.now, { maxWindows: 3 });
            for (const key of ["a:host-join", "b:host-join", "c:host-join"]) assert.equal(burst.consume(key, STREAMER_HOST_JOIN_BURST), true, key);
            assert.equal(burst.consume("d:host-join", STREAMER_HOST_JOIN_BURST), false, "full: a new unauthenticated window is refused");
            assert.equal(burst.consume("d:host-action", STREAMER_HOST_ACTION_BURST), false, "for any event");
            assert.equal(burst.size(), 3, "a refused key takes no room");
            assert.equal(burst.consume("a:host-join", STREAMER_HOST_JOIN_BURST), true, "an open window keeps counting");
            assert.equal(burst.consume("e:host-action", STREAMER_HOST_ACTION_BURST, true), true, "a socket in a host room still gets one");
            assert.equal(burst.consume("user:1:host-action", STREAMER_HOST_ACTION_BURST, true), true, "and so does its user");
            assert.equal(burst.size(), 5);
            at.now += STREAMER_HOST_JOIN_BURST.windowMs - 1;
            assert.equal(burst.consume("d:host-join", STREAMER_HOST_JOIN_BURST), false, "still full before the windows end");
            at.now += 1;
            assert.equal(burst.consume("d:host-join", STREAMER_HOST_JOIN_BURST), true, "the windows ended: the sweep made room");
            assert.equal(burst.size(), 1);
            // A key whose own window ended reuses its slot, even while the map is full.
            const full = createBurstLimiter(() => at.now, { maxWindows: 2 });
            full.consume("x:host-join", STREAMER_HOST_JOIN_BURST);
            full.consume("y:host-join", STREAMER_HOST_JOIN_BURST);
            at.now += 1;
            full.consume("user:9:host-action", STREAMER_HOST_ACTION_BURST, true);
            at.now += STREAMER_HOST_JOIN_BURST.windowMs - 1;
            assert.equal(full.consume("x:host-join", STREAMER_HOST_JOIN_BURST), true, "x's window ended: it opens a new one in its own slot");
            assert.equal(full.consume("z:host-join", STREAMER_HOST_JOIN_BURST), false, "a new key is still refused");
        });

        await test("Z7 the socket layer: with the burst map full, a socket outside any host room is RATE_LIMITED; the joined owner keeps acting", async () => {
            const quietRuntime: StreamerSessionRuntime = {
                ...wiredRuntime,
                setEmitter() {},
                setOnEnded() {},
                setOnHostNotice() {},
                setOnViewKeyRotated() {},
            };
            const smallServer: HttpServer = createServer();
            const smallIo = new Server(smallServer, { path: SOCKET_PATH });
            setupStreamerSocket(smallIo, quietRuntime, lookup, { ...options, maxBurstWindows: 3 });
            await within(new Promise<void>((resolve) => smallServer.listen(0, "127.0.0.1", () => resolve())), "listen (small map)");
            const smallUrl = `http://127.0.0.1:${(smallServer.address() as AddressInfo).port}`;
            try {
                const host = await connect(smallUrl, "owner");
                // Three windows: the host join's, then the joined socket's and its user's host-action ones.
                assertOk(await ask(host, "streamer:host:join", { sessionId }), "the owner joins");
                assertError(await ask(host, "streamer:host:resume"), "STREAMER_ACTION_INVALID_PHASE", "the owner acts");
                const flood = await connect(smallUrl);
                assertError(await ask(flood, "streamer:host:join", { sessionId }), "RATE_LIMITED", "a new socket's host join, map full");
                assertError(await ask(flood, "streamer:host:start"), "RATE_LIMITED", "and its host action");
                assertError(await ask(host, "streamer:host:resume"), "STREAMER_ACTION_INVALID_PHASE", "the joined owner keeps acting");
                assert.equal(runtime.get(sessionId)?.phase, "running");
                socketClock.now += STREAMER_HOST_JOIN_BURST.windowMs;
                assertError(await ask(flood, "streamer:host:join", { sessionId }), "AUTH_REQUIRED", "the windows ended: the sweep made room, the join is checked again");
            } finally {
                await within(new Promise<void>((resolve) => smallIo.close(() => resolve())), "io.close (small map)");
                if (smallServer.listening) await new Promise<void>((resolve) => smallServer.close(() => resolve()));
            }
        });

        await test("public joins are limited per IP in the streamer-public-join bucket (30 / 60 s)", async () => {
            limiter.reset();
            const before = limiter.calls.length;
            for (let join = 1; join <= 30; join++) assertOk(await ask(viewer, "streamer:public:join", { viewKey }), `join ${join}`);
            assertError(await ask(viewer, "streamer:public:join", { viewKey }), "RATE_LIMITED", "31st join");
            const calls = limiter.calls.slice(before);
            assert.equal(calls.length, 31);
            for (const call of calls) {
                assert.equal(call.bucket, "streamer-public-join");
                assert.equal(call.windowMs, 60_000);
                assert.equal(call.maxRequests, 30);
                assert.match(call.key, /^ip:/);
            }
            assert.ok(roomOf(io, publicRoom).has(viewer.socket.id!), "a limited join leaves the room the socket is in");
            limiter.reset();
        });

        await test("rotate-key: the new key goes only to the caller; old public sockets get streamer:ended and leave", async () => {
            const ownerTab = await connect(url, "owner");
            assertOk(await ask(ownerTab, "streamer:host:join", { sessionId }), "second owner tab");
            const secondViewer = await connect(url);
            assertOk(await ask(secondViewer, "streamer:public:join", { viewKey }), "second viewer");
            const watchers = [viewer, secondViewer, ownerTab, stranger, anonymous];
            const marks = watchers.map((client) => client.events.length);
            const endedViewer = nextEvent<{ reason: string }>(viewer, "streamer:ended");
            const endedSecond = nextEvent<{ reason: string }>(secondViewer, "streamer:ended");
            const hostAfter = nextState<HostStreamSnapshot>(ownerTab, "streamer:host:state");
            const ack = await ask(owner, "streamer:host:rotate-key");
            assertOk(ack, "rotate");
            assert.equal(typeof ack.viewKey, "string");
            const rotated = ack.viewKey as string;
            assert.equal(rotated.length, 43);
            assert.notEqual(rotated, viewKey);
            assert.deepEqual((await endedViewer)[0], { reason: "view-key-rotated" });
            assert.deepEqual((await endedSecond)[0], { reason: "view-key-rotated" });
            await hostAfter;
            assert.equal(roomOf(io, publicRoom).size, 0, "the public room was emptied");
            assert.ok(roomOf(io, hostRoom).has(owner.socket.id!) && roomOf(io, hostRoom).has(ownerTab.socket.id!), "the host room is untouched");
            for (const client of watchers) await barrier(client);
            watchers.forEach((client, index) => {
                const seen = JSON.stringify(client.events.slice(marks[index]));
                assert.ok(!seen.includes(rotated), "no other socket saw the new key");
            });
            assert.equal(received(viewer, "streamer:public:state", marks[0]).length, 0, "no public state after the rotation reached the old room");
            assertError(await ask(viewer, "streamer:public:join", { viewKey }), "STREAMER_VIEW_KEY_INVALID", "old key");
            viewKey = rotated;
            assertOk(await ask(viewer, "streamer:public:join", { viewKey }), "new key");
            assert.ok(roomOf(io, publicRoom).has(viewer.socket.id!));
        });

        await test("rotate-key is limited per user in the HTTP route's streamer-view-key bucket (10 / 15 min); a refusal rotates nothing", async () => {
            limiter.reset();
            // The fake limiter refuses the view-key bucket after two rotations (the real one after ten).
            limiter.refuseAfter("streamer-view-key", 2);
            const before = limiter.calls.length;
            assertError(await ask(stranger, "streamer:host:rotate-key"), "STREAMER_SESSION_NOT_FOUND", "stranger rotate");
            assert.equal(limiter.calls.length, before, "a caller outside the host room uses nothing of the owner's bucket");
            for (let rotation = 1; rotation <= 2; rotation++) {
                const ack = await ask(owner, "streamer:host:rotate-key");
                assertOk(ack, `rotation ${rotation}`);
                assert.notEqual(ack.viewKey, viewKey);
                viewKey = ack.viewKey as string;
            }
            assertOk(await ask(viewer, "streamer:public:join", { viewKey }), "the viewer on the current key");
            const keyHash = runtime.get(sessionId)?.viewKeyHash;
            const mark = viewer.events.length;
            assertError(await ask(owner, "streamer:host:rotate-key"), "RATE_LIMITED", "third rotation");
            // Per user, not per socket: another tab of the same user, with a fresh burst window, is refused too.
            const ownerTab = await connect(url, "owner");
            assertOk(await ask(ownerTab, "streamer:host:join", { sessionId }), "another owner tab");
            assertError(await ask(ownerTab, "streamer:host:rotate-key"), "RATE_LIMITED", "rotation from another tab");
            assert.equal(runtime.get(sessionId)?.viewKeyHash, keyHash, "no rotation happened");
            await barrier(viewer);
            assert.equal(received(viewer, "streamer:ended", mark).length, 0, "the stream screen was not closed");
            assert.ok(roomOf(io, publicRoom).has(viewer.socket.id!), "the viewer stays in the public room");
            const reload = await connect(url);
            assertOk(await ask(reload, "streamer:public:join", { viewKey }), "the old key still opens the stream screen");
            const calls = limiter.calls.slice(before).filter((call) => call.bucket === "streamer-view-key");
            assert.equal(calls.length, 4, "every rotate of a joined host consumed the bucket once");
            for (const call of calls) {
                assert.equal(call.key, "user:1");
                assert.equal(call.windowMs, 15 * 60_000);
                assert.equal(call.maxRequests, 10);
            }
            // The per-socket burst is apart: the owner socket used 3 of its 10 actions, so the next one still runs.
            assertError(await ask(owner, "streamer:host:resume"), "STREAMER_ACTION_INVALID_PHASE", "a host action after the refusal");
            limiter.reset();
        });

        const second = await createSession(deps, { userId: 3, settings: INPUT });
        const secondId = second.session.id;

        await test("a socket joining a second session's public room leaves the first; a host join for another's session keeps its room", async () => {
            assertOk(await ask(viewer, "streamer:public:join", { viewKey: second.viewKey }), "viewer joins session 2");
            assert.ok(!roomOf(io, publicRoom).has(viewer.socket.id!), "left session 1's public room");
            assert.ok(roomOf(io, streamerPublicRoom(secondId)).has(viewer.socket.id!));
            assertOk(await ask(viewer, "streamer:public:join", { viewKey }), "back to session 1");
            assert.ok(!roomOf(io, streamerPublicRoom(secondId)).has(viewer.socket.id!));
            assert.ok(roomOf(io, publicRoom).has(viewer.socket.id!));
            assertError(await ask(owner, "streamer:host:join", { sessionId: secondId }), "STREAMER_SESSION_NOT_OWNED", "owner of 1 joins 2");
            assert.ok(roomOf(io, hostRoom).has(owner.socket.id!));
            assert.ok(!roomOf(io, streamerHostRoom(secondId)).has(owner.socket.id!));
        });

        await test("a public join for an interrupted session (row active, no live runtime) is STREAMER_VIEW_KEY_INVALID", async () => {
            const orphanKey = randomBytes(32).toString("base64url");
            const orphan = await sessions.create({
                userId: 9,
                connectionId: null,
                platform: "twitch",
                settings: INPUT,
                viewKeyHash: hashViewKey(orphanKey),
                startedAt: new Date(clock.now),
            });
            assert.equal(orphan.status, "active");
            assertError(await ask(anonymous, "streamer:public:join", { viewKey: orphanKey }), "STREAMER_VIEW_KEY_INVALID", "interrupted");
            assert.equal(roomOf(io, streamerPublicRoom(orphan.id)).size, 0);
        });

        await test("the leak guard passes a real public state and trips on tampered ones, naming the rule that fired", () => {
            const live = runtime.get(sessionId);
            assert.ok(live);
            const host = live.hostSnapshot();
            const card = host.card as StreamCard;
            const pub = live.publicSnapshot();
            assertNoSecret(pub, live);
            const source = { hostSnapshot: () => host };
            // A passed word that is a taboo of the live card is no leak: viewers never see the taboos.
            assertNoSecret({ ...pub, passed: { round: 1, target: card.taboos[2] } }, source);
            const trips = (payload: unknown, rule: string, label: string, against: Parameters<typeof assertNoSecret>[1] = source) =>
                assertTrips(payload, rule, label, against);
            trips({ ...pub, card }, "host-field", "card key");
            trips({ ...pub, type: "host-state" }, "not-public", "host type");
            trips({ ...pub, players: [] }, "host-field", "players key");
            trips({ ...pub, reveal: { target: card.target, taboos: card.taboos, solved: false } }, "early-reveal", "reveal while running");
            trips(null, "not-public", "not an object");
            // The live word anywhere, in any letter case or padding.
            trips({ ...pub, pack: card.target }, "target", "target in another field");
            trips({ ...pub, extra: { nested: [`  ${card.target.toLocaleLowerCase("tr")}! `] } }, "target", "target, lower-cased and padded, nested");
            // The live word recycled into the passed card.
            trips({ ...pub, passed: { round: 1, target: card.target } }, "passed-target", "the live word in the passed card");
            const longWord = `${"UZUN".repeat(12)} KELİME`;
            const longCard = { hostSnapshot: () => ({ ...host, card: { wordId: 1, target: longWord, taboos: [] } }) };
            trips({ ...pub, passed: { round: 1, target: longWord.slice(0, 40) } }, "passed-target", "a long live word, cut as the passed card shows it", longCard);
            // A taboo anywhere but the passed card's word.
            trips({ ...pub, extra: { nested: [card.taboos[4]] } }, "taboo", "nested taboo");
            trips({ ...pub, lastCorrect: { eventId: card.taboos[0], name: "Luna", round: 1, pointsGranted: 1, solveMs: 900 } }, "taboo", "taboo beside a name");
            trips({ ...pub, passed: { round: 1, target: "BAŞKA", note: card.taboos[1] } }, "taboo", "taboo in another field of the passed card");
            trips({ ...pub, channel: { platform: card.taboos[3], name: "kanal" } }, "taboo", "taboo as the channel platform");
            // Viewer, channel and card-back names are chat or catalogue text, never card data: a viewer named like a taboo is no leak.
            const named = {
                ...pub,
                scores: [{ name: card.taboos[0], points: 3, rank: 1, tied: false }],
                lastCorrect: { eventId: 1, name: card.target, round: 1, solveMs: 900 },
                channel: { platform: "twitch", name: card.taboos[1] },
                cardBack: { itemId: 10, name: card.taboos[3], theme: { pattern: "grid" }, imageUrl: null },
            };
            assertNoSecret(named, source);
            // A finished round's reveal is on the stream screen by design; the word anywhere else still trips.
            const finished = { hostSnapshot: () => ({ ...host, phase: "finished" as const }) };
            const revealed = { ...pub, phase: "finished", reveal: { target: card.target, taboos: card.taboos, solved: true } };
            assertNoSecret(revealed, finished);
            trips({ ...revealed, pack: card.target }, "target", "the live word outside the reveal of a finished round", finished);
            // A field's fixed vocabulary (phase, theme, clock, pattern, ...) is no card data, even when a taboo is spelt
            // the same; keys are never compared. Outside that vocabulary, the same field is checked.
            const vocabulary = {
                hostSnapshot: () => ({ ...host, card: { wordId: 1, target: "DOĞUM GÜNÜ", taboos: ["Candle", "Sakura", "Running", "Rings", "Round"] } }),
            };
            const styled = {
                ...pub,
                phase: "running",
                theme: "sakura",
                clock: "candle",
                cardBack: { itemId: 10, name: "Kor", theme: { pattern: "rings", motionPreset: "pulse", surfaceColor: "#102030" }, imageUrl: null },
            };
            assertNoSecret(styled, vocabulary);
            trips({ ...styled, theme: "Sakura" }, "taboo", "a taboo outside the vocabulary of its field", vocabulary);
            trips({ ...styled, cardBack: { ...styled.cardBack, theme: { pattern: "Rings" } } }, "taboo", "a taboo as an unknown pattern", vocabulary);
            // Fails closed: a live card without a word to compare against.
            trips(pub, "no-target", "a live card without a target", { hostSnapshot: () => ({ ...host, card: { wordId: 1, target: " ", taboos: [] } }) });
        });

        await test("leak guard: paths are segments, so a key holding a dot or a star never forges an exempt path", () => {
            const live = runtime.get(sessionId);
            assert.ok(live);
            const host = live.hostSnapshot();
            const card = host.card as StreamCard;
            const pub = live.publicSnapshot();
            const source = { hostSnapshot: () => host };
            const [target, taboo] = [card.target, card.taboos[0]];
            assertTrips({ ...pub, "channel.name": target }, "target", "a dotted key is not channel.name", source);
            assertTrips({ ...pub, "cardBack.name": taboo }, "taboo", "a dotted key is not cardBack.name", source);
            assertTrips({ ...pub, scores: { "*": { name: target } } }, "target", "a * key is no array index", source);
            assertTrips({ ...pub, scores: [{ "*": { name: taboo } }] }, "taboo", "a * key inside an item is no array index either", source);
            assertTrips({ ...pub, "passed.target": taboo }, "taboo", "a dotted key is not the passed card's word", source);
            assertTrips({ ...pub, lastCorrect: { eventId: 1, name: "Luna", round: 1 }, "lastCorrect.name": target }, "target", "nor the last correct name", source);
            const finished = { hostSnapshot: () => ({ ...host, phase: "finished" as const }) };
            const revealed = { ...pub, phase: "finished", reveal: { target, taboos: card.taboos, solved: true } };
            assertNoSecret(revealed, finished);
            assertTrips({ ...revealed, "reveal.x": target }, "target", "a dotted key is not the reveal", finished);
            assertTrips({ ...revealed, revealed: { target } }, "target", "a key that starts with reveal is not the reveal", finished);
            const vocabulary = { hostSnapshot: () => ({ ...host, card: { wordId: 1, target: "DOĞUM GÜNÜ", taboos: ["Candle", "Rings"] } }) };
            assertTrips({ ...pub, "cardBack.theme.pattern": "rings" }, "taboo", "a dotted key has no vocabulary", vocabulary);
            assertTrips({ ...pub, extra: { clock: "candle" } }, "taboo", "a vocabulary field is matched at its own path only", vocabulary);
            // The real paths still pass: names are no card data, an array index is a wildcard.
            assertNoSecret(
                {
                    ...pub,
                    scores: [{ name: "Luna", points: 2, rank: 1, tied: true }, { name: target, points: 2, rank: 1, tied: true }],
                    channel: { platform: "twitch", name: taboo },
                },
                source,
            );
        });

        await test("leak guard: it walks what Socket.IO sends (the JSON of the payload), not the live object", () => {
            const live = runtime.get(sessionId);
            assert.ok(live);
            const host = live.hostSnapshot();
            const card = host.card as StreamCard;
            const pub = live.publicSnapshot();
            const source = { hostSnapshot: () => host };
            assertTrips({ ...pub, extra: { toJSON: () => card.target } }, "target", "a value that serializes to the live word", source);
            assertTrips({ ...pub, extra: new String(card.taboos[1]) }, "taboo", "a boxed string", source);
            assertTrips({ ...pub, extra: [new Date(0), { toJSON: () => [card.taboos[2]] }] }, "taboo", "nested toJSON", source);
            // What never reaches the wire is no leak: an undefined field, a function, a symbol key.
            assertNoSecret({ ...pub, card: undefined, extra: () => card.target, [Symbol("x")]: card.target }, source);
            const circular: Record<string, unknown> = { ...pub };
            circular.self = circular;
            assertTrips(circular, "not-public", "a payload Socket.IO cannot serialize", source);
            assertTrips({ ...pub, big: BigInt(1) }, "not-public", "a BigInt", source);
            assertTrips({ toJSON: () => null }, "not-public", "a payload that serializes to no object", source);
        });

        await test("leak guard: binary values are refused and keys outside the projection are compared like values", () => {
            const live = runtime.get(sessionId);
            assert.ok(live);
            const host = live.hostSnapshot();
            const card = host.card as StreamCard;
            const pub = live.publicSnapshot();
            const source = { hostSnapshot: () => host };
            // Socket.IO sends binary values as attachments the JSON walk never sees: refused outright.
            const bytes = () => new TextEncoder().encode(card.target);
            const binaries: Array<[string, unknown]> = [
                ["a Buffer", Buffer.from(card.target)],
                ["a Uint8Array", bytes()],
                ["an ArrayBuffer", bytes().buffer],
                ["a DataView", new DataView(bytes().buffer)],
                ["a Float64Array", new Float64Array([1, 2])],
                ["a Blob", new Blob([card.target])],
            ];
            for (const [label, value] of binaries) {
                assertTrips({ ...pub, extra: value }, "not-public", label, source);
                assertTrips({ ...pub, extra: { nested: [value] } }, "not-public", `${label}, nested`, source);
            }
            assertTrips({ ...pub, extra: { type: "Buffer", data: [...Buffer.from(card.target)] } }, "not-public", "a serialized Buffer", source);
            // A key outside the projection's fixed key set is compared like a value.
            assertTrips({ ...pub, extra: { [card.target]: 1 } }, "target", "the live word as a key", source);
            assertTrips({ ...pub, [card.taboos[0]]: true }, "taboo", "a taboo as a top-level key", source);
            assertTrips({ ...pub, extra: [{ deep: { [card.taboos[1].toLocaleLowerCase("tr")]: null } }] }, "taboo", "a taboo as a nested key", source);
            assertTrips(
                { ...pub, cardBack: { itemId: 10, name: "Kor", theme: { pattern: "grid", [card.taboos[2]]: "#102030" }, imageUrl: null } },
                "taboo",
                "a taboo as an unknown card-back theme key",
                source,
            );
            assertTrips({ ...pub, scores: [{ name: "Luna", points: 1, rank: 1, tied: false, [card.target]: 0 }] }, "target", "a key inside a score", source);
            // The projection's own keys are never compared, even when a card is spelt like one.
            const spelt = { hostSnapshot: () => ({ ...host, card: { wordId: 1, target: "TARGET", taboos: ["Round", "Name", "Theme", "Points", "Pattern"] } }) };
            assertNoSecret(
                {
                    ...pub,
                    passed: { round: 1, target: "KAPI" },
                    scores: [{ name: "Luna", points: 1, rank: 1, tied: false }],
                    cardBack: { itemId: 10, name: "Kor", theme: { pattern: "grid", surfaceColor: "#102030" }, imageUrl: null },
                },
                spelt,
            );
            // What the guard returns is the copy it checked: plain JSON, not the payload itself.
            const checked = assertNoSecret(pub, source);
            assert.deepEqual(checked, JSON.parse(JSON.stringify(pub)));
            assert.notEqual(checked, pub);
        });

        await test("leak guard: the emitter and the join ack send the copy the guard checked, never the payload read again", async () => {
            const live = runtime.get(sessionId);
            assert.ok(live && wiredEmit);
            const secret = liveCard().target;
            // A getter that answers safely the first time it is read and with the live word after.
            const tricky = () => {
                let reads = 0;
                const payload: Record<string, unknown> = { ...live.publicSnapshot() };
                Object.defineProperty(payload, "lastCorrect", {
                    enumerable: true,
                    get: () => (reads++ === 0 ? null : { eventId: secret, name: "Luna", round: 1, pointsGranted: 1, solveMs: 1 }),
                });
                return payload;
            };
            const mark = viewer.events.length;
            const followUp = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state");
            wiredEmit(sessionId, "public", tricky() as unknown as PublicStreamSnapshot);
            const sent = await followUp;
            assert.equal(sent.lastCorrect, null, "the client got the checked copy");
            assert.ok(!JSON.stringify(received(viewer, "streamer:public:state", mark)).includes(secret), "the live word never left the server");
            joinSnapshot = tricky;
            try {
                const screen = await connect(url);
                const ack = await ask(screen, "streamer:public:join", { viewKey });
                assertOk(ack, "a join while the projection reads differently the second time");
                assert.equal((ack.state as PublicStreamSnapshot).lastCorrect, null);
                assert.ok(!JSON.stringify(ack).includes(secret), "the ack carries the checked copy");
            } finally {
                joinSnapshot = null;
            }
        });

        await test("leak guard: words are compared folded (normal tolerance), as the domain drops a recycled pass", () => {
            const live = runtime.get(sessionId);
            assert.ok(live);
            const host = live.hostSnapshot();
            const pub = live.publicSnapshot();
            const folded = { hostSnapshot: () => ({ ...host, card: { wordId: 1, target: "ŞEMSİYE", taboos: ["Islanmak", "Yağmur", "Gökkuşağı"] } }) };
            assertNoSecret(pub, folded);
            assertTrips({ ...pub, extra: "semsiye" }, "target", "the live word without its Turkish letters", folded);
            assertTrips({ ...pub, extra: "islanmak" }, "taboo", "a taboo with a dotted i", folded);
            assertTrips({ ...pub, extra: ["YAGMUR!"] }, "taboo", "a taboo folded and shouted", folded);
            assertTrips({ ...pub, extra: { deep: "gokkusagi" } }, "taboo", "a taboo folded, nested", folded);
            assertTrips({ ...pub, passed: { round: 1, target: "Semsiye" } }, "passed-target", "the live word folded in the passed card", folded);
            // The passed card is compared with the live word only, folded too.
            assertNoSecret({ ...pub, passed: { round: 1, target: "yagmur" } }, folded);
            const long = "ŞEMSİYE".repeat(8);
            const longCard = { hostSnapshot: () => ({ ...host, card: { wordId: 1, target: long, taboos: [] } }) };
            assertTrips({ ...pub, passed: { round: 1, target: "SEMSIYE".repeat(8).slice(0, 40) } }, "passed-target", "a long live word, folded and cut", longCard);
        });

        await test("leak guard: a card-back colour field is skipped only while it holds a hex colour", () => {
            const live = runtime.get(sessionId);
            assert.ok(live);
            const host = live.hostSnapshot();
            const pub = live.publicSnapshot();
            const decade = { hostSnapshot: () => ({ ...host, card: { wordId: 1, target: "DOĞUM GÜNÜ", taboos: ["Decade", "Facade", "Bead", "Cafe", "Ace"] } }) };
            const colours = {
                surfaceColor: "#DECADE",
                borderColor: "#FACADE",
                accentColor: "#BEAD",
                secondaryColor: "#CAFE",
                titleColor: "#ACE",
                detailColor: "#decade",
                glowColor: "#DECADE80",
            };
            const withTheme = (theme: Record<string, unknown>) => ({ ...pub, cardBack: { itemId: 10, name: "Kor", theme: { pattern: "grid", ...theme }, imageUrl: null } });
            assertNoSecret(withTheme(colours), decade);
            for (const field of Object.keys(colours)) {
                assertTrips(withTheme({ ...colours, [field]: "decade" }), "taboo", `${field}: a value that is no hex colour is compared`, decade);
                assertTrips(withTheme({ ...colours, [field]: "#Decade!" }), "taboo", `${field}: a near-hex value is compared`, decade);
            }
            assertTrips({ ...pub, extra: "#DECADE" }, "taboo", "a hex colour outside the colour fields is compared", decade);
            assertTrips(withTheme({ pattern: "#DECADE" }), "taboo", "a hex value in a non-colour card-back field is compared", decade);
        });

        await test("leak guard: every member of each fixed vocabulary is skipped at its field, even spelt like a taboo", () => {
            const live = runtime.get(sessionId);
            assert.ok(live);
            const host = live.hostSnapshot();
            const pub = live.publicSnapshot();
            const vocabularies: Array<[string, readonly string[], (value: string) => Record<string, unknown>]> = [
                ["phase", ["ready", "running", "paused", "finished", "ended"], (value) => ({ ...pub, phase: value, reveal: null })],
                ["theme", BROADCAST_THEMES, (value) => ({ ...pub, theme: value })],
                ["camera", CAMERA_SLOTS, (value) => ({ ...pub, camera: value })],
                ["cameraSize", CAMERA_SIZES, (value) => ({ ...pub, cameraSize: value })],
                ["clock", TIMER_STYLES, (value) => ({ ...pub, clock: value })],
                ["pack", ["TR", "EN"], (value) => ({ ...pub, pack: value })],
                ["channel.platform", CHANNEL_PLATFORMS, (value) => ({ ...pub, channel: { platform: value, name: "kanal" } })],
                [
                    "pattern",
                    ["none", "grid", "dots", "diagonal", "chevrons", "rings", "noise"],
                    (value) => ({ ...pub, cardBack: { itemId: 10, name: "Kor", theme: { pattern: value }, imageUrl: null } }),
                ],
                [
                    "motionPreset",
                    ["none", "pulse", "drift", "shimmer"],
                    (value) => ({ ...pub, cardBack: { itemId: 10, name: "Kor", theme: { motionPreset: value }, imageUrl: null } }),
                ],
            ];
            for (const [field, members, payload] of vocabularies) {
                for (const member of members) {
                    const spelt = { hostSnapshot: () => ({ ...host, card: { wordId: 1, target: "DOĞUM GÜNÜ", taboos: [member] } }) };
                    assertNoSecret(payload(member), spelt);
                    assertTrips({ ...payload(member), extra: member }, "taboo", `${field} ${member}: the same word elsewhere is compared`, spelt);
                }
            }
        });

        await test("a public broadcast that fails the guard is dropped and reported", async () => {
            assert.ok(wiredEmit, "the socket layer installed an emitter");
            const live = runtime.get(sessionId);
            assert.ok(live);
            const mark = viewer.events.length;
            const errorsBefore = socketErrors.length;
            const followUp = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state");
            wiredEmit(sessionId, "public", { ...live.publicSnapshot(), card: live.hostSnapshot().card } as unknown as PublicStreamSnapshot);
            // A valid state sent right after: the viewer gets it, and nothing before it.
            const valid = live.publicSnapshot();
            wiredEmit(sessionId, "public", valid);
            assert.deepEqual(await followUp, valid, "the follow-up state arrives");
            assert.deepEqual(received(viewer, "streamer:public:state", mark).map((entry) => entry.args[0]), [valid], "the tampered state never left the server");
            assert.equal(socketErrors.length, errorsBefore + 1);
            assert.equal(socketErrors[errorsBefore].event, "streamer_socket.public_state_blocked");
            assert.equal((socketErrors[errorsBefore].error as { rule?: unknown }).rule, "host-field");
            // Fails closed: a public state with no live session and no host projection to check against.
            wiredEmit(randomUUID(), "public", live.publicSnapshot());
            assert.equal(socketErrors.length, errorsBefore + 2);
            assert.equal(socketErrors[errorsBefore + 1].event, "streamer_socket.public_state_blocked");
            assert.equal((socketErrors[errorsBefore + 1].error as { rule?: unknown }).rule, "no-reference");
        });

        await test("a blocked public state is reported once per session, round and rule", async () => {
            const round = liveRound() + 1;
            const passed = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.round === round);
            assertOk(await ask(owner, "streamer:host:pass"), "a new round");
            await passed;
            const live = runtime.get(sessionId);
            assert.ok(live && wiredEmit);
            const emit = wiredEmit;
            const errorsBefore = socketErrors.length;
            const blocked = () => socketErrors.slice(errorsBefore).filter((entry) => entry.event === "streamer_socket.public_state_blocked");
            const withCard = () => ({ ...live.publicSnapshot(), card: live.hostSnapshot().card }) as unknown as PublicStreamSnapshot;
            const withWord = () => ({ ...live.publicSnapshot(), extra: liveCard().target }) as unknown as PublicStreamSnapshot;
            for (let attempt = 0; attempt < 3; attempt++) {
                emit(sessionId, "host", live.hostSnapshot());
                emit(sessionId, "public", withCard());
                emit(sessionId, "public", withWord());
            }
            assert.deepEqual(blocked().map((entry) => (entry.error as { rule?: unknown }).rule), ["host-field", "target"], "one report per rule in this round");
            // A state with nothing to check against is reported each time and remembered nowhere:
            // no live session would ever clean that entry up.
            const other = randomUUID();
            emit(other, "public", live.publicSnapshot());
            emit(other, "public", live.publicSnapshot());
            assert.equal(blocked().length, 4);
            // The next round reports again.
            const next = liveRound() + 1;
            const afterPass = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.round === next);
            assertOk(await ask(owner, "streamer:host:pass"), "the next round");
            await afterPass;
            emit(sessionId, "public", withCard());
            emit(sessionId, "public", withCard());
            assert.deepEqual(blocked().map((entry) => (entry.error as { rule?: unknown }).rule), ["host-field", "target", "no-reference", "no-reference", "host-field"]);
        });

        await test("blocked-state dedupe remembers at most 1000 sessions, the oldest dropped first", async () => {
            const live = runtime.get(sessionId);
            assert.ok(live && wiredEmit);
            const emit = wiredEmit;
            const errorsBefore = socketErrors.length;
            const blocked = () => socketErrors.slice(errorsBefore).filter((entry) => entry.event === "streamer_socket.public_state_blocked").length;
            const tampered = { ...live.publicSnapshot(), card: live.hostSnapshot().card } as unknown as PublicStreamSnapshot;
            const blockFor = (id: string) => {
                emit(id, "host", live.hostSnapshot());
                emit(id, "public", tampered);
            };
            const first = randomUUID();
            blockFor(first);
            blockFor(first);
            assert.equal(blocked(), 1, "the first session's trip is remembered");
            for (let other = 0; other < 1_000; other++) blockFor(randomUUID());
            assert.equal(blocked(), 1_001);
            blockFor(first);
            assert.equal(blocked(), 1_002, "past 1000 sessions the oldest entry was dropped, so it reports again");
        });

        await test("a rotate-key whose write fails is reported sanitized: the error name, the Prisma code and a fixed message", async () => {
            const planted = "PLANTED-hash-fedcba9876543210";
            limiter.reset();
            const errorsBefore = socketErrors.length;
            writeGate.failKey = Object.assign(new Error(`Invalid \`prisma.streamSession.update()\` invocation: { data: { viewKeyHash: "${planted}" } }`), {
                name: "PrismaClientKnownRequestError",
                code: "P2002",
            });
            try {
                assertError(await ask(owner, "streamer:host:rotate-key"), "UNKNOWN_ERROR", "a rotation whose write fails");
            } finally {
                writeGate.failKey = null;
            }
            const reported = socketErrors.slice(errorsBefore);
            assert.deepEqual(reported.map((entry) => entry.event), ["streamer_socket.host_rotate-key_failed"]);
            const error = reported[0].error as Error & { code?: string };
            assert.deepEqual([error.name, error.message, error.code], ["PrismaClientKnownRequestError", "stream session write failed", "P2002"]);
            assert.ok(!String(error.stack).includes(planted), "the report carries none of the call");
        });

        await test("Z9 any other handler failure is reported sanitized too: a lookup or a features read whose Prisma error names its call", async () => {
            const secret = "PLANTED-lookup-0123456789abcdef";
            const prismaError = (call: string) =>
                Object.assign(new Error(`Invalid \`prisma.${call}()\` invocation: { where: { viewKeyHash: "${secret}" } }`), {
                    name: "PrismaClientKnownRequestError",
                    code: "P1001",
                    meta: { target: secret },
                });
            const errorsBefore = socketErrors.length;
            planted.lookup = prismaError("streamSession.findUnique");
            planted.features = prismaError("systemSetting.findUnique");
            try {
                assertError(await ask(viewer, "streamer:public:join", { viewKey }), "UNKNOWN_ERROR", "a lookup that throws");
                assertError(await ask(owner, "streamer:host:settings", { cardBack: { itemId: 10 } }), "STREAMER_CARD_CATALOGUE_UNAVAILABLE", "a features read that throws");
            } finally {
                planted.lookup = null;
                planted.features = null;
            }
            const reported = socketErrors.slice(errorsBefore);
            assert.deepEqual(reported.map((entry) => entry.event), ["streamer_socket.public_join_failed", "streamer_socket.features_failed"]);
            for (const { error } of reported) {
                const safe = error as Error & { code?: string; meta?: unknown };
                assert.deepEqual([safe.name, safe.message, safe.code, safe.meta], ["PrismaClientKnownRequestError", "streamer socket event failed", "P1001", undefined]);
                assert.ok(!String(safe.stack).includes(secret) && !JSON.stringify(safe).includes(secret), "the report carries none of the call");
            }
        });

        await test("every event is answered exactly once even when the error reporter throws; nothing is left unhandled", async () => {
            const unhandled: unknown[] = [];
            const onUnhandled = (reason: unknown) => unhandled.push(reason);
            process.on("unhandledRejection", onUnhandled);
            const errorsBefore = socketErrors.length;
            failing.reporter = true;
            try {
                failing.limiter = true;
                assertError(await ask(owner, "streamer:host:rotate-key"), "UNKNOWN_ERROR", "a limiter that throws, then a reporter that throws");
                failing.limiter = false;
                failing.lookup = true;
                assertError(await ask(viewer, "streamer:public:join", { viewKey }), "UNKNOWN_ERROR", "a lookup that throws");
                // Without an ack the failure comes as one hata, before the reply to a later event.
                const mark = viewer.events.length;
                viewer.socket.emit("streamer:public:join", { viewKey });
                await barrier(viewer);
                const hatas = received(viewer, "hata", mark);
                assert.equal(hatas.length, 1, "one hata for the event without an ack");
                assert.equal((hatas[0].args[1] as { code: string }).code, "UNKNOWN_ERROR");
            } finally {
                failing.reporter = false;
                failing.limiter = false;
                failing.lookup = false;
            }
            assert.deepEqual(
                socketErrors.slice(errorsBefore).map((entry) => entry.event),
                ["streamer_socket.host_rotate-key_failed", "streamer_socket.public_join_failed", "streamer_socket.public_join_failed"],
                "each failure reached the reporter once",
            );
            await new Promise((resolve) => setImmediate(resolve));
            process.off("unhandledRejection", onUnhandled);
            assert.deepEqual(unhandled, [], "no handler promise rejected");
            assertOk(await ask(viewer, "streamer:public:join", { viewKey }), "the socket still works");
        });

        await test("end: both rooms get the final state and streamer:ended { reason: ended }; both rooms are emptied", async () => {
            assertError(await ask(owner, "streamer:host:end", { reason: "idle" }), "INVALID_REQUEST", "a client cannot pick idle");
            const finalCard = liveCard();
            const finalPublic = nextState<PublicStreamSnapshot>(viewer, "streamer:public:state", (s) => s.phase === "ended");
            const finalHost = nextState<HostStreamSnapshot>(owner, "streamer:host:state", (s) => s.phase === "ended");
            const endedHost = nextEvent<{ reason: string }>(owner, "streamer:ended");
            const endedPublic = nextEvent<{ reason: string }>(viewer, "streamer:ended");
            assertOk(await ask(owner, "streamer:host:end", { reason: "ended" }), "end");
            assertNoWords(await finalPublic, finalCard, "final public state");
            await finalHost;
            assert.deepEqual((await endedHost)[0], { reason: "ended" });
            assert.deepEqual((await endedPublic)[0], { reason: "ended" });
            assert.equal(io.sockets.adapter.rooms.get(hostRoom), undefined, "host room is empty");
            assert.equal(io.sockets.adapter.rooms.get(publicRoom), undefined, "public room is empty");
            assertError(await ask(owner, "streamer:host:start"), "STREAMER_SESSION_NOT_FOUND", "action after end");
            assertError(await ask(owner, "streamer:host:join", { sessionId }), "STREAMER_SESSION_NOT_FOUND", "host join after end");
            assertError(await ask(viewer, "streamer:public:join", { viewKey }), "STREAMER_VIEW_KEY_INVALID", "ended key");
        });

        await test("an idle session ends with streamer:ended { reason: idle } in both rooms", async () => {
            const host = await connect(url, "second");
            assertOk(await ask(host, "streamer:host:join", { sessionId: secondId }), "second host joins");
            assertOk(await ask(viewer, "streamer:public:join", { viewKey: second.viewKey }), "viewer joins session 2");
            const endedHost = nextEvent<{ reason: string }>(host, "streamer:ended");
            const endedPublic = nextEvent<{ reason: string }>(viewer, "streamer:ended");
            clock.now += 6 * 3_600_000 + 1_000;
            await runtime.tickAll();
            assert.deepEqual((await endedHost)[0], { reason: "idle" });
            assert.deepEqual((await endedPublic)[0], { reason: "idle" });
            assert.equal(io.sockets.adapter.rooms.get(streamerHostRoom(secondId)), undefined);
            assert.equal(io.sockets.adapter.rooms.get(streamerPublicRoom(secondId)), undefined);
        });

        await test("rotate during end: a key stored while the session closes is never handed out; both rooms get ended", async () => {
            const fourth = await createSession(deps, { userId: 3, settings: INPUT });
            const fourthId = fourth.session.id;
            const host = await connect(url, "second");
            const screen = await connect(url);
            assertOk(await ask(host, "streamer:host:join", { sessionId: fourthId }), "the host joins");
            assertOk(await ask(screen, "streamer:public:join", { viewKey: fourth.viewKey }), "the stream screen joins");
            let release = () => {};
            writeGate.held = new Promise<void>((resolve) => (release = resolve));
            const keyWriteStarted = new Promise<void>((resolve) => {
                writeGate.onUpdate = (patch) => {
                    if ("viewKeyHash" in patch) resolve();
                };
            });
            try {
                const rotating = ask(host, "streamer:host:rotate-key");
                await within(keyWriteStarted, "the new key's write starts");
                const finalHost = nextState<HostStreamSnapshot>(host, "streamer:host:state", (s) => s.phase === "ended");
                const endedHost = nextEvent<{ reason: string }>(host, "streamer:ended");
                const endedScreen = nextEvent<{ reason: string }>(screen, "streamer:ended");
                const ending = ask(host, "streamer:host:end");
                // The end has begun (its final state is out) and now waits for the key write.
                await finalHost;
                writeGate.held = null;
                release();
                assertError(await rotating, "STREAMER_SESSION_NOT_FOUND", "the session closed while its new key was stored");
                assertOk(await ending, "end");
                assert.deepEqual((await endedHost)[0], { reason: "ended" });
                assert.deepEqual((await endedScreen)[0], { reason: "ended" });
            } finally {
                writeGate.held = null;
                writeGate.onUpdate = null;
                release();
            }
            await runtime.flush();
            assert.equal(io.sockets.adapter.rooms.get(streamerHostRoom(fourthId)), undefined, "the host room is empty");
            assert.equal(io.sockets.adapter.rooms.get(streamerPublicRoom(fourthId)), undefined, "the public room is empty");
            assert.equal((await sessions.findById(fourthId))?.status, "ended");
            assertError(await ask(screen, "streamer:public:join", { viewKey: fourth.viewKey }), "STREAMER_VIEW_KEY_INVALID", "the old key");
            for (const client of [host, screen]) {
                assert.ok(!client.events.some((entry) => JSON.stringify(entry.args).includes('"viewKey"')), "no socket was sent a new key");
            }
        });

        await test("a host join puts the socket in its user's session room: a password reset or email change drops it", async () => {
            const third = await createSession(deps, { userId: 1, settings: INPUT });
            const thirdId = third.session.id;
            const host = await connect(url, "owner");
            const outsider = await connect(url, "stranger");
            assertError(await ask(outsider, "streamer:host:join", { sessionId: thirdId }), "STREAMER_SESSION_NOT_OWNED", "stranger join");
            assertOk(await ask(host, "streamer:host:join", { sessionId: thirdId }), "owner join");
            const hostId = host.socket.id!;
            const members = (await io.in(userSessionRoom(1)).fetchSockets()).map((socket) => socket.id);
            assert.ok(members.includes(hostId), "the host socket is in the user-session room");
            assert.equal((await io.in(userSessionRoom(2)).fetchSockets()).length, 0, "a refused host join joins no user-session room");
            registerSocketServer(io);
            const dropped = within(new Promise<string>((resolve) => host.socket.once("disconnect", (reason) => resolve(reason))), "host disconnect");
            assert.equal(await disconnectUserSockets(1), true);
            assert.equal(await dropped, "io server disconnect");
            assert.equal((await io.in(userSessionRoom(1)).fetchSockets()).length, 0, "every socket of the user was dropped");
            assert.ok(!roomOf(io, streamerHostRoom(thirdId)).has(hostId), "the host room lost the dropped socket");
            assert.ok(outsider.socket.connected, "another user's socket stays");
        });

        await test("a socket from an untrusted origin is refused with ORIGIN_REJECTED and disconnected", async () => {
            const socket = connectClient(url, {
                path: SOCKET_PATH,
                auth: { ...SOCKET_CLIENT_AUTH, testUser: "owner" },
                transports: ["websocket"],
                forceNew: true,
                reconnection: false,
                extraHeaders: { Origin: "https://evil.example" },
            });
            clients.push({ socket, events: [] });
            const hata = within(new Promise<unknown[]>((resolve) => socket.once("hata", (...args: unknown[]) => resolve(args))), "origin hata");
            const disconnected = within(new Promise<string>((resolve) => socket.once("disconnect", (reason) => resolve(reason))), "origin disconnect");
            const [, meta] = await hata;
            assert.equal((meta as { code: string }).code, "ORIGIN_REJECTED");
            assert.equal(await disconnected, "io server disconnect");
        });

        await test("streamer mode off: host join and host actions are STREAMER_MODE_DISABLED, a public join the opaque STREAMER_VIEW_KEY_INVALID; ending still works", async () => {
            const fifth = await createSession(deps, { userId: 3, settings: INPUT });
            const fifthId = fifth.session.id;
            const host = await connect(url, "second");
            const screen = await connect(url);
            assertOk(await ask(host, "streamer:host:join", { sessionId: fifthId }), "joined while the mode is on");
            assertOk(await ask(screen, "streamer:public:join", { viewKey: fifth.viewKey }), "the stream screen joined while on");
            // Unknown (the database does not answer) is no "off": everything keeps working.
            mode.state = "unknown";
            try {
                const unsure = await connect(url, "second");
                assertOk(await ask(unsure, "streamer:host:join", { sessionId: fifthId }), "a host join while the mode is unknown");
                assertError(await ask(unsure, "streamer:host:resume"), "STREAMER_ACTION_INVALID_PHASE", "a host action reaches the session");
                const unsureScreen = await connect(url);
                assertOk(await ask(unsureScreen, "streamer:public:join", { viewKey: fifth.viewKey }), "a public join while the mode is unknown");
            } finally {
                mode.state = "on";
            }
            mode.state = "off";
            try {
                const late = await connect(url, "second");
                assertError(await ask(late, "streamer:host:join", { sessionId: fifthId }), "STREAMER_MODE_DISABLED", "a host join");
                assert.ok(!roomOf(io, streamerHostRoom(fifthId)).has(late.socket.id!), "a refused join joins nothing");
                const limitCalls = limiter.calls.length;
                const actions: Array<[string, unknown?]> = [
                    ["streamer:host:start"],
                    ["streamer:host:pause"],
                    ["streamer:host:resume"],
                    ["streamer:host:pass"],
                    ["streamer:host:next"],
                    ["streamer:host:settings", { theme: "sade" }],
                    ["streamer:host:rotate-key"],
                ];
                for (const [event, payload] of actions) {
                    assertError(await (payload === undefined ? ask(host, event) : ask(host, event, payload)), "STREAMER_MODE_DISABLED", event);
                }
                assert.equal(limiter.calls.length, limitCalls, "a refused rotation spends nothing of the view-key bucket");
                assert.equal(runtime.get(fifthId)?.phase, "ready", "no action ran");
                assert.equal(runtime.get(fifthId)?.viewKeyHash, hashViewKey(fifth.viewKey), "no key was rotated");
                assertError(await ask(screen, "streamer:public:join", { viewKey: fifth.viewKey }), "STREAMER_VIEW_KEY_INVALID", "a public join is opaque");
                const reload = await connect(url);
                assertError(await ask(reload, "streamer:public:join", { viewKey: fifth.viewKey }), "STREAMER_VIEW_KEY_INVALID", "a fresh stream screen");
                assert.ok(!roomOf(io, streamerPublicRoom(fifthId)).has(reload.socket.id!));
                // Ending is never gated: the owner can always take the stream off the air.
                const endedScreen = nextEvent<{ reason: string }>(screen, "streamer:ended");
                assertOk(await ask(host, "streamer:host:end"), "end while the mode is off");
                assert.deepEqual((await endedScreen)[0], { reason: "ended" });
            } finally {
                mode.state = "on";
            }
            assert.equal(runtime.get(fifthId), null);
        });

        await test("the kill switch: once streamer mode reads off, every live session ends with streamer:ended { reason: stopped } in both rooms", async () => {
            assert.ok(runtime.forUser(1), "user 1's session from an earlier check is still live");
            const sixth = await createSession(deps, { userId: 3, settings: INPUT });
            const sixthId = sixth.session.id;
            const host = await connect(url, "second");
            const screen = await connect(url);
            assertOk(await ask(host, "streamer:host:join", { sessionId: sixthId }), "host join");
            assertOk(await ask(screen, "streamer:public:join", { viewKey: sixth.viewKey }), "public join");
            assertOk(await ask(host, "streamer:host:start"), "a round runs");
            const endedHost = nextEvent<{ reason: string }>(host, "streamer:ended");
            const endedScreen = nextEvent<{ reason: string }>(screen, "streamer:ended");
            let checks = 0;
            let thirdCheck = () => {};
            const third = new Promise<void>((resolve) => (thirdCheck = resolve));
            mode.state = "unknown";
            const unwatch = runtime.watchMode(async () => {
                checks += 1;
                if (checks === 3) thirdCheck();
                return mode.state;
            }, 20);
            try {
                // Unknown for several checks (the database away): nothing ends.
                await within(third, "three mode checks while unknown");
                assert.ok(runtime.get(sixthId), "an unknown mode ends nothing");
                mode.state = "off";
                assert.deepEqual((await endedHost)[0], { reason: "stopped" });
                assert.deepEqual((await endedScreen)[0], { reason: "stopped" });
            } finally {
                unwatch();
                mode.state = "on";
            }
            await runtime.flush();
            const row = await sessions.findById(sixthId);
            assert.equal(row?.status, "ended", "a stopped session is ended, its summary written");
            assert.deepEqual(row?.summary, { scores: [], participants: 0, rounds: 0 });
            assert.equal(io.sockets.adapter.rooms.get(streamerHostRoom(sixthId)), undefined, "the host room is empty");
            assert.equal(io.sockets.adapter.rooms.get(streamerPublicRoom(sixthId)), undefined, "the public room is empty");
            assert.equal(runtime.forUser(1), null, "every live session was stopped");
            assertError(await ask(screen, "streamer:public:join", { viewKey: sixth.viewKey }), "STREAMER_VIEW_KEY_INVALID", "its key is dead");
        });

        const eighth = await createSession(deps, { userId: 1, settings: INPUT });
        const eighthId = eighth.session.id;

        await test("a suspension ends the owner's live session: endStreamerSessionsForUser closes both rooms with reason stopped; without a runtime it does nothing", async () => {
            const seventh = await createSession(deps, { userId: 3, settings: INPUT });
            const seventhId = seventh.session.id;
            const host = await connect(url, "second");
            const screen = await connect(url);
            assertOk(await ask(host, "streamer:host:join", { sessionId: seventhId }), "host join");
            assertOk(await ask(screen, "streamer:public:join", { viewKey: seventh.viewKey }), "public join");
            const endedHost = nextEvent<{ reason: string }>(host, "streamer:ended");
            const endedScreen = nextEvent<{ reason: string }>(screen, "streamer:ended");
            const slot = globalThis as typeof globalThis & { __hushleStreamerSessionRuntime?: StreamerSessionRuntime };
            const previous = slot.__hushleStreamerSessionRuntime;
            slot.__hushleStreamerSessionRuntime = runtime;
            try {
                assert.equal(await endStreamerSessionsForUser(2), false, "a user with nothing live");
                assert.equal(await endStreamerSessionsForUser(3), true);
                assert.deepEqual((await endedHost)[0], { reason: "stopped" });
                assert.deepEqual((await endedScreen)[0], { reason: "stopped" });
                assert.equal(await endStreamerSessionsForUser(3), false, "nothing is left to end");
            } finally {
                if (previous) slot.__hushleStreamerSessionRuntime = previous;
                else delete slot.__hushleStreamerSessionRuntime;
            }
            await runtime.flush();
            assert.equal((await sessions.findById(seventhId))?.status, "ended");
            assert.equal(io.sockets.adapter.rooms.get(streamerHostRoom(seventhId)), undefined);
            assert.equal(io.sockets.adapter.rooms.get(streamerPublicRoom(seventhId)), undefined);
            // No runtime in this process (a route served elsewhere, a job): nothing happens, nothing throws.
            assert.equal(slot.__hushleStreamerSessionRuntime, undefined);
            assert.equal(await endStreamerSessionsForUser(1), false);
            assert.ok(runtime.get(eighthId), "user 1's live session is untouched");
        });

        await test("the hourly link check: a broken link sends streamer:host:notice to the host room only; the session goes on", async () => {
            const host = await connect(url, "owner");
            const screen = await connect(url);
            assertOk(await ask(host, "streamer:host:join", { sessionId: eighthId }), "host join");
            assertOk(await ask(screen, "streamer:public:join", { viewKey: eighth.viewKey }), "public join");
            const screenMark = screen.events.length;
            const notice = nextEvent<{ kind: string; platform: string }>(host, "streamer:host:notice");
            linkAnswers.set(1, "needs_reconnect");
            try {
                assert.deepEqual((await notice)[0], { kind: "connection-needs-reconnect", platform: "twitch" });
            } finally {
                linkAnswers.delete(1);
            }
            await barrier(screen);
            assert.deepEqual(received(screen, "streamer:host:notice", screenMark), [], "the stream screen hears nothing of it");
            assert.equal(runtime.get(eighthId)?.phase, "ready", "the session keeps going");
            assertOk(await ask(host, "streamer:host:start"), "and the host plays on");
        });

        await test("shutdown: stop() closes both rooms of every live session with streamer:ended { reason: interrupted }; rows interrupted", async () => {
            const host = await connect(url, "owner");
            const screen = await connect(url);
            assertOk(await ask(host, "streamer:host:join", { sessionId: eighthId }), "host join");
            assertOk(await ask(screen, "streamer:public:join", { viewKey: eighth.viewKey }), "public join");
            const endedHost = nextEvent<{ reason: string }>(host, "streamer:ended");
            const endedScreen = nextEvent<{ reason: string }>(screen, "streamer:ended");
            await runtime.stop();
            assert.deepEqual((await endedHost)[0], { reason: "interrupted" });
            assert.deepEqual((await endedScreen)[0], { reason: "interrupted" });
            assert.equal((await sessions.findById(eighthId))?.status, "interrupted");
            assert.equal(io.sockets.adapter.rooms.get(streamerHostRoom(eighthId)), undefined);
            assert.equal(io.sockets.adapter.rooms.get(streamerPublicRoom(eighthId)), undefined);
            assert.equal(runtime.get(eighthId), null);
            assertError(await ask(screen, "streamer:public:join", { viewKey: eighth.viewKey }), "STREAMER_VIEW_KEY_INVALID", "its key is dead");
        });

        assert.deepEqual(runtimeErrors, [], "the runtime reported no errors");
    } finally {
        for (const client of clients) client.socket.disconnect();
        await runtime.stop();
        await within(new Promise<void>((resolve) => io.close(() => resolve())), "io.close");
        if (httpServer.listening) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        clearTimeout(watchdog);
    }
    console.log(`${count} checks passed.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
