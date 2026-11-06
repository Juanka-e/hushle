import assert from "node:assert/strict";
import {
    boundCardBack,
    BROADCAST_THEMES,
    MAX_STREAM_PLAYERS,
    PASSED_TARGET_MAX,
    acceptGuess,
    beginRound,
    createStreamSession,
    endSession,
    guessMatches,
    hostSnapshot,
    normalizeGuess,
    pause,
    publicSnapshot,
    ranking,
    resume,
    skipRound,
    tick,
    type ChatGuess,
    type StreamCard,
    type StreamScreenSettings,
    type StreamSessionState,
} from "@hushle/domain-streamer";

const card: StreamCard = {
    wordId: 11,
    target: "KUTUP IŞIKLARI",
    taboos: ["Gökyüzü", "Kuzey", "Yeşil", "Gece", "Aurora"],
};
const otherCard: StreamCard = { wordId: 12, target: "Buzdolabı", taboos: ["Soğuk"] };

let count = 0;
function test(name: string, run: () => void) {
    run();
    count++;
    console.log(`PASS ${name}`);
}

function settings(overrides: Partial<StreamScreenSettings> = {}): StreamScreenSettings {
    return {
        theme: "oyun-gecesi",
        camera: "br",
        cameraSize: "m",
        clock: null,
        cardBack: null,
        showCardName: true,
        duration: 60,
        language: "tr",
        tolerance: "normal",
        channel: null,
        ...overrides,
    };
}

function fresh(overrides: Partial<StreamScreenSettings> = {}): StreamSessionState {
    return createStreamSession(settings(overrides), 0);
}

function guess(state: StreamSessionState, overrides: Partial<ChatGuess> = {}, time = 1000) {
    const input: ChatGuess = {
        platform: "fake",
        platformUserId: "luna",
        name: "Luna",
        text: "Kutup ışıkları",
        messageId: `message-${state.round}`,
        sentAt: time,
        ...overrides,
    };
    return acceptGuess(state, input, time);
}

function forbiddenKeys(value: unknown): string[] {
    const found: string[] = [];
    const walk = (node: unknown) => {
        if (Array.isArray(node)) node.forEach(walk);
        else if (node && typeof node === "object") {
            for (const [key, child] of Object.entries(node)) {
                if (key === "target" || key === "taboos") found.push(key);
                walk(child);
            }
        }
    };
    walk(value);
    return found;
}

test("a fresh session is ready with the configured duration", () => {
    const s = fresh({ duration: 90 });
    assert.equal(s.phase, "ready");
    assert.equal(s.duration, 90);
    assert.equal(s.remaining, 90);
    assert.equal(s.round, 1);
    assert.equal(s.card, null);
    assert.equal(s.tolerance, "normal");
});

test("winner is unique and last correct survives next round", () => {
    const s = fresh();
    beginRound(s, card, 0);
    assert.equal(guess(s), "correct");
    const last = s.lastCorrect;
    assert.equal(guess(s, { platformUserId: "deniz", messageId: "other" }), "closed");
    assert.equal(s.players.get("fake:luna")?.points, 1);
    beginRound(s, otherCard, 2000);
    assert.equal(s.winner, null);
    assert.equal(s.lastCorrect, last);
});

test("duplicate and stale guesses cannot score", () => {
    const s = fresh();
    beginRound(s, card, 1000);
    assert.equal(guess(s, { text: "Yanlış" }, 2000), "wrong");
    assert.equal(guess(s, {}, 2000), "duplicate");
    assert.equal(guess(s, { messageId: "late", sentAt: 500 }, 2000), "stale");
    assert.equal(s.players.get("fake:luna")?.points, 0);
    assert.equal(s.participants, 1);
});

test("ties share rank, next correct changes leader", () => {
    const s = fresh();
    for (const [id, points] of [["deniz", 6], ["luna", 6], ["mert", 4]] as const) {
        s.players.set(`fake:${id}`, { id: `fake:${id}`, name: id, points });
    }
    assert.deepEqual(ranking(s).map((p) => p.rank), [1, 1, 3]);
    assert.deepEqual(ranking(s).map((p) => p.tied), [true, true, false]);
    beginRound(s, card, 0);
    guess(s);
    assert.equal(ranking(s)[0].id, "fake:luna");
    assert.equal(ranking(s)[0].points, 7);
});

test("pause blocks guesses and resume continues the clock", () => {
    const s = fresh();
    beginRound(s, card, 0);
    assert.equal(pause(s, 12000), true);
    assert.equal(s.phase, "paused");
    assert.equal(guess(s, {}, 13000), "closed");
    assert.equal(resume(s, 20000), true);
    assert.equal(s.remaining, 48);
    tick(s, 68000);
    assert.equal(s.phase, "finished");
    assert.equal(s.remaining, 0);
});

test("expired guesses reject before interval tick and timer never becomes negative", () => {
    const s = fresh();
    beginRound(s, card, 0);
    assert.equal(guess(s, {}, 60000), "closed");
    tick(s, 999999);
    assert.equal(s.remaining, 0);
    assert.equal(s.players.size, 0);
});

