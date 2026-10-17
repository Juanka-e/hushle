import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Renders /test/card-text (static fixtures, no DB) and checks that long words
// stay fully visible and are upper-cased by their word pack locale.

interface FixtureExpectation {
    key: string;
    word: string;
    lang: string;
    taboo?: string[];
    /** Pathological single words are allowed to break inside the word. */
    mayBreakInside?: boolean;
}

const fixtures: FixtureExpectation[] = [
    { key: "tr-kitap", word: "KİTAP", lang: "tr-TR", taboo: ["OKUMAK", "SAYFA", "YAZAR", "KÜTÜPHANE", "ROMAN"] },
    { key: "tr-elektrik", word: "ELEKTRİK MÜHENDİSLİĞİ", lang: "tr-TR", taboo: ["AKIM", "DEVRE", "ÜNİVERSİTE", "MÜHENDİS", "VOLTAJ"] },
    { key: "tr-programci", word: "BİLGİSAYAR PROGRAMCISI", lang: "tr-TR", taboo: ["YAZILIM GELİŞTİRİCİ", "KOD", "ALGORİTMA", "KLAVYE", "İŞLETİM SİSTEMİ"] },
    { key: "tr-gokkusagi", word: "GÖKKUŞAĞI", lang: "tr-TR" },
    { key: "tr-kaliforniya", word: "KALİFORNİYA", lang: "tr-TR", taboo: ["AMERİKA", "EYALET", "LOS ANGELES", "HOLLYWOOD", "SAN FRANCİSCO"] },
    { key: "tr-bagimsizlik", word: "BAĞIMSIZLIK GÜNÜ", lang: "tr-TR", taboo: ["DÖRT TEMMUZ", "AMERİKA BİRLEŞİK DEVLETLERİ", "BAYRAM", "HAVAİ FİŞEK", "KUTLAMA"] },
    { key: "tr-room-fallback", word: "ŞİŞLİ İSKELESİ", lang: "tr-TR" },
    { key: "tr-extreme", word: "MUVAFFAKİYETSİZLEŞTİRİCİLEŞTİRİVEREMEYEBİLECEKLERİMİZDENMİŞSİNİZCESİNE", lang: "tr-TR", mayBreakInside: true },
    { key: "en-electromagnetic", word: "ELECTROMAGNETIC", lang: "en-US", taboo: ["MAGNET", "ELECTRICITY", "FIELD", "WAVE", "RADIATION"] },
    { key: "en-photosynthesis", word: "PHOTOSYNTHESIS", lang: "en-US", taboo: ["PLANT", "SUNLIGHT", "CHLOROPHYLL", "OXYGEN", "CARBON DIOXIDE"] },
    { key: "en-independence", word: "INDEPENDENCE DAY", lang: "en-US" },
    { key: "en-pizza", word: "PIZZA", lang: "en-US", taboo: ["ITALY", "CHEESE", "SLICE", "DELIVERY", "PEPPERONI"] },
    { key: "en-extreme", word: "PNEUMONOULTRAMICROSCOPICSILICOVOLCANOCONIOSIS", lang: "en-US", mayBreakInside: true },
];

const widths = [320, 360, 390, 1280];
const uiLocales = ["en", "tr"] as const;

interface TextMetrics {
    testId: string;
    text: string;
    lang: string;
    scrollWidth: number;
    clientWidth: number;
    left: number;
    right: number;
    lines: number;
    fitSize: string | null;
    fitBreak: string | null;
}

interface FixtureMetrics {
    key: string;
    cardLeft: number;
    cardRight: number;
    cardHeight: number;
    texts: TextMetrics[];
}

async function collectMetrics(page: Page): Promise<FixtureMetrics[]> {
    return page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-testid^='card-fixture-']")).map(
            (section) => {
                const card = section.querySelector<HTMLElement>("[data-testid='game-card']")!;
                const cardBox = card.getBoundingClientRect();
                const elements = [
                    section.querySelector<HTMLElement>("[data-testid='game-card-word']")!,
                    ...Array.from(section.querySelectorAll<HTMLElement>("[data-testid='game-card-taboo']")),
                ];
                return {
                    key: section.dataset.testid!.replace("card-fixture-", ""),
                    cardLeft: cardBox.left,
                    cardRight: cardBox.right,
                    cardHeight: cardBox.height,
                    texts: elements.map((element) => {
                        const box = element.getBoundingClientRect();
                        const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
                        return {
                            testId: element.dataset.testid!,
                            text: element.innerText.trim(),
                            lang: element.lang,
                            scrollWidth: element.scrollWidth,
                            clientWidth: element.clientWidth,
                            left: box.left,
                            right: box.right,
                            lines: Math.round(element.offsetHeight / lineHeight),
                            fitSize: element.dataset.fitSize ?? null,
                            fitBreak: element.dataset.fitBreak ?? null,
                        };
                    }),
                };
            }
        )
    );
}

