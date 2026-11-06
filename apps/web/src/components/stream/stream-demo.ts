import { BROADCAST_THEMES, CAMERA_SIZES, CAMERA_SLOTS, TIMER_STYLES } from "@hushle/domain-streamer";
import { readSnapshot, type StreamRenderer } from "./stream-renderer";

// The stream screen's demo scenes, kept out of the screen's own chunk: stream-screen.tsx loads
// this module with a dynamic import() only when the fake platform is on and the URL asks for
// ?demo=, so a production page never fetches the sample data below.

type Bag = Record<string, unknown>;

function pick<T extends string>(allowed: readonly T[], value: unknown): T | null {
    return allowed.includes(value as T) ? (value as T) : null;
}

/**
 * Built-in sample scenes for screenshots and the theme gallery (only while the fake platform
 * is on): the prototype's demo states and its `play` loop. Demo words only; nothing from a
 * session. Returns a stop function.
 */
export function startDemo(renderer: StreamRenderer, name: string, params: URLSearchParams): () => void {
    const theme = pick(BROADCAST_THEMES, params.get("theme")) ?? BROADCAST_THEMES[0];
    const camera = pick(CAMERA_SLOTS, params.get("camera")) ?? "br";
    const cameraSize = pick(CAMERA_SIZES, params.get("size")) ?? "m";
    const clock = pick(TIMER_STYLES, params.get("clock"));
    const channel = params.get("channel") === "none" ? null : { platform: "twitch", name: params.get("channel") || "denizoynuyor" };
    const race = [
        { name: "Luna", points: 7, rank: 1 },
        { name: "Deniz", points: 6, rank: 2 },
        { name: "Mert_TR", points: 4, rank: 3 },
    ];
    const after = [
        { name: "Deniz", points: 7, rank: 1, tied: true },
        { name: "Luna", points: 7, rank: 1, tied: true },
        { name: "Mert_TR", points: 4, rank: 3 },
    ];
    const longNames = [
        { name: "xXx_KaraSavasci_2004_xXx", points: 12, rank: 1 },
        { name: "Ahmet Yılmaz | Günlük Vlog ve Oyun", points: 11, rank: 2 },
        { name: "bir_ismin_tam_yirmi_bes_k", points: 9, rank: 3 },
    ];
    const card = { target: "MANDALİNA", taboos: ["Portakal", "Kış", "Kabuk", "Turuncu", "Meyve"] };
    const base: Bag = {
        type: "public-state",
        schemaVersion: 4,
        theme,
        camera,
        cameraSize,
        clock,
        showCardName: true,
        // A shop card back needs a session (?card= selects nothing): the demo shows the plain Hushle card.
        cardBack: null,
        connected: true,
        channel,
        duration: 60,
        remaining: 60,
        round: 7,
        passedRound: null,
        passed: null,
        participants: 23,
        scores: race,
        lastCorrect: { eventId: "demo-6", name: "Luna", round: 6, solveMs: 14200 },
        reveal: null,
    };
    const states: Record<string, Bag> = {
        empty: { ...base, phase: "ready", round: 1, participants: 0, scores: [], lastCorrect: null },
        ready: { ...base, phase: "ready" },
        running: { ...base, phase: "running", remaining: 38 },
        low: { ...base, phase: "running", remaining: 7 },
        paused: { ...base, phase: "paused", remaining: 38 },
        offline: { ...base, phase: "paused", remaining: 38, connected: false },
        solved: {
            ...base,
            phase: "finished",
            remaining: 51,
            scores: after,
            participants: 24,
            lastCorrect: { eventId: "demo-7", name: "Deniz", round: 7, solveMs: 8400 },
            reveal: { ...card, solved: true },
        },
        timeout: { ...base, phase: "finished", remaining: 0, reveal: { ...card, solved: false } },
        passed: { ...base, phase: "running", remaining: 60, round: 8, passedRound: 7, passed: { round: 7, target: "MANDALİNA" } },
        ended: { ...base, phase: "ended", scores: after, participants: 31 },
        longnames: {
            ...base,
            phase: "running",
            remaining: 38,
            scores: longNames,
            participants: 212,
            lastCorrect: { eventId: "demo-6", name: "Ahmet Yılmaz | Günlük Vlog ve Oyun", round: 6, solveMs: 14200 },
            channel: { platform: "youtube", name: "ahmetyilmazgunlukvlogoyun" },
        },
    };
    let revision = 1;
    const show = (data: Bag) => {
        const state = readSnapshot({ ...data, revision: revision++ });
        if (state) renderer.render(state);
    };
    if (name !== "play") {
        show(states[name] ?? states.running);
        return () => undefined;
    }

    // A short scripted round loop so the motion can be judged: count down, a correct guess,
    // the next round, a pass, a round that runs out of time, and the finale.
    let state: Bag = { ...states.ready };
    const round = () => state.round as number;
    const steps: Array<[number, () => Bag]> = [];
    const at = (delay: number, change: () => Bag) => steps.push([delay, change]);
    at(1200, () => ({ ...state, phase: "running", remaining: 60 }));
    for (let s = 59; s >= 52; s--) at(1000, () => ({ ...state, remaining: s }));
    at(700, () => ({
        ...state,
        ...states.solved,
        remaining: 52,
        lastCorrect: { eventId: `play-${revision}`, name: "Deniz", round: round(), solveMs: 8400 },
    }));
    at(4800, () => ({ ...state, phase: "running", round: round() + 1, remaining: 60, reveal: null }));
    for (let s = 59; s >= 55; s--) at(1000, () => ({ ...state, remaining: s }));
    at(1000, () => ({ ...state, round: round() + 1, passedRound: round(), passed: { round: round(), target: "KUM SAATİ" }, remaining: 60 }));
    for (let s = 59; s >= 50; s--) at(1000, () => ({ ...state, remaining: s }));
    at(600, () => ({ ...state, remaining: 11 }));
    for (let s = 10; s >= 0; s--) {
        at(1000, () => ({ ...state, remaining: s, phase: s === 0 ? "finished" : "running", reveal: s === 0 ? { ...card, solved: false } : null }));
    }
    at(4200, () => ({ ...state, phase: "ended" }));
    at(5000, () => ({ ...states.ready, round: round() + 1, scores: state.scores }));
    let index = 0;
    let handle: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
        const [delay, change] = steps[index];
        handle = setTimeout(() => {
            state = change();
            show(state);
            index = (index + 1) % steps.length;
            if (index === 0) state = { ...states.ready };
            next();
        }, delay);
    };
    show(state);
    next();
    return () => clearTimeout(handle);
}
