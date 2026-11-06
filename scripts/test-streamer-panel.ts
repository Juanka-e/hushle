import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { HostStreamSnapshot } from "@hushle/domain-streamer";
import * as model from "@/components/streamer/streamer-panel-model";
import {
    actionRefusalAction,
    appendLog,
    cameraMeasurements,
    closedKindOf,
    connectionLabel,
    createSessionRereader,
    describeTransition,
    goneRereadAction,
    hostNoticeOf,
    isHostSnapshot,
    isLiveSession,
    LOG_LIMIT,
    maskStreamUrl,
    scoreKeys,
    streamerGateState,
    streamUrlsFor,
    summaryFromSnapshot,
    withCardNameRule,
    type ClosedKind,
    type LogEntry,
    type RereadStatus as ModelRereadStatus,
} from "@/components/streamer/streamer-panel-model";
import { cameraRect } from "@/components/stream/camera-rects";
import { dictionaries, translate, type TranslationKey } from "@/lib/i18n/dictionaries";
import { buildStreamUrls } from "@/lib/streamer/session-http";
import type { StreamerEndedReason } from "@/lib/streamer/socket-contract";
import type { StreamSessionResponse, StreamSessionView } from "@/types/streamer-session";

// The host panel's pure parts (event log, snapshot summary, stream addresses, camera hole, the
// gate decision, the closed reasons and notices, the re-read guard) and the source rules the
// panel keeps: the view key and the card stay in memory, stream addresses open as plain new-tab
// links. The browser side is tests/streamer-session.spec.ts.

