import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
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
    // Guest claim Lab fixtures: tracked by id so cleanup never touches other suites' rows.
    const labSettlementIds: number[] = [];
    const labUserIds: number[] = [];

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
        if (labSettlementIds.length > 0) {
            await prisma.matchSettlement.deleteMany({ where: { id: { in: labSettlementIds } } });
        }
        if (labUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: labUserIds } } });
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

    async function loginAdmin(page: Page): Promise<void> {
        await page.goto("/admin/login");
        await page.getByLabel("Kullanici Adi").fill(adminUsername);
        await page.getByLabel("Sifre").fill(adminPassword);
        await page.getByRole("button", { name: "Giris Yap" }).click();
        await page.waitForURL(/\/admin(?:\/)?$/);
    }

    test("Admin Lab shows the recorded connection pauses", async ({ page }) => {
        await loginAdmin(page);

        await page.getByRole("link", { name: /^Lab$/ }).first().click();
        await expect(page).toHaveURL(/\/admin\/lab$/);
        const pauseCard = page.getByTestId("connection-pause-lab");
        await expect(pauseCard.getByText("Bağlantı kopmaları").first()).toBeVisible({ timeout: 20_000 });
        await expect(pauseCard.getByText(/^Toplam duraklatma$/i)).toBeVisible({ timeout: 20_000 });
        if (process.env.PLAYWRIGHT_REDIS_URL) {
            await expect(page.getByText(/Redis bağlı değil/i)).toHaveCount(0);
        }
        await page.screenshot({ path: join(screenshotDir, "07-admin-lab-7d.png"), fullPage: true });
        await pauseCard.getByRole("button", { name: /30 gün/i }).click();
        await expect(pauseCard.getByRole("button", { name: /30 gün/i })).toHaveAttribute("aria-pressed", "true");
        await expect(pauseCard.getByText(/^Toplam duraklatma$/i)).toBeVisible({ timeout: 20_000 });
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.screenshot({ path: join(screenshotDir, "08-admin-lab-30d-tablet.png"), fullPage: true });
        // Below md the admin sidebar is an icon rail; neither the page nor the card may scroll sideways.
        for (const width of [768, 390]) {
            await page.setViewportSize({ width, height: 900 });
            await expect
                .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
                .toBeLessThanOrEqual(1);
            await expect.poll(() => pauseCard.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
        }
        await page.screenshot({ path: join(screenshotDir, "08b-admin-lab-phone.png") });
    });

    interface GuestClaimLabSummary {
        days: number;
        available: boolean;
        windowStart: string;
        windowEnd: string;
        eligible: number;
        unclaimed: number;
        claimed: number;
        claimRatePercent: number;
        settled: number;
        coinGranted: number;
        settledFromHostEnded: number;
        waiting: number;
        waitingByReason: Record<string, number>;
        closed: number;
        rejected: number;
        expired: number;
        closedByReason: Record<string, number>;
        distinctAccounts: number;
    }

    const labCount = new Intl.NumberFormat("tr-TR");
    const labPercent = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

    function waitForLab(page: Page, section: "guest-claims" | "connection-pauses", days: 7 | 30) {
        return page.waitForResponse((response) => response.url().includes(`/api/admin/lab/${section}?days=${days}`));
    }

    // Other suites may write seats to the same database, so the page is checked against the
    // exact payload it rendered.
    async function expectGuestClaimCard(card: Locator, summary: GuestClaimLabSummary) {
        const tiles: Array<[string, number]> = [
            ["guest-claim-eligible", summary.eligible],
            ["guest-claim-claimed", summary.claimed],
            ["guest-claim-settled", summary.settled],
            ["guest-claim-coins", summary.coinGranted],
            ["guest-claim-waiting", summary.waiting],
            ["guest-claim-closed", summary.closed],
            ["guest-claim-accounts", summary.distinctAccounts],
            ["guest-claim-unclaimed", summary.unclaimed],
        ];
        for (const [testId, value] of tiles) {
            await expect(card.getByTestId(testId).locator("dd").first()).toHaveText(labCount.format(value));
        }
        await expect(card.getByTestId("guest-claim-claimed")).toContainText(
            `Talep oranı %${labPercent.format(summary.claimRatePercent)}`
        );
        await expect(card.getByTestId("guest-claim-settled")).toContainText(
            `Erken biten maçtan: ${labCount.format(summary.settledFromHostEnded)} (0 coin)`
        );
        for (const reason of ["email_verification", "suspension", "retry"] as const) {
            await expect(card.getByTestId(`guest-claim-waiting-${reason}`)).toContainText(
                labCount.format(summary.waitingByReason[reason])
            );
        }
        await expect(card.getByTestId("guest-claim-closed-already_participant")).toContainText(
            labCount.format(summary.closedByReason.already_participant)
        );
        await expect(card.getByTestId("guest-claim-closed-expired")).toContainText(
            labCount.format(summary.closedByReason.expired)
        );
        await expect(card.getByText(new RegExp(`son ${summary.days} × 24 saat`))).toBeVisible();
        await expect(card.getByText(/Koltuk verisi 30 gün tutulur/)).toBeVisible();
    }

    async function seedGuestSeat(input: {
        endedAt: Date;
        status: "unclaimed" | "pending" | "settled" | "rejected" | "expired";
        outcome?: string;
        coin?: number;
        claimUserId?: number;
        endReason?: "completed" | "host_ended";
    }): Promise<void> {
        const claimed = input.status !== "unclaimed";
        const closedAt = claimed && input.status !== "pending" ? new Date() : null;
        const settlement = await prisma.matchSettlement.create({
            data: {
                // 12 characters, so it can never collide with a real 6-character room code.
                roomCode: `LBP${randomUUID().replaceAll("-", "").slice(0, 9).toUpperCase()}`,
                matchStartedAt: new Date(input.endedAt.getTime() - 600_000),
                matchEndedAt: input.endedAt,
                endReason: input.endReason ?? "completed",
                snapshot: { labFixture: true },
                guestParticipantCount: 1,
                status: "settled",
                settledAt: new Date(),
                guestSeats: {
                    create: [
                        {
                            guestPlayerId: `guest:${randomUUID()}`,
                            matchEndedAt: input.endedAt,
                            status: input.status,
                            outcome: input.outcome ?? (input.status === "settled" ? "settled" : null),
                            claimUserId: claimed ? (input.claimUserId ?? null) : null,
                            claimedAt: claimed ? new Date() : null,
                            // Far in the future: no worker sweep touches these pending fixtures.
                            availableAt: input.status === "pending" ? new Date(Date.now() + 30 * 86_400_000) : null,
                            coinEarned: input.status === "settled" ? (input.coin ?? 0) : null,
                            settledAt: closedAt,
                        },
                    ],
                },
            },
            select: { id: true },
        });
        labSettlementIds.push(settlement.id);
    }

    test("Admin Lab shows guest match claims", async ({ page }) => {
        const dayMs = 86_400_000;
        const recent = new Date(Date.now() - 2 * dayMs);
        const older = new Date(Date.now() - 12 * dayMs);
        for (const label of ["a", "b"]) {
            const user = await prisma.user.create({
                data: { username: `lab_claim_${label}_${suffix}`, password: "playwright-only" },
                select: { id: true },
            });
            labUserIds.push(user.id);
        }
        const [userA, userB] = labUserIds;
        await seedGuestSeat({ endedAt: recent, status: "unclaimed" });
        await seedGuestSeat({ endedAt: recent, status: "unclaimed" });
        await seedGuestSeat({ endedAt: recent, status: "pending", outcome: "awaiting_verification", claimUserId: userA });
        await seedGuestSeat({ endedAt: recent, status: "pending", outcome: "suspended_waiting", claimUserId: userB });
        await seedGuestSeat({ endedAt: recent, status: "settled", coin: 120, claimUserId: userA });
        await seedGuestSeat({ endedAt: recent, status: "settled", coin: 0, claimUserId: userB, endReason: "host_ended" });
        await seedGuestSeat({ endedAt: recent, status: "rejected", outcome: "already_participant", claimUserId: userA });
        await seedGuestSeat({ endedAt: recent, status: "expired", outcome: "expired", claimUserId: userB });
        await seedGuestSeat({ endedAt: older, status: "unclaimed" });
        await seedGuestSeat({ endedAt: older, status: "unclaimed" });
        await seedGuestSeat({ endedAt: older, status: "settled", coin: 40, claimUserId: userA });

        const labResponse = (days: 7 | 30) => waitForLab(page, "guest-claims", days);

        await loginAdmin(page);
        const sevenLoaded = labResponse(7);
        await page.goto("/admin/lab");
        const sevenResponse = await sevenLoaded;
        expect(sevenResponse.status()).toBe(200);
        expect(sevenResponse.headers()["cache-control"]).toContain("no-store");
        const seven = (await sevenResponse.json()) as GuestClaimLabSummary;
        expect(seven).toMatchObject({ days: 7, available: true });
        expect(Date.parse(seven.windowEnd) - Date.parse(seven.windowStart)).toBe(7 * dayMs);
        expect(seven.eligible).toBeGreaterThanOrEqual(8);
        expect(seven.settled).toBeGreaterThanOrEqual(2);
        expect(seven.coinGranted).toBeGreaterThanOrEqual(120);
        expect(seven.settledFromHostEnded).toBeGreaterThanOrEqual(1);
        expect(seven.waitingByReason.email_verification).toBeGreaterThanOrEqual(1);
        expect(seven.waitingByReason.suspension).toBeGreaterThanOrEqual(1);
        expect(seven.closedByReason.already_participant).toBeGreaterThanOrEqual(1);
        expect(seven.closedByReason.expired).toBeGreaterThanOrEqual(1);
        expect(seven.distinctAccounts).toBeGreaterThanOrEqual(2);
        expect(seven.claimRatePercent).toBeGreaterThan(0);
        expect(seven.claimRatePercent).toBeLessThan(100);

        const card = page.getByTestId("guest-claim-lab");
        const pauseCard = page.getByTestId("connection-pause-lab");
        const expectPauseCardIntact = async () => {
            await expect(pauseCard.getByText("Bağlantı kopmaları").first()).toBeVisible();
            await expect(pauseCard).not.toContainText(/Sunucu hatası \(test\)|Veritabanından okunamadı/);
            if (process.env.PLAYWRIGHT_REDIS_URL) {
                await expect(pauseCard.getByRole("alert")).toHaveCount(0);
                await expect(pauseCard.getByText(/Toplam duraklatma|bağlantı kopması yok/i).first()).toBeVisible();
            }
        };
        await expect(card.getByText("Misafir maç aktarımı").first()).toBeVisible();
        await expectGuestClaimCard(card, seven);
        await expect(card.getByRole("button", { name: /7 gün/i })).toHaveAttribute("aria-pressed", "true");
        await card.scrollIntoViewIfNeeded();
        await card.screenshot({ path: join(screenshotDir, "09-guest-claim-lab-7d.png") });

        // 30 days: the toggle reloads this card only.
        const thirtyLoaded = labResponse(30);
        await card.getByRole("button", { name: /30 gün/i }).click();
        const thirty = (await (await thirtyLoaded).json()) as GuestClaimLabSummary;
        expect(thirty).toMatchObject({ days: 30, available: true });
        expect(Date.parse(thirty.windowEnd) - Date.parse(thirty.windowStart)).toBe(30 * dayMs);
        expect(thirty.eligible).toBeGreaterThanOrEqual(11);
        expect(thirty.coinGranted).toBeGreaterThanOrEqual(160);
        await expect(card.getByRole("button", { name: /30 gün/i })).toHaveAttribute("aria-pressed", "true");
        await expect(card.getByRole("button", { name: /7 gün/i })).toHaveAttribute("aria-pressed", "false");
        await expect(pauseCard.getByRole("button", { name: /7 gün/i })).toHaveAttribute("aria-pressed", "true");
        await expectGuestClaimCard(card, thirty);
        await card.screenshot({ path: join(screenshotDir, "10-guest-claim-lab-30d.png") });

        const backToSeven = labResponse(7);
        await card.getByRole("button", { name: /7 gün/i }).click();
        await expectGuestClaimCard(card, (await (await backToSeven).json()) as GuestClaimLabSummary);

        // A slow 7-day refresh must never paint over a newer 30-day result.
        let releaseSlowRefresh: () => void = () => undefined;
        const slowRefreshHeld = new Promise<void>((resolve) => {
            releaseSlowRefresh = resolve;
        });
        let slowRefreshDone: Promise<void> = Promise.resolve();
        const slowRefreshSeen = new Promise<void>((resolve) => {
            void page.route("**/api/admin/lab/guest-claims?days=7", (route) => {
                resolve();
                // The page aborts this request when the newer one starts; continuing it then fails.
                slowRefreshDone = slowRefreshHeld.then(() => route.continue().catch(() => undefined));
                return slowRefreshDone;
            });
        });
        await card.getByRole("button", { name: /^Yenile$/ }).click();
        await slowRefreshSeen;
        const newerThirty = labResponse(30);
        await card.getByRole("button", { name: /30 gün/i }).click();
        const newer = (await (await newerThirty).json()) as GuestClaimLabSummary;
        await expectGuestClaimCard(card, newer);
        releaseSlowRefresh();
        await slowRefreshDone;
        await page.unroute("**/api/admin/lab/guest-claims?days=7");
        // Give a late response time to land; the card must still show the 30-day payload.
        await page.waitForTimeout(750);
        await expectGuestClaimCard(card, newer);
        await expect(card.getByRole("button", { name: /30 gün/i })).toHaveAttribute("aria-pressed", "true");
        const sevenAgain = labResponse(7);
        await card.getByRole("button", { name: /7 gün/i }).click();
        await expectGuestClaimCard(card, (await (await sevenAgain).json()) as GuestClaimLabSummary);

        // Phone: nothing pushes the page or the card sideways.
        await page.setViewportSize(phone);
        await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
            .toBeLessThanOrEqual(1);
        const cardOverflow = await card.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const offenders = [...element.querySelectorAll("*")]
                .filter((node) => node.getBoundingClientRect().right > box.right + 1)
                .slice(0, 5)
                .map((node) => `${node.tagName.toLowerCase()} "${(node.textContent ?? "").trim().slice(0, 40)}" +${Math.round(node.getBoundingClientRect().right - box.right)}px`);
            return { overflow: element.scrollWidth - element.clientWidth, offenders };
        });
        expect(cardOverflow.overflow, cardOverflow.offenders.join("\n")).toBeLessThanOrEqual(1);
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(screenshotDir, "11-guest-claim-lab-phone.png"), fullPage: true });
        await card.screenshot({ path: join(screenshotDir, "11b-guest-claim-lab-phone-card.png") });
        await page.setViewportSize(desktop);

        // A failing endpoint shows an error in this card only; the pause card keeps working.
        await page.route("**/api/admin/lab/guest-claims**", (route) =>
            route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Sunucu hatası (test)" }) })
        );
        await card.getByRole("button", { name: /^Yenile$/ }).click();
        await expect(card.getByRole("alert")).toContainText("Sunucu hatası (test)");
        await expect(card.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
        await expectPauseCardIntact();

        // A database failure on the server (available: false) shows its own error, never zeros.
        await page.unroute("**/api/admin/lab/guest-claims**");
        await page.route("**/api/admin/lab/guest-claims**", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ ...seven, available: false, eligible: 0 }),
            })
        );
        await card.getByRole("button", { name: "Tekrar dene" }).click();
        await expect(card.getByText(/Veritabanından okunamadı/)).toBeVisible();
        await expect(card.getByTestId("guest-claim-eligible")).toHaveCount(0);
        await card.screenshot({ path: join(screenshotDir, "12-guest-claim-lab-db-error.png") });
        await expectPauseCardIntact();

        await page.unroute("**/api/admin/lab/guest-claims**");
        const recovered = labResponse(7);
        await card.getByRole("button", { name: "Tekrar dene" }).click();
        await expectGuestClaimCard(card, (await (await recovered).json()) as GuestClaimLabSummary);
        await expect(card.getByRole("alert")).toHaveCount(0);
    });
    interface PauseLabSummary {
        days: number;
        paused: number;
        byTrigger: Record<"narrator" | "inspector" | "team_below_minimum", number>;
        outcomes: Record<string, number>;
        averageResolutionSeconds: Record<string, number | null>;
    }

    const pauseOutcomeLabels: Record<string, string> = {
        resumed_after_reconnect: "Oyuncu dönünce devam",
        continued_without_missing: "Onsuz devam",
        ended_by_host: "Yönetici bitirdi",
        reset_by_host: "Sıfırlandı",
        abandoned: "Terk edildi",
    };
    const pauseTriggerLabels = {
        narrator: "Anlatıcı",
        inspector: "Gözetmen",
        team_below_minimum: "Takım 2'nin altına düştü",
    } as const;

    async function expectPauseCard(card: Locator, summary: PauseLabSummary) {
        const kpis = card.locator('section[aria-labelledby="connection-pause-kpis"]');
        const tile = (label: string) =>
            kpis.locator("dt").filter({ hasText: new RegExp(`^${label}$`) }).locator("xpath=..").locator("dd").first();
        await expect(tile("Toplam duraklatma")).toHaveText(labCount.format(summary.paused));
        for (const [outcome, label] of Object.entries(pauseOutcomeLabels)) {
            await expect(tile(label)).toHaveText(labCount.format(summary.outcomes[outcome]));
        }
        const triggers = card.locator('section[aria-labelledby="connection-pause-triggers"] li');
        for (const [trigger, label] of Object.entries(pauseTriggerLabels)) {
            await expect(triggers.filter({ hasText: label })).toContainText(
                `${labCount.format(summary.byTrigger[trigger as keyof typeof pauseTriggerLabels])} ·`
            );
        }
        const durations = card.locator('section[aria-labelledby="connection-pause-durations"]');
        for (const [outcome, label] of Object.entries(pauseOutcomeLabels)) {
            const seconds = summary.averageResolutionSeconds[outcome];
            const row = durations.locator("dt").filter({ hasText: label }).locator("xpath=..").locator("dd");
            if (seconds === null) await expect(row).toContainText("—");
            else if (seconds < 60) await expect(row).toHaveText(`${Math.round(seconds)} sn`);
        }
    }

    // Opens Admin Lab on the data test:admin-lab-data-flow-e2e kept (KEEP mode), with the smoke
    // server on that run's database and REDIS_KEY_PREFIX.
    const dataFlowFile = process.env.ADMIN_LAB_DATA_FLOW_FILE?.trim();

    test("Admin Lab shows the numbers real play produced", async ({ page }) => {
        test.skip(!dataFlowFile, "set ADMIN_LAB_DATA_FLOW_FILE to a kept test:admin-lab-data-flow-e2e run");
        const flow = JSON.parse(readFileSync(dataFlowFile!, "utf8")) as {
            after: { pause7: PauseLabSummary; pause30: PauseLabSummary; claims7: GuestClaimLabSummary; claims30: GuestClaimLabSummary };
        };
        // The claim window moves with the clock; every count must match.
        const counts = (summary: GuestClaimLabSummary) => ({ ...summary, windowStart: null, windowEnd: null });
        await loginAdmin(page);
        const pauseSeven = waitForLab(page, "connection-pauses", 7);
        const claimsSeven = waitForLab(page, "guest-claims", 7);
        await page.goto("/admin/lab");
        const pause7 = (await (await pauseSeven).json()) as PauseLabSummary;
        const claims7 = (await (await claimsSeven).json()) as GuestClaimLabSummary;
        // The browser receives exactly what the e2e read right after playing.
        expect(pause7).toEqual(flow.after.pause7);
        expect(counts(claims7)).toEqual(counts(flow.after.claims7));
        const pauseCard = page.getByTestId("connection-pause-lab");
        const claimCard = page.getByTestId("guest-claim-lab");
        await expectPauseCard(pauseCard, pause7);
        await expectGuestClaimCard(claimCard, claims7);
        await page.screenshot({ path: join(screenshotDir, "13-admin-lab-real-play-7d.png"), fullPage: true });

        const pauseThirty = waitForLab(page, "connection-pauses", 30);
        await pauseCard.getByRole("button", { name: /30 gün/i }).click();
        const pause30 = (await (await pauseThirty).json()) as PauseLabSummary;
        const claimsThirty = waitForLab(page, "guest-claims", 30);
        await claimCard.getByRole("button", { name: /30 gün/i }).click();
        const claims30 = (await (await claimsThirty).json()) as GuestClaimLabSummary;
        expect(pause30).toEqual(flow.after.pause30);
        expect(counts(claims30)).toEqual(counts(flow.after.claims30));
        await expectPauseCard(pauseCard, pause30);
        await expectGuestClaimCard(claimCard, claims30);
        await page.screenshot({ path: join(screenshotDir, "14-admin-lab-real-play-30d.png"), fullPage: true });

        await page.setViewportSize(phone);
        await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
            .toBeLessThanOrEqual(1);
        await claimCard.scrollIntoViewIfNeeded();
        await claimCard.screenshot({ path: join(screenshotDir, "15-admin-lab-real-play-phone-claims.png") });
    });
});
