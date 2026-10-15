import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@hushle/platform-db";
import { closeRedisClient } from "@hushle/platform-cache";
import { invalidateCategoryCache } from "../apps/web/src/lib/socket/category-service";
import { getConnectionPauseAnalytics } from "../apps/web/src/lib/analytics/connection-pause-analytics";
import { CONNECTION_PAUSE_RESOLVE_EVENT } from "../apps/web/src/lib/socket/connection-pause-contract";

// Run against a server started with CONNECTION_PAUSE_GRACE_SECONDS=5.
const serverUrl = process.env.SOCKET_TEST_URL ?? "http://127.0.0.1:3301";
// Production servers only answer /api/health with the shared token.
const healthHeaders: Record<string, string> = process.env.HEALTHCHECK_TOKEN?.trim()
    ? { "x-health-token": process.env.HEALTHCHECK_TOKEN.trim() }
    : {};
const graceSeconds = Number(process.env.CONNECTION_PAUSE_GRACE_SECONDS ?? "5");
const timeoutMs = 45_000;

interface LobbyPlayer { playerId: string; ad: string; takim: "A" | "B" | null; online: boolean; rol: string }
interface Lobby { odaKodu: string; creatorPlayerId: string; oyuncular: LobbyPlayer[] }
interface PauseSummary {
    waitingForPlayers: boolean;
    missingPlayers?: Array<{ playerId: string; ad: string; takim: "A" | "B" | null }>;
    resolutionAvailableInSeconds?: number;
    canContinueWithoutMissing?: boolean;
}
interface GameState {
    oyunDurduruldu: boolean;
    gecisEkraninda: boolean;
    mevcutTur: number;
    kalanZaman: number;
    anlatacakTakim: "A" | "B";
    anlatici: { ad: string; takim: "A" | "B" } | null;
    gozetmen: { ad: string; takim: "A" | "B" } | null;
    connectionPause: PauseSummary | null;
}
interface Transition { anlatici: { ad: string; takim: "A" | "B" }; gozetmen: { ad: string; takim: "A" | "B" } | null; connectionPause?: PauseSummary | null }

interface Player {
    name: string;
    socket: Socket;
    playerId: string;
    guestToken?: string;
    errors: Array<{ message: string; code?: string }>;
    lobby: Lobby | null;
    state: GameState | null;
    pause: PauseSummary | null;
}

function assertSafeTarget(): void {
    assert.equal(process.env.CONNECTION_PAUSE_E2E_TEST, "true", "CONNECTION_PAUSE_E2E_TEST=true is required");
    const url = new URL(serverUrl);
    assert.ok(url.hostname === "127.0.0.1" || url.hostname === "localhost", "loopback server only");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor<T>(socket: Socket, event: string, predicate: (payload: T) => boolean = () => true): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`${event} timed out`));
        }, timeoutMs);
        const handler = (payload: T) => {
            if (!predicate(payload)) return;
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(payload);
        };
        socket.on(event, handler);
    });
}

async function until(label: string, check: () => boolean, ms = timeoutMs): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (check()) return;
        await sleep(100);
    }
    throw new Error(`timed out waiting for ${label}`);
}

function cookieHeaderFrom(setCookies: string[]): string {
    return setCookies.map((cookie) => cookie.split(";", 1)[0]).filter(Boolean).join("; ");
}

async function login(username: string, password: string): Promise<string> {
    const csrfResponse = await fetch(`${serverUrl}/api/auth/csrf`);
    const csrf = (await csrfResponse.json()) as { csrfToken: string };
    const csrfCookies = csrfResponse.headers.getSetCookie();
    const callback = await fetch(`${serverUrl}/api/auth/callback/credentials`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeaderFrom(csrfCookies) },
        body: new URLSearchParams({ csrfToken: csrf.csrfToken, username, password, portal: "user", callbackUrl: `${serverUrl}/dashboard` }),
        redirect: "manual",
    });
    const cookies = [...csrfCookies, ...callback.headers.getSetCookie()];
    assert.ok(cookies.some((cookie) => cookie.includes("authjs.session-token")), `login failed for ${username}`);
    return cookieHeaderFrom(cookies);
}

