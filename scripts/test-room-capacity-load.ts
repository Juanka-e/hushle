import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";

const serverUrl = process.env.SOCKET_TEST_URL ?? "http://127.0.0.1:3000";
const expectedRoomMax = readPositiveInteger(
    "ROOM_CAPACITY_TEST_EXPECTED_MAX",
    12
);
const expectedTeamMax = readPositiveInteger(
    "ROOM_CAPACITY_TEST_EXPECTED_TEAM_MAX",
    6
);
const concurrentCandidates = readPositiveInteger(
    "ROOM_CAPACITY_TEST_CANDIDATES",
    expectedRoomMax * 2
);
const timeoutMs = 20_000;

interface SocketIdentity {
    playerId: string;
    guestToken: string;
}

interface PublicPlayer {
    id: string;
    playerId: string;
    ad: string;
    takim: "A" | "B" | null;
    online: boolean;
    rol: string;
    [key: string]: unknown;
}

interface LobbyPayload {
    odaKodu: string;
    oyuncular: PublicPlayer[];
    startReadiness: {
        ready: boolean;
        activePlayers: number;
        minimumPlayers: number;
        teamAPlayers: number;
        teamBPlayers: number;
    };
}

interface ConnectedGuest {
    socket: Socket;
    identity: SocketIdentity;
    lobby: LobbyPayload;
}

function readPositiveInteger(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] ?? "", 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function connectGuest(options: {
    name: string;
    roomCode?: string;
    guestToken?: string;
}): Promise<ConnectedGuest> {
    return new Promise((resolve, reject) => {
        const socket = io(serverUrl, {
            path: "/api/socketio",
            transports: ["websocket"],
            forceNew: true,
            reconnection: false,
            extraHeaders: { Origin: serverUrl },
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
                ...(options.guestToken
                    ? { guestToken: options.guestToken }
                    : {}),
            });
        });
        socket.on("kimlikAta", (assigned: SocketIdentity) => {
            identity = assigned;
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
    predicate: (lobby: LobbyPayload) => boolean,
    label: string
): Promise<LobbyPayload> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off("lobiGuncelle", handleLobby);
            reject(new Error(`${label} lobby update timed out`));
        }, timeoutMs);
        const handleLobby = (lobby: LobbyPayload) => {
            if (!predicate(lobby)) return;
            clearTimeout(timeout);
            socket.off("lobiGuncelle", handleLobby);
            resolve(lobby);
        };
        socket.on("lobiGuncelle", handleLobby);
    });
}

function assertPublicPlayerShape(players: PublicPlayer[]): void {
    for (const player of players) {
        assert.equal("userId" in player, false);
        assert.equal("identityType" in player, false);
        assert.equal("usernameSnapshot" in player, false);
        assert.equal("ip" in player, false);
    }
}

async function run(): Promise<void> {
    assert.ok(
        concurrentCandidates > expectedRoomMax,
        "Candidate count must exceed room capacity"
    );
    assert.ok(
        expectedTeamMax * 2 >= expectedRoomMax,
        "Team capacity must cover room capacity"
    );

    const sockets: Socket[] = [];

    try {
        const creator = await connectGuest({ name: "LoadHost" });
        sockets.push(creator.socket);
        const roomCode = creator.lobby.odaKodu;
        const startedAt = Date.now();
        const attempts = await Promise.allSettled(
            Array.from(
                { length: concurrentCandidates - 1 },
                (_, index) =>
                    connectGuest({
                        name: `LoadGuest${String(index + 1).padStart(2, "0")}`,
                        roomCode,
                    })
            )
        );
        const joined = attempts
            .filter(
                (
                    result
                ): result is PromiseFulfilledResult<ConnectedGuest> =>
                    result.status === "fulfilled"
            )
            .map((result) => result.value);
        const rejected = attempts.filter(
            (
                result
            ): result is PromiseRejectedResult =>
                result.status === "rejected"
        );
        sockets.push(...joined.map((entry) => entry.socket));

        assert.equal(joined.length + 1, expectedRoomMax);
        assert.equal(
            rejected.length,
            concurrentCandidates - expectedRoomMax
        );
        for (const rejection of rejected) {
            assert.match(
                String(rejection.reason),
                /oda dolu|takım da dolu|takim da dolu/i
            );
        }

        const observedFullLobby = joined.find(
            (entry) =>
                entry.lobby.startReadiness.activePlayers === expectedRoomMax
        )?.lobby;
        const fullLobby =
            observedFullLobby ??
            (await waitForLobby(
                creator.socket,
                (lobby) =>
                    lobby.startReadiness.activePlayers === expectedRoomMax,
                "full room"
            ));

        assert.equal(fullLobby.oyuncular.filter((player) => player.online).length, expectedRoomMax);
        assert.equal(
            fullLobby.startReadiness.teamAPlayers +
                fullLobby.startReadiness.teamBPlayers,
            expectedRoomMax
        );
        assert.ok(fullLobby.startReadiness.teamAPlayers <= expectedTeamMax);
        assert.ok(fullLobby.startReadiness.teamBPlayers <= expectedTeamMax);
        assert.ok(
            Math.abs(
                fullLobby.startReadiness.teamAPlayers -
                    fullLobby.startReadiness.teamBPlayers
            ) <= 1
        );
        assertPublicPlayerShape(fullLobby.oyuncular);

        const reconnectTarget = joined[0];
        assert.ok(reconnectTarget, "A reconnect target is required");
        const offlineLobbyPromise = waitForLobby(
            creator.socket,
            (lobby) =>
                lobby.startReadiness.activePlayers === expectedRoomMax - 1,
            "disconnect"
        );
        reconnectTarget.socket.disconnect();
        await offlineLobbyPromise;

        const reconnected = await connectGuest({
            name: reconnectTarget.lobby.oyuncular.find(
                (player) =>
                    player.playerId === reconnectTarget.identity.playerId
            )?.ad ?? "LoadReconnect",
            roomCode,
            guestToken: reconnectTarget.identity.guestToken,
        });
        sockets.push(reconnected.socket);
        assert.equal(
            reconnected.identity.playerId,
            reconnectTarget.identity.playerId
        );
        assert.equal(
            reconnected.lobby.oyuncular.filter((player) => player.online)
                .length,
            expectedRoomMax
        );
        assert.equal(reconnected.lobby.oyuncular.length, expectedRoomMax);

        await assert.rejects(
            connectGuest({ name: "LoadOverflow", roomCode }),
            /oda dolu|takım da dolu|takim da dolu/i
        );

        console.log(
            JSON.stringify({
                result: "room capacity load test passed",
                roomCode,
                candidates: concurrentCandidates,
                admitted: expectedRoomMax,
                rejected: rejected.length,
                parallelJoinMs: Date.now() - startedAt,
                reconnectPreservedPlayerId: true,
            })
        );
    } finally {
        for (const socket of sockets) {
            socket.disconnect();
        }
    }
}

void run();