test("a guess after the deadline, before the interval tick, is closed and the round finishes as a timeout", () => {
    const late = fresh();
    beginRound(late, card, 0);
    assert.equal(late.phase, "running", "no tick ran since the round began");
    assert.equal(guess(late, { messageId: "late" }, 60_000), "closed");
    assert.equal(late.phase, "finished", "the guess brought the clock up to its own time first");
    assert.equal(late.remaining, 0);
    assert.equal(late.winner, null);
    assert.equal(late.lastCorrect, null);
    assert.equal(late.players.size, 0, "a closed guess tracks nobody");
    assert.equal(late.participants, 0);
    assert.deepEqual(late.seenMessages, [], "a closed guess does not burn its message id");
    assert.deepEqual(publicSnapshot(late, 1).reveal, { target: card.target, taboos: card.taboos, solved: false }, "a timeout, not a solve");
    assert.equal(tick(late, 61_000), false, "the interval tick that follows finds nothing left to do");
    assert.equal(late.phase, "finished");
    // One millisecond before the deadline the round is still on: the same guess scores.
    const inTime = fresh();
    beginRound(inTime, card, 0);
    assert.equal(guess(inTime, { messageId: "in-time" }, 59_999), "correct");
});

test("skip preserves last correct and pause state", () => {
    const s = fresh();
    s.round = 7;
    s.lastCorrect = { eventId: "sample-1", name: "Luna", round: 6, pointsGranted: 1, solveMs: 14200 };
    const last = s.lastCorrect;
    beginRound(s, card, 0);
    pause(s, 1000);
    const skipped = skipRound(s, 2000, otherCard);
    assert.deepEqual(skipped, { passed: card });
    assert.equal(s.phase, "paused");
    assert.equal(s.lastCorrect, last);
    assert.equal(s.round, 8);
});

test("skip is refused outside a live round", () => {
    const s = fresh();
    assert.equal(skipRound(s, 0, otherCard), null);
    beginRound(s, card, 0);
    assert.equal(skipRound(s, 61000, otherCard), null, "an expired round cannot be skipped");
    assert.equal(s.phase, "finished");
});

test("a pass is judged when it was handled, but the new round starts when its card arrived", () => {
    const s = fresh();
    beginRound(s, card, 0);
    // Handled at 59 s (in time); the next card took until 62 s to arrive.
    assert.deepEqual(skipRound(s, 59_000, otherCard, 62_000), { passed: card });
    assert.equal(s.round, 2);
    assert.equal(s.roundStartedAt, 62_000);
    assert.equal(s.deadline, 62_000 + 60_000, "the new round is full length from when its card arrived");
    assert.equal(s.remaining, 60);
    assert.equal(guess(s, { text: "Buzdolabı", messageId: "sent-during-the-draw", sentAt: 61_000 }, 62_500), "stale", "a guess sent during the draw is stale for the new card");
    tick(s, 62_000 + 59_999);
    assert.equal(s.phase, "running", "the draw did not shorten the new round");
    assert.equal(guess(s, { text: "Buzdolabı", messageId: "sent-after", sentAt: 62_100 }, 62_000 + 59_999), "correct");
    // Judged at the handling time: a pass handled after the deadline is refused, however early the start.
    const late = fresh();
    beginRound(late, card, 0);
    assert.equal(skipRound(late, 61_000, otherCard, 59_000), null);
    assert.equal(late.phase, "finished");
    // Without a start time the new round starts when the pass was handled; an earlier start never shortens it.
    const plain = fresh();
    beginRound(plain, card, 0);
    skipRound(plain, 5_000, otherCard);
    assert.equal(plain.roundStartedAt, 5_000);
    const early = fresh();
    beginRound(early, card, 0);
    skipRound(early, 5_000, otherCard, 4_000);
    assert.equal(early.roundStartedAt, 5_000);
    assert.equal(early.deadline, 65_000);
});

test("a round never starts without a card: beginRound refuses a missing card and changes nothing", () => {
    const ready = fresh();
    const finished = fresh();
    beginRound(finished, card, 0);
    tick(finished, 61_000);
    const ended = fresh();
    beginRound(ended, card, 0);
    endSession(ended, 5_000);
    for (const [label, s] of [["ready", ready], ["finished", finished], ["ended", ended]] as const) {
        const before = structuredClone(s);
        for (const missing of [null, undefined]) {
            assert.equal(beginRound(s, missing as never, 70_000), false, `${label}: no card, no round`);
            assert.deepEqual(s, before, `${label}: nothing changed`);
        }
        assert.notEqual(s.phase, "running");
    }
});

test("a pass without a next card is refused and changes nothing (running or paused)", () => {
    for (const paused of [false, true]) {
        const s = fresh();
        beginRound(s, card, 0);
        if (paused) pause(s, 1000);
        const before = structuredClone(s);
        for (const missing of [null, undefined]) {
            assert.equal(skipRound(s, 2000, missing as never), null, `paused=${paused}, next card ${missing}`);
            assert.deepEqual(s, before, "the session stays on the current card, nothing recorded");
        }
        assert.deepEqual(s.card, card);
        assert.equal(s.phase, paused ? "paused" : "running");
        assert.equal(s.passedCard, null);
        assert.equal(s.passedRound, null);
        assert.equal(s.round, 1);
        // The refused pass left a live round with its card: guesses still work.
        if (paused) resume(s, 3000);
        assert.equal(guess(s, { messageId: `after-${paused}` }, 4000), "correct");
    }
});

test("same nickname is not same player identity", () => {
    const s = fresh();
    beginRound(s, card, 0);
    guess(s, { platformUserId: "one", name: "Aynı" });
    beginRound(s, card, 2000);
    guess(s, { platformUserId: "two", name: "Aynı", messageId: "new" }, 3000);
    assert.equal(s.players.size, 2);
    assert.equal(s.participants, 2);
});

