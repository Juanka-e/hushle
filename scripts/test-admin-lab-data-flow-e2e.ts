import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import bcryptjs from "bcryptjs";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@hushle/platform-db";
import { closeRedisClient, getRedisClient, getRedisKey } from "@hushle/platform-cache";
import { invalidateCategoryCache } from "../apps/web/src/lib/socket/category-service";
import { CONNECTION_PAUSE_RESOLVE_EVENT } from "../apps/web/src/lib/socket/connection-pause-contract";
import { getSystemSettings } from "../apps/web/src/lib/system-settings/service";
import { resolveMatchRewardCoin } from "../apps/web/src/lib/system-settings/economy";
import type { ConnectionPauseAnalyticsSummary } from "../apps/web/src/lib/analytics/connection-pause-analytics";
import {
    guestClaimSharePercent,
    type GuestClaimAnalyticsSummary,
} from "../apps/web/src/lib/analytics/guest-claim-analytics-rules";

// Real play on a running server must reach both Admin Lab sections. Reads the Lab endpoints as
// an admin, plays matches with socket clients that pause, resume, continue, end and get claimed,
// then asserts the exact change of every counter. Run against a server started with
// CONNECTION_PAUSE_GRACE_SECONDS=5 and its own REDIS_KEY_PREFIX (the same prefix here).
//
// ADMIN_LAB_DATA_FLOW_KEEP_FILE=<path> keeps the data and writes the numbers for the browser
// check; ADMIN_LAB_DATA_FLOW_CLEANUP_FILE=<path> later removes it. ADMIN_LAB_DATA_FLOW_STRICT=true
// fails instead of falling back to lower bounds when another writer touched guest seats.
const serverUrl = process.env.SOCKET_TEST_URL ?? "http://127.0.0.1:3301";
const healthHeaders: Record<string, string> = process.env.HEALTHCHECK_TOKEN?.trim()
    ? { "x-health-token": process.env.HEALTHCHECK_TOKEN.trim() }
    : {};
const graceSeconds = Number(process.env.CONNECTION_PAUSE_GRACE_SECONDS ?? "5");
const keepFile = process.env.ADMIN_LAB_DATA_FLOW_KEEP_FILE?.trim() || null;
const cleanupFile = process.env.ADMIN_LAB_DATA_FLOW_CLEANUP_FILE?.trim() || null;
const strict = process.env.ADMIN_LAB_DATA_FLOW_STRICT === "true";
const timeoutMs = 45_000;
const DAY_MS = 86_400_000;

interface LobbyPlayer { playerId: string; ad: string; takim: "A" | "B" | null; online: boolean; rol: string }
interface Lobby { odaKodu: string; oyuncular: LobbyPlayer[] }
interface PauseSummary { waitingForPlayers: boolean; resolutionAvailableInSeconds?: number; canContinueWithoutMissing?: boolean }
interface GameState {
    oyunDurduruldu: boolean;
    gecisEkraninda: boolean;
    anlatici: { ad: string } | null;
    gozetmen: { ad: string } | null;
    connectionPause: PauseSummary | null;
}
interface Player {
    name: string;
    socket: Socket;
    playerId: string;
    guestToken: string | null;
    errors: string[];
    lobby: Lobby | null;
    state: GameState | null;
    pause: PauseSummary | null;
}
interface LabSnapshot {
    pause7: ConnectionPauseAnalyticsSummary;
    pause30: ConnectionPauseAnalyticsSummary;
    claims7: GuestClaimAnalyticsSummary;
    claims30: GuestClaimAnalyticsSummary;
}
interface Created {
    prefix: string;
    adminId: number | null;
    roomCodes: string[];
    userIds: number[];
    guestPlayerIds: string[];
    categoryId: number | null;
    wordId: number | null;
    /** Per Redis key, the counter increments this run added (undone at cleanup). */
    pauseCounterDeltas: Record<string, Record<string, number>>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function assertSafeTarget(): void {
    assert.equal(process.env.ADMIN_LAB_DATA_FLOW_E2E_TEST, "true", "ADMIN_LAB_DATA_FLOW_E2E_TEST=true is required");
    const url = new URL(serverUrl);
    assert.ok(url.hostname === "127.0.0.1" || url.hostname === "localhost", "loopback server only");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/, "requires a tabu_test database");
    assert.ok(process.env.REDIS_KEY_PREFIX?.trim(), "use the server's REDIS_KEY_PREFIX");
}

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

