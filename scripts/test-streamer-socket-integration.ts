import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as connectClient, type Socket as ClientSocket } from "socket.io-client";
import type { HostStreamSnapshot, PublicStreamSnapshot, StreamCard } from "@hushle/domain-streamer";
import {
    createMemoryStreamerConnectionStore,
    type StreamerConnectionRecord,
    type StreamerPlatform,
} from "@hushle/platform-streamer";
import { SOCKET_CLIENT_AUTH } from "../apps/web/src/lib/socket/protocol-version";
import {
    assertNoSecret,
    setupStreamerSocket,
    streamerHostRoom,
    streamerPublicRoom,
    type StreamerSocketOptions,
} from "../apps/web/src/lib/socket/streamer-socket";
import type { consumeDistributedRequestRateLimit } from "../apps/web/src/lib/security/request-rate-limit";
import { resolveCardBackSelection, type CardBackCatalogItem, type CardBackLoaders } from "../apps/web/src/lib/streamer/card-backs";
import type { CreateSessionInput } from "../apps/web/src/lib/streamer/session-settings";
import { createMemoryStreamSessionStore } from "../apps/web/src/lib/streamer/session-store";
import {
    createStreamerSessionRuntime,
    type StreamerEmitter,
    type StreamerSessionRuntime,
    type WordSource,
} from "../apps/web/src/lib/streamer/session-runtime";
import { createSession, type StreamerSessionServiceDeps } from "../apps/web/src/lib/streamer/session-service";
import { hashViewKey } from "../apps/web/src/lib/streamer/view-key";

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

function pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

interface FakeSource extends WordSource {
    empty: boolean;
    draws: number;
}

function deckSource(): FakeSource {
    const source: FakeSource = {
        empty: false,
        draws: 0,
        async next() {
            if (source.empty) return null;
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
    const consume: RateLimit = async (options) => {
        calls.push(options);
        const key = `${options.bucket}|${options.key}`;
        const used = (counts.get(key) ?? 0) + 1;
        counts.set(key, used);
        const allowed = used <= options.maxRequests;
        return { allowed, limit: options.maxRequests, remaining: Math.max(0, options.maxRequests - used), retryAfterSeconds: allowed ? 0 : 60 };
    };
    return { calls, consume, reset: () => counts.clear() };
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
    const runtimeErrors: Array<{ event: string; error: unknown }> = [];
    const runtime = createStreamerSessionRuntime({
        store: sessions,
        wordSource: source,
        now: () => clock.now,
        tickMs: 50,
        onError: (event, error) => runtimeErrors.push({ event, error }),
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
    const wiredRuntime: StreamerSessionRuntime = {
        ...runtime,
        setEmitter(emit) {
            wiredEmit = emit;
            runtime.setEmitter(emit);
        },
    };

    const limiter = countingLimiter();
    const socketErrors: Array<{ event: string; error: unknown }> = [];
    const options: StreamerSocketOptions = {
        resolveUser: async (socket) => {
            const who = (socket.handshake.auth as { testUser?: unknown } | undefined)?.testUser;
            return typeof who === "string" && TEST_USERS[who] ? { ...TEST_USERS[who] } : { userId: null, isSuspended: false };
        },
        rateLimit: limiter.consume,
        features: async () => ({ ...features }),
        resolveCardBack: (userId, itemId, flags) => resolveCardBackSelection(userId, itemId, flags, CARD_BACK_LOADERS),
        now: () => socketClock.now,
        onError: (event, error) => socketErrors.push({ event, error }),
    };

    const httpServer: HttpServer = createServer();
    const io = new Server(httpServer, { path: SOCKET_PATH });
    setupStreamerSocket(io, wiredRuntime, sessions, options);
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
            await pause(50);
            assert.equal(stranger.events.length, strangerMark, "the stranger got nothing");
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
            assert.equal(pub.cardBack?.name, "Kor");
            assert.equal(typeof pub.cardBack?.theme, "object");
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
            await pause(50);
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

        await test("the leak guard passes a real public state and trips on tampered ones", () => {
            const live = runtime.get(sessionId);
            assert.ok(live);
            const host = live.hostSnapshot();
            const card = host.card as StreamCard;
            const pub = live.publicSnapshot();
            assertNoSecret(pub, live);
            const source = { hostSnapshot: () => host };
            const trips = (payload: unknown, label: string) =>
                assert.throws(() => assertNoSecret(payload, source), /secret|host-only|public/i, label);
            trips({ ...pub, card }, "card key");
            trips({ ...pub, type: "host-state" }, "host type");
            trips({ ...pub, players: [] }, "players key");
            trips({ ...pub, reveal: { target: card.target, taboos: card.taboos, solved: false } }, "reveal while running");
            trips({ ...pub, pack: card.target }, "target in another field");
            trips({ ...pub, passed: { round: 1, target: card.taboos[2] } }, "taboo in the passed card");
            trips({ ...pub, extra: { nested: [card.taboos[4]] } }, "nested taboo");
            trips(null, "not an object");
            // Viewer and channel names are chat text, never card data: a viewer named like a taboo is no leak.
            const named = {
                ...pub,
                scores: [{ name: card.taboos[0], points: 3, rank: 1, tied: false }],
                lastCorrect: { eventId: 1, name: card.target, round: 1, solveMs: 900 },
                channel: { platform: "twitch", name: card.taboos[1] },
            };
            assertNoSecret(named, source);
            const finished = { hostSnapshot: () => ({ ...host, phase: "finished" as const }) };
            assertNoSecret({ ...pub, phase: "finished", reveal: { target: card.target, taboos: card.taboos, solved: true } }, finished);
        });

        await test("a public broadcast that fails the guard is dropped and reported", async () => {
            assert.ok(wiredEmit, "the socket layer installed an emitter");
            const live = runtime.get(sessionId);
            assert.ok(live);
            const mark = viewer.events.length;
            const errorsBefore = socketErrors.length;
            wiredEmit(sessionId, "public", { ...live.publicSnapshot(), card: live.hostSnapshot().card } as unknown as PublicStreamSnapshot);
            await pause(100);
            assert.equal(received(viewer, "streamer:public:state", mark).length, 0, "the tampered state never left the server");
            assert.equal(socketErrors.length, errorsBefore + 1);
            assert.equal(socketErrors[errorsBefore].event, "streamer_socket.public_state_blocked");
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
