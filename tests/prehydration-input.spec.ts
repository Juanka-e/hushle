import { expect, type Locator, type Page, test } from "@playwright/test";

// Slow phones show server-rendered forms seconds before React hydrates. Text typed (or
// autofilled) in that window must survive hydration and the next re-render.

async function gotoWithScriptsHeld(page: Page, path: string): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/_next/static/**/*.js", async (route) => {
    await released;
    await route.continue();
  });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  return release;
}

async function waitForHydration(input: Locator): Promise<void> {
  // React attaches its props to the DOM node once it has hydrated it.
  await expect
    .poll(() => input.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactProps$"))), {
      timeout: 20_000,
    })
    .toBe(true);
}

const forms = [
  {
    path: "/login",
    early: [{ placeholder: "Kullanıcı adı", value: "early_login_user" }],
    late: { placeholder: "Parola", value: "Mercan-early vapuru 2026" },
  },
  {
    path: "/register",
    early: [
      { placeholder: "Kullanıcı adı", value: "early_register_user" },
      { placeholder: "E-posta", value: "early@example.test" },
    ],
    late: { placeholder: "Parola", value: "Mercan-early vapuru 2026" },
  },
];

for (const form of forms) {
  test(`text typed before hydration survives on ${form.path}`, async ({ page }) => {
    const release = await gotoWithScriptsHeld(page, form.path);
    for (const field of form.early) {
      await page.getByPlaceholder(field.placeholder, { exact: true }).fill(field.value);
    }
    release();

    const late = page.getByPlaceholder(form.late.placeholder, { exact: true });
    await waitForHydration(late);
    // Typing into another field re-renders the form; React would reset unadopted text here.
    await late.fill(form.late.value);

    for (const field of form.early) {
      await expect(page.getByPlaceholder(field.placeholder, { exact: true })).toHaveValue(field.value);
    }
    await expect(late).toHaveValue(form.late.value);
  });
}
