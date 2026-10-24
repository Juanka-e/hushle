import { randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import { expect, test } from "@playwright/test";
import { prisma } from "@hushle/platform-db";

// A signed-in player's notification list follows the locale cookie: templated rows
// render in that locale, rows without a template keep their stored text.
const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3201";

test.describe("notification list locale", () => {
    test.skip(process.env.WEB_LAUNCH_DB_E2E !== "true", "WEB_LAUNCH_DB_E2E=true is required for the disposable DB flow");

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const username = `notify_e2e_${suffix}`;
    const password = `Bildirim-${suffix} vapur 2026!`;
    let userId: number | null = null;

    test.beforeAll(async () => {
        expect(process.env.DATABASE_URL ?? "").toMatch(/tabu_test/);
        const user = await prisma.user.create({
            data: { username, password: await bcryptjs.hash(password, 10), role: "user" },
        });
        userId = user.id;
        await prisma.notification.createMany({
            data: [
                {
                    userId: user.id,
                    type: "economy",
                    title: "Coin kodu kullanıldı",
                    body: "250 coin hesabına eklendi.",
                    actionLabel: "Mağazayı Aç",
                    actionHref: "/dashboard?tab=shop",
                    metadata: { template: { id: "coinGrantRedeemed", params: { amount: 250 } } },
                },
                { userId: user.id, type: "system", title: "Eski bildirim", body: "Şablonsuz kayıt." },
            ],
        });
    });

    test.afterAll(async () => {
        if (userId !== null) {
            await prisma.notification.deleteMany({ where: { userId } });
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await prisma.$disconnect();
    });

    test("renders templated notifications in the cookie locale", async ({ page }) => {
        await page.goto("/login");
        await page.getByPlaceholder(/Kullanıcı Adı/i).fill(username);
        await page.getByPlaceholder(/Parola/i).fill(password);
        await page.getByRole("button", { name: /^Giriş Yap$/i }).click();
        await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

        // The phone-only notification and help buttons are icons; they need accessible names.
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.getByRole("button", { name: "Bildirimler", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Yardım merkezi", exact: true })).toBeVisible();
        await page.setViewportSize({ width: 1280, height: 860 });

        const list = async (locale: "tr" | "en") => {
            await page.context().addCookies([{ name: "hushle_locale", value: locale, url: baseURL }]);
            const response = await page.request.get("/api/notifications?limit=10&filter=all");
            expect(response.status()).toBe(200);
            const payload = (await response.json()) as {
                notifications: Array<{ title: string; body: string; actionLabel: string | null }>;
            };
            return payload.notifications;
        };

        const english = await list("en");
        expect(english).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    title: "Coin code redeemed",
                    body: "250 coins were added to your account.",
                    actionLabel: "Open Store",
                }),
                expect.objectContaining({ title: "Eski bildirim", body: "Şablonsuz kayıt." }),
            ])
        );
        const turkish = await list("tr");
        expect(turkish).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    title: "Coin kodu kullanıldı",
                    body: "250 coin hesabına eklendi.",
                    actionLabel: "Mağazayı Aç",
                }),
            ])
        );
    });
});
