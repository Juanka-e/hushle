import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// The public stream screen (/stream/[viewKey], the OBS browser source). The demo scenes
// (?demo=) need the server started with STREAMER_FAKE_PLATFORM=1. Screenshots land in
// test-results/stream-screen/ (git-ignored) for an eye check against the V4 prototype.

const enabled = process.env.STREAMER_FAKE_PLATFORM === "1";
const THEMES = ["oyun-gecesi", "studyo", "gece-altini", "sakura", "sade"] as const;
const STATES = [
    "empty",
    "ready",
    "running",
    "low",
    "paused",
    "offline",
    "solved",
    "timeout",
    "passed",
    "ended",
    "longnames",
] as const;
type DemoState = (typeof STATES)[number];
const PHASE_OF: Record<DemoState, string> = {
    empty: "ready",
    ready: "ready",
    running: "running",
    low: "running",
    paused: "paused",
    offline: "paused",
    solved: "finished",
    timeout: "finished",
    passed: "running",
    ended: "ended",
    longnames: "running",
};
const SHOTS = path.join("test-results", "stream-screen");
// Any path segment works for a demo; the scene never connects.
const DEMO = "/stream/preview";

async function settle(page: Page): Promise<void> {
    const screen = page.locator("main.hushle-stream");
    await expect(screen).toHaveAttribute("data-ready", "true");
    await expect(screen).toHaveAttribute("data-fonts", "ready");
    // The dev server's indicator would sit on top of the scene. (page.addStyleTag would also
    // report the dev environment's unrelated favicon CSP violation as its own failure.)
    await page.evaluate(() => {
        const style = document.createElement("style");
        style.textContent = "nextjs-portal { display: none !important; }";
        document.head.append(style);
    });
}

async function openDemo(page: Page, query: string): Promise<void> {
    await page.goto(`${DEMO}?${query}`);
    await settle(page);
}

async function checkScene(page: Page, state: DemoState): Promise<void> {
    const text = (id: string) => page.locator(`#${id}`);
    switch (state) {
        case "empty":
            await expect(text("seconds")).toHaveText("Hazır");
            await expect(text("last-empty")).toBeVisible();
            await expect(text("last-empty")).toHaveText("Henüz kimse bilmedi");
            await expect(text("participants")).toHaveText("Henüz tahmin yok");
            break;
        case "ready":
            await expect(text("seconds")).toHaveText("Hazır");
            await expect(text("seconds-note")).toHaveText("60 sn");
            await expect(text("prompt")).toContainText("Yayıncı başlatınca");
            break;
        case "running":
            await expect(text("seconds")).toHaveText("38");
            await expect(text("prompt")).toContainText("Twitch sohbetine yaz");
            await expect(text("reveal-target")).toHaveText("");
            await expect(text("card")).not.toHaveClass(/flipped/);
            break;
        case "low":
            await expect(page.locator(".timer")).toHaveClass(/low/);
            await expect(text("seconds")).toHaveText("7");
            await expect(text("prompt")).toContainText("Son 10 saniye!");
            break;
        case "paused":
            await expect(text("pause-sign")).toBeVisible();
            await expect(text("pause-sign")).toHaveText("Kısa bir ara");
            await expect(text("seconds-note")).toHaveText("durdu");
            break;
        case "offline":
            await expect(text("pause-sign")).toHaveText("Bağlantı bekleniyor");
            await expect(text("prompt")).toHaveText("Sohbet bağlantısı bekleniyor.");
            break;
        case "solved":
            await expect(text("card")).toHaveClass(/flipped/);
            await expect(text("verdict")).toHaveAttribute("data-kind", "solved");
            await expect(text("verdict-word")).toHaveText("Bildi!");
            await expect(text("verdict-detail")).toHaveText("Deniz · 8,4 sn");
            await expect(text("reveal-target")).toHaveText("MANDALİNA");
            await expect(page.locator("#reveal-taboos li")).toHaveCount(5);
            await expect(text("last-name")).toHaveText("Deniz");
            await expect(text("last-points")).toBeVisible();
            break;
        case "timeout":
            await expect(text("verdict-word")).toHaveText("Süre doldu");
            await expect(text("reveal-target")).toHaveText("MANDALİNA");
            await expect(text("last-points")).toBeHidden();
            break;
        case "passed":
            await expect(text("seconds")).toHaveText("60");
            await expect(text("round")).toHaveText("8. tur");
            await expect(text("reveal-target")).toHaveText("");
            break;
        case "ended":
            await expect(text("winner")).toBeVisible();
            await expect(text("winner-label")).toHaveText("Berabere bitirdiler");
            await expect(text("winner-name")).toHaveText("Deniz · Luna");
            await expect(text("scores-title")).toHaveText("Gecenin skoru");
            break;
        case "longnames": {
            await expect(text("channel")).toHaveText("@ahmetyilmazgunlukvlogoyun · YouTube");
            // Long chat names shrink, then ellipsize: nothing leaves its slot or the canvas.
            const overflow = await page.evaluate(() => {
                const slot = document.querySelector(".scores")!.getBoundingClientRect();
                return [...document.querySelectorAll(".score-name, #last-name")]
                    .map((node) => node.getBoundingClientRect())
                    .filter((box) => box.right > Math.min(slot.right, 1920) + 1 && box.width > 0).length;
            });
            expect(overflow).toBe(0);
            break;
        }
    }
}

