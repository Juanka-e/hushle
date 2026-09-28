import { expect, test } from "@playwright/test";

test("player locale switches to English and persists across reload", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel("Dil").selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Create New Room" })).toBeVisible();
    await expect(page.getByPlaceholder("Enter your name...")).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("hushle_locale"))).toBe("en");

    await page.reload();
    await expect(page.getByRole("button", { name: "Create New Room" })).toBeVisible();
    await expect(page.getByLabel("Language")).toHaveValue("en");
});

test("announcement navigation exposes updates, announcements and FAQ in English", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Dil").selectOption("en");
    await page.getByRole("button", { name: "Open announcements" }).click();

    await expect(page.getByRole("button", { name: "Updates", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Announcements", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "FAQ", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: "What's New" })).toBeHidden();
});

test("announcement panel follows the global light and dark theme", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Dil").selectOption("en");

    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("button", { name: "Open announcements" }).click();
    const panel = page.getByTestId("announcements-panel");
    const darkBackground = await panel.evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "Change theme" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.getByRole("button", { name: "Open announcements" }).click();
    const lightBackground = await panel.evaluate((element) => getComputedStyle(element).backgroundColor);

    expect(lightBackground).not.toBe(darkBackground);
});
