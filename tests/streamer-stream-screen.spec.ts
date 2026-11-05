import { expect, test, type Page } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { prisma } from "@hushle/platform-db";

// The public stream screen (/stream/[viewKey], the OBS browser source). The demo scenes
// (?demo=) need the server started with STREAMER_FAKE_PLATFORM=1. Screenshots land in
// test-results/stream-screen/ (git-ignored) for an eye check against the V4 prototype. The live
// session test also needs STREAMER_TOKEN_KEY (server and here) and the test database.

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
        // The renderer builds the bulbs and segments once, however often React mounts it.
        await expect(page.locator("#bulb-ring circle")).toHaveCount(36);
        await expect(page.locator("#segment-bar rect")).toHaveCount(20);
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

test.describe("stream screen live session", () => {
    const live = enabled && Boolean(process.env.STREAMER_TOKEN_KEY);
    test.skip(!live, "set STREAMER_FAKE_PLATFORM=1 and STREAMER_TOKEN_KEY (and start the server with them) to run");
    test.describe.configure({ mode: "serial" });

    const suffix = randomUUID().slice(0, 8);
    const username = `stream_screen_${suffix}`;
    const password = `Stream-screen-${suffix}!`;
    // A login of its own, so no other run's fake channel holds the same platform account.
    const channelLogin = `screen-${suffix}`;
    let userId: number | null = null;
    let originalFeatures: unknown = undefined;

    async function setStreamerMode(on: boolean): Promise<void> {
        const current = await prisma.systemSetting.findUnique({ where: { key: "features" } });
        const value = { ...((current?.value as Record<string, unknown> | null) ?? {}), streamerModeEnabled: on };
        await prisma.systemSetting.upsert({ where: { key: "features" }, update: { value }, create: { key: "features", value } });
    }

    // Same-origin fetch from the signed-in page, so the origin check sees the app's own origin.
    async function post(page: Page, url: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
        return page.evaluate(
            async ({ url, body }) => {
                const response = await fetch(url, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: body === undefined ? undefined : JSON.stringify(body),
                });
                return { status: response.status, json: (await response.json()) as Record<string, unknown> };
            },
            { url, body }
        );
    }

    test.beforeAll(async () => {
        const existing = await prisma.systemSetting.findUnique({ where: { key: "features" } });
        originalFeatures = existing ? existing.value : undefined;
        const user = await prisma.user.create({
            data: { username, password: await bcryptjs.hash(password, 10) },
            select: { id: true },
        });
        userId = user.id;
        await setStreamerMode(true);
    });

    test.afterAll(async () => {
        if (originalFeatures === undefined) {
            await prisma.systemSetting.deleteMany({ where: { key: "features" } });
        } else {
            await prisma.systemSetting.update({ where: { key: "features" }, data: { value: originalFeatures as object } });
        }
        if (userId !== null) {
            await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await prisma.$disconnect();
    });

    test("joins with the view key, follows the session, goes dark on rotation and keeps the finale", async ({ page, browser }) => {
        // The settings cache (15 s TTL) is waited out once.
        test.setTimeout(150_000);
        await page.goto("/login");
        await page.getByPlaceholder(/Kullanıcı Adı/i).fill(username);
        await page.getByPlaceholder(/Parola/i).fill(password);
        await page.getByRole("button", { name: /^Giriş Yap$/i }).click();
        await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
        await expect
            .poll(
                async () => {
                    const response = await page.request.get("/api/streamer/connections");
                    return response.ok() ? ((await response.json()) as { enabled: boolean }).enabled : false;
                },
                { timeout: 40_000, intervals: [1_000] }
            )
            .toBe(true);

        // Link a fake Twitch channel under this run's own login.
        const start = await page.request.get("/api/streamer/connect/twitch/start", { maxRedirects: 0 });
        expect(start.status()).toBe(302);
        const authorize = new URL(start.headers().location, page.url());
        authorize.searchParams.set("login", channelLogin);
        await page.goto(authorize.toString());
        await page.waitForURL(/streamer=linked/, { timeout: 30_000 });

        const created = await post(page, "/api/streamer/sessions", {
            platform: "twitch",
            language: "tr",
            categoryIds: [1],
            difficulties: [1, 2, 3],
            duration: 60,
            tolerance: "normal",
            theme: "sade",
            camera: "none",
            cameraSize: "m",
            clock: null,
            cardBack: null,
            showCardName: false,
        });
        expect(created.status).toBe(201);
        const viewKey = created.json.viewKey as string;
        expect(viewKey).toMatch(/^[A-Za-z0-9_-]{43}$/);

        // OBS: a browser source without the streamer's cookies.
        const obs = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
        const screen = await obs.newPage();
        await screen.goto(`/stream/${viewKey}?theme=gece-altini`);
        const root = screen.locator("main.hushle-stream");
        // The join ack replaces the URL look with the session's own.
        await expect(root).toHaveAttribute("data-theme", "sade", { timeout: 10_000 });
        await expect(root).toHaveAttribute("data-phase", "ready");
        await expect(root).not.toHaveClass(/preview/);
        await expect(screen.locator("#channel")).toHaveText(`@${channelLogin} · Twitch`);
        await expect(screen.locator("#seconds")).toHaveText("Hazır");
        expect(await screen.title()).not.toContain(viewKey);
        expect(await screen.locator("body").innerText()).not.toContain(viewKey);
        await screen.screenshot({ path: path.join(SHOTS, "live-ready.png") });

        // A rotated key closes the old screen; the new key opens the same session.
        const rotated = await post(page, "/api/streamer/sessions/current/view-key");
        expect(rotated.status).toBe(200);
        const nextKey = rotated.json.viewKey as string;
        expect(nextKey).not.toBe(viewKey);
        await expect(root).toHaveAttribute("data-phase", "paused", { timeout: 10_000 });
        await expect(screen.locator("#pause-sign")).toHaveText("Bağlantı bekleniyor");
        await screen.screenshot({ path: path.join(SHOTS, "live-rotated-offline.png") });

        const second = await obs.newPage();
        await second.goto(`/stream/${nextKey}`);
        const secondRoot = second.locator("main.hushle-stream");
        await expect(secondRoot).toHaveAttribute("data-phase", "ready", { timeout: 10_000 });
        await expect(secondRoot).toHaveAttribute("data-theme", "sade");

        // Ending draws the finale; the closed room does not turn it into the offline scene.
        const ended = await post(page, "/api/streamer/sessions/current/end");
        expect(ended.status).toBe(200);
        await expect(secondRoot).toHaveAttribute("data-phase", "ended", { timeout: 10_000 });
        await expect(second.locator("#prompt")).toHaveText("Oyun bitti. Bir sonrakinde görüşürüz.");
        await second.waitForTimeout(6_000);
        await expect(secondRoot).toHaveAttribute("data-phase", "ended");
        await second.screenshot({ path: path.join(SHOTS, "live-ended.png") });

        // The old key stays dead after a reload.
        await screen.reload();
        await expect(root).toHaveAttribute("data-phase", "paused", { timeout: 10_000 });
        await obs.close();
    });
});