for (const uiLocale of uiLocales) {
    for (const width of widths) {
        test(`card text fits and keeps word pack casing (${uiLocale} UI, ${width}px)`, async ({
            page,
            baseURL,
        }) => {
            await page.context().addCookies([
                { name: "hushle_locale", value: uiLocale, url: baseURL ?? "http://127.0.0.1:3201" },
            ]);
            await page.setViewportSize({ width, height: 900 });
            await page.goto("/test/card-text");
            await expect(page.locator("html")).toHaveAttribute("lang", uiLocale);

            // The fit runs after hydration and again once web fonts are ready.
            await expect(page.locator("[data-testid='game-card-word'][data-fit-size]")).toHaveCount(
                fixtures.length
            );
            await page.evaluate(async () => {
                await document.fonts.ready;
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            });

            const metrics = await collectMetrics(page);
            expect(metrics.map((entry) => entry.key)).toEqual(fixtures.map((fixture) => fixture.key));

            const documentOverflow = await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth
            );
            expect(documentOverflow).toBeLessThanOrEqual(1);

            const summary: string[] = [];
            for (const fixture of fixtures) {
                const entry = metrics.find((candidate) => candidate.key === fixture.key)!;
                const [word, ...taboo] = entry.texts;

                expect(word.text, `${fixture.key} word casing`).toBe(fixture.word);
                expect(word.lang, `${fixture.key} word lang`).toBe(fixture.lang);
                if (fixture.taboo) {
                    expect(taboo.map((item) => item.text), `${fixture.key} taboo casing`).toEqual(fixture.taboo);
                }

                for (const text of entry.texts) {
                    const label = `${fixture.key} ${text.testId} "${text.text}" at ${width}px`;
                    expect(text.lang, `${label} lang`).toBe(fixture.lang);
                    expect(text.scrollWidth, `${label} is clipped`).toBeLessThanOrEqual(text.clientWidth);
                    expect(text.left, `${label} starts outside the card`).toBeGreaterThanOrEqual(entry.cardLeft - 0.5);
                    expect(text.right, `${label} ends outside the card`).toBeLessThanOrEqual(entry.cardRight + 0.5);
                    if (!fixture.mayBreakInside) {
                        expect(text.fitBreak, `${label} broke inside a word`).toBe("false");
                    }
                }
                if (!fixture.mayBreakInside) {
                    expect(word.lines, `${fixture.key} word lines`).toBeLessThanOrEqual(2);
                } else {
                    expect(word.fitBreak, `${fixture.key} uses the last resort`).toBe("true");
                }

                summary.push(
                    `${fixture.key}: word ${word.fitSize}px/${word.lines}l, taboo ${taboo
                        .map((item) => `${item.fitSize}${item.lines > 1 ? `/${item.lines}l` : ""}`)
                        .join(",")}, card ${Math.round(entry.cardHeight)}px`
                );
            }
            console.log(`[${uiLocale} ${width}px]\n${summary.join("\n")}`);

            const screenshotDir = process.env.CARD_TEXT_SCREENSHOT_DIR;
            if (screenshotDir) {
                mkdirSync(screenshotDir, { recursive: true });
                await page.screenshot({
                    path: path.join(screenshotDir, `card-text-${uiLocale}-${width}.png`),
                    fullPage: true,
                });
            }
        });
    }
}

test("card text refits when the card width changes", async ({ page }) => {
    const word = page.locator("[data-testid='card-fixture-en-electromagnetic'] [data-testid='game-card-word']");
    const fitSize = async () => Number(await word.getAttribute("data-fit-size"));
    const isClipped = () =>
        word.evaluate((element) => element.scrollWidth > element.clientWidth);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/test/card-text");
    await expect(word).toHaveAttribute("data-fit-size", /\d+/);
    await page.evaluate(() => document.fonts.ready);
    const desktopSize = await fitSize();

    // Phone rotation / window resize: the resize observer shrinks the text.
    await page.setViewportSize({ width: 320, height: 900 });
    await expect.poll(fitSize).toBeLessThan(desktopSize);
    expect(await isClipped()).toBe(false);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(fitSize).toBe(desktopSize);
    expect(await isClipped()).toBe(false);
});