test("the same user id on two platforms is two players", () => {
    const s = fresh();
    beginRound(s, card, 0);
    guess(s, { platform: "twitch", platformUserId: "1", messageId: "a", text: "x" });
    guess(s, { platform: "kick", platformUserId: "1", messageId: "b", text: "x" });
    assert.equal(s.players.size, 2);
});

test("public projection is bounded and excludes secret fields", () => {
    const s = fresh();
    for (const [id, points] of [["deniz", 8], ["luna", 6], ["mert", 5], ["ece", 2]] as const) {
        s.players.set(`fake:${id}`, { id: `fake:${id}`, name: id, points });
        s.participants += 1;
    }
    beginRound(s, { wordId: 1, target: "SECRET", taboos: ["SECRET2"] }, 0);
    (s as unknown as Record<string, unknown>).token = "TOKEN";
    const dto = publicSnapshot(s, 3);
    assert.equal(dto.schemaVersion, 4);
    assert.equal(dto.scores.length, 3);
    assert.equal(dto.participants, 4);
    assert.equal(dto.reveal, null);
    const json = JSON.stringify(dto);
    for (const forbidden of ["SECRET", "TOKEN", "playerId", "platformUserId", "seenMessages", "target", "taboos", "wordId"]) {
        assert.ok(!json.includes(forbidden), forbidden);
    }
    assert.deepEqual(forbiddenKeys(dto), []);
});

test("publicSnapshot while running has no target or taboos keys, hostSnapshot does", () => {
    const s = fresh();
    beginRound(s, card, 0);
    assert.deepEqual(forbiddenKeys(publicSnapshot(s, 1)), []);
    const host = hostSnapshot(s, 1);
    assert.deepEqual(host.card, card);
    assert.notEqual(host.card, card, "the host card is a copy");
    assert.equal(host.tolerance, "normal");
    assert.ok(forbiddenKeys(host).includes("target"));
    assert.ok(forbiddenKeys(host).includes("taboos"));
    assert.equal(host.schemaVersion, 4);
    assert.equal(host.phase, "running");
});

test("hostSnapshot carries the full ranking and optional pool", () => {
    const s = fresh();
    for (const [id, points] of [["a", 5], ["b", 4], ["c", 3], ["d", 2], ["e", 1]] as const) {
        s.players.set(`fake:${id}`, { id: `fake:${id}`, name: id, points });
    }
    assert.equal(publicSnapshot(s, 1).scores.length, 3);
    const host = hostSnapshot(s, 2, { drawn: 4, eligible: 120 });
    assert.equal(host.players.length, 5);
    assert.deepEqual(host.pool, { drawn: 4, eligible: 120 });
    assert.equal(hostSnapshot(s, 3).pool, undefined);
});

test("the card is revealed only after its round is over", () => {
    const s = fresh();
    const hidden = () => assert.equal(publicSnapshot(s, 1).reveal, null);
    hidden();
    beginRound(s, card, 0);
    hidden();
    pause(s, 5000);
    hidden();
    resume(s, 6000);
    hidden();
    guess(s, {}, 9000);
    assert.deepEqual(publicSnapshot(s, 2).reveal, { target: "KUTUP IŞIKLARI", taboos: card.taboos, solved: true });
    beginRound(s, card, 10000);
    hidden();
    tick(s, 70000);
    assert.equal(publicSnapshot(s, 3).reveal?.solved, false, "time ran out: revealed, not solved");
    beginRound(s, card, 71000);
    skipRound(s, 72000, otherCard);
    hidden();
    endSession(s, 73000);
    hidden();
});

test("the revealed card is bounded", () => {
    const s = fresh();
    beginRound(s, { wordId: 1, target: "X".repeat(90), taboos: ["Y".repeat(50), "b", "c", "d", "e", "f", "g"] }, 0);
    tick(s, 61000);
    const reveal = publicSnapshot(s, 1).reveal;
    assert.ok(reveal);
    assert.equal(reveal.target.length, 40);
    assert.equal(reveal.taboos.length, 5);
    assert.equal(reveal.taboos[0].length, 24);
});

test("solve time counts the clock, not pauses", () => {
    const s = fresh();
    beginRound(s, card, 0);
    guess(s, {}, 3800);
    assert.equal(s.lastCorrect?.solveMs, 3800);
    beginRound(s, card, 5000);
    pause(s, 15000);
    resume(s, 55000);
    guess(s, { messageId: "second" }, 57000);
    assert.equal(s.lastCorrect?.solveMs, 12000);
});