test.describe("stream screen", () => {
    test.skip(!enabled, "set STREAMER_FAKE_PLATFORM=1 (and start the server with it) to run");
    test.use({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });

    for (const theme of THEMES) {
        test(`demo scenes render for ${theme}`, async ({ page }) => {
            test.setTimeout(150_000);
            const screen = page.locator("main.hushle-stream");
            for (const state of STATES) {
                await openDemo(page, `demo=${state}&theme=${theme}`);
                await expect(screen).toHaveAttribute("data-theme", theme);
                await expect(screen).toHaveAttribute("data-phase", PHASE_OF[state]);
                await checkScene(page, state);
                await page.screenshot({ path: path.join(SHOTS, `${theme}-${state}.png`) });
            }
        });
    }

    test("the running demo carries no word in its HTML or DOM, and is not indexed", async ({ page, request }) => {
        const response = await request.get(`${DEMO}?demo=running`);
        expect(response.status()).toBe(200);
        const html = await response.text();
        expect(html).toContain("hushle-stream");
        expect(html).not.toContain("MANDALİNA");
        expect(html).not.toContain("fonts.googleapis.com");
        expect(html).not.toContain("reference-cards");

        await openDemo(page, "demo=running");
        expect(await page.content()).not.toContain("MANDALİNA");
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    });

    test("the half column and the overlay strip render", async ({ page }) => {
        test.setTimeout(90_000);
        const screen = page.locator("main.hushle-stream");
        for (const theme of THEMES) {
            await page.setViewportSize({ width: 960, height: 1080 });
            await openDemo(page, `demo=running&layout=half&theme=${theme}`);
            await expect(screen).toHaveAttribute("data-mode", "half");
            await expect(screen).toHaveAttribute("data-layout", "half");
            await expect(screen).toHaveAttribute("data-scores", "stack");
            await expect(screen).toHaveAttribute("data-timer", "compact");
            const half = await page.locator(".stage").boundingBox();
            expect(Math.round(half?.width ?? 0)).toBe(960);
            expect(Math.round(half?.height ?? 0)).toBe(1080);
            await page.screenshot({ path: path.join(SHOTS, `${theme}-half-running.png`) });

            await page.setViewportSize({ width: 1920, height: 220 });
            await openDemo(page, `demo=solved&overlay=top&theme=${theme}`);
            await expect(screen).toHaveAttribute("data-mode", "strip");
            await expect(screen).toHaveAttribute("data-layout", "strip");
            await expect(screen).toHaveAttribute("data-strip", "top");
            await expect(page.locator(".hero")).toBeHidden();
            await expect(page.locator("#strip-chip")).toBeVisible();
            await expect(page.locator("#strip-chip")).toContainText("Bildi! · MANDALİNA");
            const strip = await page.locator(".stage").boundingBox();
            expect(Math.round(strip?.y ?? -1)).toBe(0);
            expect(Math.round(strip?.height ?? 0)).toBe(220);
            await page.screenshot({ path: path.join(SHOTS, `${theme}-strip-top-solved.png`) });
        }
    });

    test("an unknown view key shows the offline scene and never prints the key", async ({ page }) => {
        // A malformed key (refused before connecting) and a well-formed one the server does not know.
        for (const key of ["not-a-real-key", "A".repeat(43)]) {
            await page.goto(`/stream/${key}`);
            const screen = page.locator("main.hushle-stream");
            await expect(screen).toHaveAttribute("data-ready", "true");
            await expect(screen).toHaveAttribute("data-phase", "paused", { timeout: 10_000 });
            await expect(page.locator("#pause-sign")).toHaveText("Bağlantı bekleniyor");
            expect(await page.title()).not.toContain(key);
            expect(await page.locator("body").innerText()).not.toContain(key);
        }
    });

    test("a ?demo= scene still names no view key and keeps the URL look", async ({ page }) => {
        await openDemo(page, "demo=running&theme=gece-altini&camera=left&clock=ring");
        const screen = page.locator("main.hushle-stream");
        await expect(screen).toHaveAttribute("data-theme", "gece-altini");
        await expect(screen).toHaveAttribute("data-camera", "left");
        await expect(screen).toHaveAttribute("data-layout", "left");
        await expect(screen).toHaveAttribute("data-clock", "ring");
        await expect(screen).toHaveClass(/preview/);
        await page.screenshot({ path: path.join(SHOTS, "gece-altini-left-ring-running.png") });
    });
});

