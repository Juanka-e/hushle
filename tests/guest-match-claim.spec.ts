import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@hushle/platform-db";

// A guest finishes a real match in the browser and moves it to an account from the
// game-over screen. Run with playwright.guest-claim.config.ts (smoke server, tabu_test).
const enabled = process.env.GUEST_CLAIM_UI_E2E === "true";
const screenshotDir = process.env.GUEST_CLAIM_SCREENSHOT_DIR ?? "test-results/guest-match-claim";
const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3201";

test.describe.configure({ mode: "serial" });

test.describe("guest match claim", () => {
    test.skip(!enabled, "GUEST_CLAIM_UI_E2E=true is required");

    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const memberName = `claim_member_${suffix}`;
    const memberPassword = `Claim-member-${suffix}!`;
    const signupName = `claim_new_${suffix}`;
    let categoryId: number | null = null;
    let memberId: number | null = null;
    const contexts: BrowserContext[] = [];
    const sockets: Socket[] = [];
    const roomCodes: string[] = [];

    test.beforeAll(async () => {
        mkdirSync(screenshotDir, { recursive: true });
        const category = await prisma.category.create({
            data: { name: `Guest claim UI ${suffix}`, color: "#16a34a", sortOrder: 999_200, isVisible: true },
        });
        categoryId = category.id;
        for (let index = 1; index <= 6; index += 1) {
            const word = await prisma.word.create({
                data: {
                    wordText: `claimui_${suffix}_${index}`,
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
        await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
        if (roomCodes.length > 0) await prisma.matchSettlement.deleteMany({ where: { roomCode: { in: roomCodes } } });
        const users = await prisma.user.findMany({ where: { username: { in: [memberName, signupName] } }, select: { id: true } });
        const ids = users.map((user) => user.id);
        if (ids.length > 0) {
            await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
            await prisma.guestProgress.deleteMany({ where: { linkedUserId: { in: ids } } });
            await prisma.user.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.word.deleteMany({ where: { wordText: { startsWith: `claimui_${suffix}_` } } });
        if (categoryId !== null) await prisma.category.deleteMany({ where: { id: categoryId } });
        await prisma.$disconnect();
    });

    const desktop = { width: 1280, height: 860 };
    const phone = { width: 390, height: 844 };

    function socketGuest(name: string, roomCode?: string): Promise<{ socket: Socket; roomCode: string }> {
        return new Promise((resolve, reject) => {
            const socket = io(baseURL, {
                path: "/api/socketio",
                transports: ["websocket"],
                forceNew: true,
                reconnection: false,
                extraHeaders: { Origin: baseURL },
            });
            sockets.push(socket);
            const timer = setTimeout(() => reject(new Error(`${name} join timed out`)), 20_000);
            socket.on("connect", () => socket.emit("room:request", { kullaniciAdi: name, ...(roomCode ? { odaKodu: roomCode } : {}) }));
            socket.once("lobiGuncelle", (lobby: { odaKodu: string }) => {
                clearTimeout(timer);
                resolve({ socket, roomCode: lobby.odaKodu });
            });
            socket.on("connect_error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }

    async function browserGuest(
        browser: Browser,
        name: string,
        roomCode: string,
        viewport = desktop,
        lobbyView = true
    ): Promise<Page> {
        const context = await browser.newContext({ viewport, hasTouch: viewport === phone });
        contexts.push(context);
        const page = await context.newPage();
        await page.goto("/");
        await page.getByPlaceholder(/Adınızı girin|Enter your name/i).fill(name);
        await page.getByPlaceholder(/Örn: ABC123|E.g.: ABC123/i).fill(roomCode);
        await page.getByRole("button", { name: /^Katıl$|^Join$/i }).click();
        await expect(page).toHaveURL(new RegExp(`/room/${roomCode}$`), { timeout: 20_000 });
        if (lobbyView) {
            // Team lists sit in drawers on phones, so readiness is checked on the lobby header.
            await expect(page.getByRole("button", { name: new RegExp(`/room/.*${roomCode}`) })).toBeVisible({ timeout: 20_000 });
        }
        return page;
    }

    type LobbyPlayer = { ad: string; rol: string; takim: "A" | "B" | null; online?: boolean };

    /** Resolves once the server lists `name` in the room, whatever screen the room shows. */
    function lobbyIncludes(socket: Socket, name: string): Promise<LobbyPlayer> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${name} never reached the room`)), 20_000);
            const onLobby = (lobby: { oyuncular: LobbyPlayer[] }) => {
                const player = lobby.oyuncular.find((entry) => entry.ad === name);
                if (!player) return;
                clearTimeout(timer);
                socket.off("lobiGuncelle", onLobby);
                resolve(player);
            };
            socket.on("lobiGuncelle", onLobby);
        });
    }

    /** Resolves on the next lobby update that lists `count` seated players online. */
    function lobbyHasOnlineSeats(socket: Socket, count: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                socket.off("lobiGuncelle", onLobby);
                reject(new Error(`the lobby never listed ${count} seated players online`));
            }, 20_000);
            const onLobby = (lobby: { oyuncular: LobbyPlayer[] }) => {
                const seated = lobby.oyuncular.filter(
                    (entry) => entry.online !== false && entry.rol !== "İzleyici" && (entry.takim === "A" || entry.takim === "B")
                );
                if (seated.length < count) return;
                clearTimeout(timer);
                socket.off("lobiGuncelle", onLobby);
                resolve();
            };
            socket.on("lobiGuncelle", onLobby);
        });
    }

    /**
     * Rejects with `describe()` when `promise` is still pending after `ms`. Socket events
     * have no built-in timeout, so a lost one would otherwise hang until the test timeout
     * with no hint of where the match stopped.
     */
    function within<T>(promise: Promise<T>, ms: number, describe: () => string): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(describe())), ms);
        });
        return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
    }

    /** 2v2 with the browser guest in seat two; plays to the score target and waits for game over. */
    async function playMatch(
        browser: Browser,
        tag: string,
        viewport = desktop,
        duringMatch?: (roomCode: string, host: Socket) => Promise<void>
    ) {
        const host = await socketGuest(`Host${tag}${suffix}`);
        const roomCode = host.roomCode;
        roomCodes.push(roomCode);
        // Kept for failure messages: a refused start or a stalled score explains a missing event.
        const hostErrors: string[] = [];
        let lastScore = "none";
        host.socket.on("hata", (message: unknown, meta?: { code?: string }) => {
            hostErrors.push(meta?.code ?? String(message));
        });
        host.socket.on("oyunDurumuGuncelle", (state: { skor?: { A: number; B: number } }) => {
            if (state.skor) lastScore = `A ${state.skor.A} - B ${state.skor.B}`;
        });
        const context = () => `room ${roomCode}, score ${lastScore}, host errors: ${hostErrors.join(", ") || "none"}`;
        const playerName = `Misafir${tag}${suffix}`;
        const joined = lobbyIncludes(host.socket, playerName);
        const player = await browserGuest(browser, playerName, roomCode, viewport);
        await joined;
        const others = [await socketGuest(`Ali${tag}${suffix}`, roomCode), await socketGuest(`Ayse${tag}${suffix}`, roomCode)];
        const seats = [host.socket, ...others.map((entry) => entry.socket)];
        const roles = Promise.all(
            seats.map(
                (socket) =>
                    new Promise<[Socket, string]>((resolve) =>
                        socket.once("yeniTurBilgisi", (turn: { rol: string }) => resolve([socket, turn.rol]))
                    )
            )
        );
        const gameOver = new Promise<void>((resolve) => host.socket.once("oyunBitti", () => resolve()));
        const startGame = () =>
            host.socket.emit("oyun_baslat", {
                seciliKategoriler: [categoryId],
                seciliZorluklar: [1],
                ayarlar: { sure: 60, mod: "skor", deger: 10 },
            });
        // The browser guest joins through the home page socket and rejoins from the room page,
        // so it can be offline for a moment after the host first lists it (seen in CI as
        // NOT_ENOUGH_PLAYERS). Like a host pressing Start again, a refused start is sent again
        // once the lobby lists the four seats online.
        let startRetries = 0;
        const retryRefusedStart = (_message: unknown, meta?: { code?: string }) => {
            if (meta?.code !== "NOT_ENOUGH_PLAYERS" || startRetries >= 3) return;
            startRetries += 1;
            void lobbyHasOnlineSeats(host.socket, 4).then(startGame).catch(() => undefined);
        };
        host.socket.on("hata", retryRefusedStart);
        startGame();
        // The start transition alone takes about ten seconds.
        const turnRoles = await within(roles, 30_000, () => `first turn roles never arrived (${context()})`);
        host.socket.off("hata", retryRefusedStart);
        const narrator = turnRoles.find(([, role]) => role === "Anlatıcı")?.[0] ?? null;
        await duringMatch?.(roomCode, host.socket);
        let over = false;
        void gameOver.then(() => {
            over = true;
        });
        // The server ignores narrator actions closer than 200 ms apart.
        let attempts = 0;
        for (; attempts < 40 && !over; attempts += 1) {
            if (narrator) {
                narrator.emit("oyunVerisi", { eylem: "dogru" });
            } else {
                await player.getByRole("button", { name: /^DOĞRU$|^CORRECT$/i }).click({ timeout: 5_000 });
            }
            await player.waitForTimeout(300);
        }
        await within(
            gameOver,
            30_000,
            () => `game over never arrived after ${attempts} correct answers by the ${narrator ? "socket" : "browser"} narrator (${context()})`
        );
        return { player, roomCode, host: host.socket };
    }

    test("a guest signs in from the game-over card and keeps the match", async ({ browser }) => {
        let watcher: Page | null = null;
        const { player, roomCode, host } = await playMatch(browser, "L", desktop, async (code, hostSocket) => {
            // Joins mid-match, so the server seats this guest as a spectator.
            const seated = lobbyIncludes(hostSocket, `Izleyici${suffix}`);
            watcher = await browserGuest(browser, `Izleyici${suffix}`, code, desktop, false);
            expect((await seated).rol).toBe("İzleyici");
        });
        const card = player.getByTestId("game-over-guest-claim");
        await expect(card).toBeVisible({ timeout: 20_000 });
        await expect(card).toContainText("Bu maç hesabına geçsin");
        await expect(card).toContainText("kazandığın coin");
        await player.screenshot({ path: join(screenshotDir, "01-game-over-desktop.png"), animations: "disabled" });

        // Guests who only watched, or arrived after the end, are not offered the move.
        const spectator = watcher as Page | null;
        expect(spectator).not.toBeNull();
        await expect(spectator!.getByText(/KAZANAN|BERABERE|SONUÇ/).first()).toBeVisible({ timeout: 20_000 });
        await expect(spectator!.getByTestId("game-over-guest-claim")).toHaveCount(0);
        const arrived = lobbyIncludes(host, `Gec${suffix}`);
        const latecomer = await browserGuest(browser, `Gec${suffix}`, roomCode, desktop, false);
        await arrived;
        await latecomer.waitForTimeout(1_500);
        await expect(latecomer.getByTestId("game-over-guest-claim")).toHaveCount(0);

        await card.getByRole("button", { name: "Giriş yap" }).click();
        await expect(player).toHaveURL(new RegExp(`/login\\?callbackUrl=%2Froom%2F${roomCode}$`), { timeout: 15_000 });
        await player.getByPlaceholder(/Kullanıcı adı/i).fill(memberName);
        await player.getByPlaceholder(/Parola/i).fill(memberPassword);
        await player.getByRole("button", { name: /^Giriş Yap$/i }).click();
        await expect(player).toHaveURL(new RegExp(`/room/${roomCode}$`), { timeout: 20_000 });
        await expect(player.getByText(/1 maç hesabına eklendi/)).toBeVisible({ timeout: 20_000 });

        const results = await prisma.matchResult.findMany({ where: { userId: memberId!, roomCode } });
        expect(results).toHaveLength(1);
        await expect
            .poll(() => player.evaluate(() => window.sessionStorage.getItem("tabu_pendingGuestClaim")))
            .toBeNull();
        // A reload must not claim or announce again.
        await player.reload();
        await expect(player.getByText(/maç hesabına eklendi/)).toHaveCount(0);
        expect(await prisma.matchResult.count({ where: { userId: memberId!, roomCode } })).toBe(1);
    });

    test("a guest signs up on a phone and the match moves with the new account", async ({ browser }) => {
        const { player, roomCode } = await playMatch(browser, "R", phone);
        const card = player.getByTestId("game-over-guest-claim");
        await expect(card).toBeVisible({ timeout: 20_000 });
        await card.scrollIntoViewIfNeeded();
        await expect(card.getByRole("button", { name: "Kayıt ol" })).toBeInViewport();
        await expect
            .poll(() => player.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
            .toBe(true);
        await player.screenshot({ path: join(screenshotDir, "02-game-over-phone.png"), animations: "disabled" });

        await card.getByRole("button", { name: "Kayıt ol" }).click();
        await expect(player).toHaveURL(/\/register$/, { timeout: 15_000 });
        await player.getByPlaceholder(/Kullanıcı adı/i).fill(signupName);
        await player.getByPlaceholder(/E-posta/i).fill(`${signupName}@example.test`);
        await player.getByPlaceholder(/Parola/i).fill(`Telefon-kayit ${suffix} vapur 2026!`);
        await player.getByRole("button", { name: /^Kayıt Ol$/i }).click();
        await expect(player.getByText(/1 maç hesabına eklendi/)).toBeVisible({ timeout: 20_000 });
        await expect(player).toHaveURL(/\/login$/, { timeout: 15_000 });
        await player.screenshot({ path: join(screenshotDir, "03-after-signup-phone.png"), animations: "disabled" });

        const user = await prisma.user.findUniqueOrThrow({ where: { username: signupName } });
        const results = await prisma.matchResult.findMany({ where: { userId: user.id, roomCode } });
        expect(results).toHaveLength(1);
        expect(await player.evaluate(() => window.sessionStorage.getItem("tabu_pendingGuestClaim"))).toBeNull();
    });
});