test("theme, camera and channel fall back to safe values", () => {
    const s = fresh();
    const loose = s.settings as unknown as Record<string, unknown>;
    assert.equal(publicSnapshot(s, 1).theme, "oyun-gecesi");
    assert.equal(publicSnapshot(s, 1).camera, "br");
    assert.equal(publicSnapshot(s, 1).cameraSize, "m");
    assert.equal(publicSnapshot(s, 1).channel, null);
    Object.assign(loose, { theme: "<img src=x>", camera: "top", cameraSize: "xl", showCardName: "yes", cardBack: { itemId: "3" }, channel: { platform: "tiktok", name: "x" } });
    const dto = publicSnapshot(s, 2);
    assert.equal(dto.theme, "oyun-gecesi");
    assert.equal(dto.camera, "none");
    assert.equal(dto.cameraSize, "m");
    assert.equal(dto.showCardName, false);
    assert.equal(dto.cardBack, null);
    assert.equal(dto.channel, null);
    for (const slot of ["tl", "tr", "bl", "br", "left", "right", "none"]) {
        loose.camera = slot;
        assert.equal(publicSnapshot(s, 3).camera, slot);
    }
    loose.channel = { platform: "twitch", name: "x".repeat(40) };
    assert.equal(publicSnapshot(s, 4).channel?.name.length, 25);
    loose.theme = "sakura";
    // A theme as the server resolves it: every value in range, so it passes unchanged.
    const theme = {
        renderSpecVersion: 1, requestedRenderSpecVersion: 1, usedRenderSpecFallback: false, surfaceColor: "#112233", borderColor: "#445566",
        accentColor: "#778899", secondaryColor: "#aabbcc", titleColor: "#ffffff", detailColor: "#ddd", pattern: "grid", patternOpacity: 0.2,
        patternScale: 18, motionPreset: "drift", motionSpeedMs: 7000, glowColor: "#ffffff", glowBlur: 24, glowOpacity: 0.3, overlayImageUrl: null, overlayOpacity: 0,
    };
    loose.cardBack = { itemId: 7, name: "Ember", theme, imageUrl: "/cosmetics/ember.svg" };
    assert.deepEqual(publicSnapshot(s, 3).cardBack, { itemId: 7, name: "Ember", theme, imageUrl: "/cosmetics/ember.svg" });
    const withOverlay = { ...theme, overlayImageUrl: "https://cdn.hushle.example/backs/ember.png?v=2", overlayOpacity: 0.24 };
    loose.cardBack = { itemId: 7, name: "Ember", theme: withOverlay, imageUrl: "https://cdn.hushle.example/backs/ember.png?v=2" };
    assert.deepEqual(publicSnapshot(s, 3).cardBack?.theme, withOverlay);
    assert.equal(publicSnapshot(s, 3).cardBack?.imageUrl, "https://cdn.hushle.example/backs/ember.png?v=2");
    assert.equal(publicSnapshot(s, 3).theme, "sakura");
    loose.theme = "sade";
    assert.equal(publicSnapshot(s, 4).theme, "sade");
    assert.ok(BROADCAST_THEMES.includes("sade"));
});

test("the public card back copies only the known theme fields, each bounded; nothing else reaches the snapshot", () => {
    const s = fresh();
    const loose = s.settings as unknown as Record<string, unknown>;
    const hostile = {
        renderSpecVersion: -3,
        requestedRenderSpecVersion: 2.7,
        usedRenderSpecFallback: "yes",
        surfaceColor: "red",
        borderColor: "#12345",
        accentColor: "#ABC",
        secondaryColor: "#11223344",
        titleColor: "url(javascript:alert(1))",
        detailColor: 7,
        pattern: "<img src=x onerror=alert(1)>",
        patternOpacity: 5,
        patternScale: 1000,
        motionPreset: "spin",
        motionSpeedMs: 1e12,
        glowColor: "#0f0",
        glowBlur: -5,
        glowOpacity: Number.NaN,
        overlayImageUrl: "//evil.example/x.png",
        overlayOpacity: Number.POSITIVE_INFINITY,
        // Not part of the theme: must never reach the stream screen.
        script: "<script>alert(1)</script>",
        css: "body{display:none}",
        nested: { deep: true },
    };
    loose.cardBack = { itemId: 9, name: `\u0007${"Ç".repeat(70)}`, theme: hostile, imageUrl: "javascript:alert(1)", extra: "drop me" };
    const back = publicSnapshot(s, 1).cardBack;
    assert.ok(back);
    assert.deepEqual(Object.keys(back).sort(), ["imageUrl", "itemId", "name", "theme"]);
    assert.deepEqual(Object.keys(back.theme).sort(), [
        "accentColor", "borderColor", "detailColor", "glowBlur", "glowColor", "glowOpacity", "motionPreset", "motionSpeedMs",
        "overlayImageUrl", "overlayOpacity", "pattern", "patternOpacity", "patternScale", "renderSpecVersion",
        "requestedRenderSpecVersion", "secondaryColor", "surfaceColor", "titleColor", "usedRenderSpecFallback",
    ]);
    assert.deepEqual(back.theme, {
        renderSpecVersion: 0,
        requestedRenderSpecVersion: 2,
        usedRenderSpecFallback: false,
        surfaceColor: "#0f172a",
        borderColor: "#475569",
        accentColor: "#ABC",
        secondaryColor: "#cbd5e1",
        titleColor: "#f8fafc",
        detailColor: "#cbd5e1",
        pattern: "none",
        patternOpacity: 0.42,
        patternScale: 42,
        motionPreset: "none",
        motionSpeedMs: 12000,
        glowColor: "#0f0",
        glowBlur: 8,
        glowOpacity: 0.18,
        overlayImageUrl: null,
        overlayOpacity: 0,
    });
    assert.equal(back.name, "Ç".repeat(60), "control characters dropped, at most 60 characters");
    assert.equal(back.imageUrl, null);
    const text = JSON.stringify(publicSnapshot(s, 1));
    for (const needle of ["script", "javascript", "display:none", "deep", "drop me", "evil.example", "onerror"]) {
        assert.ok(!text.includes(needle), `${needle} never reaches the public snapshot`);
    }
    // The host projection shows the same card back.
    assert.deepEqual(hostSnapshot(s, 1).cardBack, back);
});

