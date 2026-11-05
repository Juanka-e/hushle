import {
    acceptGuess,
    beginRound,
    endSession,
    hostSnapshot,
    pause,
    publicSnapshot,
    ranking,
    resume,
    skipRound,
    tick,
    type ChatGuess,
    type GuessResult,
    type HostStreamSnapshot,
    type PublicStreamSnapshot,
    type StreamCard,
    type StreamPhase,
    type StreamSessionState,
} from "@hushle/domain-streamer";
import type { StreamerPlatform } from "@hushle/platform-streamer";
import {
    createSessionInputSchema,
    screenPatchFields,
    wordFiltersOf,
    type CreateSessionInput,
    type ScreenSettingsPatch,
    type WordFilters,
} from "./session-settings";
import type {
    StreamRoundOutcomeValue,
    StreamSessionRecord,
    StreamSessionStore,
    StreamSessionSummary,
} from "./session-store";
import { createViewKey } from "./view-key";

// Live stream sessions of this process (single realtime replica, ADR-003). The runtime is the
// only writer of a session's game state: every action runs on the session's own queue, ticks
// once a second, persists each finished round and re-emits the host and public projections.

export const STREAM_TICK_MS = 1_000;
export const STREAM_SESSION_IDLE_TIMEOUT_MS = 6 * 3_600_000;
export const SUMMARY_SCORE_LIMIT = 10;
// Phase 2 has no chat adapters yet; the stream screen always reads as connected.
const SNAPSHOT_OPTIONS = { connected: true } as const;

export const STREAMER_SESSION_ERROR_CODES = [
    "session_active",
    "connection_required",
    "not_found",
    "invalid_phase",
    "word_source_empty",
    "card_not_allowed",
] as const;

export type StreamerSessionErrorCode = (typeof STREAMER_SESSION_ERROR_CODES)[number];

// The custom server and the Next route bundles each load this module, so a route can catch an
// error built from the other copy of this class: `instanceof` fails across copies, a
// registry symbol does not. Check errors with `isStreamerSessionError`.
const STREAMER_SESSION_ERROR_BRAND = Symbol.for("hushle.streamer-session-error");

export class StreamerSessionError extends Error {
    readonly code: StreamerSessionErrorCode;

    constructor(code: StreamerSessionErrorCode, message?: string) {
        super(message ?? `streamer session: ${code}`);
        this.name = "StreamerSessionError";
        this.code = code;
        Object.defineProperty(this, STREAMER_SESSION_ERROR_BRAND, { value: true });
    }
}

export function isStreamerSessionError(error: unknown): error is StreamerSessionError {
    if (typeof error !== "object" || error === null) return false;
    const code = Reflect.get(error, "code");
    return (
        Reflect.get(error, STREAMER_SESSION_ERROR_BRAND) === true &&
        STREAMER_SESSION_ERROR_CODES.includes(code as StreamerSessionErrorCode)
    );
}

export interface WordSource {
    /** The next card of the pool (it cycles once every word was drawn); null when no word matches at all. */
    next(poolKey: string, filters: WordFilters): Promise<StreamCard | null>;
    clear(poolKey: string): void;
}

export type StreamSessionEndReason = "ended" | "idle";
export type StreamerSnapshotKind = "host" | "public";
export type StreamerEmitter = (
    sessionId: string,
    kind: StreamerSnapshotKind,
    payload: HostStreamSnapshot | PublicStreamSnapshot,
) => void;
export type StreamerEndedListener = (sessionId: string, reason: StreamSessionEndReason) => void;

/** A read-only view of one live session; snapshots are taken at call time. */
export interface LiveStreamSession {
    id: string;
    userId: number;
    platform: StreamerPlatform;
    viewKeyHash: string;
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
    onError?: (event: string, error: unknown) => void;
    tickMs?: number;
    idleTimeoutMs?: number;
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
    end(sessionId: string, reason: StreamSessionEndReason): Promise<StreamSessionSummary>;
    applySettings(sessionId: string, patch: ScreenSettingsPatch): Promise<void>;
    guess(sessionId: string, guess: ChatGuess): Promise<GuessResult>;
    rotateViewKey(sessionId: string): Promise<{ viewKey: string }>;
    /** Ticks every live session now (the interval does this on its own; tests call it directly). */
    tickAll(now?: number): Promise<void>;
    setEmitter(emit: StreamerEmitter): void;
    setOnEnded(listener: StreamerEndedListener): void;
    setOnViewKeyRotated(listener: (sessionId: string) => void): void;
    /** Clears every timer and marks the sessions still open as interrupted. */
    stop(): Promise<void>;
}