function join(name: string, options: { roomCode?: string; cookie?: string; guestToken?: string } = {}): Promise<Player> {
    return new Promise((resolve, reject) => {
        const socket = io(serverUrl, {
            path: "/api/socketio",
            transports: ["websocket"],
            forceNew: true,
            reconnection: false,
            extraHeaders: { Origin: serverUrl, ...(options.cookie ? { Cookie: options.cookie } : {}) },
        });
        const player: Player = { name, socket, playerId: "", errors: [], lobby: null, state: null, pause: null };
        socket.on("hata", (message: string, meta?: { code?: string }) =>
            player.errors.push({ message, code: meta?.code })
        );
        socket.on("lobiGuncelle", (lobby: Lobby) => { player.lobby = lobby; });
        socket.on("oyunDurumuGuncelle", (state: GameState) => {
            player.state = state;
            player.pause = state.connectionPause ?? null;
        });
        socket.on("turGecisiBaslat", (transition: Transition) => { player.pause = transition.connectionPause ?? null; });
        socket.on("turGecisDurumGuncelle", (update: { connectionPause?: PauseSummary | null }) => { player.pause = update.connectionPause ?? null; });
        const timer = setTimeout(() => reject(new Error(`${name} join timed out`)), timeoutMs);
        socket.once("kimlikAta", (identity: { playerId: string; guestToken?: string }) => {
            player.playerId = identity.playerId;
            player.guestToken = identity.guestToken;
        });
        socket.once("lobiGuncelle", () => {
            clearTimeout(timer);
            resolve(player);
        });
        socket.on("connect", () =>
            socket.emit("room:request", {
                kullaniciAdi: name,
                ...(options.roomCode ? { odaKodu: options.roomCode } : {}),
                ...(options.guestToken ? { guestToken: options.guestToken } : {}),
            })
        );
        socket.on("connect_error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

async function lobbyWith(host: Player, count: number): Promise<Lobby> {
    await until(`${count} players in lobby`, () => (host.lobby?.oyuncular.filter((p) => p.online).length ?? 0) === count);
    return host.lobby!;
}

/** Moves the host to the bottom of its team so it is never the first narrator or inspector. */
async function sinkHost(host: Player, teamSize: number): Promise<void> {
    for (let step = 0; step < teamSize - 1; step += 1) {
        host.socket.emit("narrator_order", { playerId: host.playerId, direction: "down" });
        await sleep(250);
    }
    const lobby = host.lobby!;
    const team = lobby.oyuncular.filter((p) => p.takim === lobby.oyuncular.find((q) => q.playerId === host.playerId)?.takim);
    assert.equal(team.at(-1)?.playerId, host.playerId, "host must be last in its team order");
}

async function start(host: Player, categoryId: number, mode: { mod: "skor" | "tur"; deger: number }): Promise<Transition> {
    const started = waitFor<undefined>(host.socket, "oyunBasladi");
    const transition = waitFor<Transition>(host.socket, "turGecisiBaslat");
    host.socket.emit("oyun_baslat", { seciliKategoriler: [categoryId], seciliZorluklar: [1], ayarlar: { sure: 60, ...mode } });
    await started;
    return transition;
}

function resolve(player: Player, action: "continue_without_missing" | "end_match"): void {
    player.socket.emit(CONNECTION_PAUSE_RESOLVE_EVENT, { action });
}

/** Waits for a `hata` with this code; the Turkish text must still read as before for old clients. */
async function expectError(player: Player, code: string, pattern: RegExp, action: () => void): Promise<void> {
    const before = player.errors.length;
    action();
    await until(
        `error ${code}`,
        () => player.errors.slice(before).some((error) => error.code === code && pattern.test(error.message)),
        5_000
    );
}

/** Returns the room to the lobby so no interrupted match is left on the server. */
async function closeMatch(host: Player): Promise<void> {
    const backToLobby = waitFor<undefined>(host.socket, "lobiyeDon");
    host.socket.emit("oyun_sifirla");
    await backToLobby;
}

async function activeMatches(): Promise<number> {
    const response = await fetch(`${serverUrl}/api/health`, { headers: healthHeaders });
    assert.equal(response.status, 200, "health refused: set HEALTHCHECK_TOKEN to the server's token");
    const health = (await response.json()) as { aktifMacSayisi?: number };
    assert.equal(typeof health.aktifMacSayisi, "number", "health must report active matches");
    return health.aktifMacSayisi as number;
}

async function waitForResolvable(player: Player): Promise<void> {
    await until("pause resolvable", () => player.pause?.waitingForPlayers === true && player.pause.resolutionAvailableInSeconds === 0, (graceSeconds + 10) * 1000);
}

async function run(): Promise<void> {
    assertSafeTarget();
    assert.ok(graceSeconds >= 5 && graceSeconds <= 10, "start the server with CONNECTION_PAUSE_GRACE_SECONDS between 5 and 10");
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const sockets: Socket[] = [];
    const userIds: number[] = [];
    const roomCodes: string[] = [];
    let categoryId = 0;
    let wordId = 0;
    const track = (players: Player[]) => sockets.push(...players.map((p) => p.socket));
    const analyticsBefore = await getConnectionPauseAnalytics({ days: 7 });
    const matchesBefore = await activeMatches();

    try {
        const category = await prisma.category.create({ data: { name: `Pause e2e ${suffix}`, color: "#2563eb", isVisible: true } });
        categoryId = category.id;
        const word = await prisma.word.create({
            data: {
                wordText: `pause-e2e-${suffix}`,
                difficulty: 1,
                tabooWords: { create: [{ tabooWordText: "test" }] },
                wordCategories: { create: [{ categoryId }] },
            },
        });
        wordId = word.id;
        await invalidateCategoryCache();

        async function sixPlayerRoom(tag: string): Promise<Player[]> {
            const host = await join(`H${tag}${suffix}`);
            roomCodes.push(host.lobby!.odaKodu);
            const others: Player[] = [];
            for (let index = 1; index < 6; index += 1) {
                others.push(await join(`P${index}${tag}${suffix}`, { roomCode: host.lobby!.odaKodu }));
            }
            const players = [host, ...others];
            track(players);
            await lobbyWith(host, 6);
            await sinkHost(host, 3);
            return players;
        }
        const byName = (players: Player[], ad: string) => players.find((p) => p.name === ad)!;

        // S1. Narrator leaves mid-turn in 3v3: grace and permission are enforced, then the
        // host continues without them; the turn passes to the other team.
        {
            const players = await sixPlayerRoom("a");
            const host = players[0];
            const firstTransition = await start(host, categoryId, { mod: "skor", deger: 10 });
            await until("turn started", () => host.state?.gecisEkraninda === false && host.state.anlatici !== null);
            const narrator = byName(players, host.state!.anlatici!.ad);
            assert.notEqual(narrator, host);
            assert.equal(firstTransition.anlatici.ad, narrator.name);
            const narratorTeam = host.state!.anlatici!.takim;
            narrator.socket.disconnect();
            await until("pause after narrator leaves", () => host.pause?.waitingForPlayers === true);
            assert.deepEqual(host.pause!.missingPlayers?.map((p) => p.playerId), [narrator.playerId]);
            assert.equal(host.pause!.missingPlayers?.[0].ad, narrator.name);
            assert.equal(host.pause!.canContinueWithoutMissing, true);
            assert.ok((host.pause!.resolutionAvailableInSeconds ?? 0) > 0);

            await expectError(host, "CONNECTION_DECISION_TOO_EARLY", /süre tanıyın \(\d+ sn\)/, () => resolve(host, "continue_without_missing"));
            const bystander = players.find((p) => p !== host && p !== narrator)!;
            await expectError(bystander, "CONNECTION_DECISION_HOST_ONLY", /yalnız yönetici/, () => resolve(bystander, "end_match"));

            await waitForResolvable(host);
            const nextTransition = waitFor<Transition>(host.socket, "turGecisiBaslat");
            resolve(host, "continue_without_missing");
            const transition = await nextTransition;
            assert.notEqual(transition.anlatici.takim, narratorTeam, "the interrupted turn ends; the other team speaks");
            assert.notEqual(transition.anlatici.ad, narrator.name);
            await until("departed player shown as spectator", () => {
                const entry = host.lobby?.oyuncular.find((p) => p.playerId === narrator.playerId);
                return entry?.rol === "İzleyici" && entry.takim === null;
            });
            assert.equal(host.pause, null);

            // S5. The departed player returns as a spectator and does not re-trigger a pause.
            const returned = await join(narrator.name, { roomCode: host.lobby!.odaKodu, guestToken: narrator.guestToken });
            track([returned]);
            assert.equal(returned.playerId, narrator.playerId);
            await sleep(500);
            const entry = host.lobby!.oyuncular.find((p) => p.playerId === narrator.playerId);
            assert.equal(entry?.online, true);
            assert.equal(entry?.rol, "İzleyici");
            assert.equal(host.pause, null);
            await closeMatch(host);
            console.log("[pause-e2e] S1/S5 narrator left, continued without, returned as spectator");
        }

        // S2. Inspector leaves mid-turn: a new inspector is assigned and the clock keeps running.
        {
            const players = await sixPlayerRoom("b");
            const host = players[0];
            await start(host, categoryId, { mod: "skor", deger: 10 });
            await until("turn started", () => host.state?.gecisEkraninda === false && host.state.gozetmen !== null);
            const inspector = byName(players, host.state!.gozetmen!.ad);
            assert.notEqual(inspector, host);
            inspector.socket.disconnect();
            await until("pause after inspector leaves", () => host.pause?.waitingForPlayers === true);
            const pausedClock = host.state!.kalanZaman;
            const narratorBefore = host.state!.anlatici?.ad;
            await waitForResolvable(host);
            assert.equal(host.state!.kalanZaman, pausedClock, "the turn clock is frozen during the pause");
            const roles = players
                .filter((p) => p !== inspector)
                .map((p) => waitFor<{ rol: string }>(p.socket, "yeniTurBilgisi").then((turn) => [p, turn.rol] as const));
            resolve(host, "continue_without_missing");
            const assigned = await Promise.all(roles);
            const newInspector = assigned.find(([, rol]) => rol === "Gözetmen")?.[0];
            assert.ok(newInspector && newInspector !== inspector, "a new inspector is assigned");
            await until("clock resumed", () => (host.state?.kalanZaman ?? pausedClock) < pausedClock);
            // Same turn: no transition, same narrator, and the clock continues instead of resetting.
            assert.equal(host.state!.gecisEkraninda, false, "the turn continues without a transition");
            assert.equal(host.state!.anlatici?.ad, narratorBefore, "the narrator keeps the turn");
            assert.ok(host.state!.kalanZaman >= pausedClock - 3, "the clock continues from where it stopped");
            assert.equal(host.state!.gozetmen?.ad, newInspector.name);
            await closeMatch(host);
            console.log("[pause-e2e] S2 inspector replaced, clock resumed");
        }

        // S7. A second disconnect inside the same (not yet resumed) pause gets a fresh grace
        // period and is counted as a new pause.
        {
            const players = await sixPlayerRoom("d");
            const host = players[0];
            await start(host, categoryId, { mod: "skor", deger: 10 });
            await until("turn started", () => host.state?.gecisEkraninda === false && host.state.gozetmen !== null);
            const narrator = byName(players, host.state!.anlatici!.ad);
            const inspector = byName(players, host.state!.gozetmen!.ad);
            narrator.socket.disconnect();
            await until("first pause", () => host.pause?.waitingForPlayers === true);
            const back = await join(narrator.name, { roomCode: host.lobby!.odaKodu, guestToken: narrator.guestToken });
            track([back]);
            await until("narrator back, still paused", () => host.pause !== null && host.pause.waitingForPlayers === false);
            await sleep((graceSeconds + 1) * 1000);
            inspector.socket.disconnect();
            await until("second episode", () => host.pause?.waitingForPlayers === true);
            assert.ok((host.pause!.resolutionAvailableInSeconds ?? 0) > 0, "a new disconnect starts a new grace period");
            await expectError(host, "CONNECTION_DECISION_TOO_EARLY", /süre tanıyın \(\d+ sn\)/, () => resolve(host, "continue_without_missing"));
            await waitForResolvable(host);
            resolve(host, "continue_without_missing");
            await until("pause cleared", () => host.pause === null);
            await closeMatch(host);
            console.log("[pause-e2e] S7 second disconnect in one pause restarted the grace period");
        }

        // S6. Narrator leaves during the transition: same team gets a new narrator and the
        // round counter is not advanced twice (round mode).
        {
            const players = await sixPlayerRoom("c");
            const host = players[0];
            const transition = await start(host, categoryId, { mod: "tur", deger: 3 });
            const narrator = byName(players, transition.anlatici.ad);
            assert.notEqual(narrator, host);
            narrator.socket.disconnect();
            await until("pause during transition", () => host.pause?.waitingForPlayers === true);
            await waitForResolvable(host);
            const restarted = waitFor<Transition>(host.socket, "turGecisiBaslat");
            resolve(host, "continue_without_missing");
            const again = await restarted;
            assert.equal(again.anlatici.takim, transition.anlatici.takim, "same team keeps its turn");
            assert.notEqual(again.anlatici.ad, narrator.name);
            await until("turn started after restart", () => host.state?.gecisEkraninda === false && host.state.anlatici !== null, 20_000);
            assert.equal(host.state!.mevcutTur, 1, "re-picking a narrator must not count a new round");
            await closeMatch(host);
            console.log("[pause-e2e] S6 transition restarted for the same team without skipping a round");
        }

        // S3. 2v2 with a registered host: continuing would leave a team of one, so only ending
        // works; the match is recorded as host_ended with no coins and no win.
        {
            const username = `pause_${suffix}`;
            const password = `Pause-${suffix}!`;
            const user = await prisma.user.create({ data: { username, password: await bcryptjs.hash(password, 10), role: "user" } });
            userIds.push(user.id);
            const cookie = await login(username, password);
            const host = await join(username, { cookie });
            const roomCode = host.lobby!.odaKodu;
            roomCodes.push(roomCode);
            const others = [await join(`Q1${suffix}`, { roomCode }), await join(`Q2${suffix}`, { roomCode }), await join(`Q3${suffix}`, { roomCode })];
            const players = [host, ...others];
            track(players);
            await lobbyWith(host, 4);
            await start(host, categoryId, { mod: "skor", deger: 10 });
            const leaver = others[0];
            leaver.socket.disconnect();
            await until("pause after 2v2 departure", () => host.pause?.waitingForPlayers === true);
            assert.equal(host.pause!.canContinueWithoutMissing, false);
            await waitForResolvable(host);
            await expectError(host, "CONTINUE_WITHOUT_MISSING_BLOCKED", /en az 2 oyuncu/, () => resolve(host, "continue_without_missing"));
            const finished = waitFor<{ kazananTakim: string; endReason?: string }>(host.socket, "oyunBitti");
            resolve(host, "end_match");
            const ended = await finished;
            assert.equal(ended.endReason, "host_ended");
            assert.equal(ended.kazananTakim, "Berabere");
            const deadline = Date.now() + 15_000;
            let result = null;
            while (!result && Date.now() < deadline) {
                result = await prisma.matchResult.findFirst({ where: { roomCode, userId: user.id } });
                if (!result) await sleep(250);
            }
            assert.ok(result, "host_ended match is recorded");
            assert.equal(result.endReason, "host_ended");
            assert.equal(result.coinEarned, 0);
            assert.equal(result.won, false);
            const settlement = await prisma.matchSettlement.findFirstOrThrow({ where: { roomCode } });
            assert.equal(settlement.endReason, "host_ended");
            console.log("[pause-e2e] S3 2v2 can only end; host_ended settled with no coins");
        }

        // S4. The host leaves a 2v2: another active participant may decide; a late spectator may not.
        {
            const host = await join(`R0${suffix}`);
            const roomCode = host.lobby!.odaKodu;
            roomCodes.push(roomCode);
            const others = [await join(`R1${suffix}`, { roomCode }), await join(`R2${suffix}`, { roomCode }), await join(`R3${suffix}`, { roomCode })];
            track([host, ...others]);
            await lobbyWith(host, 4);
            await start(host, categoryId, { mod: "skor", deger: 10 });
            const spectator = await join(`R4${suffix}`, { roomCode });
            track([spectator]);
            host.socket.disconnect();
            const deputy = others[0];
            await until("pause after host leaves", () => deputy.pause?.waitingForPlayers === true);
            await waitForResolvable(deputy);
            await expectError(spectator, "CONNECTION_DECISION_HOST_ONLY", /yalnız yönetici/, () => resolve(spectator, "end_match"));
            const finished = waitFor<{ endReason?: string }>(deputy.socket, "oyunBitti");
            resolve(deputy, "end_match");
            assert.equal((await finished).endReason, "host_ended");
            console.log("[pause-e2e] S4 participant resolved for an absent host; spectator refused");
        }

        // Analytics: every pause and resolution above was counted.
        await sleep(500);
        const after = await getConnectionPauseAnalytics({ days: 7 });
        if (after.available) {
            assert.ok(after.paused - analyticsBefore.paused >= 7, "seven pause episodes were recorded");
            assert.ok(after.outcomes.resumed_after_reconnect - analyticsBefore.outcomes.resumed_after_reconnect >= 1, "the healed first episode was closed");
            assert.ok(after.outcomes.continued_without_missing - analyticsBefore.outcomes.continued_without_missing >= 3);
            assert.ok(after.outcomes.ended_by_host - analyticsBefore.outcomes.ended_by_host >= 2);
            assert.ok(after.byTrigger.narrator - analyticsBefore.byTrigger.narrator >= 2);
            assert.ok(after.byTrigger.inspector - analyticsBefore.byTrigger.inspector >= 1);
            console.log("[pause-e2e] analytics counted pauses and outcomes");
        } else {
            console.log("[pause-e2e] analytics unavailable (no Redis); skipped counter checks");
        }

        assert.equal(await activeMatches(), matchesBefore, "every scenario must leave no active match behind");
        console.log("connection pause resolution e2e checks passed");
    } finally {
        for (const socket of sockets) socket.disconnect();
        if (roomCodes.length > 0) await prisma.matchSettlement.deleteMany({ where: { roomCode: { in: roomCodes } } });
        if (userIds.length > 0) {
            await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
            await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        }
        if (categoryId) {
            await prisma.category.deleteMany({ where: { id: categoryId } });
            await invalidateCategoryCache();
        }
        if (wordId) await prisma.word.deleteMany({ where: { id: wordId } });
        await prisma.$disconnect();
        await closeRedisClient();
    }
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
