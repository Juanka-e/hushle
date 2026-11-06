import { expect, test, type Page } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { closeRedisClient } from "@hushle/platform-cache";
import { prisma } from "@hushle/platform-db";
import { invalidateSystemSettingsCache } from "../apps/web/src/lib/cache/application-cache";
import { dictionaries } from "../apps/web/src/lib/i18n/dictionaries";
import { invalidateCategoryCache } from "../apps/web/src/lib/socket/category-service";

// The host panel (/streamer) end to end against the fake platform: link a channel, open a
// session from the form (its toggle groups are labelled), copy the stream screen address (shown
// masked; each row reveals its own), run rounds with the private card (which can be hidden off
// the page) while the public screen stays wordless, take a test guess and pass; with the channel
// link marked for a reconnect mid-session the panel still opens with a warning and ends the
// session; then, with a session cut short by a restart, the panel shows the "oturum kesildi"
// notice and opens no socket. The server needs STREAMER_FAKE_PLATFORM=1, STREAMER_TOKEN_KEY and
// an OAuth public origin equal to the base URL (STREAMER_OAUTH_PUBLIC_ORIGIN or
// NEXT_PUBLIC_SITE_URL); this process needs DATABASE_URL and STREAMER_TOKEN_KEY. The run seeds
// its own category and words and removes them afterwards.
// Screenshots of the panel land in test-results/streamer-panel/ (git-ignored) for an eye check.

const SHOTS = path.join("test-results", "streamer-panel");
const live = process.env.STREAMER_FAKE_PLATFORM === "1" && Boolean(process.env.STREAMER_TOKEN_KEY);
// The Playwright smoke server takes its cache store from PLAYWRIGHT_REDIS_URL (see
// scripts/start-playwright-smoke-server.ts). Sharing it lets this process clear the server's
// category and settings caches after seeding. A server on a memory cache (no Redis) cannot be
// reached this way: there the polls below wait its TTLs out instead.
if (!process.env.REDIS_URL && process.env.PLAYWRIGHT_REDIS_URL) process.env.REDIS_URL = process.env.PLAYWRIGHT_REDIS_URL;

/** Case-folded the Turkish way and then some (I, ı, İ, i alike), so a word in another case still counts. */
function fold(text: string): string {
    return text.toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/̇/g, "");
}

