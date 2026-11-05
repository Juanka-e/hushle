import { expect, test, type Page } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { prisma } from "@hushle/platform-db";

// The host panel (/streamer) end to end against the fake platform: link a channel, open a
// session from the form, copy the stream screen address, run rounds with the private card while
// the public screen stays wordless, take a test guess, pass and end. The server needs
// STREAMER_FAKE_PLATFORM=1, STREAMER_TOKEN_KEY and an OAuth public origin equal to the base URL
// (STREAMER_OAUTH_PUBLIC_ORIGIN or NEXT_PUBLIC_SITE_URL); this process needs DATABASE_URL and
// STREAMER_TOKEN_KEY. The run seeds its own category and words and removes them afterwards.
// Screenshots of the panel land in test-results/streamer-panel/ (git-ignored) for an eye check.

const SHOTS = path.join("test-results", "streamer-panel");
const live = process.env.STREAMER_FAKE_PLATFORM === "1" && Boolean(process.env.STREAMER_TOKEN_KEY);

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
    });

    test.afterAll(async () => {
        if (originalFeatures === undefined) {
            await prisma.systemSetting.deleteMany({ where: { key: "features" } });
        } else {
            await prisma.systemSetting.update({ where: { key: "features" }, data: { value: originalFeatures as object } });
        }
        if (userId !== null) {
            await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
            // Sessions, round results and the channel link go with the user.
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await prisma.word.deleteMany({ where: { locale: "tr", wordText: { in: cards.map((card) => card.target) } } });
        if (categoryId !== null) await prisma.category.deleteMany({ where: { id: categoryId } });
        await prisma.$disconnect();
    });

    test("sets up a session, hands out the stream address and runs the rounds", async ({ page }) => {
        // The settings cache (15 s TTL) and the category cache (60 s TTL) may each be waited out once.
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
            // The visible-category cache may still hold the list from before this run's category.
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
            await setup.getByRole("button", { name: "30 sn", exact: true }).click();
            await expect(setup.getByRole("button", { name: "30 sn", exact: true })).toHaveAttribute("aria-pressed", "true");
            await page.screenshot({ path: path.join(SHOTS, "setup.png"), fullPage: true });
            await setup.getByRole("button", { name: "Oturumu aç" }).click();

            // ---------------------------------------------------------------- OBS box
            const obs = page.getByTestId("streamer-obs");
            await expect(obs).toBeVisible({ timeout: 20_000 });
            const fullRow = obs.getByTestId("streamer-url-full");
            await fullRow.getByRole("button", { name: "Kopyala" }).click();
            await expect(fullRow.getByRole("button", { name: "Kopyalandı" })).toBeVisible();
            const firstUrl = await readClipboard(page);
            expect(firstUrl).toMatch(new RegExp(`^${origin}/stream/[A-Za-z0-9_-]{43}$`));
            await expect(obs.getByTestId("streamer-url-half").getByRole("textbox")).toHaveValue(`${firstUrl}?layout=half`);
            await expect(obs.getByTestId("streamer-url-strip-top").getByRole("textbox")).toHaveValue(`${firstUrl}?overlay=top`);
            await expect(obs.getByTestId("streamer-url-strip-bottom").getByRole("textbox")).toHaveValue(`${firstUrl}?overlay=bottom`);
            await expect(obs.getByRole("link", { name: "Yeni sekmede önizle" })).toHaveAttribute("href", firstUrl);
            const firstKey = firstUrl.slice(firstUrl.lastIndexOf("/") + 1);

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
            const running = await screen.content();
            for (const word of [first.target, ...first.taboos]) expect(running).not.toContain(word);
            await expect(log.getByText("1. tur başladı")).toBeVisible();
            await page.screenshot({ path: path.join(SHOTS, "running.png"), fullPage: true });

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
            expect(await screen.content()).not.toContain(second.target);
            await controls.getByRole("button", { name: "Pas geç" }).click();
            await expect(log.getByText(`2. tur pas geçildi: ${second.target}`)).toBeVisible({ timeout: 10_000 });
            await expect(screen.locator("#verdict")).toHaveAttribute("data-kind", "pass", { timeout: 10_000 });
            await expect(screen.locator("#verdict-detail")).toHaveText(second.target);
            // Round 3 runs: its word is on the panel only.
            await expect(log.getByText("3. tur başladı")).toBeVisible();
            const third = cardOf((await targetOf.innerText()).trim());
            const afterPass = await screen.content();
            for (const word of [third.target, ...third.taboos]) expect(afterPass).not.toContain(word);

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
        }
    });
});