test.describe("stream screen motion", () => {
    test.skip(!enabled, "set STREAMER_FAKE_PLATFORM=1 (and start the server with it) to run");
    test.use({ viewport: { width: 1920, height: 1080 }, reducedMotion: "no-preference" });

    test("the play loop stamps, flips, scores, passes, times out and ends", async ({ page }) => {
        test.setTimeout(120_000);
        await openDemo(page, "demo=play&theme=oyun-gecesi");
        const screen = page.locator("main.hushle-stream");
        await expect(screen).toHaveAttribute("data-phase", "ready");

        // Reveal sequencing: the stamp at once, the card 420 ms later, the score at 1.2 s.
        const marks = await page.evaluate(
            () =>
                new Promise<Record<string, number>>((resolve) => {
                    const root = document.querySelector("main.hushle-stream")!;
                    const seen: Record<string, number> = {};
                    const note = (key: string, on: boolean) => {
                        if (on && !(key in seen)) seen[key] = performance.now();
                    };
                    const observer = new MutationObserver(() => {
                        note("finished", root.getAttribute("data-phase") === "finished");
                        note("stamp", Boolean(document.querySelector("#verdict.show")));
                        note("flip", Boolean(document.querySelector("#card.flipped")));
                        note("score", document.querySelector("#last-name")?.textContent === "Deniz");
                        if (Object.keys(seen).length === 4) {
                            observer.disconnect();
                            resolve(seen);
                        }
                    });
                    observer.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
                })
        );
        expect(marks.stamp - marks.finished).toBeLessThan(100);
        expect(marks.flip - marks.finished).toBeGreaterThanOrEqual(380);
        expect(marks.flip - marks.finished).toBeLessThan(900);
        expect(marks.score - marks.finished).toBeGreaterThanOrEqual(1150);
        expect(marks.score - marks.finished).toBeLessThan(1900);
        await expect(page.locator("#verdict-word")).toHaveText("Bildi!");
        await page.screenshot({ path: path.join(SHOTS, "play-solved.png") });

        await expect(page.locator("#verdict")).toHaveAttribute("data-kind", "pass", { timeout: 20_000 });
        await expect(page.locator("#verdict-detail")).toHaveText("KUM SAATİ");
        await expect(page.locator(".timer")).toHaveClass(/low/, { timeout: 20_000 });
        await expect(page.locator("#verdict-word")).toHaveText("Süre doldu", { timeout: 20_000 });
        await expect(page.locator("#card")).toHaveClass(/flipped/, { timeout: 2_000 });
        await expect(screen).toHaveAttribute("data-phase", "ended", { timeout: 10_000 });
        await expect(page.locator("#winner")).toBeVisible();
        await page.screenshot({ path: path.join(SHOTS, "play-ended.png") });
    });
});
