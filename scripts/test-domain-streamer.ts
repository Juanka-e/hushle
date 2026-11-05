import assert from "node:assert/strict";
import {
    BROADCAST_THEMES,
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
    assert.equal(s.participants.size, 1);
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

test("skip preserves last correct and pause state", () => {
    const s = fresh();
    s.round = 7;
    s.lastCorrect = { eventId: "sample-1", name: "Luna", round: 6, pointsGranted: 1, solveMs: 14200 };
    const last = s.lastCorrect;
    beginRound(s, card, 0);
    pause(s, 1000);
    const skipped = skipRound(s, 2000);
    assert.deepEqual(skipped, { passed: card });
    assert.equal(s.phase, "paused");
    assert.equal(s.lastCorrect, last);
    assert.equal(s.round, 8);
});

test("skip is refused outside a live round", () => {
    const s = fresh();
    assert.equal(skipRound(s, 0), null);
    beginRound(s, card, 0);
    assert.equal(skipRound(s, 61000), null, "an expired round cannot be skipped");
    assert.equal(s.phase, "finished");
});

test("same nickname is not same player identity", () => {
    const s = fresh();
    beginRound(s, card, 0);
    guess(s, { platformUserId: "one", name: "Aynı" });
    beginRound(s, card, 2000);
    guess(s, { platformUserId: "two", name: "Aynı", messageId: "new" }, 3000);
    assert.equal(s.players.size, 2);
    assert.equal(s.participants.size, 2);
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
        s.participants.add(`fake:${id}`);
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
    skipRound(s, 72000);
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
    const theme = {
        renderSpecVersion: 1, requestedRenderSpecVersion: 1, usedRenderSpecFallback: false, surfaceColor: "#112233", borderColor: "#445566",
        accentColor: "#778899", secondaryColor: "#aabbcc", titleColor: "#ffffff", detailColor: "#dddddd", pattern: "grid", patternOpacity: 0.2,
        patternScale: 1, motionPreset: "none", motionSpeedMs: 0, glowColor: "#ffffff", glowBlur: 4, glowOpacity: 0.3, overlayImageUrl: null, overlayOpacity: 0,
    };
    loose.cardBack = { itemId: 7, name: "Ember", theme, imageUrl: "/cosmetics/ember.svg" };
    assert.deepEqual(publicSnapshot(s, 3).cardBack, { itemId: 7, name: "Ember", theme, imageUrl: "/cosmetics/ember.svg" });
    assert.equal(publicSnapshot(s, 3).theme, "sakura");
    loose.theme = "sade";
    assert.equal(publicSnapshot(s, 4).theme, "sade");
    assert.ok(BROADCAST_THEMES.includes("sade"));
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
    skipRound(s, 2000);
    assert.equal(s.card, null);
    assert.equal(skipRound(s, 2500), null, "no card, nothing to pass");
    endSession(s, 3000);
    beginRound(s, card, 4000);
    assert.equal(publicSnapshot(s, 3).passedRound, null);
    assert.equal(publicSnapshot(s, 3).passed, null);
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
    skipRound(s, 100);
    assert.equal(guess(s, { messageId: "n" }, 200), "closed");
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
