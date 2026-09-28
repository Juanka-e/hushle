import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      )
    )
    .toBe(true);
}

test("home page renders primary lobby actions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Yeni Oda Oluştur" })).toBeVisible();
  await expect(page.getByPlaceholder("Adınızı girin...")).toBeVisible();
  await expect(page.getByPlaceholder("Örn: ABC123")).toBeVisible();
  await expect(page.getByRole("button", { name: "Duyuruları aç" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Temayı değiştir" })).toBeVisible();
});

test("home page validates guest identity before room actions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Yeni Oda Oluştur" })).toBeDisabled();
  await page.getByPlaceholder("Adınızı girin...").fill("Launch Guest");
  await expect(page.getByRole("button", { name: "Yeni Oda Oluştur" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Katıl", exact: true })).toBeDisabled();
});

test("announcements modal opens and closes accessibly", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Duyuruları aç" }).click();
  await expect(page.getByRole("heading", { name: "Yenilikler" })).toBeVisible();
  await page.getByRole("button", { name: "Kapat" }).click();
  await expect(page.getByRole("heading", { name: "Yenilikler" })).toBeHidden();
});

test("login page renders credentials form", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("button", { name: /Giriş Yap/i })).toBeVisible();
  await expect(page.getByPlaceholder(/Kullanıcı Adı/i)).toBeVisible();
  await expect(page.getByPlaceholder(/Parola/i)).toBeVisible();
});

test("register page renders complete account form", async ({ page }) => {
  await page.goto("/register");

  await expect(page.getByRole("button", { name: /Kayıt Ol/i })).toBeVisible();
  await expect(page.getByPlaceholder(/Kullanıcı adı/i)).toBeVisible();
  await expect(page.getByPlaceholder(/E-posta/i)).toBeVisible();
  await expect(page.getByPlaceholder(/Parola/i)).toBeVisible();
});

test("room page prompts guest username before joining", async ({ page }) => {
  await page.goto("/room/ABC123");

  await expect(page.locator("input[type='text']")).toBeVisible({ timeout: 15_000 });
});

test.describe("mobile web launch surfaces", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of ["/", "/login", "/register", "/room/ABC123"]) {
    test(`${path} has no horizontal page overflow`, async ({ page }) => {
      await page.goto(path);
      await expectNoHorizontalOverflow(page);
    });
  }
});
