import { ranking } from "./session";
import {
    BROADCAST_THEMES,
    CAMERA_SIZES,
    CAMERA_SLOTS,
    CHANNEL_PLATFORMS,
    TIMER_STYLES,
    type ClockStyle,
    type HostStreamSnapshot,
    type PublicStreamSnapshot,
    type ResolvedCardThemeLike,
    type StreamCardBack,
    type StreamSessionState,
} from "./types";

export interface SnapshotOptions {
    /** Whether the chat connection is up; defaults to true. */
    connected?: boolean;
}

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

// ------------------------------------------------------------ card back

// The card back reaches the stream screen as an explicit copy of the known theme fields, each
// bounded, whatever the session state holds: an unknown key never passes. The bounds, defaults
// and vocabularies are the stream screen's own (apps/web/src/components/stream/stream-renderer.ts
// `readCardBack`, itself the cosmetics resolver's ranges), so what is sent is what is drawn.
const CARD_BACK_HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const CARD_BACK_PATTERNS = ["none", "grid", "dots", "diagonal", "chevrons", "rings", "noise"] as const;
const CARD_BACK_MOTIONS = ["none", "pulse", "drift", "shimmer"] as const;
const CARD_BACK_NAME_MAX = 60;
const CARD_BACK_URL_MAX = 2048;

type Bag = Record<string, unknown>;

function cardBackColor(value: unknown, fallback: string): string {
    return typeof value === "string" && CARD_BACK_HEX_COLOR.test(value) ? value : fallback;
}

/** A finite number clamped to [min, max]; the fallback for anything else. */
function cardBackFraction(value: unknown, max: number, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
}