test("boundCardBack is the public projection's card back: the snapshot carries exactly its answer", () => {
    const hostile = {
        itemId: 4,
        name: "\u0000  Ember  ",
        theme: { surfaceColor: "url(x)", pattern: "spiral", patternScale: 2, extra: "drop me" },
        imageUrl: "https://user:pw@evil.example/x.png",
        more: true,
    } as never;
    const s = fresh({ cardBack: hostile });
    assert.deepEqual(publicSnapshot(s, 1).cardBack, boundCardBack(hostile));
    assert.deepEqual(hostSnapshot(s, 1).cardBack, boundCardBack(hostile));
    assert.equal(boundCardBack(null), null);
    assert.equal(boundCardBack({ itemId: 1.5, name: "x", theme: {}, imageUrl: null } as never), null);
    const bounded = boundCardBack(hostile);
    assert.ok(bounded);
    assert.deepEqual(boundCardBack(bounded), bounded, "bounding twice changes nothing");
});

test("card-back numbers clamp into the ranges the screen draws; an unusable one takes its default", () => {
    const s = fresh();
    const loose = s.settings as unknown as Record<string, unknown>;
    const themeOf = (overrides: Record<string, unknown>) => {
        loose.cardBack = { itemId: 3, name: "Kor", theme: overrides, imageUrl: null };
        return publicSnapshot(s, 1).cardBack!.theme;
    };
    // A theme with nothing usable: every default.
    assert.deepEqual(themeOf({}), {
        renderSpecVersion: 1, requestedRenderSpecVersion: 1, usedRenderSpecFallback: false, surfaceColor: "#0f172a", borderColor: "#475569",
        accentColor: "#94a3b8", secondaryColor: "#cbd5e1", titleColor: "#f8fafc", detailColor: "#cbd5e1", pattern: "none", patternOpacity: 0,
        patternScale: 18, motionPreset: "none", motionSpeedMs: 5000, glowColor: "#94a3b8", glowBlur: 22, glowOpacity: 0.18, overlayImageUrl: null, overlayOpacity: 0,
    });
    const low = themeOf({ patternOpacity: -1, patternScale: 1, motionSpeedMs: -10, glowBlur: 0, glowOpacity: -0.5, overlayOpacity: -2, renderSpecVersion: -1 });
    assert.deepEqual(
        [low.patternOpacity, low.patternScale, low.motionSpeedMs, low.glowBlur, low.glowOpacity, low.overlayOpacity, low.renderSpecVersion],
        [0, 8, 1800, 8, 0, 0, 0],
    );
    const high = themeOf({ patternOpacity: 1, patternScale: 99.9, motionSpeedMs: 60001, glowBlur: 65, glowOpacity: 1, overlayOpacity: 1, renderSpecVersion: 3.9 });
    assert.deepEqual(
        [high.patternOpacity, high.patternScale, high.motionSpeedMs, high.glowBlur, high.glowOpacity, high.overlayOpacity, high.renderSpecVersion],
        [0.42, 42, 12000, 56, 0.36, 0.45, 3],
    );
    const wrongType = themeOf({ patternOpacity: "0.3", patternScale: null, motionSpeedMs: "fast", glowBlur: [], glowOpacity: {}, overlayOpacity: true, renderSpecVersion: "2" });
    assert.deepEqual(
        [wrongType.patternOpacity, wrongType.patternScale, wrongType.motionSpeedMs, wrongType.glowBlur, wrongType.glowOpacity, wrongType.overlayOpacity, wrongType.renderSpecVersion],
        [0, 18, 5000, 22, 0.18, 0, 1],
    );
    // Every pattern and motion of the vocabulary passes; nothing else, whatever its case.
    for (const pattern of ["none", "grid", "dots", "diagonal", "chevrons", "rings", "noise"]) assert.equal(themeOf({ pattern }).pattern, pattern);
    for (const pattern of ["Grid", "stripes", "", 3]) assert.equal(themeOf({ pattern }).pattern, "none");
    for (const motionPreset of ["none", "pulse", "drift", "shimmer"]) assert.equal(themeOf({ motionPreset }).motionPreset, motionPreset);
    for (const motionPreset of ["Pulse", "spin", null]) assert.equal(themeOf({ motionPreset }).motionPreset, "none");
});

test("card-back images: a same-site path or a credential-free https address, at most 2048 characters, else null", () => {
    const s = fresh();
    const loose = s.settings as unknown as Record<string, unknown>;
    const urls = (url: unknown) => {
        loose.cardBack = { itemId: 3, name: "Kor", theme: { overlayImageUrl: url }, imageUrl: url };
        const back = publicSnapshot(s, 1).cardBack!;
        return [back.imageUrl, back.theme.overlayImageUrl];
    };
    for (const kept of ["/cosmetics/kor.svg", "/uploads/shop/a_b-c.png?v=3", "https://cdn.hushle.example/x.png", `https://cdn.hushle.example/${"a".repeat(2048 - 27)}`]) {
        assert.equal(kept.length <= 2048, true);
        assert.deepEqual(urls(kept), [kept, kept], kept.slice(0, 60));
    }
    for (const dropped of [
        "//evil.example/x.png",
        "http://cdn.hushle.example/x.png",
        "javascript:alert(1)",
        "data:image/svg+xml;base64,PHN2Zz4=",
        "https://user:pass@cdn.hushle.example/x.png",
        "/a\"onerror=alert(1)",
        "/a b.png",
        "\\\\server\\share.png",
        "relative/path.png",
        `https://cdn.hushle.example/${"a".repeat(2048 - 26)}`,
        "",
        42,
        null,
    ]) {
        assert.deepEqual(urls(dropped), [null, null], String(dropped).slice(0, 60));
    }
});

