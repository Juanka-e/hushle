import assert from "node:assert/strict";
import type { PublicStreamSnapshot } from "@hushle/domain-streamer";
import { cameraRect, offlineState, readSnapshot, urlLookSnapshot } from "@/components/stream/stream-renderer";

// The stream screen's pure parts: the snapshot reader (the screen's allowlist) and the camera
// hole geometry. The DOM side is covered by tests/streamer-stream-screen.spec.ts.

let count = 0;
async function test(name: string, run: () => void | Promise<void>): Promise<void> {
    await run();
    count += 1;
    console.log(`ok - ${name}`);
}

function snapshot(patch: Record<string, unknown> = {}): Record<string, unknown> {
    const base: PublicStreamSnapshot = {
        type: "public-state",
        schemaVersion: 4,
        revision: 3,
        phase: "running",
        remaining: 38,
        duration: 60,
        round: 7,
        passedRound: null,
        theme: "sade",
        camera: "br",
        cameraSize: "m",
        clock: null,
        showCardName: true,
        channel: { platform: "twitch", name: "denizoynuyor" },
        passed: null,
        participants: 23,
        pack: "TR",
        scores: [
            { name: "Luna", points: 7, rank: 1, tied: false },
            { name: "Deniz", points: 6, rank: 2, tied: false },
        ],
        lastCorrect: { eventId: "e-6", name: "Luna", round: 6, pointsGranted: 1, solveMs: 14200 },
        cardBack: null,
        connected: true,
        reveal: null,
    };
    return { ...base, ...patch };
}

const cardBack = {
    itemId: 42,
    name: "Gece Mavisi",
    imageUrl: "https://cdn.example.com/item.png",
    theme: {
        renderSpecVersion: 1,
        requestedRenderSpecVersion: 1,
        usedRenderSpecFallback: false,
        surfaceColor: "#111827",
        borderColor: "#60a5fa",
        accentColor: "#22d3ee",
        secondaryColor: "#93c5fd",
        titleColor: "#f8fafc",
        detailColor: "#cbd5e1",
        pattern: "grid",
        patternOpacity: 0.2,
        patternScale: 18,
        motionPreset: "drift",
        motionSpeedMs: 7000,
        glowColor: "#38bdf8",
        glowBlur: 24,
        glowOpacity: 0.2,
        overlayImageUrl: null,
        overlayOpacity: 0,
    },
};

