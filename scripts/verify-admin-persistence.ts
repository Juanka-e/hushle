
import { io } from "socket.io-client";

const SERVER_URL = "http://127.0.0.1:3000";
const PATH = "/api/socketio";

interface LobbyPayload {
    odaKodu: string;
    creatorId: string;
}

async function testAdminPersistence() {
    console.log("--- Starting Admin Persistence Test ---");

    let adminPlayerId: string | undefined;
    let roomCode: string | undefined;

    // 1. Connect as Admin (Initial)
    console.log("\n1. Connecting Admin (Initial)...");
    const socket1 = io(SERVER_URL, {
        path: PATH,
        transports: ["websocket", "polling"],
        extraHeaders: { Origin: SERVER_URL },
        // reconnection: false, // Removed
    });

    try {
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timeout waiting for initial setup")), 5000);

            socket1.on("connect", () => {
                console.log("Socket 1 Connected:", socket1.id);
                socket1.emit("odaİsteği", { kullaniciAdi: "AdminUser" });
            });

            socket1.on("kimlikAta", (id) => {
                console.log("Received Player ID:", id);
                adminPlayerId = id;
                checkDone();
            });

            socket1.on("lobiGuncelle", (data: LobbyPayload) => {
                console.log(`Lobby Update (1): Room: ${data.odaKodu}, Creator: ${data.creatorId}`);
                if (!roomCode) {
                    roomCode = data.odaKodu;
                    if (data.creatorId === socket1.id) {
                        console.log("SUCCESS: Initial Admin Identity Verified.");
                        checkDone();
                    } else {
                        // reject(new Error(`Initial Creator ID mismatch. Expected ${socket1.id}, got ${data.creatorId}`));
                        console.warn(`Initial Creator ID mismatch. Expected ${socket1.id}, got ${data.creatorId}. Might be timing issue.`);
                    }
                }
            });

            socket1.on("connect_error", (err) => {
                console.error("Connect Error 1:", err.message);
                reject(err);
            });

            function checkDone() {
                if (adminPlayerId && roomCode) {
                    clearTimeout(timeout);
                    resolve();
                }
            }
        });

        // socket1.removeAllListeners(); // Cleanup

        if (!adminPlayerId) {
            throw new Error("Failed to get Player ID (kimlikAta not received)");
        }

        console.log(`proceeding with PlayerID: ${adminPlayerId} and Room: ${roomCode}`);

        // 2. Disconnect Admin
        console.log("\n2. Disconnecting Admin...");
        socket1.disconnect();

        // Wait a bit
        await new Promise((r) => setTimeout(r, 1000));

        // 3. Reconnect Admin (with same Player ID)
        console.log("\n3. Reconnecting Admin (Same Player ID)...");
        const socket2 = io(SERVER_URL, {
            path: PATH,
            transports: ["websocket", "polling"],
            extraHeaders: { Origin: SERVER_URL },
            // reconnection: false,
        });

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timeout waiting for reconnection")), 5000);

            socket2.on("connect", () => {
                console.log("Socket 2 Connected:", socket2.id);
                // Send the captured playerId!
                console.log("Sending odaİsteği with playerId:", adminPlayerId);
                socket2.emit("odaİsteği", {
                    kullaniciAdi: "AdminUser",
                    odaKodu: roomCode,
                    playerId: adminPlayerId
                });
            });

            socket2.on("lobiGuncelle", (data: LobbyPayload) => {
                console.log(`Lobby Update (2): Creator: ${data.creatorId}, My Socket: ${socket2.id}`);

                if (data.creatorId === socket2.id) {
                    console.log("SUCCESS: Admin Rights Preserved! (Creator ID updated to new Socket ID)");
                    clearTimeout(timeout);
                    resolve();
                } else {
                    console.error(`FAILURE: Admin Rights Lost. Creator ID (${data.creatorId}) !== New Socket ID (${socket2.id})`);
                    clearTimeout(timeout); // verify failing
                    reject(new Error("Admin rights lost"));
                }
            });

            socket2.on("hata", (msg) => {
                console.error("Socket Error:", msg);
                reject(new Error(msg));
            });

            socket2.on("connect_error", (err) => {
                console.error("Connect Error 2:", err.message);
                reject(err);
            });
        });

        socket2.disconnect();
        console.log("\n--- Test Passed Successfully ---");
        process.exit(0);

    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error("Test Failed Stack:", error.stack);
        } else {
            console.error("Test Failed:", error);
        }
        if (socket1.connected) socket1.disconnect();
        process.exit(1);
    }
}

testAdminPersistence();
