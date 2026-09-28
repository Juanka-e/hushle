import { expect, test } from "@playwright/test";

test("compact word language and collapsed settings work on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByLabel("Dil", { exact: true }).selectOption("en");
    await page.getByPlaceholder("Enter your name...").fill("Setup Test");
    await page.getByRole("button", { name: "Create New Room", exact: true }).click();
    await expect(page).toHaveURL(/\/room\/[A-Z0-9]{6}$/);
    const language = page.getByLabel("Word language", { exact: true });
    await expect(language).toBeVisible();
    await expect(language).toHaveValue("tr");
    await language.selectOption("en");
    await expect(language).toHaveValue("en");
    const settings = page.locator("details").filter({ has: page.locator("summary", { hasText: "Game settings" }) });
    await expect(settings).not.toHaveAttribute("open", "");
    await settings.locator("summary").click();
    await expect(settings).toHaveAttribute("open", "");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: "test-results/lobby-setup-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(language).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: "test-results/lobby-setup-desktop.png", fullPage: true });
});