async function main(): Promise<void> {
    await test("a v4 public snapshot reads into a screen state", () => {
        const state = readSnapshot(snapshot());
        assert.ok(state);
        assert.equal(state.revision, 3);
        assert.equal(state.phase, "running");
        assert.equal(state.theme, "sade");
        assert.equal(state.camera, "br");
        assert.equal(state.remaining, 38);
        assert.deepEqual(state.channel, { platform: "twitch", name: "denizoynuyor" });
        assert.equal(state.scores.length, 2);
        assert.deepEqual(state.lastCorrect, { eventId: "e-6", name: "Luna", round: 6, solveMs: 14200 });
        assert.equal(state.reveal, null);
        assert.equal(state.cardBack, null);
    });

    await test("anything but a v4 public-state with an integer revision is refused", () => {
        for (const bad of [null, undefined, 4, "public-state", [], {}]) assert.equal(readSnapshot(bad), null);
        assert.equal(readSnapshot(snapshot({ type: "host-state" })), null);
        assert.equal(readSnapshot(snapshot({ type: undefined })), null);
        for (const version of [3, 5, "4", null]) assert.equal(readSnapshot(snapshot({ schemaVersion: version })), null);
        for (const revision of [1.5, "3", Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
            assert.equal(readSnapshot(snapshot({ revision })), null, `revision ${String(revision)}`);
        }
        assert.ok(readSnapshot(snapshot({ revision: 0 })));
    });

    await test("unknown looks fall back: the first theme, no camera, size m, the theme's clock", () => {
        const state = readSnapshot(snapshot({ theme: "neon", camera: "middle", cameraSize: "xl", clock: "sundial", phase: "warmup" }));
        assert.ok(state);
        assert.equal(state.theme, "oyun-gecesi");
        assert.equal(state.camera, "none");
        assert.equal(state.cameraSize, "m");
        assert.equal(state.clock, null);
        assert.equal(state.phase, "ready");
        assert.equal(readSnapshot(snapshot({ theme: undefined }))?.theme, "oyun-gecesi");
        assert.equal(readSnapshot(snapshot({ clock: "ring" }))?.clock, "ring");
    });

    await test("the word is read only once its round is over", () => {
        const reveal = { target: "MANDALİNA", taboos: ["Portakal", "Kış", "Kabuk", "Turuncu", "Meyve", "Altıncı"], solved: true };
        for (const phase of ["ready", "running", "paused", "ended"]) {
            assert.equal(readSnapshot(snapshot({ phase, reveal }))?.reveal, null, phase);
        }
        const finished = readSnapshot(snapshot({ phase: "finished", reveal }));
        assert.deepEqual(finished?.reveal, { target: "MANDALİNA", taboos: reveal.taboos.slice(0, 5), solved: true });
        assert.equal(readSnapshot(snapshot({ phase: "finished", reveal: { target: "  ", taboos: [] } }))?.reveal, null);
        assert.equal(readSnapshot(snapshot({ phase: "finished", reveal: { ...reveal, solved: "yes" } }))?.reveal?.solved, false);
    });

    await test("a passed card needs its round and word; passedRound stands on its own", () => {
        const state = readSnapshot(snapshot({ passedRound: 7, passed: null }));
        assert.equal(state?.passedRound, 7);
        assert.equal(state?.passed, null);
        assert.deepEqual(readSnapshot(snapshot({ passedRound: 7, passed: { round: 7, target: "KUM SAATİ" } }))?.passed, { round: 7, target: "KUM SAATİ" });
        assert.equal(readSnapshot(snapshot({ passed: { round: "7", target: "KUM SAATİ" } }))?.passed, null);
        assert.equal(readSnapshot(snapshot({ passed: { round: 7, target: "" } }))?.passed, null);
        assert.equal(readSnapshot(snapshot({ passedRound: 7.5 }))?.passedRound, null);
    });

    await test("names are trimmed, stripped of control characters and capped", () => {
        const long = "x".repeat(60);
        const state = readSnapshot(
            snapshot({
                scores: [
                    { name: " Lu\u0007na\n ", points: 7, rank: 1, tied: false },
                    { name: long, points: 1e9, rank: 0, tied: "true" },
                    { name: "", points: 3, rank: 3, tied: false },
                    null,
                    { name: "Mert", points: -4, rank: 3, tied: false },
                    { name: "Fifth", points: 1, rank: 5, tied: false },
                ],
                channel: { platform: "twitch", name: "a".repeat(40) },
                lastCorrect: { eventId: "e", name: "\u0000", round: 1, solveMs: 10 },
            })
        );
        assert.ok(state);
        // Three slots at most; entries without a name are dropped after the cut.
        assert.deepEqual(state.scores.map((entry) => entry.name), ["Luna", "x".repeat(40)]);
        assert.equal(state.scores[1].points, 99999);
        assert.equal(state.scores[1].rank, 1);
        assert.equal(state.scores[1].tied, false);
        assert.equal(state.channel?.name, "a".repeat(25));
        assert.equal(state.lastCorrect, null);
        assert.equal(readSnapshot(snapshot({ channel: { platform: "tiktok", name: "x" } }))?.channel, null);
    });

    await test("numbers are clamped: duration 1..600 (default 60), remaining within it", () => {
        assert.equal(readSnapshot(snapshot({ remaining: 900 }))?.remaining, 60);
        assert.equal(readSnapshot(snapshot({ remaining: -3 }))?.remaining, 0);
        assert.equal(readSnapshot(snapshot({ remaining: 12.7 }))?.remaining, 12);
        assert.equal(readSnapshot(snapshot({ duration: "90" }))?.duration, 60);
        assert.equal(readSnapshot(snapshot({ duration: 5000, remaining: 700 }))?.remaining, 600);
        assert.equal(readSnapshot(snapshot({ round: 0 }))?.round, 1);
        assert.equal(readSnapshot(snapshot({ lastCorrect: { eventId: "e", name: "Ada", round: 2, solveMs: "fast" } }))?.lastCorrect?.solveMs, null);
    });

    await test("a cosmetic card back keeps only checked colours, patterns and image addresses", () => {
        const good = readSnapshot(snapshot({ cardBack }))?.cardBack;
        assert.ok(good);
        assert.equal(good.itemId, 42);
        assert.equal(good.name, "Gece Mavisi");
        assert.equal(good.theme.surfaceColor, "#111827");
        assert.equal(good.theme.pattern, "grid");
        assert.equal(good.theme.motionPreset, "drift");

        const hostile = readSnapshot(
            snapshot({
                cardBack: {
                    ...cardBack,
                    theme: {
                        ...cardBack.theme,
                        surfaceColor: "red; background: url(https://evil.example)",
                        borderColor: "#12345",
                        pattern: "url(x)",
                        motionPreset: "spin",
                        patternOpacity: 7,
                        overlayImageUrl: "javascript:alert(1)",
                        overlayOpacity: -1,
                    },
                },
            })
        )?.cardBack;
        assert.ok(hostile);
        assert.match(hostile.theme.surfaceColor, /^#[0-9a-f]{6}$/i);
        assert.match(hostile.theme.borderColor, /^#[0-9a-f]{6}$/i);
        assert.equal(hostile.theme.pattern, "none");
        assert.equal(hostile.theme.motionPreset, "none");
        assert.ok(hostile.theme.patternOpacity <= 1);
        assert.equal(hostile.theme.overlayImageUrl, null);
        assert.equal(hostile.theme.overlayOpacity, 0);

        for (const url of ["//evil.example/x.png", "http://evil.example/x.png", "data:image/png;base64,AAAA", "/ok\".png"]) {
            const read = readSnapshot(snapshot({ cardBack: { ...cardBack, theme: { ...cardBack.theme, overlayImageUrl: url } } }));
            assert.equal(read?.cardBack?.theme.overlayImageUrl, null, url);
        }
        for (const url of ["https://cdn.example.com/a.png", "/uploads/card-backs/a.webp"]) {
            const read = readSnapshot(snapshot({ cardBack: { ...cardBack, theme: { ...cardBack.theme, overlayImageUrl: url } } }));
            assert.equal(read?.cardBack?.theme.overlayImageUrl, url);
        }
        assert.equal(readSnapshot(snapshot({ cardBack: { ...cardBack, itemId: "42" } }))?.cardBack, null);
        assert.equal(readSnapshot(snapshot({ cardBack: { ...cardBack, theme: null } }))?.cardBack, null);
    });

    await test("the URL look shows before the first state, and offline keeps the last look", () => {
        const look = urlLookSnapshot(new URLSearchParams("theme=sakura&camera=tl&size=l&clock=ring"));
        assert.ok(look);
        assert.equal(look.revision, 0);
        assert.equal(look.phase, "ready");
        assert.equal(look.theme, "sakura");
        assert.equal(look.camera, "tl");
        assert.equal(look.cameraSize, "l");
        assert.equal(look.clock, "ring");
        assert.equal(urlLookSnapshot(new URLSearchParams(""))?.theme, "oyun-gecesi");

        const offline = offlineState(readSnapshot(snapshot({ phase: "finished", reveal: { target: "MANDALİNA", taboos: [], solved: true } }))!);
        assert.equal(offline.phase, "paused");
        assert.equal(offline.connected, false);
        assert.equal(offline.reveal, null);
        assert.equal(offline.theme, "sade");
        assert.equal(offline.scores.length, 2);
        // Before any round the timer reads the full round, not zero.
        assert.equal(offlineState(look).remaining, look.duration);
    });

    await test("the camera hole sits 70 px from the edges; the halves are exact", () => {
        assert.deepEqual(cameraRect("br", "m"), { x: 1290, y: 695, w: 560, h: 315 });
        assert.deepEqual(cameraRect("tl", "s"), { x: 70, y: 70, w: 480, h: 270 });
        assert.deepEqual(cameraRect("tr", "l"), { x: 1210, y: 70, w: 640, h: 360 });
        assert.deepEqual(cameraRect("bl", "m"), { x: 70, y: 695, w: 560, h: 315 });
        assert.deepEqual(cameraRect("left", "s"), { x: 0, y: 0, w: 960, h: 1080 });
        assert.deepEqual(cameraRect("right", "l"), { x: 960, y: 0, w: 960, h: 1080 });
        assert.equal(cameraRect("none", "m"), null);
    });

    console.log(`${count} checks passed.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