test("a pass names the passed round and turns the passed card face up", () => {
    const s = fresh();
    beginRound(s, card, 0);
    skipRound(s, 1000, otherCard);
    assert.equal(publicSnapshot(s, 1).passedRound, 1);
    assert.equal(s.round, 2);
    assert.deepEqual(publicSnapshot(s, 1).passed, { round: 1, target: "KUTUP IŞIKLARI" });
    assert.equal(publicSnapshot(s, 1).reveal, null, "the new round's card stays hidden");
    assert.deepEqual(s.card, otherCard);
    assert.equal(skipRound(s, 2000, null as never), null, "no next card, no pass");
    assert.deepEqual(s.card, otherCard, "the live card stays");
    assert.equal(s.round, 2);
    endSession(s, 3000);
    beginRound(s, card, 4000);
    assert.equal(publicSnapshot(s, 3).passedRound, null);
    assert.equal(publicSnapshot(s, 3).passed, null);
});

test("a pass that deals the passed word again drops the passed card", () => {
    const s = fresh();
    beginRound(s, card, 0);
    skipRound(s, 1000, { ...card, wordId: 99, taboos: [...card.taboos] });
    assert.equal(s.card?.target, card.target, "the pool dealt the passed word again");
    assert.equal(s.passedCard, null, "the passed card would show the live word");
    assert.equal(publicSnapshot(s, 1).passed, null);
    assert.equal(s.passedRound, 1, "the pass itself is still recorded");
    assert.equal(s.round, 2);
    // The same word spelt another way (letter case, Turkish letters, punctuation) is the same word.
    skipRound(s, 2000, otherCard);
    assert.deepEqual(s.passedCard, { round: 2, target: card.target });
    skipRound(s, 3000, { wordId: 13, target: "buzdolabi!", taboos: ["Soğuk"] });
    assert.equal(s.passedCard, null, "Buzdolabı and buzdolabi! are one word");
    // A word longer than the passed card shows is compared as the passed card shows it.
    const long = { wordId: 14, target: `${"UZUN".repeat(12)} KELİME`, taboos: [] };
    skipRound(s, 4000, long);
    skipRound(s, 5000, { ...long, wordId: 15 });
    assert.equal(s.passedCard, null, "a long word dealt again is dropped too");
});

test("a dealt word longer than the passed card shows, equal to it only in full, drops the passed card", () => {
    // 43 units; the whitespace run collapses, so in full it is the passed word, cut to 40 it is not.
    const spaced: StreamCard = { wordId: 20, target: `Kutup${" ".repeat(30)}Işıkları`, taboos: ["Kuzey"] };
    assert.ok(spaced.target.length > PASSED_TARGET_MAX);
    assert.notEqual(normalizeGuess(spaced.target.slice(0, PASSED_TARGET_MAX), "normal"), normalizeGuess(card.target, "normal"));
    assert.equal(normalizeGuess(spaced.target, "normal"), normalizeGuess(card.target, "normal"));
    // The pass path: the pool deals it as the next card.
    const passing = fresh();
    beginRound(passing, card, 0);
    skipRound(passing, 1000, spaced);
    assert.equal(passing.passedCard, null, "pass: the passed card would show the live word");
    assert.equal(publicSnapshot(passing, 1).passed, null);
    assert.equal(passing.passedRound, 1, "the pass itself is still recorded");
    // The next-round path: dealt after the round that followed the pass.
    const next = fresh();
    beginRound(next, card, 0);
    skipRound(next, 1000, otherCard);
    tick(next, 62_000);
    beginRound(next, spaced, 63_000);
    assert.equal(next.passedCard, null, "next round: the passed card would show the live word");
});

test("a pass to a card whose taboos hold the passed word keeps the passed card", () => {
    const s = fresh();
    beginRound(s, card, 0);
    skipRound(s, 1000, { wordId: 16, target: "AURORA", taboos: [card.target, "Kutup"] });
    assert.deepEqual(s.passedCard, { round: 1, target: card.target }, "viewers never see the taboos");
    skipRound(s, 2000, { wordId: 17, target: "AURORALAR", taboos: [] });
    assert.deepEqual(s.passedCard, { round: 2, target: "AURORA" }, "a longer word is another word");
});

test("a round that deals the passed word again drops the passed card", () => {
    const s = fresh();
    beginRound(s, card, 0);
    skipRound(s, 1000, otherCard);
    tick(s, 62_000);
    assert.equal(s.phase, "finished");
    assert.deepEqual(s.passedCard, { round: 1, target: card.target });
    beginRound(s, { wordId: 18, target: "Kutup isiklari", taboos: ["Kuzey"] }, 63_000);
    assert.equal(s.passedCard, null, "the next round's word is the passed word");
    assert.equal(publicSnapshot(s, 2).passed, null);
    assert.equal(s.passedRound, 1, "the pass itself is still recorded");
    assert.equal(s.round, 3);
});

test("a round whose taboos hold the passed word keeps the passed card", () => {
    const s = fresh();
    beginRound(s, card, 0);
    skipRound(s, 1000, otherCard);
    tick(s, 62_000);
    beginRound(s, { wordId: 19, target: "AURORA", taboos: [card.target] }, 63_000);
    assert.deepEqual(s.passedCard, { round: 1, target: card.target });
    assert.deepEqual(publicSnapshot(s, 2).passed, { round: 1, target: card.target });
});