interface SessionEntry {
    id: string;
    userId: number;
    platform: StreamerPlatform;
    viewKeyHash: string;
    poolKey: string;
    input: CreateSessionInput;
    state: StreamSessionState;
    revision: number;
    roundCount: number;
    lastActivityAt: number;
    timer: ReturnType<typeof setInterval> | null;
    queue: Promise<unknown>;
    closed: boolean;
}

/** The round a mutation started from, to tell whether that round ended and how. */
interface RoundMark {
    phase: StreamPhase;
    round: number;
    startedAt: number;
    card: StreamCard | null;
}

export function streamerPoolKey(sessionId: string): string {
    return `streamer:${sessionId}`;
}

function markRound(state: StreamSessionState): RoundMark {
    return { phase: state.phase, round: state.round, startedAt: state.roundStartedAt, card: state.card };
}

function roundOutcome(before: RoundMark, state: StreamSessionState, passed: boolean): StreamRoundOutcomeValue | null {
    if (before.phase !== "running" && before.phase !== "paused") return null;
    if (passed) return "passed";
    if (state.phase !== "finished" || state.round !== before.round) return null;
    return state.lastCorrect?.round === before.round ? "solved" : "timeout";
}

function summarize(entry: SessionEntry): StreamSessionSummary {
    return {
        scores: ranking(entry.state)
            .slice(0, SUMMARY_SCORE_LIMIT)
            .map(({ name, points, rank, tied }) => ({ name, points, rank, tied })),
        participants: entry.state.participants.size,
        rounds: entry.roundCount,
    };
}

function invalidPhase(): StreamerSessionError {
    return new StreamerSessionError("invalid_phase");
}

