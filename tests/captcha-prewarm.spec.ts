import { expect, test } from "@playwright/test";

test("captcha prewarm loads the provider without creating a token", async ({ page }) => {
    let scriptRequests = 0;

    await page.route("**/api/security/captcha-config*", async (route) => {
        await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                enabled: true,
                required: true,
                provider: "turnstile",
                siteKey: "test-site-key",
                failMode: "hard_fail",
                turnstileMode: "managed",
                turnstileInteractiveFallback: true,
            }),
        });
    });
    await page.route("**/turnstile/v0/api.js*", async (route) => {
        scriptRequests += 1;
        await route.fulfill({
            contentType: "application/javascript",
            body: `window.__turnstileRenderCount = 0;
                window.turnstile = {
                    render() { window.__turnstileRenderCount += 1; return "widget-id"; },
                    execute() {}
                };`,
        });
    });

    await page.goto("/login");
    const submit = page.getByRole("button", { name: "Giriş Yap" });
    await submit.focus();

    await expect.poll(() => scriptRequests).toBe(1);
    await expect.poll(() => page.evaluate(() => {
        const state = window as typeof window & { __turnstileRenderCount?: number };
        return state.__turnstileRenderCount ?? -1;
    })).toBe(0);
    await expect(page.locator('link[rel="preconnect"][href="https://challenges.cloudflare.com"]')).toHaveCount(1);
    await expect(page.locator("[data-hushle-captcha]" )).toHaveCount(0);
});
