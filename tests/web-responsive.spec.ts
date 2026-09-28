import { expect, type Locator, type Page, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      )
    )
    .toBe(true);
}

async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) {
    return;
  }

  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + Math.min(box.height, 24)).toBeLessThanOrEqual(viewport.height + 1);
  expect(box.width).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(24);
}

test("home actions remain usable within the viewport", async ({ page }) => {
  await page.goto("/");

  await expectNoHorizontalOverflow(page);
  await expectInsideViewport(page, page.getByRole("button", { name: "Giriş Yap" }));
  await expectInsideViewport(page, page.getByRole("button", { name: "Kayıt Ol" }));
  await expectInsideViewport(page, page.getByRole("button", { name: "Duyuruları aç" }));
  await expectInsideViewport(page, page.getByRole("button", { name: "Temayı değiştir" }));
  await expectInsideViewport(page, page.getByPlaceholder("Adınızı girin..."));
  await expectInsideViewport(page, page.getByRole("button", { name: "Yeni Oda Oluştur" }));
});

test("account forms remain usable within the viewport", async ({ page }) => {
  for (const route of ["/login", "/register"]) {
    await page.goto(route);
    await expectNoHorizontalOverflow(page);
    await expectInsideViewport(
      page,
      page.getByPlaceholder(
        route === "/login" ? /Kullanıcı Adı/i : /Kullanıcı adı/i
      )
    );
    await expectInsideViewport(
      page,
      page.getByPlaceholder(/Parola/i)
    );
    await expectInsideViewport(
      page,
      page.getByRole("button", {
        name: route === "/login" ? /^Giriş Yap$/i : /^Kayıt Ol$/i,
      })
    );
  }
});

test("guest room prompt remains usable within the viewport", async ({ page }) => {
  await page.goto("/room/ABC123");

  await expectNoHorizontalOverflow(page);
  await expectInsideViewport(page, page.locator("input[type='text']"));
});

test("announcements remain dismissible within the viewport", async ({ page }) => {
  await page.route("**/api/announcements/visible", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Duyuruları aç" }).click();

  await expectNoHorizontalOverflow(page);
  await expectInsideViewport(page, page.getByRole("button", { name: "Kapat" }));
  await expectInsideViewport(page, page.getByRole("button", { name: "Güncellemeler" }));
  await expectInsideViewport(page, page.getByRole("button", { name: "Duyurular", exact: true }));
  await expectInsideViewport(page, page.getByRole("button", { name: "S.S.S." }));

  await page.getByRole("button", { name: "Kapat" }).click();
  await expect(page.getByRole("heading", { name: "Yenilikler" })).toBeHidden();
});
