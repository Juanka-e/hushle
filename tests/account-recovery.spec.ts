import { expect, test } from "@playwright/test";

test.describe("account recovery UI", () => {
    test("requests a reset without exposing account existence", async ({
        page,
    }) => {
        await page.route("**/api/security/captcha-config?*", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    enabled: false,
                    required: false,
                    provider: "none",
                    siteKey: null,
                    failMode: "soft_fail",
                    turnstileMode: "managed",
                    turnstileInteractiveFallback: true,
                }),
            })
        );
        await page.route("**/api/auth/password-reset/request", async (route) => {
            expect(route.request().postDataJSON()).toMatchObject({
                identifier: "unknown@example.test",
            });
            await route.fulfill({
                status: 202,
                contentType: "application/json",
                body: JSON.stringify({
                    message:
                        "Bilgiler bir hesapla eşleşiyorsa parola sıfırlama bağlantısı gönderilecek.",
                }),
            });
        });
        await page.goto("/forgot-password");
        await page
            .getByPlaceholder("Kullanıcı adı veya e-posta")
            .fill("unknown@example.test");
        await page.getByRole("button", { name: "Bağlantı iste" }).click();
        await expect(
            page.getByText(/bilgiler bir hesapla eşleşiyorsa/i)
        ).toBeVisible();
    });

    test("enforces password strength and confirms reset", async ({ page }) => {
        await page.route("**/api/auth/password-reset/confirm", async (route) => {
            expect(route.request().postDataJSON()).toMatchObject({
                token: "00000000-0000-4000-8000-000000000000.signature",
                password: "A-stronger-password-2026!",
            });
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ ok: true }),
            });
        });
        await page.goto(
            "/reset-password?token=00000000-0000-4000-8000-000000000000.signature"
        );
        await page
            .getByPlaceholder("Yeni parola", { exact: true })
            .fill("A-stronger-password-2026!");
        await page
            .getByPlaceholder("Yeni parolayı tekrar yaz")
            .fill("A-stronger-password-2026!");
        await page.getByRole("button", { name: "Parolayı değiştir" }).click();
        await expect(
            page.getByRole("heading", { name: "Parola yenilendi" })
        ).toBeVisible();
    });

    test("confirms a pending email change", async ({ page }) => {
        await page.route("**/api/auth/email-change/confirm", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ ok: true }),
            })
        );
        await page.goto(
            "/verify-email-change?token=00000000-0000-4000-8000-000000000000.signature"
        );
        await expect(
            page.getByRole("heading", { name: "E-posta değiştirildi" })
        ).toBeVisible();
        await expect(page.getByRole("link", { name: "Giriş ekranına git" }))
            .toBeVisible();
    });
});
