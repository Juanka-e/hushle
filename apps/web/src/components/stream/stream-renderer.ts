import {
    BROADCAST_THEMES,
    CAMERA_SIZES,
    CAMERA_SLOTS,
    CHANNEL_PLATFORMS,
    TIMER_STYLES,
    type BroadcastTheme,
    type CameraSize,
    type CameraSlot,
    type ChannelPlatform,
    type ClockStyle,
    type StreamPhase,
} from "@hushle/domain-streamer";
import { buildCosmeticPatternStyle, getCosmeticMotionClass, getCosmeticMotionStyle } from "@/lib/cosmetics/effects";
import type { CosmeticMotionPreset, CosmeticPattern } from "@/types/economy";
import { cameraRect } from "./camera-rects";

// The streamer panel still imports the camera hole from here; it moves to ./camera-rects next.
export { cameraRect };

// The public stream screen's renderer, ported from the V4 prototype
// (scripts/design-prototypes/hushle-streamer-studio/public.js). It draws only what readSnapshot
// lets through and never imports a word pack. The DOM it drives is stream-screen.tsx; nothing
// here touches the DOM at import time, so the pure parts run under node too.

const PHASES: readonly StreamPhase[] = ["ready", "running", "paused", "finished", "ended"];
// Timer looks: each theme ships with one; the snapshot may name another.
const THEME_CLOCK: Record<BroadcastTheme, ClockStyle> = {
    "oyun-gecesi": "hourglass",
    studyo: "bulbs",
    "gece-altini": "candle",
    sakura: "incense",
    sade: "counter",
};
const BULBS = 36;
const SEGMENTS = 20;
const PLATFORM_NAMES: Record<ChannelPlatform, string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };
const ROMAN = ["I", "II", "III"];
const SCORE_TITLES: Record<BroadcastTheme, string> = {
    "oyun-gecesi": "Skor",
    studyo: "Liderler",
    "gece-altini": "Bu gecenin skoru",
    sakura: "En çok bilenler",
    sade: "Skor",
};

// ---------------------------------------------------------------- snapshot

export interface ScoreEntry {
    name: string;
    points: number;
    rank: number;
    tied: boolean;
}

export interface LastSolver {
    eventId: string;
    name: string;
    round: number;
    solveMs: number | null;
}

export interface CardBackLook {
    surfaceColor: string;
    borderColor: string;
    accentColor: string;
    secondaryColor: string;
    titleColor: string;
    pattern: CosmeticPattern;
    patternOpacity: number;
    patternScale: number;
    motionPreset: CosmeticMotionPreset;
    motionSpeedMs: number;
    glowColor: string;
    glowBlur: number;
    glowOpacity: number;
    overlayImageUrl: string | null;
    overlayOpacity: number;
}

export interface StreamCardBackView {
    itemId: number;
    name: string;
    theme: CardBackLook;
}

/** A public snapshot after the screen's own allowlist. */
export interface StreamState {
    revision: number;
    phase: StreamPhase;
    theme: BroadcastTheme;
    camera: CameraSlot;
    cameraSize: CameraSize;
    clock: ClockStyle | null;
    showCardName: boolean;
    remaining: number;
    duration: number;
    round: number;
    passedRound: number | null;
    connected: boolean;
    participants: number;
    scores: ScoreEntry[];
    lastCorrect: LastSolver | null;
    cardBack: StreamCardBackView | null;
    reveal: { target: string; taboos: string[]; solved: boolean } | null;
    channel: { platform: ChannelPlatform; name: string } | null;
    passed: { round: number; target: string } | null;
}

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, min: number, max: number, fallback = min): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

function fraction(value: unknown, max: number, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
}

function text(value: unknown, max = 40): string {
    return typeof value === "string" ? value.replace(/\p{Cc}/gu, "").trim().slice(0, max) : "";
}