test("the timer look is a theme template until the streamer picks one", () => {
    const s = fresh();
    const loose = s.settings as unknown as Record<string, unknown>;
    assert.equal(publicSnapshot(s, 1).clock, null);
    loose.clock = "sundial";
    assert.equal(publicSnapshot(s, 2).clock, null);
    for (const style of ["hourglass", "candle", "bulbs", "incense", "ring", "counter"]) {
        loose.clock = style;
        assert.equal(publicSnapshot(s, 3).clock, style);
    }
});

test("new session clears score and last correct", () => {
    const s = fresh();
    s.players.set("fake:a", { id: "fake:a", name: "A", points: 3 });
    s.round = 7;
    s.lastCorrect = { eventId: "x", name: "A", round: 6, pointsGranted: 1, solveMs: 1 };
    endSession(s, 0);
    beginRound(s, card, 0);
    assert.equal(s.players.size, 0);
    assert.equal(s.lastCorrect, null);
    assert.equal(s.round, 1);
});

test("a round cannot start while one is running", () => {
    const s = fresh();
    assert.equal(beginRound(s, card, 0), true);
    assert.equal(beginRound(s, card, 1), false);
    pause(s, 2);
    assert.equal(beginRound(s, card, 3), false);
});

test("normalizeGuess table", () => {
    assert.equal(normalizeGuess("Buzdolabı!!!", "strict"), "buzdolabı");
    assert.equal(normalizeGuess("Buzdolabı!!!", "normal"), "buzdolabi");
    assert.equal(normalizeGuess("BUZDOLABI", "normal"), "buzdolabi");
    assert.equal(normalizeGuess("BUZDOLABI", "strict"), "buzdolabı");
    assert.equal(normalizeGuess("  buz   dolabı \n", "strict"), "buz dolabı");
    assert.equal(normalizeGuess("İSTANBUL", "strict"), "istanbul");
    assert.equal(normalizeGuess("ŞĞÇÖÜ", "normal"), "sgcou");
    assert.equal(normalizeGuess("şğçöü", "strict"), "şğçöü");
    assert.equal(normalizeGuess("a-b, c.d 42", "strict"), "ab cd 42");
    assert.equal(normalizeGuess("🎉🎉", "normal"), "");
});

test("guessMatches follows the tolerance", () => {
    assert.equal(guessMatches("BUZDOLABI", "buzdolabi", "strict"), false);
    assert.equal(guessMatches("BUZDOLABI", "buzdolabi", "normal"), true);
    assert.equal(guessMatches("buzdolabi", "Buzdolabı", "strict"), false);
    assert.equal(guessMatches("buzdolabi", "Buzdolabı", "normal"), true);
    assert.equal(guessMatches("Buzdolabı", "Buzdolabı", "strict"), true);
    assert.equal(guessMatches("buz dolabı", "Buzdolabı", "normal"), false, "inner spaces are kept");
    assert.equal(guessMatches("kutup ışıkları!", "KUTUP IŞIKLARI", "strict"), true);
    assert.equal(guessMatches("", "", "normal"), true);
});

test("tolerance decides whether an accent-less guess scores", () => {
    const strict = fresh();
    strict.tolerance = "strict";
    beginRound(strict, otherCard, 0);
    assert.equal(guess(strict, { text: "buzdolabi" }), "wrong");
    const normal = fresh();
    beginRound(normal, otherCard, 0);
    assert.equal(guess(normal, { text: "buzdolabi" }), "correct");
});

test("emoji-only, blank and malformed guesses are invalid and not recorded", () => {
    const s = fresh();
    beginRound(s, card, 0);
    assert.equal(guess(s, { text: "🎉🎉" }), "invalid");
    assert.equal(guess(s, { text: "   " }), "invalid");
    assert.equal(guess(s, { name: "" }), "invalid");
    assert.equal(guess(s, { platformUserId: "" }), "invalid");
    assert.equal(guess(s, { messageId: "" }), "invalid");
    assert.equal(s.seenMessages.length, 0);
    assert.equal(s.players.size, 0);
    assert.equal(guess(s), "correct", "an invalid message does not burn the message id");
});

test("the 257th message id evicts the oldest", () => {
    const s = fresh();
    beginRound(s, card, 0);
    for (let i = 0; i < 257; i++) {
        assert.equal(guess(s, { text: "yanlış", messageId: `m-${i}`, platformUserId: `u${i % 5}` }), "wrong");
    }
    assert.equal(s.seenMessages.length, 256);
    assert.equal(s.seenMessages[0], "m-1");
    assert.equal(guess(s, { text: "yanlış", messageId: "m-1" }), "duplicate");
    assert.equal(guess(s, { text: "yanlış", messageId: "m-0" }), "wrong", "the evicted id is accepted again");
});

test("a guess without a card is closed", () => {
    const s = fresh();
    beginRound(s, card, 0);
    // The API never leaves a live round without a card; the guard holds should a caller do so.
    s.card = null;
    assert.equal(guess(s, { messageId: "n" }, 200), "closed");
});

let chatterMessages = 0;
function chatter(s: StreamSessionState, user: string, time = 1000, text = "yanlış") {
    chatterMessages += 1;
    return guess(s, { platformUserId: user, name: user, text, messageId: `chatter-${chatterMessages}` }, time);
}

