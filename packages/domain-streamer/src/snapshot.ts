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

// The card back is already public-safe (server-resolved theme); only a malformed one is dropped.
function publicCardBack(cardBack: StreamCardBack | null | undefined): StreamCardBack | null {
    if (!cardBack || !Number.isInteger(cardBack.itemId) || !cardBack.theme || typeof cardBack.theme !== "object") return null;
    return {
        itemId: cardBack.itemId,
        name: String(cardBack.name ?? "").slice(0, 80),
        theme: { ...cardBack.theme },
        imageUrl: typeof cardBack.imageUrl === "string" ? cardBack.imageUrl : null,
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
        participants: state.participants.size,
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
