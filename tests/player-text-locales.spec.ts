import { expect, test, type Page } from "@playwright/test";

// Player surfaces whose text used to be hard-coded Turkish: page titles and the hidden-room
// page. The hidden-room page also used to read browser storage during render.
const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3201";

async function useLocale(page: Page, locale: "tr" | "en"): Promise<void> {
    await page.context().addCookies([{ name: "hushle_locale", value: locale, url: baseURL }]);
}

/** Page errors and React hydration reports (dev text or production error codes). */
function collectProblems(page: Page): string[] {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error" && /hydrat|#418|#423|#425/i.test(message.text())) {
            problems.push(message.text());
        }
    });
    return problems;
}

async function titleOf(page: Page, path: string, locale: "tr" | "en"): Promise<string> {
    const response = await page.request.get(path, { headers: { cookie: `hushle_locale=${locale}` } });
    expect(response.ok()).toBe(true);
    return (await response.text()).match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
}

const copy = {
    tr: {
        titles: { "/login": /^Giriş Yap \| /, "/register": /^Kayıt Ol \| /, "/room/ABC123": /^Oyun Odası \| / },
        noRoom: "Aktif oda bulunamadı",
        home: "Ana sayfaya dön",
        hidden: "Oda bağlantısı gizli",
        show: "Odayı göster",
    },
    en: {
        titles: { "/login": /^Log In \| /, "/register": /^Create Account \| /, "/room/ABC123": /^Game Room \| / },
        noRoom: "No active room found",
        home: "Back to home",
        hidden: "Room link hidden",
        show: "Show room",
    },
} as const;

for (const locale of ["tr", "en"] as const) {
    const text = copy[locale];

    test(`page titles follow the ${locale} locale`, async ({ page }) => {
        for (const [path, title] of Object.entries(text.titles)) {
            expect(await titleOf(page, path, locale), path).toMatch(title);
        }
    });

    test(`hidden room page without a stored room (${locale})`, async ({ page }) => {
        const problems = collectProblems(page);
        await useLocale(page, locale);
        await page.goto("/room");
        await expect(page.getByRole("heading", { name: text.noRoom })).toBeVisible();
        await expect(page.getByRole("link", { name: text.home })).toHaveAttribute("href", "/");
        expect(problems).toEqual([]);
    });

    test(`hidden room page shows the stored room without a hydration error (${locale})`, async ({ page }) => {
        const problems = collectProblems(page);
        await useLocale(page, locale);
        await page.addInitScript(() => {
            window.sessionStorage.setItem("tabu_activeRoomCode", "HIDE01");
            window.localStorage.setItem("tabu_room_hide_url:HIDE01", "true");
        });
        await page.goto("/room");
        await expect(page.getByRole("heading", { name: text.hidden })).toBeVisible();
        // Give a late hydration report time to arrive before checking.
        await page.waitForTimeout(500);
        expect(problems).toEqual([]);

        await page.getByRole("button", { name: text.show }).click();
        await expect(page).toHaveURL(/\/room\/HIDE01$/);
        expect(await page.evaluate(() => window.localStorage.getItem("tabu_room_hide_url:HIDE01"))).toBe("false");
    });
}

test("hidden room page forwards to a room that is not hidden", async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem("tabu_activeRoomCode", "SHOW01"));
    await page.goto("/room");
    await expect(page).toHaveURL(/\/room\/SHOW01$/);
});