function pick<T extends string>(allowed: readonly T[], value: unknown): T | null {
    return allowed.includes(value as T) ? (value as T) : null;
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const PATTERNS: readonly CosmeticPattern[] = ["none", "grid", "dots", "diagonal", "chevrons", "rings", "noise"];
const MOTIONS: readonly CosmeticMotionPreset[] = ["none", "pulse", "drift", "shimmer"];

function color(value: unknown, fallback: string): string {
    return typeof value === "string" && HEX_COLOR.test(value) ? value : fallback;
}

// An image the screen may load: a same-site path or an https address, nothing that could
// break out of an attribute or run.
function imageUrl(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 2048 || /["'<>\\\s]/.test(value)) return null;
    if (/^\/(?!\/)[A-Za-z0-9._~%/-]+(\?[A-Za-z0-9._~%&=-]*)?$/.test(value)) return value;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password ? value : null;
    } catch {
        return null;
    }
}

// The server resolves card backs already (ResolvedCardBackTheme); this keeps only what the
// screen draws and only in a shape it can draw safely.
function readCardBack(value: unknown): StreamCardBackView | null {
    if (!isBag(value) || !Number.isInteger(value.itemId) || !isBag(value.theme)) return null;
    const theme = value.theme;
    return {
        itemId: value.itemId as number,
        name: text(value.name, 40),
        theme: {
            surfaceColor: color(theme.surfaceColor, "#0f172a"),
            borderColor: color(theme.borderColor, "#475569"),
            accentColor: color(theme.accentColor, "#94a3b8"),
            secondaryColor: color(theme.secondaryColor, "#cbd5e1"),
            titleColor: color(theme.titleColor, "#f8fafc"),
            pattern: pick(PATTERNS, theme.pattern) ?? "none",
            patternOpacity: fraction(theme.patternOpacity, 0.42, 0),
            patternScale: integer(theme.patternScale, 8, 42, 18),
            motionPreset: pick(MOTIONS, theme.motionPreset) ?? "none",
            motionSpeedMs: integer(theme.motionSpeedMs, 1800, 12000, 5000),
            glowColor: color(theme.glowColor, "#94a3b8"),
            glowBlur: integer(theme.glowBlur, 8, 56, 22),
            glowOpacity: fraction(theme.glowOpacity, 0.36, 0.18),
            overlayImageUrl: imageUrl(theme.overlayImageUrl),
            overlayOpacity: fraction(theme.overlayOpacity, 0.45, 0),
        },
    };
}

/** The screen's allowlist: null for anything that is not a v4 public state. */
export function readSnapshot(data: unknown): StreamState | null {
    if (!isBag(data) || data.type !== "public-state" || data.schemaVersion !== 4 || !Number.isInteger(data.revision)) return null;
    const phase = pick(PHASES, data.phase) ?? "ready";
    const reveal = isBag(data.reveal) ? data.reveal : null;
    const last = isBag(data.lastCorrect) ? data.lastCorrect : null;
    const channel = isBag(data.channel) ? data.channel : null;
    const passed = isBag(data.passed) ? data.passed : null;
    const platform = channel ? pick(CHANNEL_PLATFORMS, channel.platform) : null;
    const duration = integer(data.duration, 1, 600, 60);
    return {
        revision: data.revision as number,
        phase,
        theme: pick(BROADCAST_THEMES, data.theme) ?? BROADCAST_THEMES[0],
        camera: pick(CAMERA_SLOTS, data.camera) ?? "none",
        cameraSize: pick(CAMERA_SIZES, data.cameraSize) ?? "m",
        clock: pick(TIMER_STYLES, data.clock),
        showCardName: data.showCardName === true,
        remaining: integer(data.remaining, 0, duration),
        duration,
        round: integer(data.round, 1, 999, 1),
        passedRound: Number.isInteger(data.passedRound) ? (data.passedRound as number) : null,
        connected: data.connected === true,
        participants: integer(data.participants, 0, 999999),
        scores: (Array.isArray(data.scores) ? data.scores : [])
            .slice(0, 3)
            .filter((entry): entry is Bag => isBag(entry) && text(entry.name) !== "")
            .map((entry) => ({
                name: text(entry.name),
                points: integer(entry.points, 0, 99999),
                rank: integer(entry.rank, 1, 999, 1),
                tied: entry.tied === true,
            })),
        lastCorrect:
            last && text(last.name)
                ? {
                      eventId: text(last.eventId, 80),
                      name: text(last.name),
                      round: integer(last.round, 1, 999, 1),
                      solveMs: typeof last.solveMs === "number" && Number.isFinite(last.solveMs) ? integer(last.solveMs, 0, 600000) : null,
                  }
                : null,
        cardBack: readCardBack(data.cardBack),
        // Defence in depth: a word is drawn only for a round that is over.
        reveal:
            phase === "finished" && reveal && text(reveal.target)
                ? {
                      target: text(reveal.target),
                      taboos: (Array.isArray(reveal.taboos) ? reveal.taboos : [])
                          .slice(0, 5)
                          .map((word) => text(word, 24))
                          .filter(Boolean),
                      solved: reveal.solved === true,
                  }
                : null,
        channel: channel && platform && text(channel.name, 25) ? { platform, name: text(channel.name, 25) } : null,
        passed: passed && Number.isInteger(passed.round) && text(passed.target) ? { round: passed.round as number, target: text(passed.target) } : null,
    };
}

/**
 * Until the server speaks, the look chosen in the URL already shows: an OBS source that lost
 * its link keeps the streamer's theme and camera hole.
 */
export function urlLookSnapshot(params: URLSearchParams): StreamState {
    return readSnapshot({
        type: "public-state",
        schemaVersion: 4,
        revision: 0,
        phase: "ready",
        theme: params.get("theme"),
        camera: params.get("camera") || "none",
        cameraSize: params.get("size") || "m",
        clock: params.get("clock"),
        scores: [],
    }) as StreamState;
}

/** The prototype's offline scene over the last look: paused, waiting for the connection. */
export function offlineState(state: StreamState): StreamState {
    const idle = state.phase === "ready" || state.phase === "ended";
    return { ...state, phase: "paused", connected: false, reveal: null, remaining: idle ? state.duration : state.remaining };
}

// ---------------------------------------------------------------- layouts

export type StreamMode = "scene" | "half" | "strip";

export interface StreamView {
    mode: StreamMode;
    strip: "top" | "bottom" | null;
    /** A dark backdrop and the camera hint: the panel preview and the demo scenes. */
    preview: boolean;
}

/**
 * The page is a 1920x1080 scene, a standalone 960x1080 column (?layout=half) or a 1920x220
 * strip (?overlay=top|bottom). The scene's layout follows the camera slot.
 */
export function viewFromParams(params: URLSearchParams, demo: boolean): StreamView {
    const mode: StreamMode = params.get("overlay") ? "strip" : params.get("layout") === "half" ? "half" : "scene";
    return {
        mode,
        strip: mode === "strip" ? (params.get("overlay") === "top" ? "top" : "bottom") : null,
        preview: params.get("preview") === "1" || demo,
    };
}

const CANVAS: Record<StreamMode, [number, number]> = { scene: [1920, 1080], half: [960, 1080], strip: [1920, 220] };

// ---------------------------------------------------------------- theme scenery

const FILIGREE =
    '<path d="M6 114V40C6 20 20 6 40 6h74M18 114V48c0-17 13-30 30-30h66M40 6c0 18 6 30 22 34M6 40c18 0 30 6 34 22" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="46" cy="46" r="5" fill="currentColor"/>';
const BLOSSOMS: Array<[number, number]> = [
    [700, 34], [300, 36], [790, 150], [520, 100], [610, 76], [420, 128],
    [180, 150], [250, 140], [860, 42], [96, 186], [660, 50], [360, 120],
];
// Constant markup only: no snapshot value ever reaches innerHTML.
const SCENERY: Record<BroadcastTheme, string> = {
    sade: "",
    "oyun-gecesi": `
    <svg class="tea" viewBox="0 0 150 190">
      <defs>
        <linearGradient id="tea-body" x1="0" x2="1"><stop offset="0" stop-color="#6e1a07"/><stop offset=".35" stop-color="#b8400f"/><stop offset=".6" stop-color="#8f2c08"/><stop offset="1" stop-color="#5a1405"/></linearGradient>
        <linearGradient id="saucer" x1="0" x2="1"><stop offset="0" stop-color="#d9d4ca"/><stop offset=".5" stop-color="#fbf9f4"/><stop offset="1" stop-color="#cfc9bd"/></linearGradient>
      </defs>
      <ellipse cx="75" cy="172" rx="70" ry="15" fill="url(#saucer)"/>
      <ellipse cx="75" cy="170" rx="70" ry="13" fill="none" stroke="#b8322a" stroke-width="3"/>
      <path d="M44 34C44 64 58 82 58 100 58 120 46 136 48 164H102C104 136 92 120 92 100 92 82 106 64 106 34Z" fill="url(#tea-body)"/>
      <path d="M38 14C38 52 56 78 56 100 56 122 42 138 44 166H106C108 138 94 122 94 100 94 78 112 52 112 14Z" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.75)" stroke-width="2.5"/>
      <ellipse cx="75" cy="34" rx="31" ry="5" fill="#d0561a" opacity=".85"/>
      <path d="M48 22C50 52 64 78 63 100M52 130C50 142 50 152 51 160" stroke="rgba(255,255,255,.55)" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M100 6 84 96" stroke="#c6c6c0" stroke-width="4" stroke-linecap="round"/>
    </svg>`,
    studyo: `
    <div class="bulbs"></div>
    <div class="stage-floor"></div>`,
    "gece-altini": `
    <div class="cloth"></div>
    <div class="gilt-frame"></div>
    <svg class="filigree tl" viewBox="0 0 120 120">${FILIGREE}</svg>
    <svg class="filigree tr" viewBox="0 0 120 120">${FILIGREE}</svg>
    <svg class="filigree bl" viewBox="0 0 120 120">${FILIGREE}</svg>
    <svg class="filigree br" viewBox="0 0 120 120">${FILIGREE}</svg>
    <svg class="candle" viewBox="0 0 120 260">
      <defs><radialGradient id="flame" cx="50%" cy="70%" r="60%"><stop offset="0" stop-color="#fff6c8"/><stop offset=".45" stop-color="#ffb347"/><stop offset="1" stop-color="rgba(255,120,40,0)"/></radialGradient></defs>
      <ellipse cx="60" cy="246" rx="52" ry="10" fill="#2a1a10"/>
      <path d="M22 240 30 150 90 150 98 240Z" fill="#b48a3a"/>
      <rect x="40" y="48" width="40" height="110" rx="6" fill="#f1e2c0"/>
      <path d="M40 60C44 80 36 96 46 110 52 118 40 130 40 150H80C80 130 70 118 76 104 84 92 76 78 80 60Z" fill="#fbf1d8"/>
      <rect x="58" y="32" width="4" height="18" fill="#3a2a1a"/>
      <ellipse class="flame" cx="60" cy="24" rx="22" ry="34" fill="url(#flame)"/>
    </svg>`,
    sakura: `
    <svg class="hills" viewBox="0 0 1920 300" preserveAspectRatio="none"><path d="M0 210C160 150 260 120 420 170S700 120 860 150 1180 90 1380 160 1700 120 1920 170V300H0Z" fill="#231d3f"/><path d="M0 250C220 210 380 230 560 245S900 205 1120 235 1540 215 1920 240V300H0Z" fill="#1a1530"/></svg>
    <div class="veranda"></div>
    <svg class="branch" viewBox="0 0 900 260">
      <path d="M900 40C760 52 640 70 520 104 400 138 300 128 190 150 120 164 60 196 0 214" fill="none" stroke="#2b1b18" stroke-width="18" stroke-linecap="round"/>
      <path d="M560 96C600 60 650 40 720 30M330 132C300 100 290 70 300 30M760 52C790 90 800 120 790 160" fill="none" stroke="#2b1b18" stroke-width="8" stroke-linecap="round"/>
      <g class="blossoms">${BLOSSOMS.map(
          ([x, y], i) =>
              `<g transform="translate(${x} ${y}) rotate(${i * 37}) scale(${0.8 + (i % 3) * 0.2})"><circle r="9" cx="0" cy="-12"/><circle r="9" cx="11" cy="-4"/><circle r="9" cx="7" cy="10"/><circle r="9" cx="-7" cy="10"/><circle r="9" cx="-11" cy="-4"/><circle r="4" class="heart"/></g>`
      ).join("")}</g>
    </svg>
    <div class="petals"></div>`,
};

// ---------------------------------------------------------------- copy

function seconds(ms: number): string {
    return (ms / 1000).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function promptFor(state: StreamState, lowTime: boolean): string {
    const chat = state.channel ? PLATFORM_NAMES[state.channel.platform] + " sohbetine" : "sohbete";
    const leader = state.scores[0];
    const solver = state.reveal?.solved && state.lastCorrect ? state.lastCorrect.name : null;
    switch (state.phase) {
        case "ready":
            return `Yayıncı başlatınca kelimeyi ${chat} yaz.\nİlk doğru yazan puanı alır.`;
        case "running":
            return (lowTime ? "Son 10 saniye!" : `Anlatılan kelimeyi ${chat} yaz.`) + "\nİlk doğru yazan puanı alır.";
        case "paused":
            return state.connected ? "Süre durdu, birazdan devam." : "Sohbet bağlantısı bekleniyor.";
        case "finished":
            return solver
                ? `${solver} bildi!\nSıradaki kartı yayıncı açacak.`
                : "Süre doldu, kimse bilemedi.\nSıradaki kartı yayıncı açacak.";
        case "ended":
            return leader
                ? leader.tied
                    ? "Oyun bitti, liderler berabere."
                    : `Oyun bitti. ${leader.name} önde bitirdi.`
                : "Oyun bitti. Bir sonrakinde görüşürüz.";
    }
    return "";
}

// ---------------------------------------------------------------- renderer

const SVG_NS = "http://www.w3.org/2000/svg";

function tally(points: number): SVGSVGElement | null {
    if (points < 1 || points > 20) return null;
    const svg = document.createElementNS(SVG_NS, "svg");
    const groups = Math.ceil(points / 5);
    svg.setAttribute("viewBox", `0 0 ${groups * 58} 50`);
    svg.setAttribute("class", "tally");
    svg.setAttribute("aria-hidden", "true");
    for (let i = 0; i < points; i++) {
        const group = Math.floor(i / 5);
        const inGroup = i % 5;
        const x = group * 58;
        const line = document.createElementNS(SVG_NS, "path");
        line.setAttribute(
            "d",
            inGroup === 4 ? `M${x - 2} 40 L${x + 42} 8` : `M${x + 4 + inGroup * 10} ${6 + (inGroup % 2) * 2} L${x + 2 + inGroup * 10} 46`
        );
        svg.append(line);
    }
    return svg;
}

function classicBack(): HTMLElement {
    const node = document.createElement("div");
    node.className = "classic-back";
    const mark = document.createElement("span");
    mark.className = "classic-mark";
    mark.textContent = "H";
    node.append(mark);
    return node;
}

function hexAlpha(opacity: number): string {
    return Math.round(opacity * 255)
        .toString(16)
        .padStart(2, "0");
}

// The shop card back, layered as the game's CardBackPanel layers it.
function cosmeticBack(look: CardBackLook): HTMLElement {
    const node = document.createElement("div");
    node.className = "cosmetic-back";
    node.style.setProperty("--cb-surface", look.surfaceColor);
    node.style.setProperty("--cb-border", look.borderColor);
    node.style.setProperty("--cb-secondary", look.secondaryColor);
    node.style.setProperty("--cb-title", look.titleColor);
    node.style.setProperty("--cb-accent-glow", `${look.accentColor}33`);
    node.style.setProperty("--cb-border-glow", `${look.borderColor}33`);
    node.style.setProperty("--cb-overlay-opacity", String(look.overlayOpacity));
    if (look.overlayImageUrl) {
        const art = document.createElement("img");
        art.className = "art";
        art.alt = "";
        art.decoding = "async";
        art.referrerPolicy = "no-referrer";
        art.src = look.overlayImageUrl;
        node.append(art);
    }
    const pattern = buildCosmeticPatternStyle({
        pattern: look.pattern,
        primaryColor: look.borderColor,
        secondaryColor: look.secondaryColor,
        scale: look.patternScale,
        opacity: look.patternOpacity,
    });
    if (pattern) {
        const layer = document.createElement("div");
        const motion = getCosmeticMotionClass(look.motionPreset);
        layer.className = motion ? `cosmetic-pattern ${motion}` : "cosmetic-pattern";
        if (pattern.backgroundImage) layer.style.backgroundImage = String(pattern.backgroundImage);
        if (pattern.backgroundSize) layer.style.backgroundSize = String(pattern.backgroundSize);
        if (pattern.backgroundPosition) layer.style.backgroundPosition = String(pattern.backgroundPosition);
        const duration = getCosmeticMotionStyle(look.motionSpeedMs)?.animationDuration;
        if (motion && duration) layer.style.animationDuration = String(duration);
        node.append(layer);
    }
    const glow = document.createElement("div");
    glow.className = "cosmetic-glow";
    const title = document.createElement("span");
    title.className = "cosmetic-title";
    title.textContent = "Tahmin et";
    const band = document.createElement("div");
    band.className = "cosmetic-band";
    node.append(glow, title, band);
    return node;
}

function cosmeticGlow(look: CardBackLook): string {
    return `0 20px 50px -25px ${look.accentColor}, 0 0 ${look.glowBlur}px -12px ${look.glowColor}${hexAlpha(look.glowOpacity)}`;
}

export interface StreamRenderer {
    /** Draws a state (the caller decides which states are new enough). */
    render(state: StreamState): void;
    /** The last state drawn, if any. */
    current(): StreamState | null;
    destroy(): void;
}

export function createStreamRenderer(root: HTMLElement, view: StreamView): StreamRenderer {
    const $ = <T extends Element = HTMLElement>(id: string): T => {
        const node = root.querySelector<T>(`#${id}`);
        if (!node) throw new Error(`stream screen: #${id} is missing`);
        return node;
    };
    const stage = $("stage");
    const timer = root.querySelector<HTMLElement>(".timer")!;
    const card = $("card");
    const verdict = $("verdict");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let previous: StreamState | null = null;
    let previousLeader: string | null | undefined;
    let sceneryTheme = "";
    let cardSignature = "";
    let scoreSignature = "";
    let destroyed = false;
    let fontsWatched = false;
    let secondaryTimer: ReturnType<typeof setTimeout> | undefined;
    let transientTimer: ReturnType<typeof setTimeout> | undefined;
    let flipTimer: ReturnType<typeof setTimeout> | undefined;

    function fit(): void {
        const [width, height] = CANVAS[view.mode];
        const scale = view.mode === "strip" ? window.innerWidth / width : Math.min(window.innerWidth / width, window.innerHeight / height);
        stage.style.setProperty("--scale", String(scale));
    }
    window.addEventListener("resize", fit);
    fit();
    root.dataset.mode = view.mode;
    if (view.strip) root.dataset.strip = view.strip;
    // OBS shows the page see-through outside the stage and inside the camera hole, so the
    // webcam under it shows. The preview adds a dark backdrop.
    root.classList.toggle("preview", view.preview);

    // The studio board's bulbs: index 0 at the top, clockwise; the counter's 20 segments.
    (function buildClocks() {
        const bar = $<SVGGElement>("segment-bar");
        bar.replaceChildren();
        for (let i = 0; i < SEGMENTS; i++) {
            const segment = document.createElementNS(SVG_NS, "rect");
            segment.setAttribute("x", String(16 + i * 11.4));
            segment.setAttribute("y", "154");
            segment.setAttribute("width", "9");
            segment.setAttribute("height", "28");
            segment.setAttribute("rx", "3");
            segment.setAttribute("class", "seg");
            bar.append(segment);
        }
        const ring = $<SVGGElement>("bulb-ring");
        ring.replaceChildren();
        for (let i = 0; i < BULBS; i++) {
            const angle = (i / BULBS) * Math.PI * 2 - Math.PI / 2;
            const bulb = document.createElementNS(SVG_NS, "circle");
            bulb.setAttribute("cx", (150 + Math.cos(angle) * 131).toFixed(1));
            bulb.setAttribute("cy", (150 + Math.sin(angle) * 131).toFixed(1));
            bulb.setAttribute("r", "7");
            bulb.setAttribute("class", "bulb");
            ring.append(bulb);
        }
    })();

    function replay(node: Element | null, className: string): void {
        if (!node || reducedMotion.matches) return;
        node.classList.remove(className);
        void (node as HTMLElement).offsetWidth;
        node.classList.add(className);
    }

    function applyLayout(state: StreamState): string {
        const layout = view.mode === "strip" ? "strip" : view.mode === "half" ? "half" : state.camera === "none" ? "full" : state.camera;
        root.dataset.layout = layout;
        const column = ["left", "right", "half"].includes(layout);
        root.dataset.scores = layout === "strip" ? "row" : column ? "stack" : "wide";
        root.dataset.last = column ? "card" : "wide";
        root.dataset.timer = column || layout === "strip" ? "compact" : "tall";
        root.dataset.card = ["tl", "bl"].includes(layout) ? "small" : "normal";
        const cam = view.mode === "scene" ? cameraRect(state.camera, state.cameraSize) : null;
        root.dataset.camera = cam ? state.camera : "none";
        // On the wrapper, so the layout table (also there) can place slots around the hole.
        for (const key of ["x", "y", "w", "h"] as const) root.style.setProperty(`--cam-${key}`, `${cam ? cam[key] : 0}px`);
        return layout;
    }

    function setScenery(theme: BroadcastTheme): void {
        if (theme === sceneryTheme) return;
        sceneryTheme = theme;
        $("scene-art").innerHTML = SCENERY[theme];
    }

    // ------------------------------------------------------------ text fitting

    // Shrink a one-line node's font until it fits its box; beyond the floor the CSS ellipsis takes over.
    function fitLine(node: HTMLElement, max: number, min: number): void {
        node.style.fontSize = `${max}px`;
        let size = max;
        while (size > min && node.scrollWidth > node.clientWidth + 1) {
            size -= 2;
            node.style.fontSize = `${size}px`;
        }
    }

    // The revealed word: shrink until its longest word fits and it takes at most three lines;
    // a single word too long even at the smallest size breaks across lines.
    function fitWord(node: HTMLElement, word: string): void {
        const block = document.createElement("span");
        block.className = "words";
        word.split(/\s+/).forEach((part, i) => {
            if (i) block.append(" ");
            const span = document.createElement("span");
            span.textContent = part;
            block.append(span);
        });
        node.replaceChildren(block);
        let size = 76;
        const fits = () =>
            Math.max(...[...block.children].map((span) => (span as HTMLElement).offsetWidth)) <= block.clientWidth &&
            block.offsetHeight <= size * 1.08 * 3 + 2;
        node.style.fontSize = `${size}px`;
        while (size > 22 && !fits()) {
            size -= 2;
            node.style.fontSize = `${size}px`;
        }
        if (fits()) return;
        block.classList.add("breakable");
        size = 44;
        node.style.fontSize = `${size}px`;
        while (size > 24 && block.offsetHeight > size * 1.08 * 3 + 2) {
            size -= 2;
            node.style.fontSize = `${size}px`;
        }
    }

    // The prompt keeps to two lines: it shrinks a little before it would wrap a third time.
    function fitPrompt(node: HTMLElement, copy: string): void {
        node.textContent = copy;
        const max = parseFloat(getComputedStyle(root).getPropertyValue("--prompt-size")) || 44;
        let size = max;
        node.style.fontSize = `${size}px`;
        while (size > 34 && node.scrollHeight > size * 1.3 * 2 + 4) {
            size -= 2;
            node.style.fontSize = `${size}px`;
        }
    }

    // Long chat names shrink before they are cut (measured from the stylesheet size each time).
    function fitScoreNames(): void {
        for (const name of $("scores").querySelectorAll<HTMLElement>(".score-name")) {
            name.style.removeProperty("font-size");
            fitLine(name, parseFloat(getComputedStyle(name).fontSize), 28);
        }
    }

    function fitLastName(): void {
        const name = $("last-name");
        if (!name.textContent) return;
        name.style.removeProperty("font-size");
        fitLine(name, parseFloat(getComputedStyle(name).fontSize), 32);
    }

    // ------------------------------------------------------------ card and scores

    function renderCard(cardBack: StreamCardBackView | null): void {
        const signature = cardBack ? JSON.stringify(cardBack) : "classic";
        if (signature === cardSignature) return;
        cardSignature = signature;
        const back = $("card-back");
        back.replaceChildren(cardBack ? cosmeticBack(cardBack.theme) : classicBack());
        if (cardBack) {
            back.dataset.back = "cosmetic";
            back.style.setProperty("--cb-glow", cosmeticGlow(cardBack.theme));
        } else {
            delete back.dataset.back;
            back.style.removeProperty("--cb-glow");
        }
        // A shop card back has no front art: the word sits on the plain Hushle front.
        $("front-art").replaceChildren();
        $("card-front").dataset.art = "classic";
        root.style.setProperty("--deck-tone", cardBack ? cardBack.theme.surfaceColor : "var(--deck-classic)");
    }

    function renderScores(state: StreamState): void {
        const { scores, theme, phase } = state;
        const variant = root.dataset.scores;
        const signature = [theme, variant, phase === "ended", JSON.stringify(scores)].join("|");
        if (signature === scoreSignature) return;
        scoreSignature = signature;
        const list = $("scores");
        list.replaceChildren();
        // Tallies stay a column: once anyone passes 20 the whole column goes numeric.
        const tallies = theme === "oyun-gecesi" && variant === "wide" && scores.every((entry) => entry.points <= 20);
        for (let slot = 0; slot < 3; slot++) {
            const entry = scores[slot];
            const item = document.createElement("li");
            item.className = "score" + (entry ? "" : " empty");
            item.dataset.slot = String(slot + 1);
            item.dataset.rank = String(Math.min(3, entry ? entry.rank : slot + 1));
            if (entry?.tied) item.dataset.tied = "";
            const rank = document.createElement("span");
            rank.className = "score-rank";
            const rankNumber = entry ? entry.rank : slot + 1;
            rank.textContent = theme === "gece-altini" && variant !== "row" ? ROMAN[rankNumber - 1] || String(rankNumber) : String(rankNumber);
            const name = document.createElement("span");
            name.className = "score-name";
            name.textContent = entry ? entry.name : "";
            if (entry) name.title = entry.name;
            const points = document.createElement("b");
            points.className = "score-points";
            points.textContent = entry ? String(entry.points) : "";
            item.append(rank, name);
            const marks = entry && tallies ? tally(entry.points) : null;
            if (marks) item.append(marks);
            item.append(points);
            if (entry?.tied) {
                const tie = document.createElement("span");
                tie.className = "score-tie";
                tie.textContent = "eşit";
                item.append(tie);
            }
            list.append(item);
        }
        fitScoreNames();
        const leader = scores[0] && !scores[0].tied ? scores[0].name : null;
        if (leader && previousLeader !== undefined && leader !== previousLeader && !reducedMotion.matches) {
            list.querySelector('[data-slot="1"]')?.classList.add("new-leader");
        }
        previousLeader = leader;
    }

    // ------------------------------------------------------------ verdict stamp

    // Stamp in the timer slot: the verdict of a round, or a pass.
    function showVerdict(kind: "solved" | "timeout" | "pass", word: string, detail: string): void {
        verdict.dataset.kind = kind;
        $("verdict-word").textContent = word;
        $("verdict-detail").textContent = detail;
        verdict.classList.add("show");
        replay(verdict, "stamping");
    }

    function hideVerdict(): void {
        verdict.classList.remove("show");
    }

    function petals(): void {
        if (reducedMotion.matches) return;
        const box = root.querySelector(".petals");
        if (!box) return;
        box.replaceChildren();
        for (let i = 0; i < 18; i++) {
            const petal = document.createElement("i");
            petal.style.setProperty("--x", `${(120 + ((i * 97) % 760)).toFixed(0)}px`);
            petal.style.setProperty("--drift", `${(((i * 53) % 220) - 60).toFixed(0)}px`);
            petal.style.setProperty("--delay", `${(((i * 37) % 90) / 100).toFixed(2)}s`);
            petal.style.setProperty("--spin", `${(((i * 71) % 540) - 270).toFixed(0)}deg`);
            box.append(petal);
        }
    }

    // ------------------------------------------------------------ render

    function renderPrimary(state: StreamState): { layout: string; low: boolean } {
        root.dataset.theme = state.theme;
        root.dataset.phase = state.phase;
        setScenery(state.theme);
        const layout = applyLayout(state);

        const channel = $("channel");
        channel.textContent = state.channel ? `@${state.channel.name} · ${PLATFORM_NAMES[state.channel.platform]}` : "Anlat, sohbet bilsin";
        channel.classList.toggle("handle", Boolean(state.channel));

        renderCard(state.cardBack);
        const cardName = $("card-name");
        cardName.hidden = !state.showCardName || !state.cardBack || !["ready", "running", "paused"].includes(state.phase);
        cardName.textContent = state.cardBack?.name ? `Yayıncının kartı: ${state.cardBack.name}` : "";
        $("front-round").textContent = String(state.round);

        // Timer: the sand (wax, stick, arc, lit bulbs) follows the remaining share of the round.
        const idle = state.phase === "ready" || state.phase === "ended";
        const share = idle ? 1 : state.remaining / state.duration;
        timer.style.setProperty("--p", String(share));
        root.dataset.clock = state.clock || THEME_CLOCK[state.theme];
        const lit = state.phase === "ended" ? 0 : Math.ceil(share * BULBS);
        $("bulb-ring")
            .querySelectorAll("circle")
            .forEach((bulb, index) => bulb.classList.toggle("lit", index < lit));
        const segments = state.phase === "ended" ? 0 : Math.ceil(share * SEGMENTS);
        $("segment-bar")
            .querySelectorAll("rect")
            .forEach((segment, index) => segment.classList.toggle("lit", index < segments));
        const low = state.phase === "running" && state.remaining <= 10;
        timer.classList.toggle("low", low);
        $("seconds").textContent = state.phase === "ready" ? "Hazır" : String(state.remaining);
        $("seconds-note").textContent = state.phase === "ready" ? `${state.duration} sn` : state.phase === "paused" ? "durdu" : "";
        $("round").textContent = `${state.round}. tur`;

        const started = previous !== null && state.phase === "running" && ["ready", "finished", "ended"].includes(previous.phase);
        const passed = previous !== null && state.passedRound !== null && state.passedRound !== previous.passedRound;
        if (started || passed) replay(timer, "turning");
        // The sand turns over; the other timers light up again.
        if (started) replay(timer, "relight");
        if (passed) {
            replay(card, "passing");
            // The stamp names the passed card only when the snapshot still carries it (the
            // server drops it once the pool deals the same word again): never from passedRound alone.
            if (state.passed && state.passed.round === state.passedRound) {
                showVerdict("pass", "Pas", state.passed.target);
                clearTimeout(transientTimer);
                transientTimer = setTimeout(() => {
                    if (!previous?.reveal) hideVerdict();
                }, 3200);
            }
        }
        if (started && previous?.reveal) replay(card, "drawing");

        // Reveal: the card turns over once its round is over. Its word leaves the page with it,
        // because a later round may draw the same word again.
        if (state.reveal) {
            const taboos = $("reveal-taboos");
            taboos.replaceChildren();
            for (const word of state.reveal.taboos) {
                const item = document.createElement("li");
                item.textContent = word;
                taboos.append(item);
            }
            fitWord($("reveal-target"), state.reveal.target);
        } else {
            clearTimeout(flipTimer);
            $("reveal-target").replaceChildren();
            $("reveal-taboos").replaceChildren();
            if (card.classList.contains("flipped")) {
                card.classList.add("instant");
                card.classList.remove("flipped");
                void card.offsetWidth;
                card.classList.remove("instant");
            }
        }
        const entering = state.reveal !== null && !previous?.reveal;
        if (state.reveal && !entering) card.classList.add("flipped");
        if (state.reveal && entering) {
            const solver = state.reveal.solved && state.lastCorrect ? state.lastCorrect : null;
            showVerdict(
                state.reveal.solved ? "solved" : "timeout",
                state.reveal.solved ? "Bildi!" : "Süre doldu",
                solver ? solver.name + (solver.solveMs !== null ? ` · ${seconds(solver.solveMs)} sn` : "") : ""
            );
            // Stamp first, then the card.
            if (reducedMotion.matches) card.classList.add("flipped");
            else
                flipTimer = setTimeout(() => {
                    if (previous?.reveal) card.classList.add("flipped");
                }, 420);
            replay(root.querySelector(".scene"), "celebrate");
            if (state.reveal.solved && state.theme === "sakura") petals();
        }
        const passStampShowing =
            previous !== null && state.passedRound === previous.passedRound && verdict.dataset.kind === "pass" && verdict.classList.contains("show");
        if (!state.reveal && !passed && !passStampShowing) hideVerdict();

        // Finale: the winner takes the card's place, the hourglass lies down.
        const winner = $("winner");
        const leader = state.scores[0];
        winner.hidden = state.phase !== "ended" || !leader;
        if (leader && !winner.hidden) {
            const tied = state.scores.filter((entry) => entry.tied && entry.rank === 1).map((entry) => entry.name);
            $("winner-label").textContent = tied.length > 1 ? "Berabere bitirdiler" : "Gecenin kazananı";
            $("winner-name").textContent = tied.length > 1 ? tied.join(" · ") : leader.name;
            $("winner-points").textContent = `${leader.points} puan`;
            fitLine($("winner-name"), 72, 36);
        }
        $("pause-sign").textContent = state.connected ? "Kısa bir ara" : "Bağlantı bekleniyor";
        $("scores-title").textContent = state.phase === "ended" ? "Gecenin skoru" : SCORE_TITLES[state.theme];
        return { layout, low };
    }

    // Scores, the last-solver note and the prompt: on a solve these wait for the flip.
    function renderSecondary(state: StreamState, low: boolean, before: StreamState | null): void {
        fitPrompt($("prompt"), promptFor(state, low));
        renderScores(state);
        $("participants").textContent = state.participants ? `${state.participants} kişi tahmin etti` : "Henüz tahmin yok";

        const last = state.lastCorrect;
        $("last").classList.toggle("is-empty", !last);
        $("last-name").textContent = last ? last.name : "";
        fitLastName();
        $("last-detail").textContent = last
            ? `${last.round}. turda bildi` + (last.solveMs !== null ? ` · ${seconds(last.solveMs)} sn` : "")
            : "İlk doğru tahmin buraya yazılır.";
        // "+1" means a point was just given: only while the solved round is still on screen.
        $("last-points").hidden = !(last && state.phase === "finished" && state.reveal?.solved && last.round === state.round);
        if (last && before && last.eventId !== before.lastCorrect?.eventId) replay($("last"), "celebrate");

        // The overlay strip gets the reveal as a chip, since it has no card.
        const chip = $("strip-chip");
        if (state.reveal) {
            chip.dataset.kind = state.reveal.solved ? "solved" : "timeout";
            chip.textContent =
                (state.reveal.solved ? "Bildi! · " : "Süre doldu · ") +
                state.reveal.target +
                (state.reveal.taboos.length ? " · yasaklar: " + state.reveal.taboos.join(", ") : "");
        } else if (state.passed && state.passedRound === state.passed.round && before && state.passedRound !== before.passedRound) {
            chip.dataset.kind = "pass";
            chip.textContent = "Pas · " + state.passed.target;
        } else {
            chip.dataset.kind = "info";
            chip.textContent = promptFor(state, low).split("\n")[0];
        }
    }

    // Text fitting measures glyphs: once the theme's faces arrive, measure again.
    function refit(): void {
        if (destroyed || !previous) return;
        if (previous.reveal) fitWord($("reveal-target"), previous.reveal.target);
        fitScoreNames();
        fitLastName();
        if (!$("winner").hidden) fitLine($("winner-name"), 72, 36);
        fitPrompt($("prompt"), $("prompt").textContent ?? "");
    }

    function watchFonts(): void {
        if (fontsWatched) return;
        fontsWatched = true;
        document.fonts.addEventListener("loadingdone", refit);
        void document.fonts.ready.then(() => {
            if (destroyed) return;
            refit();
            root.dataset.fonts = "ready";
        });
    }

    return {
        render(state) {
            if (destroyed) return;
            clearTimeout(secondaryTimer);
            const before = previous;
            const entering = state.reveal !== null && !before?.reveal;
            const { low } = renderPrimary(state);
            previous = state;
            if (entering && !reducedMotion.matches) {
                // Stamp first, then the card, then who scored.
                secondaryTimer = setTimeout(() => renderSecondary(state, false, before), 1200);
            } else {
                renderSecondary(state, low, before);
            }
            root.dataset.ready = "true";
            watchFonts();
        },
        current() {
            return previous;
        },
        destroy() {
            destroyed = true;
            clearTimeout(secondaryTimer);
            clearTimeout(transientTimer);
            clearTimeout(flipTimer);
            window.removeEventListener("resize", fit);
            document.fonts.removeEventListener("loadingdone", refit);
        },
    };
}

// ---------------------------------------------------------------- demo

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
