export const BROADCAST_THEMES = ["oyun-gecesi", "studyo", "gece-altini", "sakura", "sade"] as const;
// Where the streamer webcam shows through the stream screen, and how big a corner hole is.
export const CAMERA_SLOTS = ["none", "tl", "tr", "bl", "br", "left", "right"] as const;
export const CAMERA_SIZES = ["s", "m", "l"] as const;
// Timer looks the stream screen knows. `null` means: use the theme template.
export const TIMER_STYLES = ["hourglass", "candle", "bulbs", "incense", "ring", "counter"] as const;
export const CHANNEL_PLATFORMS = ["twitch", "kick", "youtube"] as const;

export type BroadcastTheme = (typeof BROADCAST_THEMES)[number];
export type CameraSlot = (typeof CAMERA_SLOTS)[number];
export type CameraSize = (typeof CAMERA_SIZES)[number];
export type ClockStyle = (typeof TIMER_STYLES)[number];
export type ChannelPlatform = (typeof CHANNEL_PLATFORMS)[number];

export type StreamPhase = "ready" | "running" | "paused" | "finished" | "ended";
export type GuessTolerance = "strict" | "normal";
export type GuessResult = "closed" | "stale" | "duplicate" | "invalid" | "wrong" | "correct";

export interface StreamCard {
    wordId: number;
    target: string;
    taboos: string[];
}

export interface ChatGuess {
    platform: "twitch" | "kick" | "fake";
    platformUserId: string;
    name: string;
    text: string;
    messageId: string;
    /** Epoch milliseconds at which the platform says the message was sent. */
    sentAt: number;
}

export interface StreamScreenSettings {
    theme: BroadcastTheme;
    camera: CameraSlot;
    cameraSize: CameraSize;
    clock: ClockStyle | null;
    cardBack: { collection: number } | null;
    showCardName: boolean;
    /** Round length in seconds. */
    duration: number;
    language: "tr" | "en";
    channel: { platform: ChannelPlatform; name: string } | null;
}

export interface StreamPlayer {
    id: string;
    name: string;
    points: number;
}

export interface RankedPlayer extends StreamPlayer {
    rank: number;
    tied: boolean;
}

export interface LastCorrect {
    eventId: string;
    name: string;
    round: number;
    pointsGranted: number;
    solveMs: number;
}

export interface PassedCard {
    round: number;
    target: string;
}

export interface StreamSessionState {
    phase: StreamPhase;
    duration: number;
    remaining: number;
    round: number;
    /** Epoch ms at which the current round was started (guesses sent earlier are stale). */
    roundStartedAt: number;
    deadline: number;
    winner: { id: string; name: string } | null;
    lastCorrect: LastCorrect | null;
    passedRound: number | null;
    passedCard: PassedCard | null;
    card: StreamCard | null;
    tolerance: GuessTolerance;
    settings: StreamScreenSettings;
    players: Map<string, StreamPlayer>;
    participants: Set<string>;
    /** Most recent message ids, oldest first, capped at 256. */
    seenMessages: string[];
    eventCounter: number;
}

export interface PublicStreamSnapshot {
    type: "public-state";
    schemaVersion: 4;
    revision: number;
    phase: StreamPhase;
    remaining: number;
    duration: number;
    round: number;
    passedRound: number | null;
    theme: BroadcastTheme;
    camera: CameraSlot;
    cameraSize: CameraSize;
    clock: ClockStyle | null;
    showCardName: boolean;
    channel: { platform: ChannelPlatform; name: string } | null;
    passed: PassedCard | null;
    participants: number;
    pack: "TR" | "EN";
    scores: Array<{ name: string; points: number; rank: number; tied: boolean }>;
    lastCorrect: LastCorrect | null;
    cardBack: { collection: number; variant: 0 } | null;
    reveal: { target: string; taboos: string[]; solved: boolean } | null;
}

export interface HostStreamSnapshot extends Omit<PublicStreamSnapshot, "type"> {
    type: "host-state";
    card: StreamCard | null;
    tolerance: GuessTolerance;
    pool?: { drawn: number; eligible: number };
    players: RankedPlayer[];
}