/** A finite number floored and clamped to [min, max]; the fallback for anything else. */
function cardBackInteger(value: unknown, min: number, max: number, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

// An image the screen may load: a same-site path (`/…`, never `//`) or an https address without
// credentials, at most 2048 characters, with nothing that could break out of an attribute.
function cardBackImageUrl(value: unknown): string | null {
    if (typeof value !== "string" || value.length > CARD_BACK_URL_MAX || /["'<>\\\s]/.test(value)) return null;
    if (/^\/(?!\/)[A-Za-z0-9._~%/-]+(\?[A-Za-z0-9._~%&=-]*)?$/.test(value)) return value;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password ? value : null;
    } catch {
        return null;
    }
}

function publicCardTheme(theme: Bag): ResolvedCardThemeLike {
    return {
        renderSpecVersion: cardBackInteger(theme.renderSpecVersion, 0, Number.MAX_SAFE_INTEGER, 1),
        requestedRenderSpecVersion: cardBackInteger(theme.requestedRenderSpecVersion, 0, Number.MAX_SAFE_INTEGER, 1),
        usedRenderSpecFallback: theme.usedRenderSpecFallback === true,
        surfaceColor: cardBackColor(theme.surfaceColor, "#0f172a"),
        borderColor: cardBackColor(theme.borderColor, "#475569"),
        accentColor: cardBackColor(theme.accentColor, "#94a3b8"),
        secondaryColor: cardBackColor(theme.secondaryColor, "#cbd5e1"),
        titleColor: cardBackColor(theme.titleColor, "#f8fafc"),
        detailColor: cardBackColor(theme.detailColor, "#cbd5e1"),
        pattern: pick(CARD_BACK_PATTERNS, theme.pattern, "none"),
        patternOpacity: cardBackFraction(theme.patternOpacity, 0.42, 0),
        patternScale: cardBackInteger(theme.patternScale, 8, 42, 18),
        motionPreset: pick(CARD_BACK_MOTIONS, theme.motionPreset, "none"),
        motionSpeedMs: cardBackInteger(theme.motionSpeedMs, 1800, 12000, 5000),
        glowColor: cardBackColor(theme.glowColor, "#94a3b8"),
        glowBlur: cardBackInteger(theme.glowBlur, 8, 56, 22),
        glowOpacity: cardBackFraction(theme.glowOpacity, 0.36, 0.18),
        overlayImageUrl: cardBackImageUrl(theme.overlayImageUrl),
        overlayOpacity: cardBackFraction(theme.overlayOpacity, 0.45, 0),
    };
}

function publicCardBack(cardBack: StreamCardBack | null | undefined): StreamCardBack | null {
    if (!cardBack || !Number.isInteger(cardBack.itemId)) return null;
    const theme: unknown = cardBack.theme;
    if (!theme || typeof theme !== "object" || Array.isArray(theme)) return null;
    const name: unknown = cardBack.name;
    return {
        itemId: cardBack.itemId,
        name: typeof name === "string" ? name.replace(/\p{Cc}/gu, "").trim().slice(0, CARD_BACK_NAME_MAX) : "",
        theme: publicCardTheme(theme as Bag),
        imageUrl: cardBackImageUrl(cardBack.imageUrl),
    };
}

// The card is revealed only once its round is over (guessed or out of time); while a round
// runs or waits, the public projection never carries the word or its taboo list.
function revealedCard(state: StreamSessionState): PublicStreamSnapshot["reveal"] {
    const card = state.card;
    if (state.phase !== "finished" || !card || typeof card.target !== "string") return null;
    return {
        target: card.target.slice(0, 40),
        taboos: (Array.isArray(card.taboos) ? card.taboos : []).slice(0, 5).map((word) => String(word).slice(0, 24)),
        solved: state.lastCorrect?.round === state.round,
    };
}

function baseSnapshot(
    state: StreamSessionState,
    revision: number,
    options: SnapshotOptions,
): Omit<PublicStreamSnapshot, "type"> {
    const settings = state.settings;
    const channel = settings.channel;
    // Explicit projection: no live answers, chat bodies or account credentials.
    return {
        schemaVersion: 4,
        revision,
        phase: state.phase,
        remaining: state.remaining,
        duration: state.duration,
        round: state.round,
        passedRound: state.passedRound,
        theme: pick(BROADCAST_THEMES, settings.theme, BROADCAST_THEMES[0]),
        camera: pick(CAMERA_SLOTS, settings.camera, "none"),
        cameraSize: pick(CAMERA_SIZES, settings.cameraSize, "m"),
        clock: TIMER_STYLES.includes(settings.clock as ClockStyle) ? settings.clock : null,
        showCardName: settings.showCardName === true,
        channel:
            channel && CHANNEL_PLATFORMS.includes(channel.platform) && typeof channel.name === "string"
                ? { platform: channel.platform, name: channel.name.replace(/\p{Cc}/gu, "").slice(0, 25) }
                : null,
        passed: state.passedCard ? { ...state.passedCard } : null,
        participants: state.participants,
        pack: settings.language === "en" ? "EN" : "TR",
        scores: ranking(state)
            .slice(0, 3)
            .map((player) => ({ name: player.name, points: player.points, rank: player.rank, tied: player.tied })),
        lastCorrect: state.lastCorrect ? { ...state.lastCorrect } : null,
        cardBack: publicCardBack(settings.cardBack),
        connected: options.connected !== false,
        reveal: revealedCard(state),
    };
}

export function publicSnapshot(
    state: StreamSessionState,
    revision: number,
    options: SnapshotOptions = {},
): PublicStreamSnapshot {
    return { type: "public-state", ...baseSnapshot(state, revision, options) };
}

export function hostSnapshot(
    state: StreamSessionState,
    revision: number,
    pool?: { drawn: number; eligible: number },
    options: SnapshotOptions = {},
): HostStreamSnapshot {
    const snapshot: HostStreamSnapshot = {
        type: "host-state",
        ...baseSnapshot(state, revision, options),
        card: state.card ? { ...state.card, taboos: [...state.card.taboos] } : null,
        tolerance: state.tolerance,
        players: ranking(state),
    };
    if (pool) snapshot.pool = { ...pool };
    return snapshot;
}
