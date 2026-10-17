import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@hushle/platform-db";
import { closeRedisClient } from "@hushle/platform-cache";
import { invalidateCategoryCache } from "../apps/web/src/lib/socket/category-service";
import { getSystemSettings } from "../apps/web/src/lib/system-settings/service";
import { resolveMatchRewardCoin } from "../apps/web/src/lib/system-settings/economy";

const serverUrl = process.env.SOCKET_TEST_URL ?? "http://127.0.0.1:3301";
// Production servers only answer /api/health with the shared token.
const healthHeaders: Record<string, string> = process.env.HEALTHCHECK_TOKEN?.trim()
    ? { "x-health-token": process.env.HEALTHCHECK_TOKEN.trim() }
    : {};
const timeoutMs = 30_000;

interface LobbyPlayer {
    playerId: string;
    ad: string;
    takim: "A" | "B" | null;
    rol: string;
}
interface LobbyPayload {
    odaKodu: string;
    oyuncular: LobbyPlayer[];
}
interface Participant {
    name: string;
    socket: Socket;
    userId: number | null;
    cookie?: string;
}

function assertSafeTarget(): void {
    assert.equal(process.env.MATCH_SETTLEMENT_E2E_TEST, "true", "MATCH_SETTLEMENT_E2E_TEST=true is required");
    const url = new URL(serverUrl);
    assert.ok(url.hostname === "127.0.0.1" || url.hostname === "localhost", "loopback server only");
}

function cookieHeaderFrom(setCookies: string[]): string {
    return setCookies.map((cookie) => cookie.split(";", 1)[0]).filter(Boolean).join("; ");
}

