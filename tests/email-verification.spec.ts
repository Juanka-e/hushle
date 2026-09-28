import { expect, test } from "@playwright/test";

test.describe("email verification UI", () => {
    test("shows the inbox state without overflowing on mobile", async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/verify-email?sent=1&required=1");

        await expect(
            page.getByRole("heading", { name: "Gelen kutunu kontrol et" })
        ).toBeVisible();
        await expect(page.getByText(/e-posta adresine gönderildi/i)).toBeVisible();
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        document.documentElement.scrollWidth <=
                        document.documentElement.clientWidth + 1
                )
            )
            .toBe(true);
    });

    test("confirms a token and exposes a clear next action", async ({ page }) => {
        await page.route("**/api/auth/email-verification/confirm", async (route) => {
            expect(route.request().method()).toBe("POST");
            expect(route.request().postDataJSON()).toEqual({
                token: "00000000-0000-4000-8000-000000000000.signature",
            });
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ ok: true }),
            });
        });

        await page.goto(
            "/verify-email?token=00000000-0000-4000-8000-000000000000.signature"
        );
        await expect(
            page.getByRole("heading", { name: "Doğrulama tamamlandı" })
        ).toBeVisible();
        await expect(
            page.getByRole("link", { name: "Giriş ekranına git" })
        ).toBeVisible();
    });
});