async function login(username: string, password: string, portal: "user" | "admin"): Promise<string> {
    const csrfResponse = await fetch(`${serverUrl}/api/auth/csrf`);
    const csrf = (await csrfResponse.json()) as { csrfToken: string };
    const csrfCookies = csrfResponse.headers.getSetCookie();
    const callback = await fetch(`${serverUrl}/api/auth/callback/credentials`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeaderFrom(csrfCookies) },
        body: new URLSearchParams({ csrfToken: csrf.csrfToken, username, password, portal, callbackUrl: `${serverUrl}/dashboard` }),
        redirect: "manual",
    });
    const cookies = [...csrfCookies, ...callback.headers.getSetCookie()];
    assert.ok(cookies.some((cookie) => cookie.includes("authjs.session-token")), `login failed for ${username}`);
    return cookieHeaderFrom(cookies);
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${serverUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: serverUrl, ...headers },
        body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, body: json };
}

function join(name: string, options: { roomCode?: string; guestToken?: string | null } = {}): Promise<Player> {
    return new Promise((resolve, reject) => {
        const socket = io(serverUrl, {
            path: "/api/socketio",
            transports: ["websocket"],
            forceNew: true,
            reconnection: false,
            extraHeaders: { Origin: serverUrl },
        });
        const player: Player = { name, socket, playerId: "", guestToken: null, errors: [], lobby: null, state: null, pause: null };
        socket.on("hata", (message: string) => player.errors.push(message));
        socket.on("lobiGuncelle", (lobby: Lobby) => { player.lobby = lobby; });
        socket.on("oyunDurumuGuncelle", (state: GameState) => {
            player.state = state;
            player.pause = state.connectionPause ?? null;
        });
        socket.on("turGecisiBaslat", (transition: { connectionPause?: PauseSummary | null }) => { player.pause = transition.connectionPause ?? null; });
        socket.on("turGecisDurumGuncelle", (update: { connectionPause?: PauseSummary | null }) => { player.pause = update.connectionPause ?? null; });
        const timer = setTimeout(() => reject(new Error(`${name} join timed out`)), timeoutMs);
        socket.once("kimlikAta", (identity: { playerId: string; guestToken?: string | null }) => {
            player.playerId = identity.playerId;
            player.guestToken = identity.guestToken ?? null;
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
}

async function start(host: Player, categoryId: number): Promise<void> {
    const started = waitFor<undefined>(host.socket, "oyunBasladi");
    host.socket.emit("oyun_baslat", {
        seciliKategoriler: [categoryId],
        seciliZorluklar: [1],
        ayarlar: { sure: 60, mod: "skor", deger: 10 },
    });
    await started;
    await until("turn started", () => host.state?.gecisEkraninda === false && host.state.anlatici !== null && host.state.gozetmen !== null);
}

async function waitForResolvable(player: Player): Promise<void> {
    await until(
        "pause resolvable",
        () => player.pause?.waitingForPlayers === true && player.pause.resolutionAvailableInSeconds === 0,
        (graceSeconds + 10) * 1000
    );
}

async function activeMatches(): Promise<number> {
    const response = await fetch(`${serverUrl}/api/health`, { headers: healthHeaders });
    assert.equal(response.status, 200, "health refused: set HEALTHCHECK_TOKEN to the server's token");
    return ((await response.json()) as { aktifMacSayisi: number }).aktifMacSayisi;
}

async function readLab(cookie: string): Promise<LabSnapshot> {
    const read = async <T>(path: string): Promise<T> => {
        const response = await fetch(`${serverUrl}${path}`, { headers: { cookie } });
        assert.equal(response.status, 200, `${path} answered ${response.status}`);
        assert.match(response.headers.get("cache-control") ?? "", /no-store/, `${path} must not be cached`);
        return (await response.json()) as T;
    };
    return {
        pause7: await read<ConnectionPauseAnalyticsSummary>("/api/admin/lab/connection-pauses?days=7"),
        pause30: await read<ConnectionPauseAnalyticsSummary>("/api/admin/lab/connection-pauses?days=30"),
        claims7: await read<GuestClaimAnalyticsSummary>("/api/admin/lab/guest-claims?days=7"),
        claims30: await read<GuestClaimAnalyticsSummary>("/api/admin/lab/guest-claims?days=30"),
    };
}

const PAUSE_TRIGGERS = ["narrator", "inspector", "team_below_minimum"] as const;
const PAUSE_OUTCOMES = ["resumed_after_reconnect", "continued_without_missing", "ended_by_host", "reset_by_host", "abandoned"] as const;
const PAUSE_FIELDS = [
    "paused",
    "missing_players",
    ...PAUSE_TRIGGERS.map((trigger) => `trigger:${trigger}`),
    ...PAUSE_OUTCOMES.map((outcome) => `outcome:${outcome}`),
    ...PAUSE_OUTCOMES.map((outcome) => `outcome:${outcome}:duration_seconds`),
];

function pauseKey(date: Date): string {
    return getRedisKey("telemetry", "daily", date.toISOString().slice(0, 10), "connection-pause");
}

async function readPauseCounters(keys: string[]): Promise<Record<string, Record<string, number>>> {
    const redis = await getRedisClient();
    assert.ok(redis?.hmGet, "the e2e needs Redis to account for pause counters");
    const result: Record<string, Record<string, number>> = {};
    for (const key of keys) {
        const values = await redis.hmGet(key, PAUSE_FIELDS);
        result[key] = Object.fromEntries(PAUSE_FIELDS.map((field, index) => [field, Number(values[index] ?? 0)]));
    }
    return result;
}

const DECREMENT_SCRIPT = `
for index = 1, #ARGV, 2 do
  redis.call("HINCRBY", KEYS[1], ARGV[index], ARGV[index + 1])
end
return 1
`;

/** Takes back exactly the pause counters this run added; other runs' counts stay. */
async function undoPauseCounters(deltas: Created["pauseCounterDeltas"]): Promise<void> {
    const redis = await getRedisClient();
    if (!redis) return;
    for (const [key, fields] of Object.entries(deltas)) {
        const pairs = Object.entries(fields).filter(([, value]) => value > 0);
        if (pairs.length === 0) continue;
        await redis.eval(DECREMENT_SCRIPT, {
            keys: [key],
            arguments: pairs.flatMap(([field, value]) => [field, String(-value)]),
        });
    }
}

/** Only numbers, booleans, null and ISO dates may leave the Lab endpoints. */
function assertAggregateOnly(value: unknown, path: string, forbidden: string[]): void {
    if (value === null || typeof value === "number" || typeof value === "boolean") return;
    if (typeof value === "string") {
        assert.match(value, /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/, `${path} is a free-text string`);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertAggregateOnly(entry, `${path}[${index}]`, forbidden));
        return;
    }
    assert.equal(typeof value, "object", `${path} has an unexpected type`);
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        assert.match(key, /^[a-zA-Z_:]+$/, `${path}.${key} is not a fixed field name`);
        assertAggregateOnly(entry, `${path}.${key}`, forbidden);
    }
    if (path.split(".").length === 1) {
        const text = JSON.stringify(value);
        for (const needle of forbidden) {
            assert.ok(!text.includes(needle), `${path} leaks ${needle}`);
        }
    }
}

type Numeric = Record<string, number>;

function pauseNumbers(summary: ConnectionPauseAnalyticsSummary): Numeric {
    return {
        paused: summary.paused,
        missingPlayers: summary.missingPlayers,
        dailyPaused: summary.daily.reduce((total, day) => total + day.paused, 0),
        ...Object.fromEntries(PAUSE_TRIGGERS.map((trigger) => [`trigger.${trigger}`, summary.byTrigger[trigger]])),
        ...Object.fromEntries(PAUSE_OUTCOMES.map((outcome) => [`outcome.${outcome}`, summary.outcomes[outcome]])),
        ...Object.fromEntries(
            PAUSE_OUTCOMES.map((outcome) => [
                `dailyOutcome.${outcome}`,
                summary.daily.reduce((total, day) => total + day.outcomes[outcome], 0),
            ])
        ),
    };
}

function claimNumbers(summary: GuestClaimAnalyticsSummary): Numeric {
    return {
        eligible: summary.eligible,
        unclaimed: summary.unclaimed,
        claimed: summary.claimed,
        settled: summary.settled,
        coinGranted: summary.coinGranted,
        settledFromHostEnded: summary.settledFromHostEnded,
        waiting: summary.waiting,
        closed: summary.closed,
        rejected: summary.rejected,
        expired: summary.expired,
        unknownStatus: summary.unknownStatus,
        distinctAccounts: summary.distinctAccounts,
        ...Object.fromEntries(Object.entries(summary.waitingByReason).map(([reason, count]) => [`waiting.${reason}`, count])),
        ...Object.fromEntries(Object.entries(summary.closedByReason).map(([reason, count]) => [`closed.${reason}`, count])),
    };
}

function delta(after: Numeric, before: Numeric): Numeric {
    return Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - (before[key] ?? 0)]));
}

