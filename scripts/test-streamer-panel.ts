import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import type { HostStreamSnapshot } from "@hushle/domain-streamer";
import {
    appendLog,
    cameraMeasurements,
    describeTransition,
    isHostSnapshot,
    LOG_LIMIT,
    streamUrlsFor,
    summaryFromSnapshot,
    type LogEntry,
} from "@/components/streamer/streamer-panel-model";
import { buildStreamUrls } from "@/lib/streamer/session-http";

// The host panel's pure parts (event log, snapshot summary, stream addresses, camera hole) and
// the source rules the panel keeps: the view key and the card stay in memory, stream addresses
// open as plain new-tab links. The browser side is tests/streamer-session.spec.ts.

let count = 0;
function test(name: string, run: () => void): void {
    run();
    count += 1;
    console.log(`ok - ${name}`);
}

function host(patch: Partial<HostStreamSnapshot> = {}): HostStreamSnapshot {
    return {
        type: "host-state",
        schemaVersion: 4,
        revision: 1,
        phase: "ready",
        remaining: 60,
        duration: 60,
        round: 1,
        passedRound: null,
        theme: "oyun-gecesi",
        camera: "none",
        cameraSize: "m",
        clock: null,
        showCardName: false,
        channel: { platform: "twitch", name: "deniz" },
        passed: null,
        participants: 0,
        pack: "TR",
        scores: [],
        lastCorrect: null,
        cardBack: null,
        connected: true,
        reveal: null,
        card: null,
        tolerance: "normal",
        players: [],
        ...patch,
    };
}

const CARD1 = { wordId: 1, target: "MANDALİNA", taboos: ["Portakal", "Meyve", "Kış", "Turuncu", "Kabuk"] };
const CARD2 = { wordId: 2, target: "PUSULA", taboos: ["Kuzey", "Yön", "İğne", "Harita", "Mıknatıs"] };
const CARD3 = { wordId: 3, target: "FENER", taboos: ["Işık", "Deniz", "Gemi", "Kule", "Gece"] };
const correct1 = { eventId: "correct-1-1", name: "Deniz", round: 1, pointsGranted: 1, solveMs: 8_400 };

const ready = host();
const running1 = host({ phase: "running", card: CARD1, remaining: 38 });
const solved1 = host({
    phase: "finished",
    card: CARD1,
    lastCorrect: correct1,
    reveal: { target: CARD1.target, taboos: CARD1.taboos, solved: true },
});
const timedOut1 = host({ phase: "finished", card: CARD1, remaining: 0, reveal: { target: CARD1.target, taboos: CARD1.taboos, solved: false } });
const running2 = host({ phase: "running", round: 2, card: CARD2, lastCorrect: correct1 });
const passed2 = host({
    phase: "running",
    round: 3,
    card: CARD3,
    lastCorrect: correct1,
    passed: { round: 2, target: CARD2.target },
    passedRound: 2,
});

test("starting the first round logs it once; clock ticks log nothing", () => {
    assert.deepEqual(describeTransition(ready, running1), [{ kind: "roundStarted", round: 1 }]);
    assert.deepEqual(describeTransition(running1, host({ ...running1, remaining: 37, revision: 2 })), []);
    assert.deepEqual(describeTransition(running1, running1), []);
});

test("a correct guess logs the guesser and the finished round's word", () => {
    assert.deepEqual(describeTransition(running1, solved1), [{ kind: "correct", round: 1, name: "Deniz", word: CARD1.target }]);
});

test("a round that runs out of time logs a timeout with its word", () => {
    assert.deepEqual(describeTransition(running1, timedOut1), [{ kind: "timeout", round: 1, word: CARD1.target }]);
});

test("pause and resume are logged; a pass logs the passed word, then the new round", () => {
    const paused = host({ ...running1, phase: "paused" });
    assert.deepEqual(describeTransition(running1, paused), [{ kind: "paused", round: 1 }]);
    assert.deepEqual(describeTransition(paused, running1), [{ kind: "resumed", round: 1 }]);
    assert.deepEqual(describeTransition(solved1, running2), [{ kind: "roundStarted", round: 2 }]);
    assert.deepEqual(describeTransition(running2, passed2), [
        { kind: "passed", round: 2, word: CARD2.target },
        { kind: "roundStarted", round: 3 },
    ]);
    // A pass while paused stays paused on the next round.
    const pausedPass = host({ ...passed2, phase: "paused" });
    assert.deepEqual(describeTransition(host({ ...running2, phase: "paused" }), pausedPass), [
        { kind: "passed", round: 2, word: CARD2.target },
        { kind: "roundStarted", round: 3 },
    ]);
});

test("ending logs once, from any phase", () => {
    assert.deepEqual(describeTransition(running1, host({ ...running1, phase: "ended" })), [{ kind: "ended", round: 1 }]);
    assert.deepEqual(describeTransition(solved1, host({ ...solved1, phase: "ended" })), [{ kind: "ended", round: 1 }]);
    const ended = host({ ...solved1, phase: "ended" });
    assert.deepEqual(describeTransition(ended, ended), []);
});

test("a rejoin after a gap folds the missed steps and never names the live card as a solved word", () => {
    // Seen: round 1 running. Missed: solved, round 2 passed. Now: round 3 running with CARD3 on the card.
    const drafts = describeTransition(running1, passed2);
    assert.deepEqual(drafts, [
        { kind: "passed", round: 2, word: CARD2.target },
        { kind: "correct", round: 1, name: "Deniz", word: undefined },
        { kind: "roundStarted", round: 3 },
    ]);
    assert.ok(!JSON.stringify(drafts).includes(CARD3.target), "the live word is not in the log as an earlier round's answer");
});

