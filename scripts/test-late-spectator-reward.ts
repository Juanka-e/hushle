import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@hushle/platform-db";
import { closeRedisClient } from "@hushle/platform-cache";
import { invalidateCategoryCache } from "../apps/web/src/lib/socket/category-service";

const serverUrl = process.env.SOCKET_TEST_URL ?? "http://127.0.0.1:3000";
const timeoutMs = 30_000;

interface LobbyPayload {
    odaKodu: string;
    startReadiness: {
        ready: boolean;
        activePlayers: number;
        minimumPlayers: number;
        teamAPlayers: number;
        teamBPlayers: number;
    };
    oyuncular: Array<{
        playerId: string;
        ad: string;
        takim: "A" | "B" | null;
        online: boolean;
        rol: string;
    }>;
}

interface ConnectedPlayer {
    socket: Socket;
    lobby: LobbyPayload;
}

function assertSafeTarget(): void {
    assert.equal(
        process.env.LATE_SPECTATOR_REWARD_TEST,
        "true",
        "LATE_SPECTATOR_REWARD_TEST=true is required"
    );
    const url = new URL(serverUrl);
    assert.ok(
        url.hostname === "127.0.0.1" || url.hostname === "localhost",
        "Late spectator reward test only supports a loopback server"
    );
}

function cookieHeaderFrom(setCookies: string[]): string {
    return setCookies
        .map((cookie) => cookie.split(";", 1)[0])
        .filter(Boolean)
        .join("; ");
}

async function login(username: string, password: string): Promise<string> {
    const csrfResponse = await fetch(`${serverUrl}/api/auth/csrf`);
    assert.equal(csrfResponse.ok, true);
    const csrf = (await csrfResponse.json()) as { csrfToken: string };
    const csrfCookies = csrfResponse.headers.getSetCookie();
    const callbackResponse = await fetch(
        `${serverUrl}/api/auth/callback/credentials`,
        {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                cookie: cookieHeaderFrom(csrfCookies),
            },
            body: new URLSearchParams({
                csrfToken: csrf.csrfToken,
                username,
                password,
                portal: "user",
                callbackUrl: `${serverUrl}/dashboard`,
            }),
            redirect: "manual",
        }
    );
    assert.ok(
        callbackResponse.status === 200 ||
            callbackResponse.status === 302 ||
            callbackResponse.status === 303
    );
    const cookies = [
        ...csrfCookies,
        ...callbackResponse.headers.getSetCookie(),
    ];
    assert.ok(
        cookies.some((cookie) => cookie.includes("authjs.session-token"))
    );
    return cookieHeaderFrom(cookies);
}

function connectPlayer(options: {
    name: string;
    roomCode?: string;
    cookie?: string;
}): Promise<ConnectedPlayer> {
    return new Promise((resolve, reject) => {
        const socket = io(serverUrl, {
            path: "/api/socketio",
            transports: ["websocket"],
            forceNew: true,
            reconnection: false,
            extraHeaders: {
                Origin: serverUrl,
                ...(options.cookie ? { Cookie: options.cookie } : {}),
            },
        });
        const timeout = setTimeout(() => {
            socket.disconnect();
            reject(new Error(`${options.name} room request timed out`));
        }, timeoutMs);
        socket.on("connect", () => {
            socket.emit("room:request", {
                kullaniciAdi: options.name,
                ...(options.roomCode ? { odaKodu: options.roomCode } : {}),
            });
        });
        socket.on("lobiGuncelle", (lobby: LobbyPayload) => {
            if (options.roomCode && lobby.odaKodu !== options.roomCode) return;
            clearTimeout(timeout);
            resolve({ socket, lobby });
        });
        socket.on("connect_error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        socket.on("hata", (message: string) => {
            clearTimeout(timeout);
            socket.disconnect();
            reject(new Error(String(message)));
        });
    });
}

function waitForEvent<T>(
    socket: Socket,
    event: string,
    predicate: (payload: T) => boolean = () => true
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`${event} timed out`));
        }, timeoutMs);
        const handler = (payload: T) => {
            if (!predicate(payload)) return;
            clearTimeout(timeout);
            socket.off(event, handler);
            resolve(payload);
        };
        socket.on(event, handler);
    });
}

