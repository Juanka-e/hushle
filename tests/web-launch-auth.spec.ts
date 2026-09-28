import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { prisma } from "@hushle/platform-db";

test.describe("registered web launch flow", () => {
  test.skip(
    process.env.WEB_LAUNCH_DB_E2E !== "true",
    "WEB_LAUNCH_DB_E2E=true is required for the disposable DB flow"
  );

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const username = `launch_${suffix}`;
  const email = `${username}@example.test`;
  const password = `Mercan-${suffix} vapuru 2026`;

  test.beforeAll(() => {
    expect(process.env.DATABASE_URL ?? "").toMatch(/tabu_test/);
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  test("registers, logs in, opens a room and reaches the lobby", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("button", { name: /Giriş Yap/i })).toBeVisible();

    await page.goto("/register");
    await page.getByPlaceholder(/Kullanıcı adı/i).fill(username);
    await page.getByPlaceholder(/E-posta/i).fill(email);
    await page.getByPlaceholder(/Parola/i).fill(password);
    await page.getByRole("button", { name: /^Kayıt Ol$/i }).click();

    await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
    await page.getByPlaceholder(/Kullanıcı Adı/i).fill(username);
    await page.getByPlaceholder(/Parola/i).fill(password);
    await page.getByRole("button", { name: /^Giriş Yap$/i }).click();

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
        )
      )
      .toBe(true);
    await page.getByRole("button", { name: /^Oyna$/i }).click();
    await page.getByRole("button", { name: /Yeni Oda Oluştur|Create New Room/i }).click();
    await expect(page).toHaveURL(/\/room\/[A-Z0-9]{6}$/, { timeout: 15_000 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
        )
      )
      .toBe(true);
    await expect(page.getByText(username, { exact: false }).first()).toBeVisible();
  });
});