export function createStreamerSessionRuntime(deps: StreamerSessionRuntimeDeps): StreamerSessionRuntime {
    const clock = deps.now ?? Date.now;
    const tickMs = deps.tickMs ?? STREAM_TICK_MS;
    const idleTimeoutMs = deps.idleTimeoutMs ?? STREAM_SESSION_IDLE_TIMEOUT_MS;
    const onError = deps.onError ?? ((event: string, error: unknown) => console.error(event, error));
    let emit: StreamerEmitter = deps.emit ?? (() => undefined);
    let onEnded: StreamerEndedListener = deps.onEnded ?? (() => undefined);
    let onViewKeyRotated: (sessionId: string) => void = () => undefined;
    const entries = new Map<string, SessionEntry>();

    // ------------------------------------------------------------ plumbing

    function guarded(event: string, run: () => void): void {
        try {
            run();
        } catch (error) {
            onError(event, error);
        }
    }

    async function persist(event: string, run: () => Promise<unknown>): Promise<void> {
        try {
            await run();
        } catch (error) {
            onError(event, error);
        }
    }

    function view(entry: SessionEntry): LiveStreamSession {
        return {
            id: entry.id,
            userId: entry.userId,
            platform: entry.platform,
            viewKeyHash: entry.viewKeyHash,
            phase: entry.state.phase,
            revision: entry.revision,
            hostSnapshot: () => hostSnapshot(entry.state, entry.revision, undefined, SNAPSHOT_OPTIONS),
            publicSnapshot: () => publicSnapshot(entry.state, entry.revision, SNAPSHOT_OPTIONS),
        };
    }

    function emitState(entry: SessionEntry): void {
        entry.revision += 1;
        const host = hostSnapshot(entry.state, entry.revision, undefined, SNAPSHOT_OPTIONS);
        const pub = publicSnapshot(entry.state, entry.revision, SNAPSHOT_OPTIONS);
        guarded("streamer_session.emit_failed", () => emit(entry.id, "host", host));
        guarded("streamer_session.emit_failed", () => emit(entry.id, "public", pub));
    }

    // One action at a time per session: draws and writes are async, the state machine is not.
    function run<T>(sessionId: string, task: (entry: SessionEntry, now: number) => Promise<T>): Promise<T> {
        const entry = entries.get(sessionId);
        if (!entry || entry.closed) return Promise.reject(new StreamerSessionError("not_found"));
        const result = entry.queue.then(() => {
            if (entry.closed) throw new StreamerSessionError("not_found");
            return task(entry, clock());
        });
        entry.queue = result.catch(() => undefined);
        return result;
    }

    function hostAction<T>(sessionId: string, task: (entry: SessionEntry, now: number) => Promise<T>): Promise<T> {
        return run(sessionId, async (entry, now) => {
            entry.lastActivityAt = now;
            await catchUp(entry, now);
            return task(entry, now);
        });
    }

    function clearTimer(entry: SessionEntry): void {
        if (entry.timer) clearInterval(entry.timer);
        entry.timer = null;
    }

    function reportTick(error: unknown): void {
        if (isStreamerSessionError(error) && error.code === "not_found") return;
        onError("streamer_session.tick_failed", error);
    }

    // (Re)starts the session's 1 s tick so it lines up with the round clock just set.
    function align(entry: SessionEntry): void {
        clearTimer(entry);
        if (entry.closed) return;
        const timer = setInterval(() => {
            run(entry.id, tickEntry).catch(reportTick);
        }, tickMs);
        timer.unref?.();
        entry.timer = timer;
    }

    // ------------------------------------------------------------ rounds

    async function recordRound(entry: SessionEntry, before: RoundMark, now: number, passed: boolean): Promise<void> {
        const outcome = roundOutcome(before, entry.state, passed);
        if (!outcome) return;
        entry.roundCount += 1;
        const winner = outcome === "solved" ? entry.state.winner : null;
        const result = {
            sessionId: entry.id,
            round: before.round,
            wordId: before.card?.wordId ?? null,
            outcome,
            // Player ids are "<platform>:<platform user id>"; the column keeps the platform's id.
            winnerPlatformUserId: winner ? winner.id.slice(winner.id.indexOf(":") + 1) : null,
            winnerName: winner?.name ?? null,
            solveMs: outcome === "solved" ? (entry.state.lastCorrect?.solveMs ?? null) : null,
            startedAt: new Date(before.startedAt),
            endedAt: new Date(now),
        };
        const roundCount = entry.roundCount;
        await persist("streamer_session.round_result_failed", async () => {
            await deps.store.addRoundResult(result);
            await deps.store.update(entry.id, { roundCount });
        });
    }

    /** Emits the new state, then records the round `before` belonged to if it just ended. */
    async function settle(entry: SessionEntry, before: RoundMark, now: number, passed = false): Promise<void> {
        emitState(entry);
        await recordRound(entry, before, now, passed);
    }

    /** Brings a running round up to `now`; a round that ran out of time is settled. True when only the clock moved. */
    async function catchUp(entry: SessionEntry, now: number): Promise<boolean> {
        if (entry.state.phase !== "running") return false;
        const before = markRound(entry.state);
        const changed = tick(entry.state, now);
        if (entry.state.phase === before.phase) return changed;
        await settle(entry, before, now);
        return false;
    }

    async function tickEntry(entry: SessionEntry, now: number): Promise<void> {
        if (now - entry.lastActivityAt >= idleTimeoutMs) {
            await finish(entry, "idle", now);
            return;
        }
        if (await catchUp(entry, now)) emitState(entry);
    }

    async function drawCard(entry: SessionEntry): Promise<StreamCard> {
        const card = await deps.wordSource.next(entry.poolKey, wordFiltersOf(entry.input));
        if (!card) throw new StreamerSessionError("word_source_empty");
        return card;
    }

    function beginFrom(phase: StreamPhase) {
        return (sessionId: string) =>
            hostAction(sessionId, async (entry) => {
                if (entry.state.phase !== phase) throw invalidPhase();
                const card = await drawCard(entry);
                beginRound(entry.state, card, clock());
                align(entry);
                emitState(entry);
            });
    }

    // ------------------------------------------------------------ session end

    async function finish(entry: SessionEntry, reason: StreamSessionEndReason, now: number): Promise<StreamSessionSummary> {
        await catchUp(entry, now);
        endSession(entry.state, now);
        const summary = summarize(entry);
        entry.closed = true;
        clearTimer(entry);
        emitState(entry);
        await persist("streamer_session.end_failed", () =>
            deps.store.update(entry.id, { status: "ended", endedAt: new Date(now), summary, roundCount: entry.roundCount }),
        );
        guarded("streamer_session.pool_clear_failed", () => deps.wordSource.clear(entry.poolKey));
        entries.delete(entry.id);
        guarded("streamer_session.on_ended_failed", () => onEnded(entry.id, reason));
        return summary;
    }

    // ------------------------------------------------------------ API

    return {
        open(row, state) {
            if (entries.has(row.id) || [...entries.values()].some((entry) => entry.userId === row.userId && !entry.closed)) {
                throw new StreamerSessionError("session_active");
            }
            const now = clock();
            const entry: SessionEntry = {
                id: row.id,
                userId: row.userId,
                platform: row.platform,
                viewKeyHash: row.viewKeyHash,
                poolKey: streamerPoolKey(row.id),
                input: createSessionInputSchema.parse(row.settings),
                state,
                revision: 0,
                roundCount: row.roundCount,
                lastActivityAt: now,
                timer: null,
                queue: Promise.resolve(),
                closed: false,
            };
            entries.set(entry.id, entry);
            align(entry);
            emitState(entry);
            return view(entry);
        },
        get(sessionId) {
            const entry = entries.get(sessionId);
            return entry && !entry.closed ? view(entry) : null;
        },
        forUser(userId) {
            for (const entry of entries.values()) {
                if (entry.userId === userId && !entry.closed) return view(entry);
            }
            return null;
        },
        start: beginFrom("ready"),
        next: beginFrom("finished"),
        pause: (sessionId) =>
            hostAction(sessionId, async (entry, now) => {
                if (!pause(entry.state, now)) throw invalidPhase();
                emitState(entry);
            }),
        resume: (sessionId) =>
            hostAction(sessionId, async (entry, now) => {
                if (!resume(entry.state, now)) throw invalidPhase();
                align(entry);
                emitState(entry);
            }),
        pass: (sessionId) =>
            hostAction(sessionId, async (entry) => {
                if (entry.state.phase !== "running" && entry.state.phase !== "paused") throw invalidPhase();
                const card = await drawCard(entry);
                const at = clock();
                const before = markRound(entry.state);
                if (!skipRound(entry.state, at, card)) {
                    // The clock ran out while the next card was drawn: that round timed out instead.
                    if (entry.state.phase !== before.phase) await settle(entry, before, at);
                    throw invalidPhase();
                }
                align(entry);
                await settle(entry, before, at, true);
            }),
        end: (sessionId, reason) => run(sessionId, (entry, now) => finish(entry, reason, now)),
        applySettings: (sessionId, patch) =>
            hostAction(sessionId, async (entry) => {
                const fields = screenPatchFields(patch);
                entry.state.settings = { ...entry.state.settings, ...fields };
                entry.input = { ...entry.input, ...fields };
                emitState(entry);
                const settings = entry.input;
                await persist("streamer_session.settings_failed", () => deps.store.update(entry.id, { settings }));
            }),
        guess: (sessionId, guess) =>
            run(sessionId, async (entry, now) => {
                entry.lastActivityAt = now;
                // acceptGuess ticks first, so a round that just ran out settles as a timeout here.
                const before = markRound(entry.state);
                const participants = entry.state.participants.size;
                const result = acceptGuess(entry.state, guess, now);
                if (entry.state.phase !== before.phase || entry.state.participants.size !== participants) {
                    await settle(entry, before, now);
                }
                return result;
            }),
        rotateViewKey: (sessionId) =>
            hostAction(sessionId, async (entry) => {
                const { viewKey, hash } = createViewKey();
                // A failed write leaves the old key valid, so the error reaches the caller.
                await deps.store.update(entry.id, { viewKeyHash: hash });
                entry.viewKeyHash = hash;
                guarded("streamer_session.on_view_key_rotated_failed", () => onViewKeyRotated(entry.id));
                emitState(entry);
                return { viewKey };
            }),
        async tickAll(at) {
            const ids = [...entries.keys()];
            await Promise.all(ids.map((id) => run(id, (entry, now) => tickEntry(entry, at ?? now)).catch(reportTick)));
        },
        setEmitter(next) {
            emit = next;
        },
        setOnEnded(listener) {
            onEnded = listener;
        },
        setOnViewKeyRotated(listener) {
            onViewKeyRotated = listener;
        },
        async stop() {
            const open = [...entries.values()];
            for (const entry of open) {
                entry.closed = true;
                clearTimer(entry);
            }
            await Promise.all(open.map((entry) => entry.queue));
            const endedAt = new Date(clock());
            for (const entry of open) {
                clearTimer(entry);
                // An end that was already running has removed its entry and written `ended`.
                if (entries.get(entry.id) !== entry) continue;
                entries.delete(entry.id);
                await persist("streamer_session.stop_failed", () =>
                    deps.store.update(entry.id, { status: "interrupted", endedAt, roundCount: entry.roundCount }),
                );
                guarded("streamer_session.pool_clear_failed", () => deps.wordSource.clear(entry.poolKey));
            }
        },
    };
}
