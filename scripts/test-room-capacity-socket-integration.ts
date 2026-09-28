import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";

const serverUrl = process.env.SOCKET_TEST_URL ?? "http://127.0.0.1:3000";
const timeoutMs = 15_000;

interface PublicPlayer {
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

function connectGuest(name: string, roomCode?: string): Promise<{
    socket: Socket;
    lobby: LobbyPayload;
}> {
    return new Promise((resolve, reject) => {
        const socket = io(serverUrl, {
            path: "/api/socketio",
            transports: ["websocket"],
            forceNew: true,
            extraHeaders: {
                Origin: serverUrl,
            },
        });
        const timeout = setTimeout(() => {
            socket.disconnect();
            reject(new Error(`${name} socket request timed out`));
        }, timeoutMs);

        socket.on("connect", () => {
            socket.emit("room:request", {
                kullaniciAdi: name,
                ...(roomCode ? { odaKodu: roomCode } : {}),
            });
        });
        socket.on("lobiGuncelle", (lobby: LobbyPayload) => {
            if (roomCode && lobby.odaKodu !== roomCode) return;
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
            reject(new Error(message));
        });
    });
}

async function run(): Promise<void> {
    const sockets: Socket[] = [];

    try {
        const creator = await connectGuest("CapacityGuestA");
        sockets.push(creator.socket);
        assert.equal(creator.lobby.startReadiness.ready, false);
        assert.equal(creator.lobby.startReadiness.minimumPlayers, 4);

        const joiner = await connectGuest(
            "CapacityGuestB",
            creator.lobby.odaKodu
        );
        sockets.push(joiner.socket);

        const joinedLobby = await new Promise<LobbyPayload>((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(new Error("Updated lobby payload timed out")),
                timeoutMs
            );
            const handleLobby = (lobby: LobbyPayload) => {
                if (lobby.oyuncular.length !== 2) return;
                clearTimeout(timeout);
                creator.socket.off("lobiGuncelle", handleLobby);
                resolve(lobby);
            };
            creator.socket.on("lobiGuncelle", handleLobby);

            if (joiner.lobby.oyuncular.length === 2) {
                clearTimeout(timeout);
                creator.socket.off("lobiGuncelle", handleLobby);
                resolve(joiner.lobby);
            }
        });

        assert.equal(joinedLobby.startReadiness.ready, false);
        assert.equal(joinedLobby.startReadiness.activePlayers, 2);
        assert.equal(joinedLobby.startReadiness.teamAPlayers, 1);
        assert.equal(joinedLobby.startReadiness.teamBPlayers, 1);

        const third = await connectGuest(
            "CapacityGuestC",
            creator.lobby.odaKodu
        );
        sockets.push(third.socket);
        assert.equal(third.lobby.startReadiness.ready, false);
        assert.equal(third.lobby.startReadiness.activePlayers, 3);

        const fourth = await connectGuest(
            "CapacityGuestD",
            creator.lobby.odaKodu
        );
        sockets.push(fourth.socket);
        assert.equal(fourth.lobby.startReadiness.ready, true);
        assert.equal(fourth.lobby.startReadiness.activePlayers, 4);
        assert.equal(fourth.lobby.startReadiness.teamAPlayers, 2);
        assert.equal(fourth.lobby.startReadiness.teamBPlayers, 2);

        for (const player of fourth.lobby.oyuncular) {
            assert.equal("id" in player, false);
            assert.equal("userId" in player, false);
            assert.equal("identityType" in player, false);
            assert.equal("usernameSnapshot" in player, false);
            assert.equal("ip" in player, false);
        }
        assert.equal("creatorId" in fourth.lobby, false);

        const hostPlayer = fourth.lobby.oyuncular.find(player => player.ad === "CapacityGuestA")!;
        const teammate = fourth.lobby.oyuncular.find(player => player.takim === hostPlayer.takim && player.playerId !== hostPlayer.playerId)!;
        let unauthorizedUpdates = 0;
        const countUpdate = () => { unauthorizedUpdates++; };
        creator.socket.on("lobiGuncelle", countUpdate);
        joiner.socket.emit("narrator_order", { playerId: teammate.playerId, direction: "up" });
        await new Promise(resolve => setTimeout(resolve, 400));
        creator.socket.off("lobiGuncelle", countUpdate);
        assert.equal(unauthorizedUpdates, 0, "non-host cannot reorder narrators");

        const reordered = new Promise<LobbyPayload>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Narrator order update timed out")), timeoutMs);
            creator.socket.once("lobiGuncelle", lobby => { clearTimeout(timer); resolve(lobby); });
        });
        creator.socket.emit("narrator_order", { playerId: teammate.playerId, direction: "up" });
        const updated = await reordered;
        assert.equal(updated.oyuncular.filter(player => player.takim === hostPlayer.takim)[0].playerId, teammate.playerId);
        assert.deepEqual(updated.oyuncular.map(player => player.playerId).sort(), fourth.lobby.oyuncular.map(player => player.playerId).sort());

        console.log("room capacity socket integration test passed");
    } finally {
        for (const socket of sockets) {
            socket.disconnect();
        }
    }
}

void run();
