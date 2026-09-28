
import { io } from "socket.io-client";

const SERVER_URL = "http://127.0.0.1:3000";
const PATH = "/api/socketio";

interface LobbyPlayer {
    ad: string;
}

interface LobbyPayload {
    odaKodu: string;
    oyuncular: LobbyPlayer[];
}

async function testRoomJoin() {
    console.log("--- Starting Room Join Reproduction ---");

    let roomCode = "";

    // 1. Creator joins and creates room
    const creator = io(SERVER_URL, {
        path: PATH,
        transports: ["websocket"],
        extraHeaders: { Origin: SERVER_URL },
    });

    await new Promise<void>((resolve, reject) => {
        creator.on("connect", () => {
            console.log("Creator connected:", creator.id);
            creator.emit("odaİsteği", { kullaniciAdi: "Admin" });
        });

        creator.on("lobiGuncelle", (data: LobbyPayload) => {
            if (!roomCode) {
                roomCode = data.odaKodu;
                console.log("Room Created:", roomCode);
                resolve();
            }
        });

        creator.on("error", reject);
    });

    console.log("Waiting 2s...");
    await new Promise(r => setTimeout(r, 2000));

    // 2. Joiner tries to join
    console.log("Joiner connecting to:", roomCode);
    const joiner = io(SERVER_URL, {
        path: PATH,
        transports: ["websocket"],
        extraHeaders: { Origin: SERVER_URL },
    });

    await new Promise<void>((resolve, reject) => {
        joiner.on("connect", () => {
            console.log("Joiner connected:", joiner.id);
            joiner.emit("odaİsteği", { kullaniciAdi: "Joiner", odaKodu: roomCode });
        });

        joiner.on("lobiGuncelle", (data: LobbyPayload) => {
            if (data.odaKodu === roomCode) {
                console.log("SUCCESS: Joiner joined room", roomCode);
                // Check players
                const names = data.oyuncular.map((p) => p.ad);
                console.log("Players:", names);
                if (names.includes("Joiner")) {
                    resolve();
                }
            }
        });

        joiner.on("hata", (msg) => {
            console.error("FAILURE: Joiner received error:", msg);
            reject(new Error(msg));
        });
    });

    creator.disconnect();
    joiner.disconnect();
    process.exit(0);
}

testRoomJoin().catch(e => {
    console.error("Test Failed:", e);
    process.exit(1);
});
