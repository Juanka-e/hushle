import assert from "node:assert/strict";
import type { PublicStreamSnapshot } from "@hushle/domain-streamer";
import { cameraRect, offlineState, readSnapshot, urlLookSnapshot, type StreamState } from "@/components/stream/stream-renderer";
import {
    connectStreamTransport,
    createReloadCounter,
    createRevisionGuard,
    isProtocolRefusal,
    isViewKey,
    protocolReloadDelayMs,
    type ReloadCounter,
    type StreamSocketLike,
    type StreamTimers,
} from "@/components/stream/stream-transport";
import type { StreamerEndedReason } from "@/lib/streamer/socket-contract";

// The stream screen's pure parts: the snapshot reader (the screen's allowlist), the camera hole
// geometry, the revision guard and the transport (against a fake socket and a fake clock). The
// DOM side is covered by tests/streamer-stream-screen.spec.ts.

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

// ---------------------------------------------------------------- transport harness

const KEY = "Ab3_-".repeat(8) + "xyz";

// As StreamSocketLike takes them: any listener, whatever its parameters. `fire` passes what the
// server would send.
type Listener = (...args: never[]) => void;

class FakeSocket implements StreamSocketLike {
    connected = false;
    connectCalls = 0;
    disconnectCalls = 0;
    emits: Array<{ event: string; payload: unknown; ack: (reply: unknown) => void }> = [];
    private listeners = new Map<string, Listener[]>();

    on(event: string, listener: Listener): this {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
        return this;
    }
    emit(event: string, payload: unknown, ack: (reply: unknown) => void): this {
        this.emits.push({ event, payload, ack });
        return this;
    }
    connect(): this {
        this.connectCalls += 1;
        return this;
    }
    disconnect(): this {
        this.disconnectCalls += 1;
        this.connected = false;
        return this;
    }
    fire(event: string, ...args: unknown[]): void {
        for (const listener of this.listeners.get(event) ?? []) (listener as (...args: unknown[]) => void)(...args);
    }
    up(): void {
        this.connected = true;
        this.fire("connect");
    }
    down(): void {
        this.connected = false;
        this.fire("disconnect", "transport close");
    }
}

function fakeClock(): StreamTimers & { advance(ms: number): void } {
    let now = 0;
    let next = 0;
    const timers = new Map<number, { at: number; run: () => void }>();
    return {
        setTimeout(run, ms) {
            next += 1;
            timers.set(next, { at: now + ms, run });
            return next;
        },
        clearTimeout(handle) {
            timers.delete(handle as number);
        },
        advance(ms) {
            const end = now + ms;
            for (;;) {
                const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
                if (!due) break;
                timers.delete(due[0]);
                now = due[1].at;
                due[1].run();
            }
            now = end;
        },
    };
}

function memoryCounter(start = 0): ReloadCounter {
    let count = start;
    return {
        get: () => count,
        set(next) {
            count = next;
        },
    };
}

// What the handshake middleware sends when it refuses this bundle's socket protocol.
function protocolRefusal(): Error {
    return Object.assign(new Error("socket protocol unsupported"), {
        data: { code: "SOCKET_PROTOCOL_UNSUPPORTED", clientVersion: 1, serverVersion: 2, minimumVersion: 2, reason: "too_old" },
    });
}