test("players are capped: a new chatter evicts the longest-quiet player without points", () => {
    assert.equal(MAX_STREAM_PLAYERS, 2000);
    const s = fresh();
    beginRound(s, card, 0);
    for (let i = 0; i < MAX_STREAM_PLAYERS; i++) assert.equal(chatter(s, `u${i}`), "wrong");
    assert.equal(s.players.size, MAX_STREAM_PLAYERS);
    assert.equal(s.participants, MAX_STREAM_PLAYERS);
    // u0 speaks again: it is now the most recently active, so u1 is the longest quiet.
    assert.equal(chatter(s, "u0"), "wrong");
    assert.equal(s.participants, MAX_STREAM_PLAYERS, "a known player is no new participant");
    assert.equal(chatter(s, "late-1"), "wrong");
    assert.equal(s.players.size, MAX_STREAM_PLAYERS);
    assert.ok(s.players.has("fake:u0"), "the player who spoke again stays");
    assert.ok(!s.players.has("fake:u1"), "the longest-quiet player without points makes room");
    assert.ok(s.players.has("fake:late-1"));
    assert.equal(s.participants, MAX_STREAM_PLAYERS + 1, "participants count every player ever tracked");
    assert.equal(chatter(s, "late-2"), "wrong");
    assert.ok(!s.players.has("fake:u2"), "eviction goes in activity order");
    assert.ok(s.players.has("fake:u3"));
});

test("players are capped: a scorer is never evicted; with only scorers tracked a new chatter is invalid", () => {
    const s = fresh();
    beginRound(s, card, 0);
    for (let i = 0; i < MAX_STREAM_PLAYERS; i++) chatter(s, `u${i}`);
    // The two longest-quiet players have points: the first quiet player without points goes instead.
    s.players.get("fake:u0")!.points = 3;
    s.players.get("fake:u1")!.points = 1;
    assert.equal(chatter(s, "late-1"), "wrong");
    assert.ok(s.players.has("fake:u0") && s.players.has("fake:u1"), "scorers stay");
    assert.ok(!s.players.has("fake:u2"));
    assert.deepEqual(ranking(s).map((player) => [player.id, player.points, player.rank]), [["fake:u0", 3, 1], ["fake:u1", 1, 2]], "ranking unaffected");
    // Every tracked player now scores: a new name is not tracked and its guess is invalid, even a correct one.
    for (const player of s.players.values()) player.points = Math.max(1, player.points);
    const participants = s.participants;
    const seen = [...s.seenMessages];
    for (const text of ["yanlış", card.target]) {
        assert.equal(guess(s, { platformUserId: "outsider", name: "Outsider", text, messageId: `outsider-${text}` }, 1500), "invalid");
    }
    assert.equal(s.players.size, MAX_STREAM_PLAYERS);
    assert.ok(!s.players.has("fake:outsider"));
    assert.equal(s.participants, participants, "an untracked chatter is no participant");
    assert.deepEqual(s.seenMessages, seen, "an invalid guess does not burn its message id");
    assert.equal(s.phase, "running", "the correct text of an untracked chatter did not end the round");
    assert.equal(s.winner, null);
    // A tracked scorer still plays.
    assert.equal(chatter(s, "u5", 1600, card.target), "correct");
    assert.equal(s.players.get("fake:u5")?.points, 2);
});

test("players are capped: memory stays at the cap however many chatters come and go", () => {
    const s = fresh();
    beginRound(s, card, 0);
    for (let i = 0; i < 5_000; i++) chatter(s, `c${i}`);
    assert.equal(s.players.size, MAX_STREAM_PLAYERS);
    assert.equal(s.participants, 5_000);
    assert.equal(typeof s.participants, "number", "no set of every id ever seen is kept");
    assert.deepEqual([...s.players.keys()].slice(0, 2), ["fake:c3000", "fake:c3001"], "the most recent chatters are kept");
    assert.equal(publicSnapshot(s, 1).participants, 5_000);
    endSession(s, 2000);
    beginRound(s, card, 3000);
    assert.equal(s.participants, 0, "a new session starts its count afresh");
    assert.equal(s.players.size, 0);
});

test("names are stripped of control characters and bounded", () => {
    const s = fresh();
    beginRound(s, card, 0);
    guess(s, { name: "Lu\u0000na" + "x".repeat(60), text: "yanlış" });
    assert.equal(s.players.get("fake:luna")?.name.length, 40);
    assert.ok(!s.players.get("fake:luna")?.name.includes("\u0000"));
});

test("tolerance is a per-session setting", () => {
    const strict = fresh({ tolerance: "strict" });
    const normal = fresh({ tolerance: "normal" });
    assert.equal(strict.tolerance, "strict");
    assert.equal(normal.tolerance, "normal");
    assert.equal(hostSnapshot(strict, 1).tolerance, "strict");
    assert.equal(hostSnapshot(normal, 1).tolerance, "normal");
    beginRound(strict, otherCard, 0);
    beginRound(normal, otherCard, 0);
    assert.equal(guess(strict, { text: "buzdolabi" }), "wrong");
    assert.equal(guess(normal, { text: "buzdolabi" }), "correct");
    const loose = fresh({ tolerance: "flexible" as never });
    assert.equal(loose.tolerance, "normal", "an invalid value falls back to normal");
    const missing = fresh({ tolerance: undefined as never });
    assert.equal(missing.tolerance, "normal");
});

test("the snapshots carry the connected flag, true by default", () => {
    const s = fresh();
    assert.equal(publicSnapshot(s, 1).connected, true);
    assert.equal(publicSnapshot(s, 1, { connected: false }).connected, false);
    assert.equal(publicSnapshot(s, 1, {}).connected, true);
    assert.equal(hostSnapshot(s, 1).connected, true);
    assert.equal(hostSnapshot(s, 1, undefined, { connected: false }).connected, false);
});

console.log(`${count} checks passed.`);
