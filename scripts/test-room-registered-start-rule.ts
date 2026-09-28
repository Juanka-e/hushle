import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@hushle/platform-db";

const serverUrl = process.env.SOCKET_TEST_URL ?? "http://127.0.0.1:3000";
const timeoutMs = 15_000;

function assertSafeTarget(): void {
    assert.equal(
        process.env.REGISTERED_START_RULE_TEST,
        "true",
        "REGISTERED_START_RULE_TEST=true is required"
    );
    assert.match(
        process.env.DATABASE_URL ?? "",
        /tabu_test/,
        "Registered start rule test requires a disposable tabu_test database"
    );
    const url = new URL(serverUrl);
    assert.ok(
        url.hostname === "127.0.0.1" || url.hostname === "localhost",
        "Registered start rule test only supports a loopback server"
    );
}

interface SocketIdentity {
    playerId: string;
    guestToken?: string;
}

interface LobbyPayload {
    odaKodu: string;
    startReadiness: {
        ready: boolean;
        activePlayers: number;
        minimumPlayers: number;
        teamAPlayers: number;
        teamBPlayers: number;
    };
}

interface ConnectedPlayer {
    socket: Socket;
    identity: SocketIdentity;
    lobby: LobbyPayload;
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

    const body = new URLSearchParams({
        csrfToken: csrf.csrfToken,
        username,
        password,
        portal: "user",
        callbackUrl: `${serverUrl}/dashboard`,
    });
    const callbackResponse = await fetch(
        `${serverUrl}/api/auth/callback/credentials`,
        {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                cookie: cookieHeaderFrom(csrfCookies),
            },
            body,
            redirect: "manual",
        }
    );
    assert.ok(
        callbackResponse.status === 200 ||
            callbackResponse.status === 302 ||
            callbackResponse.status === 303
    );
    const sessionCookies = callbackResponse.headers.getSetCookie();
    const allCookies = [...csrfCookies, ...sessionCookies];
    assert.ok(
        allCookies.some((cookie) =>
            cookie.includes("authjs.session-token")
        ),
        "Auth.js session cookie was not issued"
    );

    return cookieHeaderFrom(allCookies);
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
        let identity: SocketIdentity | null = null;
        let lobby: LobbyPayload | null = null;
        let settled = false;

        const finish = () => {
            if (settled || !identity || !lobby) return;
            settled = true;
            clearTimeout(timeout);
            resolve({ socket, identity, lobby });
        };
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            socket.disconnect();
            reject(error);
        };
        const timeout = setTimeout(
            () => fail(new Error(`${options.name} request timed out`)),
            timeoutMs
        );

        socket.on("connect", () => {
            socket.emit("room:request", {
                kullaniciAdi: options.name,
                ...(options.roomCode ? { odaKodu: options.roomCode } : {}),
            });
        });
        socket.on("kimlikAta", (nextIdentity: SocketIdentity) => {
            identity = nextIdentity;
            finish();
        });
        socket.on("lobiGuncelle", (nextLobby: LobbyPayload) => {
            if (
                options.roomCode &&
                nextLobby.odaKodu !== options.roomCode
            ) {
                return;
            }
            lobby = nextLobby;
            finish();
        });
        socket.on("connect_error", (error) => fail(error));
        socket.on("hata", (message: string) =>
            fail(new Error(String(message)))
        );
    });
}

function waitForLobby(
    socket: Socket,
    activePlayers: number
): Promise<LobbyPayload> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off("lobiGuncelle", handleLobby);
            reject(new Error(`Lobby ${activePlayers} update timed out`));
        }, timeoutMs);
        const handleLobby = (lobby: LobbyPayload) => {
            if (lobby.startReadiness.activePlayers !== activePlayers) {
                return;
            }
            clearTimeout(timeout);
            socket.off("lobiGuncelle", handleLobby);
            resolve(lobby);
        };
        socket.on("lobiGuncelle", handleLobby);
    });
}

function emitStartAndWaitForError(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off("hata", handleError);
            reject(new Error("Start rule response timed out"));
        }, timeoutMs);
        const handleError = (message: string) => {
            clearTimeout(timeout);
            socket.off("hata", handleError);
            resolve(String(message));
        };
        socket.on("hata", handleError);
        socket.emit("oyun_baslat", {
            seciliKategoriler: [],
            seciliZorluklar: [],
            ayarlar: {
                sure: 60,
                mod: "skor",
                deger: 10,
            },
        });
    });
}

async function run(): Promise<void> {
    assertSafeTarget();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const username = `capacity_user_${suffix}`;
    const password = `Capacity-${suffix}!`;
    const sockets: Socket[] = [];
    let userId: number | null = null;

    try {
        const user = await prisma.user.create({
            data: {
                username,
                password: await bcryptjs.hash(password, 10),
                role: "user",
            },
        });
        userId = user.id;
        const cookie = await login(username, password);
        const host = await connectPlayer({
            name: username,
            cookie,
        });
        sockets.push(host.socket);
        assert.equal(host.lobby.startReadiness.minimumPlayers, 4);
        assert.equal(host.lobby.startReadiness.activePlayers, 1);
        assert.equal(host.lobby.startReadiness.ready, false);

        const guestA = await connectPlayer({
            name: "RegisteredRuleGuestA",
            roomCode: host.lobby.odaKodu,
        });
        sockets.push(guestA.socket);
        const guestB = await connectPlayer({
            name: "RegisteredRuleGuestB",
            roomCode: host.lobby.odaKodu,
        });
        sockets.push(guestB.socket);
        const threePlayerLobby =
            guestB.lobby.startReadiness.activePlayers === 3
                ? guestB.lobby
                : await waitForLobby(host.socket, 3);
        assert.equal(threePlayerLobby.startReadiness.minimumPlayers, 4);
        assert.equal(threePlayerLobby.startReadiness.ready, false);

        const blockedMessage = await emitStartAndWaitForError(host.socket);
        assert.match(blockedMessage, /en az 4 aktif oyuncu/i);

        const guestC = await connectPlayer({
            name: "RegisteredRuleGuestC",
            roomCode: host.lobby.odaKodu,
        });
        sockets.push(guestC.socket);
        const fourPlayerLobby =
            guestC.lobby.startReadiness.activePlayers === 4
                ? guestC.lobby
                : await waitForLobby(host.socket, 4);
        assert.equal(fourPlayerLobby.startReadiness.minimumPlayers, 4);
        assert.equal(fourPlayerLobby.startReadiness.ready, true);
        assert.equal(fourPlayerLobby.startReadiness.teamAPlayers, 2);
        assert.equal(fourPlayerLobby.startReadiness.teamBPlayers, 2);

        const categoryMessage = await emitStartAndWaitForError(host.socket);
        assert.match(categoryMessage, /kategori seçin/i);

        console.log(
            JSON.stringify({
                result: "registered room start rule test passed",
                threePlayersBlocked: true,
                fourPlayersEligible: true,
                serverStartGuardVerified: true,
            })
        );
    } finally {
        for (const socket of sockets) {
            socket.disconnect();
        }
        if (userId !== null) {
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await prisma.$disconnect();
    }
}

void run();