// Source files are read from the repo root this script sits under, whatever the cwd.
const ROOT = path.resolve(__dirname, "..");
const PANEL_DIR = path.join(ROOT, "apps/web/src/components/streamer");
function source(relative: string): string {
    return readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

// Cases are queued and run in order by main(); a failing case is reported and the rest still run.
const cases: Array<[string, () => void | Promise<void>]> = [];
function test(name: string, run: () => void | Promise<void>): void {
    cases.push([name, run]);
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

// ---------------------------------------------------------------- error paths (review fix round 1)

type Refusal = "gone" | "signedOut" | "retry";
const joinRefusalAction = (model as Record<string, unknown>).joinRefusalAction as ((code: unknown) => Refusal) | undefined;
type RereadStatus = "idle" | "loading" | "failed";
const rereadSession = (model as Record<string, unknown>).rereadSession as
    | ((load: () => Promise<Response>, handlers: { apply(data: StreamSessionResponse): void; status(status: RereadStatus): void }) => Promise<void>)
    | undefined;

test("a refused host join: a gone session is re-read, a sign-out stops, anything else is retried", () => {
    assert.equal(typeof joinRefusalAction, "function", "joinRefusalAction decides what a refused join does");
    const decide = joinRefusalAction!;
    assert.equal(decide("STREAMER_SESSION_NOT_FOUND"), "gone");
    assert.equal(decide("STREAMER_SESSION_NOT_OWNED"), "gone");
    // Signed out (or suspended): retrying every 5 s can never succeed.
    assert.equal(decide("AUTH_REQUIRED"), "signedOut");
    // Streamer mode switched off: no retry can pass either.
    assert.equal(decide("STREAMER_MODE_DISABLED"), "disabled");
    for (const code of ["RATE_LIMITED", "UNKNOWN_ERROR", "INVALID_REQUEST", "STREAMER_VIEW_KEY_INVALID", undefined, null, 42, {}]) {
        assert.equal(decide(code), "retry", `${String(code)} is retried`);
    }
});

test("a failed re-read of the session is surfaced, never swallowed; a retry that works clears it", async () => {
    assert.equal(typeof rereadSession, "function", "rereadSession re-reads GET /api/streamer/sessions and reports how it went");
    const reread = rereadSession!;
    const good: StreamSessionResponse = { enabled: true, session: null, lastSettings: null, cardBacks: [] };
    const run = async (load: () => Promise<Response>) => {
        const statuses: RereadStatus[] = [];
        const applied: StreamSessionResponse[] = [];
        await reread(load, { apply: (data) => applied.push(data), status: (status) => statuses.push(status) });
        return { statuses, applied };
    };
    const failing: Array<[string, () => Promise<Response>]> = [
        ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
        ["a server error", async () => new Response(JSON.stringify({ error: "x", code: "UNKNOWN_ERROR" }), { status: 500 })],
        ["a signed-out answer", async () => new Response(JSON.stringify({ error: "x", code: "AUTH_REQUIRED" }), { status: 401 })],
        ["a body that is not JSON", async () => new Response("<html>", { status: 200 })],
        ["a body of the wrong shape", async () => new Response(JSON.stringify({ ok: true }), { status: 200 })],
    ];
    for (const [label, load] of failing) {
        const outcome = await run(load);
        assert.deepEqual(outcome.statuses, ["loading", "failed"], `${label} ends in "failed"`);
        assert.equal(outcome.applied.length, 0, `${label} applies nothing`);
    }
    const ok = await run(async () => new Response(JSON.stringify(good), { status: 200 }));
    assert.deepEqual(ok.statuses, ["loading", "idle"]);
    assert.deepEqual(ok.applied, [good]);
});

test("the panel wires both: re-read failures show a retry banner, a signed-out join stops with a sign-in link", () => {
    const panel = source("apps/web/src/components/streamer/streamer-panel.tsx");
    assert.ok(panel.includes("createSessionRereader("), "the panel re-reads through rereadSession, behind the sequence guard");
    assert.ok(panel.includes(`t("streamer.panel.rereadFailed")`), "a failed re-read is shown");
    assert.ok(panel.includes(`t("streamer.panel.retry")`), "with a retry button");
    assert.ok(panel.includes("joinRefusalAction("), "a refused join goes through joinRefusalAction");
    assert.ok(panel.includes(`t("streamer.panel.signedOut")`), "a sign-out is shown");
    assert.ok(panel.includes("/login?callbackUrl=/streamer"), "with a link back to the panel after signing in");
});

test("panel sources keep the key and the card in memory and open stream addresses in a full new tab", () => {
    const files = readdirSync(PANEL_DIR).filter((file) => /\.tsx?$/.test(file));
    assert.ok(files.length >= 5, `expected the panel files, found ${files.length}`);
    for (const file of files) {
        const text = readFileSync(path.join(PANEL_DIR, file), "utf8");
        for (const forbidden of ["localStorage", "sessionStorage", "document.cookie", "console.", "<iframe", "router.push"]) {
            assert.ok(!text.includes(forbidden), `${file} must not use ${forbidden}`);
        }
    }
    const obs = readFileSync(path.join(PANEL_DIR, "streamer-obs-box.tsx"), "utf8").replace(/\r\n/g, "\n");
    assert.ok(!obs.includes("next/link"), "stream addresses are not client-side links");
    // W9: the preview is a button opening a full new tab, so no href ever holds the key.
    assert.match(obs, /window\.open\(urls\.full, "_blank", "noopener,noreferrer"\)/);
    assert.ok(!/href=\{urls/.test(obs), "no stream address in an href");
    const panel = readFileSync(path.join(PANEL_DIR, "streamer-panel.tsx"), "utf8");
    assert.match(panel, /io\(\{\s+path: "\/api\/socketio",\s+auth: SOCKET_CLIENT_AUTH,/);
    assert.ok(!panel.includes("instanceof"), "errors are read by code, not by class");
});

// ---------------------------------------------------------------- phase 2 gaps (batch 4)

test("P1 streamer:ended: every reason closes the session its own way; a rotation keeps the host room", () => {
    const expected: Record<StreamerEndedReason, ClosedKind | null> = {
        ended: "ended",
        idle: "idle",
        interrupted: "interrupted",
        stopped: "stopped",
        "view-key-rotated": null,
    };
    for (const [reason, kind] of Object.entries(expected)) assert.equal(closedKindOf({ reason }), kind, `reason ${reason}`);
    // Anything unreadable still closes the session (as before): the summary is the last snapshot.
    for (const odd of [{}, { reason: "later" }, { reason: 1 }, { reason: "toString" }, { reason: "__proto__" }, null, undefined, "ended"]) {
        assert.equal(closedKindOf(odd), "ended", `${JSON.stringify(odd)} reads as ended`);
    }
});

test("P1 a round action refused because streamer mode is off stops the panel; other refusals are shown", () => {
    assert.equal(actionRefusalAction("STREAMER_MODE_DISABLED"), "disabled");
    for (const code of ["RATE_LIMITED", "STREAMER_ACTION_INVALID_PHASE", "AUTH_REQUIRED", "STREAMER_SESSION_NOT_FOUND", undefined, null, {}]) {
        assert.equal(actionRefusalAction(code), "failed", `${String(code)} is shown as a failure`);
    }
});

test("P1 the panel shows a stopped notice and a mode-off notice, and stops on both refusals", () => {
    const panel = source("apps/web/src/components/streamer/streamer-panel.tsx");
    assert.ok(panel.includes("closedKindOf(payload)"), "streamer:ended goes through closedKindOf");
    assert.ok(!/reason === "idle" \|\| reason === "interrupted"/.test(panel), "no hand-written reason list is left");
    assert.ok(panel.includes(`t("streamer.panel.stoppedTitle")`) && panel.includes(`t("streamer.panel.stoppedHelp")`), "stopped has its own notice");
    assert.ok(panel.includes(`t("streamer.panel.interruptedTitle")`), "interrupted keeps its notice");
    assert.ok(panel.includes(`action === "disabled"`), "a refused join with streamer mode off is handled");
    assert.ok(panel.includes(`actionRefusalAction(`), "a refused action goes through actionRefusalAction");
    assert.ok(panel.includes(`t("streamer.panel.modeDisabled")`), "streamer mode off is shown");
    assert.equal(dictionaries.tr.streamer.panel.stoppedTitle, "Yayın oturumu sistem tarafından durduruldu.");
    assert.match(dictionaries.tr.streamer.panel.modeDisabled, /^Yayıncı modu şu an kapalı/);
});

test("P2 a host notice is read only when it is the known kind for a known platform", () => {
    assert.deepEqual(hostNoticeOf({ kind: "connection-needs-reconnect", platform: "twitch" }), { kind: "connection-needs-reconnect", platform: "twitch" });
    assert.deepEqual(hostNoticeOf({ kind: "connection-needs-reconnect", platform: "kick", extra: "x" }), {
        kind: "connection-needs-reconnect",
        platform: "kick",
    });
    for (const odd of [
        { kind: "connection-needs-reconnect" },
        { kind: "connection-needs-reconnect", platform: "youtube" },
        { kind: "other", platform: "twitch" },
        { platform: "twitch" },
        null,
        undefined,
        "connection-needs-reconnect",
    ]) {
        assert.equal(hostNoticeOf(odd), null, `${JSON.stringify(odd)} is ignored`);
    }
});

test("P2 the panel listens for host notices and keeps a reconnect warning with a settings link", () => {
    const panel = source("apps/web/src/components/streamer/streamer-panel.tsx");
    assert.ok(panel.includes("socket.on(EVENTS.hostNotice"), "the host room's notices are received");
    assert.ok(panel.includes("hostNoticeOf("), "through hostNoticeOf");
    assert.ok(panel.includes(`t("streamer.panel.reconnectWarning")`), "the warning is shown");
    assert.ok(panel.includes(`href="/dashboard?tab=settings"`), "with a plain link to the settings");
    assert.equal(
        dictionaries.tr.streamer.panel.reconnectWarning,
        "Kanal bağlantın yenilenmeli; bu yayın sürüyor, yeni oturum için ayarlardan yeniden bağlan."
    );
});

function sessionView(patch: Partial<StreamSessionView> = {}): StreamSessionView {
    return {
        id: "s-1",
        status: "active",
        interrupted: false,
        platform: "twitch",
        settings: null,
        startedAt: "2026-11-06T10:00:00.000Z",
        endedAt: null,
        roundCount: 0,
        summary: null,
        ...patch,
    };
}

test("P3 X4 the gate: a live session opens the panel; the warning depends on its own platform's link", () => {
    assert.equal(isLiveSession(sessionView()), true);
    assert.equal(isLiveSession(sessionView({ status: "interrupted", interrupted: true })), false);
    assert.equal(isLiveSession(sessionView({ interrupted: true })), false, "an interrupted view is never live");
    assert.equal(isLiveSession(sessionView({ status: "ended" })), false);
    assert.equal(isLiveSession(null), false);
    type Platform = StreamSessionView["platform"];
    const twitchLive = sessionView({ platform: "twitch" });
    const gate = (enabled: boolean, activePlatforms: Platform[], brokenChannel: boolean, liveSession: StreamSessionView | null) =>
        streamerGateState({ enabled, activePlatforms, brokenChannel, liveSession });
    for (const [active, broken, live] of [
        [[], false, null],
        [["twitch"], false, null],
        [[], true, twitchLive],
        [["twitch", "kick"], true, twitchLive],
    ] as Array<[Platform[], boolean, StreamSessionView | null]>) {
        assert.equal(gate(false, active, broken, live), "coming-soon", "streamer mode off is the same with or without a session");
    }
    assert.equal(gate(true, ["twitch"], false, null), "ready");
    assert.equal(gate(true, ["twitch"], false, twitchLive), "ready", "the live session's own link is active");
    assert.equal(gate(true, ["kick", "twitch"], true, twitchLive), "ready");
    // X4: Kick active, Twitch needs a reconnect, the live session runs on Twitch.
    assert.equal(gate(true, ["kick"], true, twitchLive), "live-reconnect", "another platform's active link does not hide the warning");
    assert.equal(gate(true, ["kick"], false, sessionView({ platform: "kick" })), "ready");
    assert.equal(gate(true, [], true, twitchLive), "live-reconnect", "needs_reconnect with a live session keeps End reachable");
    assert.equal(gate(true, [], false, twitchLive), "live-reconnect", "a link that is gone with a live session too");
    assert.equal(gate(true, ["kick"], false, null), "ready", "no live session: any active link opens the panel");
    assert.equal(gate(true, [], true, null), "reconnect", "no live session: unchanged");
    assert.equal(gate(true, [], true, sessionView({ status: "interrupted", interrupted: true })), "reconnect", "an interrupted session is not live");
    assert.equal(gate(true, [], false, null), "not-linked", "no live session: unchanged");
});

test("P3 X4 the page reads the session before choosing the gate and hands the panel the warning", () => {
    const page = source("apps/web/src/app/streamer/page.tsx");
    assert.ok(page.includes("streamerGateState("), "the page decides through streamerGateState");
    assert.match(page, /^\s+activePlatforms[,:]/m, "with the platforms whose link is active");
    assert.match(page, /liveSession: known/, "and the session it read");
    assert.ok(/needsReconnect:/.test(page), "the panel is told the channel needs a reconnect");
});

test("E10 the page reads the session and the panel's own data together; the gate decision is unchanged", () => {
    const page = source("apps/web/src/app/streamer/page.tsx");
    // With an active link the gate opens the panel whatever the session says, so its reads start
    // beside the session read; without one (only a live session can open it then) they wait.
    assert.match(
        page,
        /await Promise\.all\(\[\s*currentSession\(createSessionServiceDeps\(\), sessionUser\.id\),\s*activePlatforms\.length > 0 \? loadPanelData\(sessionUser\.id\) : null,\s*\]\)/,
        "one Promise.all for the session and the panel data",
    );
    assert.doesNotMatch(page, /await currentSession\(/, "no session read on its own before the panel reads");
    const loader = page.slice(page.indexOf("async function loadPanelData("), page.indexOf("export default async function StreamerPage"));
    assert.ok(loader.length > 0 && !loader.includes("currentSession("), "the panel data never reads the session itself");
    assert.match(page, /const data = preloaded \?\? \(await loadPanelData\(sessionUser\.id\)\);/, "a panel opened without an active link reads its data then");
    assert.match(
        page,
        /streamerGateState\(\{\s*enabled: view\.enabled,\s*activePlatforms,\s*brokenChannel: Boolean\(broken\),\s*liveSession: known \?\? null,\s*\}\)/,
        "the gate gets the same inputs as before",
    );
});

test("P6 no English panel string reads as a wrong plural for one", () => {
    const en = dictionaries.en.streamer as Record<string, unknown>;
    const counted: string[] = [];
    const walk = (node: Record<string, unknown>, prefix: string) => {
        for (const [key, value] of Object.entries(node)) {
            if (typeof value === "string" && value.includes("{count}")) counted.push(`${prefix}${key}`);
            else if (value && typeof value === "object") walk(value as Record<string, unknown>, `${prefix}${key}.`);
        }
    };
    walk(en, "streamer.");
    assert.ok(counted.length >= 6, `found ${counted.length} counted strings`);
    for (const key of counted) {
        const text = translate("en", key as TranslationKey, { count: 1, max: 1 });
        assert.ok(!/\b1 (?:people|points|rounds|words|players|guesses|seconds|categories)\b/.test(text), `${key}: "${text}"`);
    }
    assert.equal(translate("en", "streamer.panel.points", { count: 1 }), "Points: 1");
    assert.equal(translate("en", "streamer.panel.participants", { count: 1 }), "Guessers: 1");
    assert.equal(translate("en", "streamer.panel.summaryRounds", { count: 1 }), "Rounds: 1");
    assert.equal(translate("en", "streamer.panel.summaryParticipants", { count: 1 }), "Participants: 1");
});

test("P7 score rows are keyed by the player id; tied players of the same name never collide", () => {
    const tied = [
        { id: "twitch:1", name: "Deniz", points: 2, rank: 1, tied: true },
        { id: "twitch:2", name: "Deniz", points: 2, rank: 1, tied: true },
        { id: "kick:1", name: "Luna", points: 1, rank: 3, tied: false },
    ];
    assert.deepEqual(scoreKeys(tied), ["twitch:1", "twitch:2", "kick:1"]);
    // The stored summary carries no ids: its fixed list is keyed by position.
    const summary = tied.map(({ name, points, rank, tied: isTied }) => ({ name, points, rank, tied: isTied }));
    const keys = scoreKeys(summary);
    assert.equal(new Set(keys).size, summary.length);
    const panel = source("apps/web/src/components/streamer/streamer-panel.tsx");
    assert.ok(!panel.includes("${entry.rank}-${entry.name}"), "no rank-name key is left");
    assert.ok(panel.includes("scoreKeys("), "the score list keys rows through scoreKeys");
});

test("P8 choosing no card back also switches the card name off, in the same patch, live and in the form", () => {
    assert.deepEqual(withCardNameRule({ cardBack: null }), { cardBack: null, showCardName: false });
    assert.deepEqual(withCardNameRule({ cardBack: { itemId: 7 } }), { cardBack: { itemId: 7 } });
    assert.deepEqual(withCardNameRule({ theme: "sade" }), { theme: "sade" });
    assert.deepEqual(withCardNameRule({ showCardName: true }), { showCardName: true });
    const panel = source("apps/web/src/components/streamer/streamer-panel.tsx");
    assert.match(panel, /emitAction\(EVENTS\.hostSettings, withCardNameRule\(patch\)\)/, "the live patch goes through the rule");
    const form = source("apps/web/src/components/streamer/streamer-setup-form.tsx");
    assert.ok(form.includes("withCardNameRule(patch)"), "the form uses the same rule");
});

test("P9 stream addresses are masked for display; the key never shows, the query stays", () => {
    const key = "Ab_9-".repeat(8) + "xyz";
    const urls = streamUrlsFor("https://hushle.com", key);
    assert.equal(maskStreamUrl(urls.full), "https://hushle.com/stream/••••••");
    assert.equal(maskStreamUrl(urls.half), "https://hushle.com/stream/••••••?layout=half");
    assert.equal(maskStreamUrl(urls.stripTop), "https://hushle.com/stream/••••••?overlay=top");
    assert.equal(maskStreamUrl(urls.stripBottom), "https://hushle.com/stream/••••••?overlay=bottom");
    for (const url of Object.values(urls)) assert.ok(!maskStreamUrl(url).includes(key));
    assert.equal(maskStreamUrl(maskStreamUrl(urls.half)), maskStreamUrl(urls.half), "masking twice changes nothing");
    const obs = source("apps/web/src/components/streamer/streamer-obs-box.tsx");
    assert.ok(obs.includes("maskStreamUrl("), "the OBS box shows masked addresses");
    assert.ok(obs.includes("copy(row.key, urls[row.key])"), "copy still takes the real address");
    const card = source("apps/web/src/components/streamer/streamer-card-view.tsx");
    assert.ok(card.includes(`t("streamer.panel.cardHide")`) && card.includes(`t("streamer.panel.cardShow")`), "the card has a hide / show toggle");
});

test("P10 every toggle group in the setup form is a labelled group", () => {
    const form = source("apps/web/src/components/streamer/streamer-setup-form.tsx");
    assert.match(form, /role="group" aria-labelledby=\{labelId\}/, "Field is a group named by its label");
    assert.match(form, /<p id=\{labelId\} className=\{labelClass\}>/, "the label element carries the id");
});

test("P12 the stale readyHelp text is gone from both locales", () => {
    assert.ok(!("readyHelp" in dictionaries.tr.streamer), "tr");
    assert.ok(!("readyHelp" in dictionaries.en.streamer), "en");
});

test("P13 P14 overlapping re-reads: only the newest answer counts, and a cancel drops what is in flight", async () => {
    assert.equal(typeof createSessionRereader, "function", "createSessionRereader guards overlapping re-reads");
    const good = (id: string): StreamSessionResponse => ({ enabled: true, session: sessionView({ id }), lastSettings: null, cardBacks: [] });
    const answers: Array<{ resolve: (response: Response) => void; reject: (error: unknown) => void }> = [];
    const load = () => new Promise<Response>((resolve, reject) => answers.push({ resolve, reject }));
    const applied: string[] = [];
    const statuses: ModelRereadStatus[] = [];
    const rereader = createSessionRereader(load, {
        apply: (data) => applied.push(data.session?.id ?? "none"),
        status: (status) => statuses.push(status),
    });
    const older = rereader.run();
    const newer = rereader.run();
    answers[1].resolve(new Response(JSON.stringify(good("newer")), { status: 200 }));
    await newer;
    answers[0].resolve(new Response(JSON.stringify(good("older")), { status: 200 }));
    await older;
    assert.deepEqual(applied, ["newer"], "the older answer, arriving last, is dropped");
    assert.deepEqual(statuses, ["loading", "loading", "idle"]);

    // An older failure after a newer success never shows the retry banner.
    applied.length = 0;
    statuses.length = 0;
    const failingOld = rereader.run();
    const fine = rereader.run();
    answers[3].resolve(new Response(JSON.stringify(good("fine")), { status: 200 }));
    await fine;
    answers[2].reject(new TypeError("fetch failed"));
    await failingOld;
    assert.deepEqual(applied, ["fine"]);
    assert.ok(!statuses.includes("failed"), `statuses ${statuses.join(",")}`);

    // A cancel (a session was just created) drops the answers still on their way, success or failure.
    applied.length = 0;
    statuses.length = 0;
    const late = rereader.run();
    const lateFail = rereader.run();
    rereader.cancel();
    answers[4].resolve(new Response(JSON.stringify(good("late")), { status: 200 }));
    answers[5].reject(new TypeError("fetch failed"));
    await Promise.all([late, lateFail]);
    assert.deepEqual(applied, []);
    assert.deepEqual(statuses, ["loading", "loading"]);
    // The next run works as usual.
    const after = rereader.run();
    answers[6].resolve(new Response(JSON.stringify(good("after")), { status: 200 }));
    await after;
    assert.deepEqual(applied, ["after"]);
    assert.equal(statuses.at(-1), "idle");
});

test("P13 the retry banner is cleared on a new session and on starting over; a create drops a re-read in flight", () => {
    const panel = source("apps/web/src/components/streamer/streamer-panel.tsx");
    const body = (name: string) => {
        const start = panel.indexOf(`const ${name} = (`);
        assert.ok(start >= 0, `${name} exists`);
        return panel.slice(start, panel.indexOf("\n    };", start));
    };
    assert.ok(body("created").includes(`setReread("idle")`), "created clears the banner");
    assert.ok(body("created").includes("rereader().cancel()"), "created drops an older re-read");
    assert.ok(body("startOver").includes(`setReread("idle")`), "startOver clears the banner");
    assert.ok(panel.includes("createSessionRereader("), "re-reads go through the guarded rereader");
});

test("P15 a session that is gone shows no connection badge: the re-read (or its retry banner) speaks", () => {
    assert.equal(connectionLabel("gone"), null);
    assert.equal(connectionLabel("joined"), "streamer.panel.connected");
    assert.equal(connectionLabel("connecting"), "streamer.panel.connecting");
    assert.equal(connectionLabel("reconnecting"), "streamer.panel.reconnecting");
    assert.equal(connectionLabel("closed"), "streamer.panel.connectionClosed");
    const panel = source("apps/web/src/components/streamer/streamer-panel.tsx");
    assert.ok(panel.includes(`setConnection("gone")`), "a gone session sets the gone state");
    assert.ok(panel.includes("connectionLabel(connection)"), "the badge reads through connectionLabel");
});

test("P16 the signed-out text also covers a suspended account", () => {
    assert.equal(dictionaries.tr.streamer.panel.signedOut, "Oturumun kapandı ya da hesabın şu an kullanılamıyor. Yeniden giriş yap.");
    assert.match(dictionaries.en.streamer.panel.signedOut, /account/i);
});

test("P17 the panel takes the camera hole from camera-rects and never imports the renderer or the demo", () => {
    const files = readdirSync(PANEL_DIR).filter((file) => /\.tsx?$/.test(file));
    const importsOf = (text: string) => [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((match) => match[1]);
    for (const file of files) {
        const imports = importsOf(readFileSync(path.join(PANEL_DIR, file), "utf8"));
        for (const target of imports) {
            assert.ok(!/stream-renderer$/.test(target), `${file} imports the renderer (${target})`);
            assert.ok(!/stream-demo$/.test(target), `${file} imports the demo scenes (${target})`);
        }
    }
    const modelSource = source("apps/web/src/components/streamer/streamer-panel-model.ts");
    assert.ok(importsOf(modelSource).includes("@/components/stream/camera-rects"), "the model imports camera-rects");
    assert.deepEqual(cameraMeasurements("br", "l")?.p1080, cameraRect("br", "l"), "the same numbers as the shared module");
});

// ---------------------------------------------------------------- batch 4 fix round 1

test("X1 a masked address is never selected on focus, and the copy-failure text points at Göster", () => {
    assert.match(dictionaries.tr.streamer.panel.copyFailed, /«Göster»/);
    assert.match(dictionaries.en.streamer.panel.copyFailed, /“Show”/);
    const obs = source("apps/web/src/components/streamer/streamer-obs-box.tsx");
    assert.ok(obs.includes("if (revealed) event.currentTarget.select();"), "focus selects the address only while it is shown");
    assert.ok(!obs.includes("onFocus={(event) => event.currentTarget.select()}"), "no unconditional select is left");
});

test("E6 a masked address keeps no selection and cannot be dragged, so no copy by hand picks up the dots", () => {
    const obs = source("apps/web/src/components/streamer/streamer-obs-box.tsx");
    const input = obs.slice(obs.indexOf("<input"), obs.indexOf("/>", obs.indexOf("<input")));
    assert.ok(input.length > 0, "the address field");
    // Chromium ignores user-select on a text field: a drag, a double click or Ctrl+A is undone as it happens.
    assert.match(input, /onSelect=\{\(event\) => \{\s*if \(!revealed\) unselect\(event\.currentTarget\);\s*\}\}/, "a selection in a masked field is collapsed");
    assert.match(obs, /function unselect\(input: HTMLInputElement\): void \{\s*if \(input\.selectionStart !== input\.selectionEnd\) input\.setSelectionRange\(0, 0\);\s*\}/);
    assert.match(input, /draggable=\{false\}/, "the field is never a drag source");
    assert.match(input, /onDragStart=\{\(event\) => \{\s*if \(!revealed\) event\.preventDefault\(\);\s*\}\}/, "a masked value is never dragged out");
    assert.match(input, /\$\{revealed \? "" : " select-none"\}/, "user-select: none while masked");
});

test("X2 a re-read after a refused join rejoins the same live session, a few times in a row at most", () => {
    const live = (id: string) => ({ enabled: true, session: sessionView({ id }), lastSettings: null, cardBacks: [] }) as StreamSessionResponse;
    assert.equal(goneRereadAction(null, 0, live("s-1")), "none", "no refused join: nothing to do");
    assert.equal(goneRereadAction("s-1", 0, live("s-1")), "rejoin");
    assert.equal(goneRereadAction("s-1", 1, live("s-1")), "rejoin");
    assert.equal(goneRereadAction("s-1", 2, live("s-1")), "reload", "it keeps refusing: tell the host to reload");
    assert.equal(goneRereadAction("s-1", 0, live("s-2")), "none", "another session: the view follows it by its id");
    const interrupted = { enabled: true, session: sessionView({ status: "interrupted", interrupted: true }), lastSettings: null, cardBacks: [] };
    assert.equal(goneRereadAction("s-1", 0, interrupted as StreamSessionResponse), "none");
    assert.equal(goneRereadAction("s-1", 0, { enabled: true, session: null, lastSettings: null, cardBacks: [] }), "none");
    const panel = source("apps/web/src/components/streamer/streamer-panel.tsx");
    assert.ok(panel.includes("goneRereadAction("), "the panel decides through goneRereadAction");
    assert.ok(panel.includes("key={`${session.id}#${generation}`}"), "a rejoin remounts the live view (a fresh socket)");
    assert.ok(panel.includes("onJoined={joinedLive}"), "a successful join resets the count");
    assert.ok(panel.includes(`data-testid="streamer-stale"`), "the reload notice exists");
});

test("X3 streamer mode off shows no connection badge next to its own notice", () => {
    assert.equal(connectionLabel("off"), null);
    const panel = source("apps/web/src/components/streamer/streamer-panel.tsx");
    assert.ok(panel.includes(`setConnection("off")`), "mode off sets the off state");
});

test("X5 X7 each row's show/hide button is named with its row; the English warning reads as two sentences", () => {
    const rows = ["streamer.panel.urlFull", "streamer.panel.urlHalf", "streamer.panel.urlStripTop", "streamer.panel.urlStripBottom"] as const;
    for (const locale of ["tr", "en"] as const) {
        for (const [key, visible] of [
            ["streamer.panel.urlShowLabel", translate(locale, "streamer.panel.urlShow")],
            ["streamer.panel.urlHideLabel", translate(locale, "streamer.panel.urlHide")],
        ] as const) {
            const names = rows.map((row) => translate(locale, key, { label: translate(locale, row) }));
            assert.equal(new Set(names).size, 4, `${locale} ${key}: ${names.join(" | ")}`);
            for (const name of names) assert.ok(name.toLocaleLowerCase(locale).includes(visible.toLocaleLowerCase(locale)), `"${name}" contains "${visible}"`);
        }
    }
    const obs = source("apps/web/src/components/streamer/streamer-obs-box.tsx");
    assert.ok(obs.includes(`aria-label={t(revealed ? "streamer.panel.urlHideLabel" : "streamer.panel.urlShowLabel", { label })}`));
    assert.equal(
        dictionaries.en.streamer.panel.reconnectWarning,
        "Your channel link needs renewing; this stream keeps going. Reconnect in Settings before you open a new session."
    );
});

// ---------------------------------------------------------------- batch 3b (W7)

/** Every source file the given files reach through value imports (relative and @/ ones), with the chain that got there. */
function importGraph(entries: string[]): Map<string, string[]> {
    const srcRoot = path.join(ROOT, "apps/web/src");
    const resolve = (from: string, specifier: string): string | null => {
        let base: string;
        if (specifier.startsWith("@/")) base = path.join(srcRoot, specifier.slice(2));
        else if (specifier.startsWith("./") || specifier.startsWith("../")) base = path.resolve(path.dirname(from), specifier);
        else return null;
        for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
            if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
        }
        return null;
    };
    const seen = new Map<string, string[]>();
    const queue: Array<[string, string[]]> = entries.map((file) => [file, [path.basename(file)]]);
    while (queue.length > 0) {
        const [file, chain] = queue.shift()!;
        if (seen.has(file)) continue;
        seen.set(file, chain);
        const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
        // Whole-statement type imports and exports bring no code along; everything else does.
        const statements = [...text.matchAll(/^(?:import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/gm)]
            .filter((match) => !match[1])
            .map((match) => match[2]);
        const dynamic = [...text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
        for (const specifier of [...statements, ...dynamic]) {
            const target = resolve(file, specifier);
            if (target && !seen.has(target)) queue.push([target, [...chain, path.relative(srcRoot, target).replace(/\\/g, "/")]]);
        }
    }
    return seen;
}

test("W7 no panel file reaches the stream renderer or the demo scenes through any import chain", () => {
    const entries = readdirSync(PANEL_DIR)
        .filter((file) => /\.tsx?$/.test(file))
        .map((file) => path.join(PANEL_DIR, file));
    const graph = importGraph(entries);
    assert.ok(graph.size > entries.length, `the walk follows imports (${graph.size} files)`);
    const streamDir = path.join(ROOT, "apps/web/src/components/stream");
    assert.ok(graph.has(path.join(streamDir, "camera-rects.ts")), "the walk does reach the shared stream modules");
    for (const forbidden of ["stream-renderer.ts", "stream-demo.ts"]) {
        const chain = graph.get(path.join(streamDir, forbidden));
        assert.equal(chain, undefined, `${forbidden} is reached: ${chain?.join(" -> ")}`);
    }
});

async function main(): Promise<void> {
    let passed = 0;
    let failed = 0;
    for (const [name, run] of cases) {
        try {
            await run();
            passed += 1;
            console.log(`ok - ${name}`);
        } catch (error) {
            failed += 1;
            console.log(`not ok - ${name}
    ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (failed > 0) {
        console.log(`FAIL streamer panel: ${failed} failed, ${passed} passed`);
        process.exit(1);
    }
    console.log(`PASS streamer panel (${passed} checks)`);
}

void main();
