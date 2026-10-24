import { expect, test, type Page } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@hushle/platform-db";

// A guest who joins from the home page keeps the same socket on the room page, so the
// server never lists them offline in between and a host can start at any moment.
const enabled = process.env.ROOM_JOIN_HANDOFF_E2E === "true";
const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3201";

type LobbyPlayer = { ad: string; rol: string; takim: "A" | "B" | null; online?: boolean };
type Lobby = { odaKodu: string; oyuncular: LobbyPlayer[] };

test.describe.configure({ mode: "serial" });

test.describe("room join handoff", () => {
    test.skip(!enabled, "ROOM_JOIN_HANDOFF_E2E=true is required");
    test.setTimeout(90_000);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const sockets: Socket[] = [];
    let categoryId: number | null = null;
    const memberName = `handoff_member_${suffix}`;
    const memberPassword = `Handoff-${suffix} vapur 2026!`;
    let memberId: number | null = null;

    test.beforeAll(async () => {
        expect(process.env.DATABASE_URL ?? "").toMatch(/tabu_test/);
        const category = await prisma.category.create({
            data: { name: `Join handoff ${suffix}`, color: "#0ea5e9", sortOrder: 999_300, isVisible: true },
        });
        categoryId = category.id;
        for (let index = 1; index <= 6; index += 1) {
            const word = await prisma.word.create({
                data: {
                    wordText: `handoff_${suffix}_${index}`,
                    difficulty: 1,
                    tabooWords: { create: [{ tabooWordText: `yasak_${suffix}_${index}` }] },
                },
            });
            await prisma.wordCategory.create({ data: { wordId: word.id, categoryId } });
        }
        const member = await prisma.user.create({
            data: { username: memberName, password: await bcryptjs.hash(memberPassword, 10), role: "user" },
        });
        memberId = member.id;
    });

    test.afterAll(async () => {
        for (const socket of sockets) socket.disconnect();
        await prisma.word.deleteMany({ where: { wordText: { startsWith: `handoff_${suffix}_` } } });
        if (categoryId !== null) await prisma.category.deleteMany({ where: { id: categoryId } });
        if (memberId !== null) {
            await prisma.auditLog.deleteMany({ where: { actorUserId: memberId } });
            await prisma.user.deleteMany({ where: { id: memberId } });
        }
        await prisma.$disconnect();
    });

    /** Every lobby update the socket receives, oldest first. */
    function recordLobbies(socket: Socket): Lobby[] {
        const lobbies: Lobby[] = [];
        socket.on("lobiGuncelle", (lobby: Lobby) => lobbies.push(lobby));
        return lobbies;
    }

    function socketPlayer(name: string, roomCode?: string): Promise<{ socket: Socket; roomCode: string; lobbies: Lobby[] }> {
        return new Promise((resolve, reject) => {
            const socket = io(baseURL, {
                path: "/api/socketio",
                transports: ["websocket"],
                forceNew: true,
                reconnection: false,
                extraHeaders: { Origin: baseURL },
            });
            sockets.push(socket);
            const lobbies = recordLobbies(socket);
            const timer = setTimeout(() => reject(new Error(`${name} join timed out`)), 20_000);
            socket.on("connect", () => socket.emit("room:request", { kullaniciAdi: name, ...(roomCode ? { odaKodu: roomCode } : {}) }));
            socket.once("lobiGuncelle", (lobby: Lobby) => {
                clearTimeout(timer);
                resolve({ socket, roomCode: lobby.odaKodu, lobbies });
            });
            socket.on("connect_error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }

    async function joinFromHomePage(page: Page, name: string, roomCode: string): Promise<void> {
        await page.goto("/");
        await page.getByPlaceholder(/Adınızı girin|Enter your name/i).fill(name);
        await page.getByPlaceholder(/Örn: ABC123|E.g.: ABC123/i).fill(roomCode);
        await page.getByRole("button", { name: /^Katıl$|^Join$/i }).click();
    }

    function guestStates(lobbies: Lobby[], name: string): string[] {
        return lobbies.flatMap((lobby) => {
            const guest = lobby.oyuncular.find((entry) => entry.ad === name);
            return guest ? [guest.online === false ? "offline" : "online"] : [];
        });
    }

    test("a guest stays online while moving from the home page to the room page", async ({ page }) => {
        const host = await socketPlayer(`HostH${suffix}`);
        const guestName = `MisafirH${suffix}`;

        await joinFromHomePage(page, guestName, host.roomCode);
        await expect(page).toHaveURL(new RegExp(`/room/${host.roomCode}$`), { timeout: 20_000 });
        await expect(page.getByRole("button", { name: new RegExp(`/room/.*${host.roomCode}`) })).toBeVisible({ timeout: 20_000 });
        // The room page asks for the room again on the handed-over socket; the server answers
        // every member with a lobby update, so the host sees the guest at least twice.
        await expect.poll(() => guestStates(host.lobbies, guestName).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
        await expect(page.getByText(guestName, { exact: true }).first()).toBeVisible();
        // Give a late disconnect from the home page time to arrive before checking.
        await page.waitForTimeout(1_500);
        expect(guestStates(host.lobbies, guestName)).not.toContain("offline");
    });

    test("a signed-in player joining from the dashboard stays online too", async ({ page }) => {
        const host = await socketPlayer(`HostD${suffix}`);
        await page.goto("/login");
        await page.getByPlaceholder(/Kullanıcı Adı/i).fill(memberName);
        await page.getByPlaceholder(/Parola/i).fill(memberPassword);
        await page.getByRole("button", { name: /^Giriş Yap$/i }).click();
        await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

        // Signed-in joins skip the captcha, so the room page takes the socket over at once.
        await page.getByRole("button", { name: /^Oyna$|^Play$/i }).first().click();
        await page.getByPlaceholder("ABC123").fill(host.roomCode);
        await page.getByRole("button", { name: /^Katıl$|^Join$/i }).click();
        await expect(page).toHaveURL(new RegExp(`/room/${host.roomCode}$`), { timeout: 20_000 });
        await expect(page.getByRole("button", { name: new RegExp(`/room/.*${host.roomCode}`) })).toBeVisible({ timeout: 20_000 });
        await expect.poll(() => guestStates(host.lobbies, memberName).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
        await page.waitForTimeout(1_500);
        expect(guestStates(host.lobbies, memberName)).not.toContain("offline");
    });

    test("a host can start while a guest's room page is still loading", async ({ page }) => {
        const host = await socketPlayer(`HostS${suffix}`);
        const roomCode = host.roomCode;
        const others = [await socketPlayer(`AliS${suffix}`, roomCode), await socketPlayer(`AyseS${suffix}`, roomCode)];
        const hostErrors: string[] = [];
        host.socket.on("hata", (message: unknown, meta?: { code?: string }) => hostErrors.push(meta?.code ?? String(message)));
        let started = false;
        host.socket.once("oyunBasladi", () => {
            started = true;
        });
        const guestName = `MisafirS${suffix}`;

        await joinFromHomePage(page, guestName, roomCode);
        // The home page has joined and handed its socket over; the room page is starting up.
        await page.waitForURL(new RegExp(`/room/${roomCode}$`), { timeout: 20_000, waitUntil: "commit" });
        host.socket.emit("oyun_baslat", {
            seciliKategoriler: [categoryId],
            seciliZorluklar: [1],
            ayarlar: { sure: 60, mod: "skor", deger: 10 },
        });

        // A refused start shows up as the host's error code instead of "started".
        await expect.poll(() => (started ? "started" : hostErrors.join(", ") || "waiting"), { timeout: 15_000 }).toBe("started");
        expect(hostErrors).toEqual([]);
        // The start reached the socket before the room page listened; the room request
        // replays the running game, so the guest still lands on the start transition.
        await expect(page.getByRole("heading", { name: /Oyun ba|Game st/i })).toBeVisible({ timeout: 20_000 });

        // Leftover interrupted matches are kept for 30 minutes and count against capacity.
        let backInLobby = false;
        host.socket.once("lobiyeDon", () => {
            backInLobby = true;
        });
        host.socket.emit("oyun_sifirla");
        await expect.poll(() => backInLobby, { timeout: 10_000 }).toBe(true);
        for (const entry of others) entry.socket.disconnect();
    });
});