function withZeros(keys: Numeric, touched: Numeric): Numeric {
    return Object.fromEntries(Object.keys(keys).map((key) => [key, touched[key] ?? 0]));
}

/** Guest seats outside this run, so a concurrent writer is detected instead of misread. */
async function foreignSeatState(roomCodes: string[], since: Date | null) {
    const now = Date.now();
    const notMine = roomCodes.length > 0 ? { settlement: { roomCode: { notIn: roomCodes } } } : {};
    const [in7, in30, touched] = await Promise.all([
        prisma.matchSettlementGuestSeat.count({ where: { ...notMine, matchEndedAt: { gte: new Date(now - 7 * DAY_MS) } } }),
        prisma.matchSettlementGuestSeat.count({ where: { ...notMine, matchEndedAt: { gte: new Date(now - 30 * DAY_MS) } } }),
        since ? prisma.matchSettlementGuestSeat.count({ where: { ...notMine, updatedAt: { gte: since } } }) : Promise.resolve(0),
    ]);
    return { in7, in30, touched };
}

/** Removes everything the run created except the admin, who reads the Lab afterwards. */
async function cleanup(created: Created): Promise<void> {
    if (created.roomCodes.length > 0) {
        await prisma.matchSettlement.deleteMany({ where: { roomCode: { in: created.roomCodes } } });
    }
    if (created.guestPlayerIds.length > 0) {
        await prisma.guestProgress.deleteMany({ where: { playerId: { in: created.guestPlayerIds } } });
    }
    const userIds = created.userIds.filter((id) => Number.isInteger(id) && id > 0);
    if (userIds.length > 0) {
        await prisma.matchResult.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (created.categoryId !== null) await prisma.category.deleteMany({ where: { id: created.categoryId } });
    if (created.wordId !== null) await prisma.word.deleteMany({ where: { id: created.wordId } });
    await invalidateCategoryCache();
    await undoPauseCounters(created.pauseCounterDeltas);
    created.pauseCounterDeltas = {};
}

async function deleteAdmin(created: Created): Promise<void> {
    if (created.adminId === null) return;
    await prisma.auditLog.deleteMany({ where: { actorUserId: created.adminId } });
    await prisma.user.deleteMany({ where: { id: created.adminId } });
    created.adminId = null;
}

/** After cleanup the Lab must show the baseline again. */
async function assertBaselineRestored(cookie: string, baseline: LabSnapshot, claimsToo: boolean): Promise<void> {
    const restored = await readLab(cookie);
    for (const days of [7, 30] as const) {
        const key = days === 7 ? "pause7" : "pause30";
        assert.deepEqual(pauseNumbers(restored[key]), pauseNumbers(baseline[key]), `pause counters back to the baseline (${days} days)`);
        if (claimsToo) {
            const claims = days === 7 ? "claims7" : "claims30";
            assert.deepEqual(claimNumbers(restored[claims]), claimNumbers(baseline[claims]), `guest claims back to the baseline (${days} days)`);
        }
    }
}

async function runCleanupOnly(path: string): Promise<void> {
    const saved = JSON.parse(readFileSync(path, "utf8")) as { created: Created; baseline: LabSnapshot; quiet: boolean };
    assert.equal(saved.created.prefix, process.env.REDIS_KEY_PREFIX, "clean up with the prefix the data was written under");
    const created = saved.created;
    await cleanup(created);
    const reader = await makeAdmin(randomUUID().replaceAll("-", "").slice(0, 8));
    try {
        await assertBaselineRestored(reader.cookie, saved.baseline, strict && saved.quiet);
        console.log("[lab-flow] cleanup removed the kept data and the Lab shows the baseline again");
    } finally {
        await prisma.auditLog.deleteMany({ where: { actorUserId: reader.id } });
        await prisma.user.deleteMany({ where: { id: reader.id } });
        await deleteAdmin(created);
    }
}

async function makeAdmin(suffix: string): Promise<{ id: number; cookie: string }> {
    const username = `lab_admin_${suffix}`;
    const password = `LabAdmin-${suffix}!`;
    const admin = await prisma.user.create({
        data: { username, password: await bcryptjs.hash(password, 10), role: "admin" },
        select: { id: true },
    });
    return { id: admin.id, cookie: await login(username, password, "admin") };
}

async function run(): Promise<void> {
    assertSafeTarget();
    if (cleanupFile) {
        try {
            await runCleanupOnly(cleanupFile);
        } finally {
            await prisma.$disconnect();
            await closeRedisClient();
        }
        return;
    }
    assert.ok(graceSeconds >= 5 && graceSeconds <= 10, "start the server with CONNECTION_PAUSE_GRACE_SECONDS between 5 and 10");
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const created: Created = {
        prefix: process.env.REDIS_KEY_PREFIX!.trim(),
        adminId: null,
        roomCodes: [],
        userIds: [],
        guestPlayerIds: [],
        categoryId: null,
        wordId: null,
        pauseCounterDeltas: {},
    };
    const sockets: Socket[] = [];
    const forbidden: string[] = [];
    let keep = false;
    let cleaned = false;

    async function makeUser(label: string, options: { unverified?: boolean } = {}) {
        const username = `lab_${label}_${suffix}`.slice(0, 40);
        const password = `Lab-${suffix}-${label}!`;
        const email = `${username}@example.test`;
        const user = await prisma.user.create({
            data: {
                username,
                email,
                normalizedEmail: email,
                password: await bcryptjs.hash(password, 10),
                role: "user",
                ...(options.unverified
                    ? { accountStatus: "pending_email_verification" as const, emailVerificationRequiredAt: new Date() }
                    : {}),
            },
        });
        created.userIds.push(user.id);
        forbidden.push(username, email);
        return { id: user.id, cookie: await login(username, password, "user") };
    }

    try {
        const admin = await makeAdmin(suffix);
        created.adminId = admin.id;
        forbidden.push(`lab_admin_${suffix}`);
        const runStart = new Date(Date.now() - 1_000);
        const dayKeys = [...new Set([pauseKey(new Date()), pauseKey(new Date(Date.now() + 10 * 60_000))])];
        const countersBefore = await readPauseCounters(dayKeys);
        const baseline = await readLab(admin.cookie);
        const foreignBefore = await foreignSeatState([], null);
        const matchesBefore = await activeMatches();

        const category = await prisma.category.create({ data: { name: `Lab flow ${suffix}`, color: "#7c3aed", isVisible: true } });
        created.categoryId = category.id;
        const word = await prisma.word.create({
            data: {
                wordText: `lab-flow-${suffix}`,
                difficulty: 1,
                tabooWords: { create: [{ tabooWordText: "test" }] },
                wordCategories: { create: [{ categoryId: category.id }] },
            },
        });
        created.wordId = word.id;
        await invalidateCategoryCache();
        const settings = await getSystemSettings();

        async function room(tag: string, size: number): Promise<Player[]> {
            const host = await join(`H${tag}${suffix}`);
            const roomCode = host.lobby!.odaKodu;
            created.roomCodes.push(roomCode);
            forbidden.push(roomCode);
            const others: Player[] = [];
            for (let index = 1; index < size; index += 1) {
                others.push(await join(`P${index}${tag}${suffix}`, { roomCode }));
            }
            const players = [host, ...others];
            sockets.push(...players.map((player) => player.socket));
            for (const player of players) {
                assert.match(player.playerId, /^guest:/, "every player is a guest");
                created.guestPlayerIds.push(player.playerId);
                forbidden.push(player.playerId, player.name);
            }
            await lobbyWith(host, size);
            await sinkHost(host, size / 2);
            return players;
        }
        const byName = (players: Player[], name: string) => {
            const match = [...players].reverse().find((player) => player.name === name);
            assert.ok(match, `player ${name} not found`);
            return match;
        };

        // Match A, 3v3 guests: a pause healed by the narrator's return, a pause the host
        // continues without the inspector, then the match is played to the score target.
        const matchA = await room("a", 6);
        const hostA = matchA[0];
        await start(hostA, category.id);
        const teamA = new Map(hostA.lobby!.oyuncular.map((player) => [player.playerId, player.takim]));
        {
            const narrator = byName(matchA, hostA.state!.anlatici!.ad);
            assert.notEqual(narrator, hostA);
            narrator.socket.disconnect();
            await until("pause after the narrator leaves", () => hostA.pause?.waitingForPlayers === true);
            await sleep(1_500);
            const back = await join(narrator.name, { roomCode: created.roomCodes[0], guestToken: narrator.guestToken });
            sockets.push(back.socket);
            assert.equal(back.playerId, narrator.playerId);
            matchA.push(back);
            await until("narrator back, match still paused", () => hostA.pause !== null && hostA.pause.waitingForPlayers === false);
            hostA.socket.emit("oyun_kontrol");
            await until("host resumed", () => hostA.pause === null && hostA.state?.oyunDurduruldu === false);
            console.log("[lab-flow] A1 narrator returned and the host resumed");
        }
        {
            const inspector = byName(matchA, hostA.state!.gozetmen!.ad);
            assert.notEqual(inspector, hostA);
            inspector.socket.disconnect();
            await until("pause after the inspector leaves", () => hostA.pause?.waitingForPlayers === true);
            await waitForResolvable(hostA);
            hostA.socket.emit(CONNECTION_PAUSE_RESOLVE_EVENT, { action: "continue_without_missing" });
            await until("continued without the inspector", () => hostA.pause === null && hostA.state?.oyunDurduruldu === false);
            console.log("[lab-flow] A2 host continued without the inspector");
        }
        let winnerA: "A" | "B";
        {
            const narrator = byName(matchA, hostA.state!.anlatici!.ad);
            let ended = false;
            const finished = waitFor<{ kazananTakim: "A" | "B"; endReason?: string }>(hostA.socket, "oyunBitti").then((payload) => {
                ended = true;
                return payload;
            });
            for (let index = 0; index < 40 && !ended; index += 1) {
                narrator.socket.emit("oyunVerisi", { eylem: "dogru" });
                await sleep(300);
            }
            const result = await finished;
            assert.notEqual(result.endReason, "host_ended");
            winnerA = result.kazananTakim;
            console.log(`[lab-flow] A3 match played to the target, team ${winnerA} won`);
        }

        // Match B, 2v2 guests: a player who is neither narrator nor inspector leaves, the team
        // drops below two and the host can only end the match early.
        const matchB = await room("b", 4);
        const hostB = matchB[0];
        await start(hostB, category.id);
        {
            const critical = new Set([hostB.state!.anlatici!.ad, hostB.state!.gozetmen!.ad, hostB.name]);
            const leaver = matchB.find((player) => !critical.has(player.name));
            assert.ok(leaver, "a plain team member to leave");
            leaver.socket.disconnect();
            await until("pause after the 2v2 departure", () => hostB.pause?.waitingForPlayers === true);
            assert.equal(hostB.pause!.canContinueWithoutMissing, false);
            await waitForResolvable(hostB);
            const finished = waitFor<{ endReason?: string }>(hostB.socket, "oyunBitti");
            hostB.socket.emit(CONNECTION_PAUSE_RESOLVE_EVENT, { action: "end_match" });
            assert.equal((await finished).endReason, "host_ended");
            console.log("[lab-flow] B1 team fell below two, host ended the match");
        }
        for (const socket of sockets) socket.disconnect();

        // Both matches are recorded with one seat per playing guest.
        const seatsOf = async (roomCode: string, expected: number) => {
            for (let attempt = 0; attempt < 80; attempt += 1) {
                const settlement = await prisma.matchSettlement.findFirst({
                    where: { roomCode },
                    select: { id: true, matchEndedAt: true, endReason: true, guestSeats: { select: { guestPlayerId: true } } },
                });
                if (settlement) {
                    assert.equal(settlement.guestSeats.length, expected, `${expected} guest seats in ${roomCode}`);
                    return settlement;
                }
                await sleep(250);
            }
            throw new Error(`match in ${roomCode} was not recorded`);
        };
        const settlementA = await seatsOf(created.roomCodes[0], 6);
        const settlementB = await seatsOf(created.roomCodes[1], 4);
        assert.equal(settlementA.endReason, "completed");
        assert.equal(settlementB.endReason, "host_ended");

        // Claims: sign-up (verified, settles with coins), an unverified account (waits for the
        // email), a verified account claiming the early-ended match (settles with 0 coin).
        const guestsA = matchA.filter((player, index, all) => all.findIndex((p) => p.playerId === player.playerId) === index);
        const [signUpGuest, unverifiedGuest] = guestsA.filter((player) => player !== hostA);
        let signUpCoins: number;
        {
            const username = `lab_new_${suffix}`;
            const email = `${username}@example.test`;
            forbidden.push(username, email);
            const response = await post("/api/auth/register", {
                username,
                email,
                password: `Lab-hesap ${suffix} vapur 2026!`,
                guestToken: signUpGuest.guestToken,
            });
            assert.equal(response.status, 201, JSON.stringify(response.body));
            created.userIds.push(Number(response.body.userId));
            const claim = response.body.guestClaim as { settledNow: number; coinEarnedNow: number; awaitingVerification: number };
            const won = teamA.get(signUpGuest.playerId) === winnerA;
            const expectedCoins = resolveMatchRewardCoin(
                won ? settings.economy.winRewardCoin : settings.economy.lossRewardCoin,
                settings,
                settlementA.matchEndedAt
            ).finalRewardCoin;
            assert.deepEqual(
                { settledNow: claim.settledNow, coinEarnedNow: claim.coinEarnedNow, awaitingVerification: claim.awaitingVerification },
                { settledNow: 1, coinEarnedNow: expectedCoins, awaitingVerification: 0 }
            );
            assert.ok(expectedCoins > 0, "a completed match pays coins");
            signUpCoins = claim.coinEarnedNow;
            console.log(`[lab-flow] C1 sign-up moved match A with ${signUpCoins} coins`);
        }
        {
            const pending = await makeUser("pending", { unverified: true });
            const response = await post("/api/game/match/guest-claims", { guestToken: unverifiedGuest.guestToken }, { cookie: pending.cookie });
            assert.equal(response.status, 200, JSON.stringify(response.body));
            assert.equal(response.body.awaitingVerification, 1);
            assert.equal(response.body.settledNow, 0);
            console.log("[lab-flow] C2 unverified account waits for email verification");
        }
        {
            const earlyGuest = matchB.find((player) => player !== hostB)!;
            const existing = await makeUser("early");
            const response = await post("/api/game/match/guest-claims", { guestToken: earlyGuest.guestToken }, { cookie: existing.cookie });
            assert.equal(response.status, 200, JSON.stringify(response.body));
            assert.equal(response.body.settledNow, 1);
            assert.equal(response.body.coinEarnedNow, 0, "an early-ended match pays no coin");
            console.log("[lab-flow] C3 early-ended match moved with 0 coin");
        }
        assert.equal(await activeMatches(), matchesBefore, "no match is left running");

        // Read the Lab again and compare every counter.
        await sleep(500);
        const after = await readLab(admin.cookie);
        const countersAfter = await readPauseCounters(dayKeys);
        for (const key of dayKeys) {
            created.pauseCounterDeltas[key] = Object.fromEntries(
                PAUSE_FIELDS.map((field) => [field, countersAfter[key][field] - countersBefore[key][field]])
            );
        }

        for (const days of [7, 30] as const) {
            const before = days === 7 ? baseline.pause7 : baseline.pause30;
            const now = days === 7 ? after.pause7 : after.pause30;
            assert.equal(now.available, true, "pause counters need Redis");
            const touched: Numeric = {
                paused: 3,
                missingPlayers: 3,
                dailyPaused: 3,
                "trigger.narrator": 1,
                "trigger.inspector": 1,
                "trigger.team_below_minimum": 1,
                "outcome.resumed_after_reconnect": 1,
                "outcome.continued_without_missing": 1,
                "outcome.ended_by_host": 1,
                "dailyOutcome.resumed_after_reconnect": 1,
                "dailyOutcome.continued_without_missing": 1,
                "dailyOutcome.ended_by_host": 1,
            };
            const numbers = pauseNumbers(now);
            assert.deepEqual(delta(numbers, pauseNumbers(before)), withZeros(numbers, touched), `pause deltas (${days} days)`);
            for (const outcome of ["resumed_after_reconnect", "continued_without_missing", "ended_by_host"] as const) {
                assert.notEqual(now.averageResolutionSeconds[outcome], null, `${outcome} has a duration`);
            }
            if (before.outcomes.continued_without_missing === 0) {
                assert.ok(now.averageResolutionSeconds.continued_without_missing! >= graceSeconds, "continuing waits out the grace period");
            }
            if (before.outcomes.ended_by_host === 0) {
                assert.ok(now.averageResolutionSeconds.ended_by_host! >= graceSeconds, "ending waits out the grace period");
            }
            if (before.outcomes.resumed_after_reconnect === 0) {
                assert.ok(now.averageResolutionSeconds.resumed_after_reconnect! >= 1, "the narrator was away for over a second");
            }
            for (const outcome of ["reset_by_host", "abandoned"] as const) {
                assert.equal(now.averageResolutionSeconds[outcome], before.averageResolutionSeconds[outcome], `${outcome} untouched`);
            }
        }
        console.log("[lab-flow] pause counters: +3 pauses (narrator, inspector, team below two), +1 of each touched resolution");
        console.log(
            `[lab-flow] 7-day pauses ${baseline.pause7.paused} -> ${after.pause7.paused}, durations (s): ` +
                JSON.stringify(after.pause7.averageResolutionSeconds)
        );

        const foreignAfter = await foreignSeatState(created.roomCodes, runStart);
        const quiet =
            foreignAfter.touched === 0 && foreignAfter.in7 === foreignBefore.in7 && foreignAfter.in30 === foreignBefore.in30;
        const claimTouched: Numeric = {
            eligible: 10,
            unclaimed: 7,
            claimed: 3,
            settled: 2,
            coinGranted: signUpCoins,
            settledFromHostEnded: 1,
            waiting: 1,
            "waiting.email_verification": 1,
            distinctAccounts: 3,
        };
        for (const days of [7, 30] as const) {
            const before = days === 7 ? baseline.claims7 : baseline.claims30;
            const now = days === 7 ? after.claims7 : after.claims30;
            assert.equal(now.available, true);
            const numbers = claimNumbers(now);
            const observed = delta(numbers, claimNumbers(before));
            const expected = withZeros(numbers, claimTouched);
            if (quiet) {
                assert.deepEqual(observed, expected, `guest claim deltas (${days} days)`);
            } else {
                assert.ok(!strict, `another writer touched guest seats during the run (${JSON.stringify({ foreignBefore, foreignAfter })})`);
                for (const [key, value] of Object.entries(claimTouched)) {
                    assert.ok(observed[key] >= value, `${key} grew by at least ${value} (${days} days)`);
                }
            }
            assert.equal(now.claimRatePercent, guestClaimSharePercent(now.claimed, now.eligible));
        }
        console.log(
            quiet
                ? `[lab-flow] guest claims exact: +10 seats, +3 claimed, +2 settled, +${signUpCoins} coin, +1 early-ended, +1 waiting for email, +7 unclaimed, +3 accounts`
                : "[lab-flow] WARNING: other guest-seat writes during the run; guest claim counters checked as lower bounds"
        );

        console.log(
            `[lab-flow] 7-day guest claims ${JSON.stringify(claimNumbers(baseline.claims7))} -> ${JSON.stringify(claimNumbers(after.claims7))}, rate ${after.claims7.claimRatePercent}%`
        );
        for (const [name, payload] of Object.entries(after)) assertAggregateOnly(payload, name, forbidden);
        console.log("[lab-flow] payloads hold only counts and dates, no names, ids or room codes");

        if (keepFile) {
            writeFileSync(keepFile, JSON.stringify({ created, baseline, after, quiet, signUpCoins }, null, 2));
            keep = true;
            console.log(`[lab-flow] kept the data for the browser check: ${keepFile}`);
        } else {
            await cleanup(created);
            await assertBaselineRestored(admin.cookie, baseline, quiet);
            cleaned = true;
            console.log(`[lab-flow] cleanup restored the baseline (${quiet ? "pause and guest claim counters" : "pause counters"})`);
        }
        console.log("admin lab data flow e2e checks passed");
    } finally {
        for (const socket of sockets) socket.disconnect();
        if (!keep) {
            if (!cleaned) await cleanup(created);
            await deleteAdmin(created);
        }
        await prisma.$disconnect();
        await closeRedisClient();
    }
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