test("the log is newest first, keeps ids unique and stops at the cap", () => {
    let log: LogEntry[] = [];
    let next = 1;
    const add = (drafts: Parameters<typeof appendLog>[1]) => {
        log = appendLog(log, drafts, next);
        next += drafts.length;
    };
    add([{ kind: "roundStarted", round: 1 }]);
    add([
        { kind: "passed", round: 1, word: "A" },
        { kind: "roundStarted", round: 2 },
    ]);
    assert.deepEqual(
        log.map((entry) => [entry.id, entry.kind]),
        [
            [3, "roundStarted"],
            [2, "passed"],
            [1, "roundStarted"],
        ]
    );
    const same = log;
    add([]);
    assert.equal(log, same, "no drafts, no new array");
    // Pure: a state updater may run twice (React strict mode) and must give the same answer.
    const twice = [appendLog(same, [{ kind: "ended", round: 2 }], 9), appendLog(same, [{ kind: "ended", round: 2 }], 9)];
    assert.deepEqual(twice[0], twice[1]);
    assert.equal(same.length, 3, "the input is not changed");
    for (let round = 0; round < LOG_LIMIT + 10; round++) add([{ kind: "roundStarted", round }]);
    assert.equal(log.length, LOG_LIMIT);
    assert.equal(new Set(log.map((entry) => entry.id)).size, LOG_LIMIT);
    assert.equal(log[0].round, LOG_LIMIT + 9, "the newest stays");
});

test("a summary read off the last snapshot keeps the top 10 and leaves the rounds unknown", () => {
    const players = Array.from({ length: 12 }, (_, index) => ({
        id: `fake:p${index}`,
        name: `P${index}`,
        points: 12 - index,
        rank: index + 1,
        tied: false,
    }));
    const summary = summaryFromSnapshot(host({ phase: "ended", players, participants: 15 }));
    assert.equal(summary.scores.length, 10);
    assert.deepEqual(summary.scores[0], { name: "P0", points: 12, rank: 1, tied: false });
    assert.ok(!("id" in summary.scores[0]), "player ids stay out of the summary");
    assert.equal(summary.participants, 15);
    assert.equal(summary.rounds, null);
    assert.deepEqual(summaryFromSnapshot(null), { scores: [], participants: 0, rounds: null });
});

test("the panel's stream addresses have the server's shape", () => {
    const key = "A".repeat(43);
    assert.deepEqual(streamUrlsFor("http://127.0.0.1:3243", key), buildStreamUrls("http://127.0.0.1:3243", key));
    assert.deepEqual(streamUrlsFor("https://hushle.com", key), {
        full: `https://hushle.com/stream/${key}`,
        half: `https://hushle.com/stream/${key}?layout=half`,
        stripTop: `https://hushle.com/stream/${key}?overlay=top`,
        stripBottom: `https://hushle.com/stream/${key}?overlay=bottom`,
    });
});

test("camera measurements: the stream screen's hole in 1080p and scaled to 720p", () => {
    assert.equal(cameraMeasurements("none", "m"), null);
    assert.deepEqual(cameraMeasurements("tl", "m"), { p1080: { x: 70, y: 70, w: 560, h: 315 }, p720: { x: 47, y: 47, w: 373, h: 210 } });
    assert.deepEqual(cameraMeasurements("tr", "s"), { p1080: { x: 1370, y: 70, w: 480, h: 270 }, p720: { x: 913, y: 47, w: 320, h: 180 } });
    assert.deepEqual(cameraMeasurements("br", "l"), { p1080: { x: 1210, y: 650, w: 640, h: 360 }, p720: { x: 807, y: 433, w: 427, h: 240 } });
    assert.deepEqual(cameraMeasurements("bl", "m")?.p1080, { x: 70, y: 695, w: 560, h: 315 });
    assert.deepEqual(cameraMeasurements("left", "s"), { p1080: { x: 0, y: 0, w: 960, h: 1080 }, p720: { x: 0, y: 0, w: 640, h: 720 } });
    assert.deepEqual(cameraMeasurements("right", "l")?.p720, { x: 640, y: 0, w: 640, h: 720 });
});

test("only host snapshots are taken", () => {
    assert.ok(isHostSnapshot(running1));
    assert.ok(!isHostSnapshot({ ...running1, type: "public-state" }));
    assert.ok(!isHostSnapshot({ ...running1, revision: 1.5 }));
    assert.ok(!isHostSnapshot({ ...running1, players: undefined }));
    assert.ok(!isHostSnapshot(null));
    assert.ok(!isHostSnapshot("host-state"));
});

test("panel sources keep the key and the card in memory and open stream addresses as plain links", () => {
    const dir = "apps/web/src/components/streamer";
    const files = readdirSync(dir).filter((file) => /\.tsx?$/.test(file));
    assert.ok(files.length >= 5, `expected the panel files, found ${files.length}`);
    for (const file of files) {
        const source = readFileSync(`${dir}/${file}`, "utf8");
        for (const forbidden of ["localStorage", "sessionStorage", "document.cookie", "console.", "<iframe", "router.push"]) {
            assert.ok(!source.includes(forbidden), `${file} must not use ${forbidden}`);
        }
    }
    const obs = readFileSync(`${dir}/streamer-obs-box.tsx`, "utf8");
    assert.ok(!obs.includes("next/link"), "stream addresses are not client-side links");
    assert.match(obs, /target="_blank"\s+rel="noopener noreferrer"/);
    const panel = readFileSync(`${dir}/streamer-panel.tsx`, "utf8");
    assert.match(panel, /io\(\{\s+path: "\/api\/socketio",\s+auth: SOCKET_CLIENT_AUTH,/);
    assert.ok(!panel.includes("instanceof"), "errors are read by code, not by class");
});

console.log(`PASS streamer panel (${count} checks)`);
