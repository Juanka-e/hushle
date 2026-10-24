import { randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@hushle/platform-db";

// State that used to be lost on load: stored sound/music preferences (the settings tab wrote
// the defaults over them), an audit ?page= deep link (reset to page one) and an inventory
// ?userId= deep link (replaced by the first listed user).
test.describe("dashboard and admin state on load", () => {
    test.skip(process.env.WEB_LAUNCH_DB_E2E !== "true", "WEB_LAUNCH_DB_E2E=true is required for the disposable DB flow");

    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const password = `Derin-${suffix} vapur 2026!`;
    const playerName = `prefs_${suffix}`;
    const adminName = `deep_admin_${suffix}`;
    const listedPrefix = `deep_user_${suffix}`;
    const auditAction = `e2e.deep_link.${suffix}`;
    const ticketSubject = `Derin bağlantı ${suffix}`;
    const userIds: number[] = [];
    let targetUserId = 0;
    let targetTicketId = 0;

    test.beforeAll(async () => {
        expect(process.env.DATABASE_URL ?? "").toMatch(/tabu_test/);
        const hash = await bcryptjs.hash(password, 10);
        const player = await prisma.user.create({ data: { username: playerName, password: hash, role: "user" } });
        const admin = await prisma.user.create({ data: { username: adminName, password: hash, role: "admin" } });
        userIds.push(player.id, admin.id);
        // Three users share a search prefix; the deep link points at the middle one.
        for (const tag of ["a", "b", "c"]) {
            const user = await prisma.user.create({
                data: { username: `${listedPrefix}_${tag}`, password: hash, role: "user" },
            });
            userIds.push(user.id);
            if (tag === "b") targetUserId = user.id;
        }
        // Three tickets share a subject prefix; the deep link points at the middle one.
        for (const tag of ["a", "b", "c"]) {
            const ticket = await prisma.supportTicket.create({
                data: { userId: player.id, category: "other", subject: `${ticketSubject} ${tag}` },
            });
            if (tag === "b") targetTicketId = ticket.id;
        }
        // 20 rows of one action: two pages of 15.
        await prisma.auditLog.createMany({
            data: Array.from({ length: 20 }, (_, index) => ({
                actorUserId: admin.id,
                actorRole: "admin",
                action: auditAction,
                resourceType: "e2e",
                resourceId: String(index),
            })),
        });
    });

    test.afterAll(async () => {
        await prisma.auditLog.deleteMany({ where: { OR: [{ action: auditAction }, { actorUserId: { in: userIds } }] } });
        await prisma.supportTicket.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.$disconnect();
    });

    async function adminLogin(page: Page) {
        await page.goto("/admin/login");
        await page.getByLabel("Kullanıcı Adı").fill(adminName);
        await page.getByLabel("Şifre").fill(password);
        await page.getByRole("button", { name: "Giriş Yap" }).click();
        await page.waitForURL(/\/admin(?:\/)?$/);
    }

    test("stored sound and music preferences survive opening the settings tab", async ({ page }) => {
        await page.goto("/login");
        await page.getByPlaceholder(/Kullanıcı Adı/i).fill(playerName);
        await page.getByPlaceholder(/Parola/i).fill(password);
        await page.getByRole("button", { name: /^Giriş Yap$/i }).click();
        await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

        const stored = () => page.evaluate(() => window.localStorage.getItem("tabu_dashboard_settings_v1"));
        await page.evaluate(() =>
            window.localStorage.setItem("tabu_dashboard_settings_v1", JSON.stringify({ soundOn: false, musicOn: true }))
        );
        await page.goto("/dashboard?tab=settings");
        const sound = page.getByRole("switch", { name: "Ses Efektleri" });
        const music = page.getByRole("switch", { name: "Arka Plan Müziği" });
        await expect(sound).toHaveAttribute("aria-checked", "false");
        await expect(music).toHaveAttribute("aria-checked", "true");
        await page.waitForTimeout(500);
        expect(JSON.parse((await stored()) ?? "null")).toEqual({ soundOn: false, musicOn: true });

        await sound.click();
        await expect(sound).toHaveAttribute("aria-checked", "true");
        expect(JSON.parse((await stored()) ?? "null")).toEqual({ soundOn: true, musicOn: true });

        await page.reload();
        await expect(page.getByRole("switch", { name: "Ses Efektleri" })).toHaveAttribute("aria-checked", "true");
        await expect(page.getByRole("switch", { name: "Arka Plan Müziği" })).toHaveAttribute("aria-checked", "true");
    });

    test("an audit ?page= deep link opens that page", async ({ page }) => {
        await adminLogin(page);
        await page.goto(`/admin/audit?action=${encodeURIComponent(auditAction)}&page=2`);
        await expect(page.getByText("2 / 2", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(1_000);
        await expect(page.getByText("2 / 2", { exact: true }).first()).toBeVisible();
        expect(new URL(page.url()).searchParams.get("page")).toBe("2");
    });

    test("an inventory ?userId= deep link selects that user", async ({ page }) => {
        await adminLogin(page);
        await page.goto(`/admin/inventory?search=${encodeURIComponent(listedPrefix)}&userId=${targetUserId}`);
        await expect(page.getByText(`${listedPrefix}_c`).first()).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(1_500);
        expect(new URL(page.url()).searchParams.get("userId")).toBe(String(targetUserId));
        expect(new URL(page.url()).searchParams.get("search")).toBe(listedPrefix);
    });

    test("a support ?ticketId= deep link selects that ticket", async ({ page }) => {
        await adminLogin(page);
        await page.goto(`/admin/support?search=${encodeURIComponent(ticketSubject)}&ticketId=${targetTicketId}`);
        await expect(page.getByText(`${ticketSubject} c`).first()).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(1_500);
        expect(new URL(page.url()).searchParams.get("ticketId")).toBe(String(targetTicketId));
    });
});
