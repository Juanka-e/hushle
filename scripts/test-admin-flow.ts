
import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:3000";

interface LobbyPayload {
    odaKodu: string;
}

const createClient = (tag: string) => {
    const socket = io(SERVER_URL, {
        path: "/api/socketio",
        reconnection: false,
        transports: ["websocket"],
        forceNew: true,
        extraHeaders: { Origin: SERVER_URL },
    });
    socket.on("connect_error", (err) => {
        console.error(`[${tag}] Connection Error:`, err.message);
    });
    return socket;
};

async function runTest() {
    console.log("=== STARTING ADMIN KICK/BAN TEST ===");

    // 1. Admin creates room
    const admin = createClient("ADMIN");

    const roomCodePromise = new Promise<string>((resolve) => {
        admin.on("lobiGuncelle", (data: LobbyPayload) => {
            if (data.odaKodu) resolve(data.odaKodu);
        });
    });

    admin.emit("odaİsteği", { kullaniciAdi: "AdminUser" });
    const roomCode = await roomCodePromise;
    console.log(`[ADMIN] Created Room: ${roomCode}`);

    // 2. Victim joins room
    const victim = createClient("VICTIM");
    let victimPlayerId = "";

    const victimJoinPromise = new Promise<string>((resolve) => {
        victim.on("kimlikAta", (id: string) => {
            victimPlayerId = id;
            resolve(id);
        });
    });

    victim.emit("odaİsteği", { kullaniciAdi: "VictimUser", odaKodu: roomCode });
    await victimJoinPromise;
    console.log(`[VICTIM] Joined Room with ID: ${victimPlayerId}`);

    // Wait for admin to see victim
    await new Promise((r) => setTimeout(r, 1000));

    // 3. Admin kicks victim
    console.log(`[ADMIN] Kicking Victim...`);
    admin.emit("oyuncuyuAt", { targetPlayerId: victimPlayerId });

    // 4. Verify victim receives kick event
    const victimKickPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject("Timeout waiting for kick event"), 5000);
        victim.on("odadanAtildin", () => {
            clearTimeout(timeout);
            console.log(`[VICTIM] Received 'odadanAtildin' event.`);
            resolve();
        });
    });

    await victimKickPromise;
    victim.disconnect(); // simulate forced disconnect
    console.log(`[VICTIM] Disconnected.`);

    // 5. Verify Ban (Rejoin attempt)
    console.log(`[VICTIM] Trying to rejoin...`);
    const victimRejoin = createClient("VICTIM_REJOIN");

    const rejoinPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject("Timeout waiting for rejoin response"), 5000);

        victimRejoin.on("hata", (msg: string) => {
            clearTimeout(timeout);
            if (msg.includes("Banlandınız") || msg.includes("izniniz yok")) {
                console.log(`[VICTIM_REJOIN] Expected Error: "${msg}"`);
                resolve();
            } else {
                reject(`Unexpected error: ${msg}`);
            }
        });

        victimRejoin.on("lobiGuncelle", () => {
            clearTimeout(timeout);
            reject("Victim managed to rejoin! Ban failed.");
        });

        victimRejoin.emit("odaİsteği", {
            kullaniciAdi: "VictimUser",
            odaKodu: roomCode,
            playerId: victimPlayerId
        });
    });

    await rejoinPromise;

    console.log("=== API TEST PASSED successfully ===");
    admin.close();
    victimRejoin.close();
    process.exit(0);
}

runTest().catch((err) => {
    console.error("Test Failed:", err);
    process.exit(1);
});