// One page load: a fresh socket and clock; `reloads` is what survives a reload (sessionStorage).
function harness(viewKey = KEY, reloads: ReloadCounter = memoryCounter()) {
    const socket = new FakeSocket();
    const clock = fakeClock();
    const events: string[] = [];
    const states: StreamState[] = [];
    let reloadCalls = 0;
    const transport = connectStreamTransport({
        viewKey,
        socket,
        timers: clock,
        reloads,
        reload() {
            reloadCalls += 1;
        },
        onState(state) {
            states.push(state);
            events.push(`state:${state.revision}`);
        },
        onOffline() {
            events.push("offline");
        },
        onEnded(reason: StreamerEndedReason) {
            events.push(`ended:${reason}`);
        },
    });
    return { socket, clock, events, states, transport, reloaded: () => reloadCalls };
}

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

    await test("the revision guard takes only newer states; a reset starts it again", () => {
        const guard = createRevisionGuard();
        assert.equal(guard.accept(0), true);
        assert.equal(guard.accept(3), true);
        assert.equal(guard.accept(3), false);
        assert.equal(guard.accept(2), false);
        assert.equal(guard.accept(4), true);
        // After a reconnect the join ack's revision is the new floor, even a lower one.
        guard.reset(1);
        assert.equal(guard.accept(1), false);
        assert.equal(guard.accept(2), true);
    });

    await test("only a 43-character base64url key is a view key", () => {
        assert.equal(isViewKey(KEY), true);
        for (const bad of ["", "short", KEY + "A", KEY.slice(1) + "/", KEY.slice(1) + "=", KEY.slice(1) + " "]) {
            assert.equal(isViewKey(bad), false, JSON.stringify(bad));
        }
    });

    await test("a malformed key goes offline at once and never connects", () => {
        const { socket, events } = harness("not-a-real-key");
        assert.deepEqual(events, ["offline"]);
        assert.equal(socket.connectCalls, 0);
        assert.equal(socket.emits.length, 0);
    });

    await test("the join ack draws at once and settles the offline timer", () => {
        const { socket, clock, events, states } = harness();
        assert.equal(socket.connectCalls, 1);
        socket.up();
        assert.equal(socket.emits.length, 1);
        assert.equal(socket.emits[0].event, "streamer:public:join");
        assert.deepEqual(socket.emits[0].payload, { viewKey: KEY });
        socket.emits[0].ack({ ok: true, state: snapshot({ revision: 9 }) });
        assert.deepEqual(events, ["state:9"]);
        assert.equal(states[0].phase, "running");
        clock.advance(20_000);
        assert.deepEqual(events, ["state:9"], "no offline after a state");
    });

    await test("broadcasts pass the revision guard; unreadable ones are dropped", () => {
        const { socket, events } = harness();
        socket.up();
        socket.emits[0].ack({ ok: true, state: snapshot({ revision: 5 }) });
        socket.fire("streamer:public:state", snapshot({ revision: 6 }));
        socket.fire("streamer:public:state", snapshot({ revision: 6 }));
        socket.fire("streamer:public:state", snapshot({ revision: 4 }));
        socket.fire("streamer:public:state", snapshot({ revision: 8, schemaVersion: 3 }));
        socket.fire("streamer:public:state", { revision: 9 });
        socket.fire("streamer:public:state", snapshot({ revision: 7 }));
        assert.deepEqual(events, ["state:5", "state:6", "state:7"]);
    });

    await test("five seconds without a state show the offline scene, once", () => {
        const { socket, clock, events } = harness();
        clock.advance(4_999);
        assert.deepEqual(events, []);
        clock.advance(1);
        assert.deepEqual(events, ["offline"]);
        clock.advance(30_000);
        assert.deepEqual(events, ["offline"]);
        // A late connection still joins and draws.
        socket.up();
        socket.emits[0].ack({ ok: true, state: snapshot({ revision: 2 }) });
        assert.deepEqual(events, ["offline", "state:2"]);
    });

    await test("a refused key goes offline and stops for good", () => {
        for (const code of ["STREAMER_VIEW_KEY_INVALID", "INVALID_REQUEST"]) {
            const { socket, clock, events } = harness();
            socket.up();
            socket.emits[0].ack({ ok: false, code, error: "x" });
            assert.deepEqual(events, ["offline"], code);
            assert.equal(socket.disconnectCalls, 1);
            socket.up();
            clock.advance(60_000);
            socket.fire("streamer:public:state", snapshot({ revision: 50 }));
            assert.equal(socket.emits.length, 1, "no second join");
            assert.deepEqual(events, ["offline"]);
        }
    });

    await test("a passing refusal (rate limit, server error, bad state) asks again with backoff", () => {
        const { socket, clock, events } = harness();
        socket.up();
        socket.emits[0].ack({ ok: false, code: "RATE_LIMITED", error: "x" });
        assert.deepEqual(events, ["offline"]);
        clock.advance(4_999);
        assert.equal(socket.emits.length, 1);
        clock.advance(1);
        assert.equal(socket.emits.length, 2);
        socket.emits[1].ack({ ok: true, state: { type: "public-state", schemaVersion: 99 } });
        clock.advance(9_999);
        assert.equal(socket.emits.length, 2, "the second wait is longer");
        clock.advance(1);
        assert.equal(socket.emits.length, 3);
        socket.emits[2].ack({ ok: true, state: snapshot({ revision: 1 }) });
        assert.deepEqual(events, ["offline", "offline", "state:1"]);
    });

    await test("a lost connection goes offline after five seconds; the rejoin resets the guard", () => {
        const { socket, clock, events } = harness();
        socket.up();
        socket.emits[0].ack({ ok: true, state: snapshot({ revision: 40 }) });
        socket.down();
        clock.advance(5_000);
        assert.deepEqual(events, ["state:40", "offline"]);
        socket.up();
        assert.equal(socket.emits.length, 2);
        assert.deepEqual(socket.emits[1].payload, { viewKey: KEY });
        // The server's count may be lower now: the ack is taken anyway and becomes the floor.
        socket.emits[1].ack({ ok: true, state: snapshot({ revision: 3 }) });
        socket.fire("streamer:public:state", snapshot({ revision: 3 }));
        socket.fire("streamer:public:state", snapshot({ revision: 4 }));
        assert.deepEqual(events, ["state:40", "offline", "state:3", "state:4"]);
    });

    await test("a quick reconnect never flashes offline, and a stale ack is ignored", () => {
        const { socket, clock, events } = harness();
        socket.up();
        const first = socket.emits[0];
        socket.down();
        socket.up();
        first.ack({ ok: true, state: snapshot({ revision: 7 }) });
        assert.deepEqual(events, [], "the ack of the lost connection is dropped");
        socket.emits[1].ack({ ok: true, state: snapshot({ revision: 8 }) });
        clock.advance(20_000);
        assert.deepEqual(events, ["state:8"]);
    });

    await test("streamer:ended closes the screen for good, whatever the reason", () => {
        for (const reason of ["ended", "idle", "view-key-rotated", "interrupted", "stopped", "bogus"]) {
            const { socket, clock, events } = harness();
            socket.up();
            socket.emits[0].ack({ ok: true, state: snapshot({ revision: 1 }) });
            socket.fire("streamer:ended", { reason });
            assert.deepEqual(events, ["state:1", `ended:${reason === "bogus" ? "interrupted" : reason}`]);
            assert.equal(socket.disconnectCalls, 1);
            socket.fire("streamer:public:state", snapshot({ revision: 2 }));
            socket.up();
            clock.advance(60_000);
            assert.equal(socket.emits.length, 1);
            assert.equal(events.length, 2);
        }
    });

    await test("only the handshake middleware's protocol code is a protocol refusal", () => {
        assert.equal(isProtocolRefusal(protocolRefusal()), true);
        assert.equal(isProtocolRefusal({ data: { code: "SOCKET_PROTOCOL_UNSUPPORTED" } }), true);
        for (const other of [
            new Error("xhr poll error"),
            Object.assign(new Error("x"), { data: { code: "RATE_LIMITED" } }),
            Object.assign(new Error("x"), { data: null }),
            { data: "SOCKET_PROTOCOL_UNSUPPORTED" },
            { code: "SOCKET_PROTOCOL_UNSUPPORTED" },
            "SOCKET_PROTOCOL_UNSUPPORTED",
            null,
            undefined,
        ]) {
            assert.equal(isProtocolRefusal(other), false, String(other));
        }
    });

    await test("reloads after a protocol refusal wait 30 s, 60 s, 120 s, then 300 s each", () => {
        assert.deepEqual([0, 1, 2, 3, 4, 50].map(protocolReloadDelayMs), [30_000, 60_000, 120_000, 300_000, 300_000, 300_000]);
        // Five page loads in a row, each refused at its handshake: the count survives each reload.
        const reloads = memoryCounter();
        for (const [index, delay] of [30_000, 60_000, 120_000, 300_000, 300_000].entries()) {
            const page = harness(KEY, reloads);
            page.socket.fire("connect_error", protocolRefusal());
            assert.deepEqual(page.events, ["offline"], `load ${index}: the offline scene at once`);
            page.clock.advance(delay - 1);
            assert.equal(page.reloaded(), 0, `load ${index}: not before ${delay} ms`);
            page.clock.advance(1);
            assert.equal(page.reloaded(), 1, `load ${index}: reloads at ${delay} ms`);
            assert.equal(reloads.get(), index + 1);
            // Nothing else follows on the dead page: no second offline, no join, no second reload.
            page.socket.up();
            page.clock.advance(600_000);
            assert.deepEqual(page.events, ["offline"]);
            assert.equal(page.socket.emits.length, 0);
            assert.equal(page.reloaded(), 1);
        }
    });

    await test("a join that draws a state resets the reload backoff; a refused join does not", () => {
        const reloads = memoryCounter(3);
        const refused = harness(KEY, reloads);
        refused.socket.up();
        refused.socket.emits[0].ack({ ok: false, code: "RATE_LIMITED", error: "x" });
        assert.equal(reloads.get(), 3);

        const joined = harness(KEY, reloads);
        joined.socket.up();
        joined.socket.emits[0].ack({ ok: true, state: snapshot({ revision: 1 }) });
        assert.equal(reloads.get(), 0);

        // The next deploy starts the backoff over.
        const next = harness(KEY, reloads);
        next.socket.fire("connect_error", protocolRefusal());
        next.clock.advance(29_999);
        assert.equal(next.reloaded(), 0);
        next.clock.advance(1);
        assert.equal(next.reloaded(), 1);
    });

    await test("other connect errors leave the retry to socket.io and never reload", () => {
        for (const error of [new Error("xhr poll error"), Object.assign(new Error("x"), { data: { code: "RATE_LIMITED" } }), undefined]) {
            const reloads = memoryCounter(2);
            const page = harness(KEY, reloads);
            page.socket.fire("connect_error", error);
            page.clock.advance(600_000);
            assert.equal(page.reloaded(), 0);
            assert.equal(page.socket.disconnectCalls, 0, "the socket is left to reconnect");
            assert.deepEqual(page.events, ["offline"], "only the five-second offline timer");
            assert.equal(reloads.get(), 2);
            // socket.io's own reconnect still joins and draws.
            page.socket.up();
            page.socket.emits[0].ack({ ok: true, state: snapshot({ revision: 4 }) });
            assert.deepEqual(page.events, ["offline", "state:4"]);
        }
    });

    await test("close() cancels a scheduled reload; a malformed or closed screen never reloads", () => {
        const page = harness();
        page.socket.fire("connect_error", protocolRefusal());
        page.transport.close();
        page.clock.advance(600_000);
        assert.equal(page.reloaded(), 0);

        const malformed = harness("not-a-real-key");
        malformed.socket.fire("connect_error", protocolRefusal());
        malformed.clock.advance(600_000);
        assert.equal(malformed.reloaded(), 0);

        const ended = harness();
        ended.socket.up();
        ended.socket.emits[0].ack({ ok: true, state: snapshot({ revision: 1 }) });
        ended.socket.fire("streamer:ended", { reason: "stopped" });
        ended.socket.fire("connect_error", protocolRefusal());
        ended.clock.advance(600_000);
        assert.equal(ended.reloaded(), 0);
        assert.deepEqual(ended.events, ["state:1", "ended:stopped"]);
    });

    await test("the reload count lives in session storage under a fixed name, in memory if storage fails", () => {
        const store = new Map<string, string>();
        const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
        const counter = createReloadCounter(storage);
        assert.equal(counter.get(), 0);
        counter.set(2);
        assert.equal(counter.get(), 2);
        assert.deepEqual([...store.keys()], ["hushle-stream:protocol-reloads"], "never the view key");
        assert.equal(createReloadCounter(storage).get(), 2, "a reloaded page reads it back");
        for (const junk of ["-1", "1.5", "abc", "1e400"]) {
            store.set("hushle-stream:protocol-reloads", junk);
            assert.equal(createReloadCounter(storage).get(), 0, junk);
        }

        const broken = {
            getItem(): string | null {
                throw new Error("SecurityError");
            },
            setItem(): void {
                throw new Error("QuotaExceededError");
            },
        };
        const fallback = createReloadCounter(broken);
        assert.equal(fallback.get(), 0);
        fallback.set(3);
        assert.equal(fallback.get(), 3);
        const none = createReloadCounter(null);
        none.set(1);
        assert.equal(none.get(), 1);
    });

    await test("close() stops every timer and callback", () => {
        const { socket, clock, events, transport } = harness();
        transport.close();
        assert.equal(socket.disconnectCalls, 1);
        clock.advance(60_000);
        socket.up();
        socket.fire("streamer:public:state", snapshot({ revision: 2 }));
        assert.deepEqual(events, []);
        assert.equal(socket.emits.length, 0);
    });

    console.log(`${count} checks passed.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