test.describe("streamer host panel", () => {
    test.skip(!live, "set STREAMER_FAKE_PLATFORM=1 and STREAMER_TOKEN_KEY (and start the server with them) to run");
    test.describe.configure({ mode: "serial" });

    const suffix = randomUUID().slice(0, 8);
    const tag = suffix.toUpperCase();
    const username = `streamer_panel_${suffix}`;
    const password = `Streamer-panel-${suffix}!`;
    // A login of its own, so no other run's fake channel holds the same platform account.
    const channelLogin = `panel-${suffix}`;
    const channelName = `Panel-${suffix}`;
    const categoryName = `E2E Yayın ${suffix}`;
    // Three rounds are played; one word to spare so no round deals a word twice.
    const cards = ["ZEPLIN", "PUSULA", "FENER", "DUMEN"].map((word, index) => ({
        target: `${word}${tag}`,
        taboos: [1, 2, 3, 4, 5].map((n) => `YASAK${index}${n}${tag}`),
    }));
    let userId: number | null = null;
    let categoryId: number | null = null;
    let originalFeatures: unknown = undefined;
    let interruptedSessionId: string | null = null;

    async function setStreamerMode(on: boolean): Promise<void> {
        const current = await prisma.systemSetting.findUnique({ where: { key: "features" } });
        const value = { ...((current?.value as Record<string, unknown> | null) ?? {}), streamerModeEnabled: on };
        await prisma.systemSetting.upsert({ where: { key: "features" }, update: { value }, create: { key: "features", value } });
    }

    async function login(page: Page): Promise<void> {
        await page.goto("/login");
        await page.getByPlaceholder(/Kullanıcı Adı/i).fill(username);
        await page.getByPlaceholder(/Parola/i).fill(password);
        await page.getByRole("button", { name: /^Giriş Yap$/i }).click();
        await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    }

    async function readClipboard(page: Page): Promise<string> {
        return page.evaluate(() => navigator.clipboard.readText());
    }

    /** No address field's value and no href anywhere on the page holds the key. */
    async function expectKeyHidden(target: Page, key: string): Promise<void> {
        const values = await target
            .getByTestId("streamer-obs")
            .getByRole("textbox")
            .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
        expect(values.length).toBeGreaterThan(0);
        expect(values.filter((value) => value.includes(key))).toEqual([]);
        const hrefs = await target.locator("[href]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
        expect(hrefs.filter((href) => href.includes(key))).toEqual([]);
    }

    /** None of the card's words (target and every taboo), in any case, is in the page's HTML. */
    async function expectWordless(target: Page, card: { target: string; taboos: string[] }, label: string): Promise<void> {
        const content = fold(await target.content());
        for (const word of [card.target, ...card.taboos]) expect(content.includes(fold(word)), `${label} shows ${word}`).toBe(false);
    }

    function cardOf(target: string) {
        const card = cards.find((entry) => entry.target === target);
        expect(card, `the dealt word ${target} is one of this run's words`).toBeTruthy();
        return card!;
    }

    test.beforeAll(async () => {
        const existing = await prisma.systemSetting.findUnique({ where: { key: "features" } });
        originalFeatures = existing ? existing.value : undefined;
        const user = await prisma.user.create({
            data: { username, password: await bcryptjs.hash(password, 10) },
            select: { id: true },
        });
        userId = user.id;
        const category = await prisma.category.create({
            data: { name: categoryName, locale: "tr", isVisible: true, sortOrder: -1000 },
            select: { id: true },
        });
        categoryId = category.id;
        for (const card of cards) {
            await prisma.word.create({
                data: {
                    wordText: card.target,
                    locale: "tr",
                    difficulty: 1,
                    tabooWords: { create: card.taboos.map((tabooWordText) => ({ tabooWordText })) },
                    wordCategories: { create: { categoryId: category.id } },
                },
            });
        }
        await setStreamerMode(true);
        // The new category and the switched-on mode reach a server sharing this cache store at once.
        await Promise.all([invalidateCategoryCache(), invalidateSystemSettingsCache()]);
    });

    test.afterAll(async () => {
        if (originalFeatures === undefined) {
            await prisma.systemSetting.deleteMany({ where: { key: "features" } });
        } else {
            await prisma.systemSetting.update({ where: { key: "features" }, data: { value: originalFeatures as object } });
        }
        if (interruptedSessionId !== null) await prisma.streamSession.deleteMany({ where: { id: interruptedSessionId } });
        if (userId !== null) {
            await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
            // Sessions, round results and the channel link go with the user.
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await prisma.word.deleteMany({ where: { locale: "tr", wordText: { in: cards.map((card) => card.target) } } });
        if (categoryId !== null) await prisma.category.deleteMany({ where: { id: categoryId } });
        await Promise.all([invalidateCategoryCache(), invalidateSystemSettingsCache()]);
        await closeRedisClient();
        await prisma.$disconnect();
    });

    test("sets up a session, hands out the stream address and runs the rounds", async ({ page }) => {
        // On a server this process cannot clear the caches of (memory cache), the settings cache
        // (15 s TTL) and the category cache (60 s TTL) may each be waited out once.
        test.setTimeout(150_000);
        await login(page);
        await expect
            .poll(
                async () => {
                    const response = await page.request.get("/api/streamer/connections");
                    return response.ok() ? ((await response.json()) as { enabled: boolean }).enabled : false;
                },
                { timeout: 40_000, intervals: [1_000] }
            )
            .toBe(true);

        // Link a fake Twitch channel under this run's own login (the phase-1 flow).
        const start = await page.request.get("/api/streamer/connect/twitch/start", { maxRedirects: 0 });
        expect(start.status()).toBe(302);
        const authorize = new URL(start.headers().location, page.url());
        authorize.searchParams.set("login", channelLogin);
        await page.goto(authorize.toString());
        await page.waitForURL(/streamer=linked/, { timeout: 30_000 });

        const origin = new URL(page.url()).origin;
        await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });

        try {
            // ---------------------------------------------------------------- setup form
            await page.goto("/streamer");
            await expect(page.getByRole("heading", { name: "Kanal hazır" })).toBeVisible({ timeout: 20_000 });
            await expect(page.getByText(`${channelName} (Twitch) bağlı.`)).toBeVisible();
            const setup = page.getByTestId("streamer-setup");
            await expect(setup).toBeVisible();
            const categoryChip = setup.getByRole("button", { name: categoryName, exact: true });
            // Fallback only: a server on its own memory cache may still list the categories from
            // before this run's one (the invalidation in beforeAll reaches a shared store only).
            await expect
                .poll(
                    async () => {
                        if (await categoryChip.isVisible()) return true;
                        await page.reload();
                        await setup.waitFor();
                        return categoryChip.isVisible();
                    },
                    { timeout: 70_000, intervals: [2_000, 5_000] }
                )
                .toBe(true);
            // The form is server-rendered: a click before hydration does nothing, so the first one is retried.
            await expect(async () => {
                await setup.getByRole("button", { name: "Seçimi temizle" }).click();
                await expect(categoryChip).toHaveAttribute("aria-pressed", "false", { timeout: 1_000 });
            }).toPass({ timeout: 20_000 });
            await categoryChip.click();
            await expect(categoryChip).toHaveAttribute("aria-pressed", "true");
            // Every toggle group is a group named by its label.
            for (const name of ["Kanal", "Kelime dili", "Kategoriler", "Zorluk", "Tur süresi", "Tahmin kontrolü"]) {
                const group = setup.getByRole("group", { name, exact: true });
                await expect(group, `the ${name} group`).toHaveCount(1);
                await expect(group.locator("button[aria-pressed]").first()).toBeVisible();
            }
            await expect(setup.getByRole("group", { name: "Kategoriler", exact: true }).getByRole("button", { name: categoryName, exact: true })).toBeVisible();
            const thirty = setup.getByRole("group", { name: "Tur süresi", exact: true }).getByRole("button", { name: "30 sn", exact: true });
            await thirty.click();
            await expect(thirty).toHaveAttribute("aria-pressed", "true");
            await page.screenshot({ path: path.join(SHOTS, "setup.png"), fullPage: true });
            await setup.getByRole("button", { name: "Oturumu aç" }).click();

            // ---------------------------------------------------------------- OBS box
            const obs = page.getByTestId("streamer-obs");
            await expect(obs).toBeVisible({ timeout: 20_000 });
            const fullRow = obs.getByTestId("streamer-url-full");
            const halfRow = obs.getByTestId("streamer-url-half");
            const rows: Array<[string, string]> = [
                ["streamer-url-full", ""],
                ["streamer-url-half", "?layout=half"],
                ["streamer-url-strip-top", "?overlay=top"],
                ["streamer-url-strip-bottom", "?overlay=bottom"],
            ];
            // Masked by default: a captured display never shows the key.
            const masked = `${origin}/stream/••••••`;
            for (const [testId, query] of rows) await expect(obs.getByTestId(testId).getByRole("textbox")).toHaveValue(`${masked}${query}`);
            // A masked field is never selected on focus: a copy by hand would copy the dots.
            const fullBox = fullRow.getByRole("textbox");
            const selectedLength = () => fullBox.evaluate((input) => (input as HTMLInputElement).selectionEnd! - (input as HTMLInputElement).selectionStart!);
            await fullBox.focus();
            expect(await selectedLength()).toBe(0);
            // Nor by a mouse drag across it, a double click or Ctrl+A.
            const fullBounds = (await fullBox.boundingBox())!;
            await page.mouse.move(fullBounds.x + 4, fullBounds.y + fullBounds.height / 2);
            await page.mouse.down();
            await page.mouse.move(fullBounds.x + fullBounds.width - 4, fullBounds.y + fullBounds.height / 2, { steps: 8 });
            await page.mouse.up();
            await expect.poll(selectedLength, { message: "a drag selects nothing in a masked field" }).toBe(0);
            await fullBox.dblclick();
            await expect.poll(selectedLength, { message: "a double click selects nothing" }).toBe(0);
            await fullBox.press("ControlOrMeta+A");
            await expect.poll(selectedLength, { message: "select-all selects nothing" }).toBe(0);
            expect(await fullBox.getAttribute("draggable")).toBe("false");
            await fullRow.getByRole("button", { name: "Kopyala" }).click();
            await expect(fullRow.getByRole("button", { name: "Kopyalandı" })).toBeVisible();
            // Copy takes the real address without revealing it.
            const firstUrl = await readClipboard(page);
            expect(firstUrl).toMatch(new RegExp(`^${origin}/stream/[A-Za-z0-9_-]{43}$`));
            const firstKey = firstUrl.slice(firstUrl.lastIndexOf("/") + 1);
            for (const [testId, query] of rows) await expect(obs.getByTestId(testId).getByRole("textbox")).toHaveValue(`${masked}${query}`);
            await expectKeyHidden(page, firstKey);
            // Each row's toggle, named with its row, reveals that row only; shown, focus selects the
            // whole real address; hiding masks it again.
            await halfRow.getByRole("button", { name: "Adresi göster: Yarım ekran", exact: true }).click();
            const halfBox = halfRow.getByRole("textbox");
            await expect(halfBox).toHaveValue(`${firstUrl}?layout=half`);
            await halfBox.focus();
            expect(await halfBox.evaluate((input) => [(input as HTMLInputElement).selectionStart, (input as HTMLInputElement).selectionEnd])).toEqual([
                0,
                `${firstUrl}?layout=half`.length,
            ]);
            await expect(fullBox).toHaveValue(masked);
            await halfRow.getByRole("button", { name: "Adresi gizle: Yarım ekran", exact: true }).click();
            await expect(halfBox).toHaveValue(`${masked}?layout=half`);
            await expectKeyHidden(page, firstKey);
            // The preview is a button that opens the real address in a full new tab (stubbed here).
            await expect(obs.getByRole("link")).toHaveCount(0);
            await page.evaluate(() => {
                const opened: unknown[][] = [];
                (window as unknown as { __opened: unknown[][] }).__opened = opened;
                window.open = ((...args: unknown[]) => {
                    opened.push(args);
                    return null;
                }) as typeof window.open;
            });
            await obs.getByRole("button", { name: "Yeni sekmede önizle" }).click();
            expect(await page.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened)).toEqual([
                [firstUrl, "_blank", "noopener,noreferrer"],
            ]);

            // A reload never shows the key again: the server keeps only its hash, the page keeps nothing.
            await page.reload();
            await expect(obs.getByText("Adres yalnız oluşturulduğunda gösterilir. Yeniden görmek için yeni anahtar üret.")).toBeVisible({
                timeout: 20_000,
            });
            expect(await page.content()).not.toContain(firstKey);
            page.once("dialog", (dialog) => void dialog.accept());
            await obs.getByRole("button", { name: "Yeni anahtar üret" }).click();
            await expect(fullRow.getByRole("button", { name: "Kopyala" })).toBeVisible({ timeout: 10_000 });
            await fullRow.getByRole("button", { name: "Kopyala" }).click();
            await expect(fullRow.getByRole("button", { name: "Kopyalandı" })).toBeVisible();
            const url = await readClipboard(page);
            expect(url).toMatch(new RegExp(`^${origin}/stream/[A-Za-z0-9_-]{43}$`));
            expect(url).not.toBe(firstUrl);
            await expect(fullRow.getByRole("textbox")).toHaveValue(masked);
            await expectKeyHidden(page, url.slice(url.lastIndexOf("/") + 1));
            await fullRow.getByRole("button", { name: "Adresi göster: Tam ekran", exact: true }).click();
            await expect(fullRow.getByRole("textbox")).toHaveValue(url);
            await fullRow.getByRole("button", { name: "Adresi gizle: Tam ekran", exact: true }).click();

            // ---------------------------------------------------------------- the stream screen
            const screen = await page.context().newPage();
            await screen.goto(url);
            const root = screen.locator("main.hushle-stream");
            await expect(root).toHaveAttribute("data-phase", "ready", { timeout: 15_000 });
            await expect(screen.locator("#channel")).toHaveText(`@${channelLogin} · Twitch`);
            await expect(screen.locator("#seconds-note")).toHaveText("30 sn");

            // A live look change reaches the stream screen; the OBS box gives the camera hole in 1080p and 720p.
            await page.getByLabel("Kamera yeri").selectOption("tl");
            await expect(root).toHaveAttribute("data-camera", "tl", { timeout: 10_000 });
            await expect(page.getByLabel("Kamera yeri")).toHaveValue("tl");
            const cameraRect = obs.getByTestId("streamer-camera-rect");
            await expect(cameraRect).toContainText("1080p: konum 70, 70 · boyut 560 × 315");
            await expect(cameraRect).toContainText("720p: konum 47, 47 · boyut 373 × 210");

            // ---------------------------------------------------------------- round 1: a correct guess
            const controls = page.getByTestId("streamer-controls");
            const secretCard = page.getByTestId("streamer-card");
            const log = page.getByTestId("streamer-log");
            await controls.getByRole("button", { name: "Turu başlat" }).click();
            await expect(secretCard.getByText("Yayına verme — gizli")).toBeVisible();
            const targetOf = secretCard.getByTestId("streamer-card-target");
            await expect(targetOf).not.toBeEmpty({ timeout: 10_000 });
            const first = cardOf((await targetOf.innerText()).trim());
            await expect(secretCard.getByTestId("streamer-card-taboos").locator("li")).toHaveCount(5);
            await expect(root).toHaveAttribute("data-phase", "running", { timeout: 10_000 });
            await expectWordless(screen, first, "round 1's stream screen");
            await expect(log.getByText("1. tur başladı")).toBeVisible();
            await page.screenshot({ path: path.join(SHOTS, "running.png"), fullPage: true });
            // Hidden, the card's words leave the panel page itself; shown again, they are back.
            await secretCard.getByRole("button", { name: "Kartı gizle" }).click();
            await expect(secretCard.getByTestId("streamer-card-hidden")).toBeVisible();
            await expect(targetOf).toHaveCount(0);
            await expect(secretCard.getByTestId("streamer-card-taboos")).toHaveCount(0);
            await expectWordless(page, first, "the panel with the card hidden");
            await secretCard.getByRole("button", { name: "Kartı göster" }).click();
            await expect(targetOf).toHaveText(first.target);
            await expect(secretCard.getByTestId("streamer-card-taboos").locator("li")).toHaveCount(5);

            const guess = await page.request.post("/api/streamer/sessions/current/test-guess", {
                headers: { origin },
                data: { name: "Deniz", text: first.target },
            });
            expect(guess.status()).toBe(200);
            expect(((await guess.json()) as { result: string }).result).toBe("correct");
            await expect(root).toHaveAttribute("data-phase", "finished", { timeout: 10_000 });
            await expect(screen.locator("#verdict-word")).toHaveText("Bildi!");
            await expect(screen.locator("#verdict-detail")).toContainText("Deniz");
            await expect(screen.locator("#last-name")).toHaveText("Deniz", { timeout: 5_000 });
            await expect(log.getByText(`Deniz bildi: ${first.target}`)).toBeVisible();
            const scores = page.getByTestId("streamer-scores");
            await expect(scores.getByRole("listitem").filter({ hasText: "Deniz" })).toContainText("1 puan");
            await page.screenshot({ path: path.join(SHOTS, "solved.png"), fullPage: true });

            // ---------------------------------------------------------------- round 2: pass
            await controls.getByRole("button", { name: "Sonraki kart" }).click();
            await expect(log.getByText("2. tur başladı")).toBeVisible({ timeout: 10_000 });
            const second = cardOf((await targetOf.innerText()).trim());
            expect(second.target).not.toBe(first.target);
            await expect(root).toHaveAttribute("data-phase", "running", { timeout: 10_000 });
            await expectWordless(screen, second, "round 2's stream screen");
            await controls.getByRole("button", { name: "Pas geç" }).click();
            await expect(log.getByText(`2. tur pas geçildi: ${second.target}`)).toBeVisible({ timeout: 10_000 });
            await expect(screen.locator("#verdict")).toHaveAttribute("data-kind", "pass", { timeout: 10_000 });
            await expect(screen.locator("#verdict-detail")).toHaveText(second.target);
            // Round 3 runs: its word is on the panel only.
            await expect(log.getByText("3. tur başladı")).toBeVisible();
            const third = cardOf((await targetOf.innerText()).trim());
            await expectWordless(screen, third, "round 3's stream screen");

            // ---------------------------------------------------------------- channel link goes bad mid-session
            // The hourly check marks the link for a reconnect; the session keeps running. After a
            // reload the gate still opens the panel (with the warning) so the session can be ended.
            await prisma.streamerConnection.updateMany({
                where: { userId: userId!, platform: "twitch" },
                data: { status: "needs_reconnect", statusReason: "refresh_failed" },
            });
            await page.reload();
            const warning = page.getByTestId("streamer-reconnect-warning");
            await expect(warning).toBeVisible({ timeout: 20_000 });
            await expect(warning).toContainText("Kanal bağlantın yenilenmeli; bu yayın sürüyor, yeni oturum için ayarlardan yeniden bağlan.");
            await expect(warning.getByRole("link", { name: "Ayarlar'a git" })).toHaveAttribute("href", "/dashboard?tab=settings");
            await expect(page.getByRole("heading", { name: "Kanal bağlantını yenile" })).toBeVisible();
            // The live controls stay: the host room is joined again, the round still runs.
            await expect(page.getByText("Bağlı", { exact: true })).toBeVisible({ timeout: 15_000 });
            await expect(controls.getByRole("button", { name: "Pas geç" })).toBeVisible();
            await expect(targetOf).toHaveText(third.target);
            await page.screenshot({ path: path.join(SHOTS, "reconnect-warning.png"), fullPage: true });

            // ---------------------------------------------------------------- end: summary and finale
            page.once("dialog", (dialog) => void dialog.accept());
            await controls.getByRole("button", { name: "Oturumu bitir" }).click();
            const summary = page.getByTestId("streamer-summary");
            await expect(summary).toBeVisible({ timeout: 15_000 });
            await expect(summary.getByRole("heading", { name: "Oturum özeti" })).toBeVisible();
            await expect(summary.getByTestId("streamer-summary-winner")).toContainText("Deniz");
            await expect(summary.getByRole("listitem").filter({ hasText: "Deniz" })).toContainText("1 puan");
            await expect(summary.getByText("1 kişi katıldı")).toBeVisible();
            // The stored summary (the end answer): a solved and a passed round; the running third never finished.
            await expect(summary.getByText("2 tur oynandı")).toBeVisible();
            await page.screenshot({ path: path.join(SHOTS, "summary.png"), fullPage: true });
            await expect(root).toHaveAttribute("data-phase", "ended", { timeout: 10_000 });
            await expect(screen.locator("#winner")).toBeVisible();
            await expect(screen.locator("#winner-name")).toHaveText("Deniz");
            await expect(page.getByRole("button", { name: "Yeni oturum aç" })).toBeVisible();
            await screen.close();
        } finally {
            // A failed run must not leave its session live on the server.
            await page.request.post("/api/streamer/sessions/current/end", { headers: { origin } }).catch(() => undefined);
            // The next test opens the panel through the gate: the link is active again.
            await prisma.streamerConnection.updateMany({ where: { userId: userId!, platform: "twitch" }, data: { status: "active", statusReason: null } });
        }
    });

    test("a session cut short by a restart shows the interrupted notice and opens no host room", async ({ page }) => {
        test.setTimeout(60_000);
        expect(userId).not.toBeNull();
        expect(categoryId).not.toBeNull();
        // The panel needs the channel the first test linked (serial: this test runs after it).
        const channel = await prisma.streamerConnection.findFirst({ where: { userId: userId!, platform: "twitch" }, select: { id: true } });
        expect(channel, "the first test linked a Twitch channel").toBeTruthy();
        // The row as boot reconciliation leaves it: the user's newest session, `interrupted`, with an end time.
        const now = new Date();
        const row = await prisma.streamSession.create({
            data: {
                userId: userId!,
                connectionId: channel!.id,
                platform: "twitch",
                status: "interrupted",
                settings: {
                    platform: "twitch",
                    language: "tr",
                    categoryIds: [categoryId!],
                    difficulties: [1],
                    duration: 30,
                    tolerance: "normal",
                    theme: "studyo",
                    camera: "br",
                    cameraSize: "m",
                    clock: null,
                    cardBack: null,
                    showCardName: true,
                },
                viewKeyHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
                startedAt: now,
                endedAt: now,
                roundCount: 1,
            },
            select: { id: true },
        });
        interruptedSessionId = row.id;

        await login(page);
        // Only the live view opens a Socket.IO connection (for the host room): none may start on
        // this page, over either transport. The dev server's own HMR websocket is not one.
        const socketTraffic: string[] = [];
        const isSocketIo = (url: string) => new URL(url).pathname.startsWith("/api/socketio");
        page.on("websocket", (socket) => {
            if (isSocketIo(socket.url())) socketTraffic.push(`websocket ${socket.url()}`);
        });
        page.on("request", (request) => {
            if (isSocketIo(request.url())) socketTraffic.push(`request ${request.url()}`);
        });
        await page.goto("/streamer");
        const text = dictionaries.tr.streamer.panel;
        await expect(page.getByRole("heading", { name: text.interruptedTitle })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(text.interruptedHelp)).toBeVisible();
        const fresh = page.getByRole("button", { name: text.newSession });
        await expect(fresh).toBeVisible();
        await expect(page.getByTestId("streamer-controls")).toHaveCount(0);
        // The connection badge of the live view ("Bağlı" is also inside the channel line, hence exact).
        for (const badge of [text.connecting, text.connected, text.reconnecting]) {
            await expect(page.getByText(badge, { exact: true })).toHaveCount(0);
        }
        await page.screenshot({ path: path.join(SHOTS, "interrupted.png"), fullPage: true });
        // Once hydrated the button leads to the form; by then the page has run its effects without a socket.
        await expect(async () => {
            await fresh.click({ timeout: 2_000 });
            await expect(page.getByTestId("streamer-setup")).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 20_000 });
        expect(socketTraffic, "no socket was opened, so no host join was attempted").toEqual([]);
    });
});
