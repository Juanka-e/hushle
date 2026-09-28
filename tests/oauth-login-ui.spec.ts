import { expect, test } from "@playwright/test";

test("Google sign-in is visible only when the provider is configured", async ({
    page,
}) => {
    test.skip(
        process.env.GOOGLE_OAUTH_ENABLED !== "true",
        "Google provider UI requires the explicit test environment"
    );

    await page.goto("/login");
    await expect(
        page.getByRole("button", { name: "Google ile devam et" })
    ).toBeVisible();
    await expect(page.getByText("veya", { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 320, height: 568 });
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    document.documentElement.scrollWidth <=
                    document.documentElement.clientWidth + 1
            )
        )
        .toBe(true);

    await page.goto("/auth/error?error=OAuthAccountNotLinked");
    await expect(page).toHaveURL(/\/login\?error=OAuthAccountNotLinked$/);
    await expect(page.getByText(/mevcut bir hesaba ait/i)).toBeVisible();
});