async function run(): Promise<void> {
    assertSafeTarget();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const username = `late_spectator_${suffix}`;
    const password = `LateSpectator-${suffix}!`;
    const sockets: Socket[] = [];
    let userId: number | null = null;
    let categoryId: number | null = null;
    let wordId: number | null = null;

    try {
        const user = await prisma.user.create({
            data: {
                username,
                password: await bcryptjs.hash(password, 10),
                role: "user",
            },
        });
        userId = user.id;
        const category = await prisma.category.create({
            data: {
                name: `Late spectator test ${suffix}`,
                color: "#0f766e",
                isVisible: true,
            },
        });
        categoryId = category.id;
        const word = await prisma.word.create({
            data: {
                wordText: `spectator-test-${suffix}`,
                difficulty: 1,
                tabooWords: {
                    create: [{ tabooWordText: "test" }],
                },
                wordCategories: {
                    create: [{ categoryId }],
                },
            },
        });
        wordId = word.id;
        await invalidateCategoryCache();

        const cookie = await login(username, password);
        const host = await connectPlayer({ name: "SpectatorTestHost" });
        const teammate = await connectPlayer({
            name: "SpectatorTestGuest",
            roomCode: host.lobby.odaKodu,
        });
        const thirdPlayer = await connectPlayer({
            name: "SpectatorTestThird",
            roomCode: host.lobby.odaKodu,
        });
        const fourthPlayer = await connectPlayer({
            name: "SpectatorTestFourth",
            roomCode: host.lobby.odaKodu,
        });
        const activePlayers = [host, teammate, thirdPlayer, fourthPlayer];
        sockets.push(...activePlayers.map((player) => player.socket));
        assert.deepEqual(fourthPlayer.lobby.startReadiness, {
            ready: true,
            activePlayers: 4,
            minimumPlayers: 4,
            teamAPlayers: 2,
            teamBPlayers: 2,
        });
        console.log("[late-spectator] four-player room ready");

        const gameStarted = waitForEvent<undefined>(
            host.socket,
            "oyunBasladi"
        );
        const gameStartError = waitForEvent<string>(host.socket, "hata");
        host.socket.emit("oyun_baslat", {
            seciliKategoriler: [categoryId],
            seciliZorluklar: [1],
            ayarlar: {
                sure: 30,
                mod: "skor",
                deger: 10,
            },
        });
        await Promise.race([
            gameStarted,
            gameStartError.then((message) => {
                throw new Error(`Game start rejected: ${message}`);
            }),
        ]);
        console.log("[late-spectator] game started");

        const spectator = await connectPlayer({
            name: username,
            roomCode: host.lobby.odaKodu,
            cookie,
        });
        sockets.push(spectator.socket);
        const spectatorPlayer = spectator.lobby.oyuncular.find(
            (player) => player.ad === username
        );
        assert.ok(spectatorPlayer);
        assert.equal(spectatorPlayer.rol, "İzleyici");
        assert.equal(spectatorPlayer.takim, null);
        console.log("[late-spectator] spectator role verified");

        const turnRoles = await Promise.all(
            activePlayers.map(async (player) => ({
                socket: player.socket,
                turn: await waitForEvent<{ rol: string }>(
                    player.socket,
                    "yeniTurBilgisi"
                ),
            }))
        );
        const narratorSocket =
            turnRoles.find(({ turn }) => turn.rol === "Anlatıcı")?.socket ??
            null;
        assert.ok(narratorSocket, "Narrator socket was not identified");
        console.log("[late-spectator] narrator identified");

        const gameFinished = waitForEvent<{
            kazananTakim: "A" | "B";
        }>(host.socket, "oyunBitti");
        for (let index = 0; index < 10; index += 1) {
            narratorSocket.emit("oyunVerisi", { eylem: "dogru" });
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        await gameFinished;
        console.log("[late-spectator] game finished");

        const beforeResultCount = await prisma.matchResult.count({
            where: { userId },
        });
        const beforeWallet = await prisma.wallet.findUnique({
            where: { userId },
            select: { coinBalance: true },
        });
        const finalizeResponse = await fetch(
            `${serverUrl}/api/game/match/finalize`,
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    cookie,
                    origin: serverUrl,
                },
                body: JSON.stringify({ roomCode: host.lobby.odaKodu }),
            }
        );
        const finalizePayload = (await finalizeResponse.json()) as {
            error?: string;
        };
        assert.equal(finalizeResponse.status, 403);
        assert.match(
            finalizePayload.error ?? "",
            /oyuncu (?:doğrulanamadı|dogrulanamadi)|izleyiciler/i
        );

        const afterResultCount = await prisma.matchResult.count({
            where: { userId },
        });
        const afterWallet = await prisma.wallet.findUnique({
            where: { userId },
            select: { coinBalance: true },
        });
        assert.equal(afterResultCount, beforeResultCount);
        assert.equal(
            String(afterWallet?.coinBalance ?? 0),
            String(beforeWallet?.coinBalance ?? 0)
        );

        const deniedAudit = await prisma.auditLog.findFirst({
            where: {
                actorUserId: userId,
                action: "game.match.finalize.denied",
                resourceId: host.lobby.odaKodu,
            },
            select: { id: true, metadata: true },
        });
        assert.ok(deniedAudit);
        assert.match(
            JSON.stringify(deniedAudit.metadata),
            /participant_not_found|spectator_not_eligible/
        );
        console.log("[late-spectator] reward denial verified");

        console.log(
            JSON.stringify({
                result: "late spectator reward test passed",
                spectatorRoleVerified: true,
                finalizeStatus: finalizeResponse.status,
                matchResultWritten: false,
                coinChanged: false,
                deniedAuditWritten: true,
            })
        );
    } finally {
        console.log("[late-spectator] cleanup started");
        for (const socket of sockets) {
            socket.disconnect();
        }
        if (userId !== null) {
            await prisma.auditLog.deleteMany({
                where: { actorUserId: userId },
            });
            await prisma.matchResult.deleteMany({
                where: { userId },
            });
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        if (categoryId !== null) {
            await prisma.category.deleteMany({ where: { id: categoryId } });
            await invalidateCategoryCache();
        }
        if (wordId !== null) {
            await prisma.word.deleteMany({ where: { id: wordId } });
        }
        await prisma.$disconnect();
        await closeRedisClient();
        console.log("[late-spectator] cleanup completed");
    }
}

void run();
