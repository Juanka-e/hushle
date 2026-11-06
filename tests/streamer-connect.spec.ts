import { expect, test, type Page } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";

// Settings "Yayın kanalları" section and the /streamer gate, driven end to end against the
// fake platform. Needs the server started with STREAMER_FAKE_PLATFORM=1 (+ HUSHLE_E2E_SMOKE=1
// for the production-mode smoke server) and a STREAMER_TOKEN_KEY.

const enabled = process.env.STREAMER_FAKE_PLATFORM === "1";

test.describe("streamer channel linking", () => {
    test.skip(!enabled, "set STREAMER_FAKE_PLATFORM=1 (and start the server with it) to run");
    test.describe.configure({ mode: "serial" });

    const suffix = randomUUID().slice(0, 8);
    const username = `streamer_e2e_${suffix}`;
    const password = `Streamer-e2e-${suffix}!`;
    let userId: number | null = null;
    let originalFeatures: unknown = undefined;

    async function setStreamerMode(enabledValue: boolean): Promise<void> {
        const current = await prisma.systemSetting.findUnique({ where: { key: "features" } });
        const value = { ...((current?.value as Record<string, unknown> | null) ?? {}), streamerModeEnabled: enabledValue };
        await prisma.systemSetting.upsert({ where: { key: "features" }, update: { value }, create: { key: "features", value } });
    }

    async function waitForMode(page: Page, expected: boolean): Promise<void> {
        await expect
            .poll(
                async () => {
                    const response = await page.request.get("/api/streamer/connections");
                    if (!response.ok()) return `status ${response.status()}`;
                    return ((await response.json()) as { enabled: boolean }).enabled;
                },
                { timeout: 40_000, intervals: [1_000] }
            )
            .toBe(expected);
    }

    async function login(page: Page): Promise<void> {
        await page.goto("/login");
        await page.getByPlaceholder(/Kullanıcı Adı/i).fill(username);
        await page.getByPlaceholder(/Parola/i).fill(password);
        await page.getByRole("button", { name: /^Giriş Yap$/i }).click();
        await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    }

    test.beforeAll(async () => {
        const existing = await prisma.systemSetting.findUnique({ where: { key: "features" } });
        originalFeatures = existing ? existing.value : undefined;
        const user = await prisma.user.create({
            data: { username, password: await bcryptjs.hash(password, 10) },
            select: { id: true },
        });
        userId = user.id;
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
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await prisma.$disconnect();
    });

    test("link, gate, disconnect, and the switch", async ({ page }) => {
        // The settings cache (15 s TTL) is waited out twice; the default 30 s budget is too tight.
        test.setTimeout(150_000);
        await login(page);
        await waitForMode(page, true);

        await page.goto("/dashboard?tab=settings");
        await expect(page.getByRole("heading", { name: "Yayın kanalları" })).toBeVisible({ timeout: 20_000 });
        const section = page.getByTestId("streamer-connections");
        const twitchRow = section.getByTestId("streamer-row-twitch");
        await expect(twitchRow.getByText("Bağlı değil")).toBeVisible();

        await twitchRow.getByRole("link", { name: "Bağla" }).click();
        await page.waitForURL(/streamer=linked/, { timeout: 30_000 });
        await expect(page.getByText("Twitch kanalı bağlandı.")).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId("streamer-row-twitch").getByText("Denizoynuyor", { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId("streamer-row-twitch").getByText("Hazır")).toBeVisible();

        await page.goto("/streamer");
        await expect(page.getByRole("heading", { name: "Kanal hazır" })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(/Denizoynuyor \(Twitch\)/)).toBeVisible();

        await page.goto("/dashboard?tab=settings");
        page.once("dialog", (dialog) => void dialog.accept());
        await page.getByTestId("streamer-row-twitch").getByRole("button", { name: "Kaldır" }).click();
        await expect(page.getByText("Twitch bağlantısı kaldırıldı.")).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId("streamer-row-twitch").getByText("Bağlı değil")).toBeVisible();

        await page.goto("/streamer");
        await expect(page.getByRole("heading", { name: "Önce bir kanal bağla" })).toBeVisible({ timeout: 20_000 });

        await setStreamerMode(false);
        await waitForMode(page, false);
        await page.goto("/dashboard?tab=settings");
        await expect(page.getByRole("heading", { name: "Profil Ayarları" })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole("heading", { name: "Oyun Ayarları" })).toBeVisible();
        await expect(page.getByTestId("streamer-connections")).toHaveCount(0);
        await page.goto("/streamer");
        await expect(page.getByRole("heading", { name: "Yayıncı modu yakında" })).toBeVisible({ timeout: 20_000 });
    });

    test("the fake authorize route refuses foreign redirect targets", async ({ page }) => {
        const response = await page.request.get("/api/streamer/connect/fake/authorize?platform=twitch&state=x&redirect_uri=https://evil.example/callback");
        expect(response.status()).toBe(400);
    });
});
