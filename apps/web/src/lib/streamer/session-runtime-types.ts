import type {
    ChatGuess,
    GuessResult,
    HostStreamSnapshot,
    PublicStreamSnapshot,
    StreamCard,
    StreamPhase,
    StreamSessionState,
} from "@hushle/domain-streamer";
import type { StreamerPlatform } from "@hushle/platform-streamer";
import type { StreamerErrorReporter } from "./session-persistence";
import type { CreateSessionInput, ResolvedScreenPatch, WordFilters } from "./session-settings";
import type { StreamSessionRecord, StreamSessionStore, StreamSessionSummary } from "./session-store";
import type { StreamerTimers } from "./session-timers";
import type { ConnectionChecker, StreamerModeState } from "./session-watch";
import type { StreamerHostNoticePayload } from "./socket-contract";

// The shape of the stream session runtime (session-runtime.ts builds it): what it is given, what
// it pushes out and what it offers. Types only.

export interface WordSource {
    /** The next card of the pool (it cycles once every word was drawn); null when no word matches at all. */
    next(poolKey: string, filters: WordFilters): Promise<StreamCard | null>;
    clear(poolKey: string): void;
}

/** ended: the host; idle: 6 h without activity; interrupted: the server stopped; stopped: streamer mode off or an account action. */
export type StreamSessionEndReason = "ended" | "idle" | "interrupted" | "stopped";
export type StreamerSnapshotKind = "host" | "public";
export type StreamerEmitter = (
    sessionId: string,
    kind: StreamerSnapshotKind,
    payload: HostStreamSnapshot | PublicStreamSnapshot,
) => void;
export type StreamerEndedListener = (sessionId: string, reason: StreamSessionEndReason) => void;
export type StreamerHostNoticeListener = (sessionId: string, notice: StreamerHostNoticePayload) => void;

/** A read-only view of one live session; snapshots are taken at call time. */
export interface LiveStreamSession {
    id: string;
    userId: number;
    platform: StreamerPlatform;
    viewKeyHash: string;
    /** When the session row was opened. */
    startedAt: Date;
    /** The session's input as it stands now (live setting changes included); a copy. */
    settings: CreateSessionInput;
    phase: StreamPhase;
    revision: number;
    /** Carries the secret card: for the owner's host room only. */
    hostSnapshot(): HostStreamSnapshot;
    publicSnapshot(): PublicStreamSnapshot;
}

export interface StreamerSessionRuntimeDeps {
    store: StreamSessionStore;
    wordSource: WordSource;
    now?: () => number;
    emit?: StreamerEmitter;
    onEnded?: StreamerEndedListener;
    /** Failures that reach no caller; `context` names the session when there is one. */
    onError?: StreamerErrorReporter;
    tickMs?: number;
    idleTimeoutMs?: number;
    /** How long end, idle, stop and a key rotation wait for a session's pending writes (STREAM_PERSIST_DRAIN_TIMEOUT_MS). */
    drainTimeoutMs?: number;
    /** The wall clock and timers of the ticks, the checks and the bounds (real ones when absent). */
    timers?: StreamerTimers;
    /** Validates the channel link of a live session, hourly (STREAM_CONNECTION_CHECK_MS); none when absent. */
    checkConnection?: ConnectionChecker;
}

export interface StreamerSessionRuntime {
    open(row: StreamSessionRecord, state: StreamSessionState): LiveStreamSession;
    get(sessionId: string): LiveStreamSession | null;
    forUser(userId: number): LiveStreamSession | null;
    start(sessionId: string): Promise<void>;
    pause(sessionId: string): Promise<void>;
    resume(sessionId: string): Promise<void>;
    pass(sessionId: string): Promise<void>;
    next(sessionId: string): Promise<void>;
    end(sessionId: string, reason: Exclude<StreamSessionEndReason, "interrupted">): Promise<StreamSessionSummary>;
    /** Ends every live session with `reason` (the row is ended, the summary written); how many ended. */
    endAll(reason: "stopped"): Promise<number>;
    applySettings(sessionId: string, patch: ResolvedScreenPatch): Promise<void>;
    guess(sessionId: string, guess: ChatGuess): Promise<GuessResult>;
    rotateViewKey(sessionId: string): Promise<{ viewKey: string }>;
    /** Ticks every live session now (the interval does this on its own; tests call it directly). */
    tickAll(now?: number): Promise<void>;
    /** Waits until the writes queued so far landed or failed (bounded per session); tests read the store after it. */
    flush(): Promise<void>;
    setEmitter(emit: StreamerEmitter): void;
    setOnEnded(listener: StreamerEndedListener): void;
    setOnViewKeyRotated(listener: (sessionId: string) => void): void;
    setOnHostNotice(listener: StreamerHostNoticeListener): void;
    /** When it reads "off" (every STREAMER_MODE_CHECK_MS; "unknown" changes nothing), every live session ends `stopped`; returns the unwatch. */
    watchMode(readMode: () => Promise<StreamerModeState>, intervalMs?: number): () => void;
    /** Clears every timer and ends the sessions still open as interrupted (rows and listener). */
    stop(): Promise<void>;
}
