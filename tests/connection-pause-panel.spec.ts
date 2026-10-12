import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@hushle/platform-db";

// Browser-level checks for the connection pause decision panel and the Admin Lab page.
// Run with playwright.pause.config.ts; the server must use CONNECTION_PAUSE_GRACE_SECONDS=5.
const enabled = process.env.CONNECTION_PAUSE_UI_E2E === "true";
const screenshotDir = process.env.PAUSE_UI_SCREENSHOT_DIR ?? "test-results/connection-pause-ui";

test.describe.configure({ mode: "serial" });

test.describe("connection pause panel", () => {
    test.skip(!enabled, "CONNECTION_PAUSE_UI_E2E=true is required");

    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const adminUsername = `pause_admin_${suffix}`;
    const adminPassword = `PauseAdmin-${suffix}!`;
    let categoryId: number | null = null;
    let adminId: number | null = null;
    const contexts: BrowserContext[] = [];

    test.beforeAll(async () => {
        mkdirSync(screenshotDir, { recursive: true });
        const category = await prisma.category.create({
            data: { name: `Pause UI ${suffix}`, color: "#7c3aed", sortOrder: 999_100, isVisible: true },
        });
        categoryId = category.id;
        for (let index = 1; index <= 6; index += 1) {
            const word = await prisma.word.create({
                data: {
                    wordText: `pauseui_${suffix}_${index}`,
                    difficulty: 1,
                    tabooWords: { create: [{ tabooWordText: `yasak_${suffix}_${index}` }] },
                },
            });
            await prisma.wordCategory.create({ data: { wordId: word.id, categoryId } });
        }
        const admin = await prisma.user.create({
            data: { username: adminUsername, password: await bcryptjs.hash(adminPassword, 10), role: "admin" },
        });
        adminId = admin.id;
    });

    test.afterAll(async () => {
        await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
        await prisma.word.deleteMany({ where: { wordText: { startsWith: `pauseui_${suffix}_` } } });
        if (categoryId !== null) await prisma.category.deleteMany({ where: { id: categoryId } });
        if (adminId !== null) {
            await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } });
            await prisma.user.deleteMany({ where: { id: adminId } });
        }
        await prisma.$disconnect();
    });

    const desktop = { width: 1280, height: 860 };
    const phone = { width: 390, height: 844 };

    async function joinRoom(
        browser: Browser,
        name: string,
        roomCode?: string,
        viewport = desktop
    ): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
        const context = await browser.newContext({ viewport, hasTouch: viewport === phone });
        contexts.push(context);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("/");
        await page.getByPlaceholder(/Adınızı girin|Enter your name/i).fill(name);
        if (roomCode) {
            await page.getByPlaceholder(/Örn: ABC123|E.g.: ABC123/i).fill(roomCode);
            await page.getByRole("button", { name: /^Katıl$|^Join$/i }).click();
        } else {
            await page.getByRole("button", { name: /Yeni Oda Oluştur|Create New Room/i }).click();
        }
        await expect(page).toHaveURL(/\/room\/[A-Z0-9]{6}$/, { timeout: 20_000 });
        return { context, page, errors };
    }

    async function setupRoom(browser: Browser, tag: string, players: number, phoneSeats: number[] = []) {
        const host = await joinRoom(browser, `Host${tag}${suffix}`);
        const roomCode = new URL(host.page.url()).pathname.split("/").at(-1)!;
        const others = [];
        for (let index = 1; index < players; index += 1) {
            const viewport = phoneSeats.includes(index) ? phone : desktop;
            const guest = await joinRoom(browser, `G${index}${tag}${suffix}`, roomCode, viewport);
            await expect(host.page.getByText(`G${index}${tag}${suffix}`, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
            others.push(guest);
        }
        return { host, others, roomCode };
    }

    async function startGame(host: Page): Promise<void> {
        const startButton = host.getByRole("button", { name: /Oyunu Ba/i });
        await expect(startButton).toBeEnabled({ timeout: 20_000 });
        await startButton.click();
        await expect(host.getByRole("heading", { name: /Oyun ba/i })).toBeVisible({ timeout: 20_000 });
    }

    test("2v2: the host can only end the match and the game over screen explains it", async ({ browser }) => {
        // The bystander (G2) plays on a phone-sized screen.
        const { host, others } = await setupRoom(browser, "a", 4, [2]);
        await startGame(host.page);

        const leaver = others[0];
        const leaverName = `G1a${suffix}`;
        await leaver.context.close();

        const panel = host.page.getByTestId("connection-pause-panel");
        await expect(panel).toBeVisible({ timeout: 20_000 });
        await expect(panel.getByText(leaverName)).toBeVisible();
        await expect(panel.getByRole("timer")).toBeVisible();
        const continueButton = panel.getByRole("button", { name: /Onsuz devam et/i });
        const endButton = panel.getByRole("button", { name: /^Maçı bitir$/i });
        await expect(continueButton).toBeDisabled();
        await expect(panel.getByText(/en az 2 oyuncu/i)).toBeVisible();
        await expect(endButton).toBeDisabled();
        await host.page.screenshot({ path: join(screenshotDir, "01-host-panel-countdown.png") });

        const bystander = others[1].page;
        const bystanderPanel = bystander.getByTestId("connection-pause-panel");
        await expect(bystanderPanel).toBeVisible({ timeout: 20_000 });
        await expect(bystanderPanel.getByRole("button")).toHaveCount(0);
        // A real wheel scroll (not a programmatic one) must reach the panel on a short screen.
        await bystander.mouse.move(195, 420);
        await bystander.mouse.wheel(0, 4000);
        await expect(bystanderPanel).toBeInViewport({ ratio: 1 });
        await bystander.screenshot({ path: join(screenshotDir, "02-player-panel-waiting-phone.png") });
        expect(await bystander.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

        await expect(endButton).toBeEnabled({ timeout: 15_000 });
        await expect(continueButton).toBeDisabled();
        await endButton.click();
        const confirm = panel.getByRole("alertdialog");
        await expect(confirm).toBeVisible();
        // Opening the confirmation scrolls it into view so the host can reach the final button.
        await expect(confirm.getByRole("button", { name: /Evet, maçı bitir/i })).toBeInViewport({ ratio: 1 });
        await host.page.screenshot({ path: join(screenshotDir, "03-host-end-confirmation.png") });
        await confirm.getByRole("button", { name: /Maçı bitir|Evet|Onayla/i }).last().click();

        await expect(host.page.getByText(/erken bitirildi/i)).toBeVisible({ timeout: 20_000 });
        await expect(bystander.getByText(/erken bitirildi/i)).toBeVisible({ timeout: 20_000 });
        await host.page.screenshot({ path: join(screenshotDir, "04-game-over-host-ended.png"), animations: "disabled" });
        expect([...host.errors, ...others[1].errors, ...others[2].errors]).toEqual([]);
    });

    test("3v3: the host continues without a missing narrator or inspector", async ({ browser }) => {
        // G3 plays on a phone-sized screen.
        const { host, others } = await setupRoom(browser, "b", 6, [3]);
        await startGame(host.page);

        const everyone = [host, ...others];
        // The narrator gets the "correct" button, the primary inspector the "taboo" button.
        const roleOf = async (page: Page) => {
            if (await page.getByRole("button", { name: /^DOĞRU$|^CORRECT$/i }).isVisible()) return "narrator";
            if (await page.getByRole("button", { name: /^TABU$|^TABOO$/i }).isVisible()) return "inspector";
            return "other";
        };
        await expect
            .poll(async () => (await Promise.all(everyone.map((entry) => roleOf(entry.page)))).includes("narrator"), { timeout: 30_000 })
            .toBe(true);
        const roles = await Promise.all(everyone.map((entry) => roleOf(entry.page)));
        const narratorIndex = roles.indexOf("narrator");
        const inspectorIndex = roles.indexOf("inspector");
        const leaverIndex = narratorIndex !== 0 ? narratorIndex : inspectorIndex;
        expect(leaverIndex).toBeGreaterThan(0);
        const leftRole = roles[leaverIndex];
        console.log(`[pause-ui] 3v3 leaver role: ${leftRole}`);
        await everyone[leaverIndex].context.close();

        const panel = host.page.getByTestId("connection-pause-panel");
        await expect(panel).toBeVisible({ timeout: 20_000 });
        const continueButton = panel.getByRole("button", { name: /Onsuz devam et/i });
        await expect(continueButton).toBeEnabled({ timeout: 15_000 });
        await host.page.screenshot({ path: join(screenshotDir, "05-host-panel-continue-ready.png") });
        const phonePlayer = everyone[3];
        if (leaverIndex !== 3) {
            const phonePanel = phonePlayer.page.getByTestId("connection-pause-panel");
            await expect(phonePanel).toBeVisible();
            await expect(phonePanel.getByRole("button")).toHaveCount(0);
            await phonePlayer.page.screenshot({ path: join(screenshotDir, "05b-player-panel-phone.png") });
            expect(
                await phonePlayer.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
            ).toBeLessThanOrEqual(1);
        }
        await continueButton.click();

        await expect(panel).toBeHidden({ timeout: 20_000 });
        await expect(host.page.getByText(/Bir oyuncunun bağlantısı kesildi/i)).toHaveCount(0);
        if (leftRole === "narrator") {
            // The turn ends as if time ran out and the other team speaks next.
            await expect(host.page.getByRole("heading", { name: /Anlatıcı değişiyor/i })).toBeVisible({ timeout: 10_000 });
        } else {
            // A new inspector is assigned and the same turn continues without a transition.
            await expect(host.page.getByRole("button", { name: /^DOĞRU$/i })).toBeVisible({ timeout: 10_000 });
            await expect(host.page.getByRole("heading", { name: /Anlatıcı değişiyor/i })).toHaveCount(0);
        }
        await host.page.screenshot({ path: join(screenshotDir, `06-after-continue-${leftRole}.png`) });
        const survivors = everyone.filter((_, index) => index !== leaverIndex);
        expect(survivors.flatMap((entry) => entry.errors)).toEqual([]);
    });

    test("Admin Lab shows the recorded connection pauses", async ({ page }) => {
        await page.goto("/admin/login");
        await page.getByLabel("Kullanici Adi").fill(adminUsername);
        await page.getByLabel("Sifre").fill(adminPassword);
        await page.getByRole("button", { name: "Giris Yap" }).click();
        await page.waitForURL(/\/admin(?:\/)?$/);

        await page.getByRole("link", { name: /^Lab$/ }).first().click();
        await expect(page).toHaveURL(/\/admin\/lab$/);
        await expect(page.getByText("Bağlantı kopmaları").first()).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(/^Toplam duraklatma$/i)).toBeVisible({ timeout: 20_000 });
        if (process.env.PLAYWRIGHT_REDIS_URL) {
            await expect(page.getByText(/Redis bağlı değil/i)).toHaveCount(0);
        }
        await page.screenshot({ path: join(screenshotDir, "07-admin-lab-7d.png"), fullPage: true });
        await page.getByRole("button", { name: /30 gün/i }).click();
        await expect(page.getByRole("button", { name: /30 gün/i })).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByText(/^Toplam duraklatma$/i)).toBeVisible({ timeout: 20_000 });
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.screenshot({ path: join(screenshotDir, "08-admin-lab-30d-tablet.png"), fullPage: true });
        // The admin shell is desktop-first (fixed sidebar); the Lab card must still not push the page sideways.
        for (const width of [768, 390]) {
            await page.setViewportSize({ width, height: 900 });
            await expect
                .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
                .toBeLessThanOrEqual(1);
        }
    });
});
