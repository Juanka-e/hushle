
import { io } from "socket.io-client";

const socket = io("http://127.0.0.1:3000", {
    path: "/api/socketio",
    transports: ["polling"], // Force polling first to test connectivity
    extraHeaders: { Origin: "http://127.0.0.1:3000" },
});

socket.on("connect", () => {
    console.log("Connected to Socket.IO server");

    // Request to join/create a room
    console.log("Sending room request...");
    socket.emit("odaİsteği", {
        kullaniciAdi: "TestUser",
        odaKodu: undefined, // Create new room
    });
});

socket.on("connect_error", (err) => {
    console.error("Connection error:", err.message);
    process.exit(1);
});

socket.on("kimlikAta", (id) => {
    console.log("Identity assigned:", id);
});

socket.on("lobiGuncelle", (data: { odaKodu: string; oyuncular: { ad: string }[] }) => {
    console.log("Lobby update received for room:", data.odaKodu);
    console.log("Players:", data.oyuncular.map((p) => p.ad).join(", "));
    socket.disconnect();
    console.log("Test Passed!");
    process.exit(0);
});

socket.on("hata", (msg) => {
    console.error("Socket error:", msg);
    process.exit(1);
});

// Timeout after 10 seconds
setTimeout(() => {
    console.error("Test timed out");
    process.exit(1);
}, 10000);