async function login(username: string, password: string): Promise<string> {
    const csrfResponse = await fetch(`${serverUrl}/api/auth/csrf`);
    assert.equal(csrfResponse.ok, true);
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

function connect(name: string, roomCode?: string, cookie?: string): Promise<{ socket: Socket; lobby: LobbyPayload }> {
    return new Promise((resolve, reject) => {
        const socket = io(serverUrl, {
            path: "/api/socketio",
            transports: ["websocket"],
            forceNew: true,
            reconnection: false,
            extraHeaders: { Origin: serverUrl, ...(cookie ? { Cookie: cookie } : {}) },
        });
        const timer = setTimeout(() => {
            socket.disconnect();
            reject(new Error(`${name} join timed out`));
        }, timeoutMs);
        socket.on("connect", () => socket.emit("room:request", { kullaniciAdi: name, ...(roomCode ? { odaKodu: roomCode } : {}) }));
        socket.once("lobiGuncelle", (lobby: LobbyPayload) => {
            clearTimeout(timer);
            resolve({ socket, lobby });
        });
        socket.on("connect_error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
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

async function finalize(cookie: string, roomCode: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${serverUrl}/api/game/match/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: serverUrl },
        body: JSON.stringify({ roomCode }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function waitForResults(roomCode: string, userIds: number[]) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        const rows = await prisma.matchResult.findMany({ where: { roomCode, userId: { in: userIds } } });
        if (rows.length === userIds.length) return rows;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`settlement did not write results for room ${roomCode}`);
}

async function lobbyOf(socket: Socket): Promise<LobbyPayload> {
    return waitFor<LobbyPayload>(socket, "lobiGuncelle");
}

async function run(): Promise<void> {
    assertSafeTarget();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const userIds: number[] = [];
    const sockets: Socket[] = [];
    const roomCodes: string[] = [];
    let categoryId: number | null = null;
    let wordId: number | null = null;

    async function makeUser(label: string): Promise<{ id: number; username: string; cookie: string }> {
        const username = `e2e_${label}_${suffix}`.slice(0, 40);
        const password = `Settle-${suffix}-${label}!`;
        const user = await prisma.user.create({
            data: { username, password: await bcryptjs.hash(password, 10), role: "user" },
        });
        userIds.push(user.id);
        return { id: user.id, username, cookie: await login(username, password) };
    }

    async function startAndFinish(host: Participant, players: Participant[], options: {
        beforeScoring?: (roles: Map<Socket, string>) => Promise<void>;
        afterFinish?: () => void;
    } = {}): Promise<"A" | "B"> {
        const startErrors: string[] = [];
        const onError = (message: string) => startErrors.push(message);
        host.socket.on("hata", onError);
        const started = waitFor<undefined>(host.socket, "oyunBasladi");
        const turnInfo = Promise.all(
            players.map((player) =>
                waitFor<{ rol: string }>(player.socket, "yeniTurBilgisi").then((turn) => [player.socket, turn.rol] as const)
            )
        );
        turnInfo.catch(() => undefined);
        host.socket.emit("oyun_baslat", {
            seciliKategoriler: [categoryId],
            seciliZorluklar: [1],
            ayarlar: { sure: 60, mod: "skor", deger: 10 },
        });
        try {
            await started;
        } catch (error) {
            throw new Error(`game did not start; server errors: ${startErrors.join(" | ") || "none"}`, { cause: error });
        } finally {
            host.socket.off("hata", onError);
        }
        const roles = new Map(await turnInfo);
        await options.beforeScoring?.(roles);
        const narrator = [...roles.entries()].find(([, role]) => role === "Anlatıcı")?.[0];
        assert.ok(narrator, "narrator not found");
        let ended = false;
        const finished = waitFor<{ kazananTakim: "A" | "B" }>(host.socket, "oyunBitti").then((payload) => {
            ended = true;
            return payload;
        });
        // The server drops narrator actions closer than 200 ms apart; keep a margin and
        // score until the match actually ends instead of assuming every emit counts.
        for (let index = 0; index < 40 && !ended; index += 1) {
            narrator.emit("oyunVerisi", { eylem: "dogru" });
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
        const result = await finished;
        options.afterFinish?.();
        return result.kazananTakim;
    }

    try {
        const category = await prisma.category.create({ data: { name: `Settlement e2e ${suffix}`, color: "#2563eb", isVisible: true } });
        categoryId = category.id;
        const word = await prisma.word.create({
            data: {
                wordText: `settlement-e2e-${suffix}`,
                difficulty: 1,
                tabooWords: { create: [{ tabooWordText: "test" }] },
                wordCategories: { create: [{ categoryId }] },
            },
        });
        wordId = word.id;
        await invalidateCategoryCache();
        const settings = await getSystemSettings();

        // Scenario A: 2v2, nobody calls finalize, host resets the room right after the end.
        {
            const r1 = await makeUser("r1");
            const r2 = await makeUser("r2");
            const hostJoin = await connect(r1.username, undefined, r1.cookie);
            const roomCode = hostJoin.lobby.odaKodu;
            roomCodes.push(roomCode);
            const g1 = await connect(`GuestA${suffix.slice(0, 4)}`, roomCode);
            const r2Join = await connect(r2.username, roomCode, r2.cookie);
            const lastLobbyPromise = lobbyOf(hostJoin.socket);
            const g2 = await connect(`GuestB${suffix.slice(0, 4)}`, roomCode);
            const lobby = await lastLobbyPromise;
            sockets.push(hostJoin.socket, g1.socket, r2Join.socket, g2.socket);
            const teamOf = (name: string) => lobby.oyuncular.find((player) => player.ad === name)?.takim;
            const r1Team = teamOf(r1.username);
            const r2Team = teamOf(r2.username);
            assert.ok(r1Team && r2Team, "registered players must be on teams");

            const beforeStart = await finalize(r1.cookie, roomCode);
            assert.equal(beforeStart.status, 404, "no finished match yet");
            const unknownRoom = await finalize(r1.cookie, "ZZZZ99");
            assert.equal(unknownRoom.status, 404);

            const host: Participant = { name: r1.username, socket: hostJoin.socket, userId: r1.id, cookie: r1.cookie };
            const players: Participant[] = [
                host,
                { name: "g1", socket: g1.socket, userId: null },
                { name: r2.username, socket: r2Join.socket, userId: r2.id, cookie: r2.cookie },
                { name: "g2", socket: g2.socket, userId: null },
            ];
            const winner = await startAndFinish(host, players, {
                beforeScoring: async () => {
                    const during = await finalize(r1.cookie, roomCode);
                    assert.equal(during.status, 409, "active match must not report a result");
                },
                afterFinish: () => {
                    host.socket.emit("oyun_sifirla");
                },
            });

            const rows = await waitForResults(roomCode, [r1.id, r2.id]);
            const settlement = await prisma.matchSettlement.findFirstOrThrow({ where: { roomCode } });
            assert.equal(settlement.status, "settled");
            assert.equal(settlement.registeredParticipantCount, 2);
            assert.equal(settlement.guestParticipantCount, 2);
            const reward = (won: boolean) =>
                resolveMatchRewardCoin(
                    won ? settings.economy.winRewardCoin : settings.economy.lossRewardCoin,
                    settings,
                    settlement.matchEndedAt
                ).finalRewardCoin;
            for (const [user, team] of [[r1, r1Team], [r2, r2Team]] as const) {
                const row = rows.find((entry) => entry.userId === user.id);
                assert.ok(row);
                assert.equal(row.won, team === winner);
                assert.equal(row.coinEarned, reward(team === winner));
                assert.equal(row.endReason, "completed");
                const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
                assert.equal(Number(wallet?.coinBalance ?? 0), row.coinEarned);
            }
            console.log("[e2e] scenario A settled without any client call, despite immediate reset");

            const read = await finalize(r1.cookie, roomCode);
            assert.equal(read.status, 200);
            assert.equal(read.body.status, "settled");
            assert.equal(read.body.coinEarned, rows.find((entry) => entry.userId === r1.id)?.coinEarned);
            const readAgain = await finalize(r1.cookie, roomCode);
            assert.deepEqual(readAgain.body, read.body);
            const walletAfterReads = await prisma.wallet.findUnique({ where: { userId: r1.id } });
            assert.equal(Number(walletAfterReads?.coinBalance ?? 0), read.body.coinEarned, "reads never pay again");
            console.log("[e2e] finalize read is stable and idempotent");

            const healthResponse = await fetch(`${serverUrl}/api/health`, { headers: healthHeaders });
            assert.equal(healthResponse.status, 200, "health refused: set HEALTHCHECK_TOKEN to the server's token");
            const health = (await healthResponse.json()) as {
                matchSettlements?: { available: boolean; buffered: number };
            };
            assert.equal(health.matchSettlements?.available, true);
            assert.equal(health.matchSettlements?.buffered, 0);
            console.log("[e2e] health reports settlement backlog");
        }

        // Scenario B: 3v3, a registered non-critical player disconnects mid-match and is still paid.
        {
            const r3 = await makeUser("r3");
            const r4 = await makeUser("r4");
            const r5 = await makeUser("r5");
            const r6 = await makeUser("r6");
            const hostJoin = await connect(r3.username, undefined, r3.cookie);
            const roomCode = hostJoin.lobby.odaKodu;
            roomCodes.push(roomCode);
            const joins = [
                { user: r4, join: await connect(r4.username, roomCode, r4.cookie) },
                { user: r5, join: await connect(r5.username, roomCode, r5.cookie) },
                { user: r6, join: await connect(r6.username, roomCode, r6.cookie) },
            ];
            const lastLobbyPromise = lobbyOf(hostJoin.socket);
            const ga = await connect(`GuestC${suffix.slice(0, 4)}`, roomCode);
            const gb = await connect(`GuestD${suffix.slice(0, 4)}`, roomCode);
            await lastLobbyPromise;
            sockets.push(hostJoin.socket, ga.socket, gb.socket, ...joins.map((entry) => entry.join.socket));
            const host: Participant = { name: r3.username, socket: hostJoin.socket, userId: r3.id, cookie: r3.cookie };
            const players: Participant[] = [
                host,
                ...joins.map((entry) => ({ name: entry.user.username, socket: entry.join.socket, userId: entry.user.id, cookie: entry.user.cookie })),
                { name: "ga", socket: ga.socket, userId: null },
                { name: "gb", socket: gb.socket, userId: null },
            ];
            let leaver: { id: number } | null = null;
            await startAndFinish(host, players, {
                beforeScoring: async (roles) => {
                    const candidate = joins.find((entry) => {
                        const role = roles.get(entry.join.socket);
                        return role !== "Anlatıcı" && role !== "Gözetmen";
                    });
                    assert.ok(candidate, "one registered player must be neither narrator nor inspector");
                    leaver = candidate.user;
                    candidate.join.socket.disconnect();
                    await new Promise((resolve) => setTimeout(resolve, 500));
                },
            });
            assert.ok(leaver);
            const rows = await waitForResults(roomCode, [r3.id, r4.id, r5.id, r6.id]);
            const leaverRow = rows.find((entry) => entry.userId === (leaver as { id: number }).id);
            assert.ok(leaverRow, "disconnected participant is still settled");
            assert.ok(leaverRow.coinEarned > 0);
            console.log("[e2e] scenario B paid a player who left before the end");
        }

        console.log("match settlement e2e checks passed");
    } finally {
        for (const socket of sockets) socket.disconnect();
        if (roomCodes.length > 0) {
            await prisma.matchSettlement.deleteMany({ where: { roomCode: { in: roomCodes } } });
        }
        if (userIds.length > 0) {
            await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
            await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        }
        if (categoryId !== null) {
            await prisma.category.deleteMany({ where: { id: categoryId } });
            await invalidateCategoryCache();
        }
        if (wordId !== null) await prisma.word.deleteMany({ where: { id: wordId } });
        await prisma.$disconnect();
        await closeRedisClient();
    }
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
