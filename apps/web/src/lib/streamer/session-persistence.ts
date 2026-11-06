import { ranking, type StreamCard, type StreamPhase, type StreamSessionState } from "@hushle/domain-streamer";
import { StreamerSessionError } from "./session-errors";
import type {
    StreamRoundOutcomeValue,
    StreamRoundResultInput,
    StreamSessionPatch,
    StreamSessionStore,
    StreamSessionSummary,
} from "./session-store";
import { realStreamerTimers, type StreamerTimers } from "./session-timers";

// The writes of live stream sessions, kept off their action queues. Each session has its own
// chain: writes land one at a time in the order they were queued, and a slow or hanging database
// never holds up a tick, a guess or a host action. A failed write is reported once, with its event
// and the session id, and the session goes on. Ending a session waits for its chain, bounded.

/** How long ending a session (end, idle, stop) waits for its pending writes before going on. */
export const STREAM_PERSIST_DRAIN_TIMEOUT_MS = 10_000;
/** How many of the final ranking a session summary keeps. */
export const SUMMARY_SCORE_LIMIT = 10;

/** Where failures that reach no caller go: the event, the error and the session it concerns. */
export type StreamerErrorReporter = (event: string, error: unknown, context?: { sessionId: string }) => void;

/** What an ended session's row keeps: the top of the final ranking, its participants and the rounds written. */
export function sessionSummary(state: StreamSessionState, roundCount: number): StreamSessionSummary {
    return {
        scores: ranking(state)
            .slice(0, SUMMARY_SCORE_LIMIT)
            .map(({ name, points, rank, tied }) => ({ name, points, rank, tied })),
        participants: state.participants,
        rounds: roundCount,
    };
}

/** The round a mutation started from, to tell whether that round ended and how. */
export interface RoundMark {
    phase: StreamPhase;
    round: number;
    startedAt: number;
    deadline: number;
    card: StreamCard | null;
}

export function markRound(state: StreamSessionState): RoundMark {
    return { phase: state.phase, round: state.round, startedAt: state.roundStartedAt, deadline: state.deadline, card: state.card };
}

function roundOutcome(before: RoundMark, state: StreamSessionState, passed: boolean): StreamRoundOutcomeValue | null {
    if (before.phase !== "running" && before.phase !== "paused") return null;
    if (passed) return "passed";
    if (state.phase !== "finished" || state.round !== before.round) return null;
    return state.lastCorrect?.round === before.round ? "solved" : "timeout";
}

/** The result row of the round `before` belonged to, when that round just ended; null otherwise. */
export function roundResultOf(
    sessionId: string,
    before: RoundMark,
    state: StreamSessionState,
    now: number,
    passed: boolean,
): StreamRoundResultInput | null {
    const outcome = roundOutcome(before, state, passed);
    if (!outcome) return null;
    const winner = outcome === "solved" ? state.winner : null;
    return {
        sessionId,
        round: before.round,
        wordId: before.card?.wordId ?? null,
        outcome,
        // Player ids are "<platform>:<platform user id>"; the column keeps the platform's id.
        winnerPlatformUserId: winner ? winner.id.slice(winner.id.indexOf(":") + 1) : null,
        winnerName: winner?.name ?? null,
        solveMs: outcome === "solved" ? (state.lastCorrect?.solveMs ?? null) : null,
        startedAt: new Date(before.startedAt),
        // A round that ran out of time ended at its deadline, however late a tick or an action noticed it.
        endedAt: new Date(outcome === "timeout" ? Math.min(before.deadline, now) : now),
    };
}

const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const PRISMA_ERROR_CODE = /^P\d{4}$/;
// The copies storeFailure made: sanitizing one again keeps it (and its message) as it is.
const sanitized = new WeakSet<Error>();

/**
 * What a failed store call is reported (or answered) as: its class name, its Prisma code and a
 * fixed message. A Prisma error's message (and its meta) can echo the call's arguments: settings,
 * summary names, a view-key hash, a token ciphertext in a conditional where. Idempotent: a copy
 * it made comes back unchanged.
 */
export function storeFailure(error: unknown, message = "stream session write failed"): Error {
    if (error instanceof Error && sanitized.has(error)) return error;
    const safe = new Error(message);
    sanitized.add(safe);
    const name: unknown = error instanceof Error ? error.name : undefined;
    if (typeof name === "string" && SAFE_ERROR_NAME.test(name)) safe.name = name;
    const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
    if (typeof code === "string" && PRISMA_ERROR_CODE.test(code)) Object.assign(safe, { code });
    return safe;
}

export interface StreamerSessionPersistence {
    /** Queues a write after the session's earlier ones. Never rejects: false once its failure was reported. */
    write(sessionId: string, event: string, run: () => Promise<unknown>): Promise<boolean>;
    /**
     * Queues a write in the same order whose failure goes to the caller instead, sanitized (storeFailure), not reported. The
     * caller waits at most the drain bound, then gets `busy`: a write that has not started by then
     * never runs; one that lands later is followed by `undo`, in its turn (a failing undo is reported
     * under `event`).
     */
    request<T>(sessionId: string, event: string, run: () => Promise<T>, undo: () => Promise<unknown>): Promise<T>;
    /**
     * Queues a finished round's result. `counted` runs only once the row is written and returns the
     * session's new round count, stored right after; a failed result write counts nothing.
     */
    roundResult(result: StreamRoundResultInput, counted: () => number): Promise<boolean>;
    /**
     * A closing session's last row write: waits for its pending writes, then for this one (each wait
     * bounded). `patch` is read when the write runs, so it counts every result written before it.
     * Past the bound the write still queues behind the others but is not waited for.
     */
    finalWrite(sessionId: string, event: string, patch: () => StreamSessionPatch): Promise<void>;
    /** Waits for the writes queued so far, at most the drain bound (then reported); true when they all landed. */
    drain(sessionId: string): Promise<boolean>;
    /** Drains every session's chain. */
    drainAll(): Promise<void>;
}

export interface StreamerSessionPersistenceDeps {
    store: StreamSessionStore;
    report: StreamerErrorReporter;
    drainTimeoutMs?: number;
    /** The wall clock and timeouts of the bounds (real ones when absent). */
    timers?: StreamerTimers;
}

export function createStreamerSessionPersistence(deps: StreamerSessionPersistenceDeps): StreamerSessionPersistence {
    const timeoutMs = deps.drainTimeoutMs ?? STREAM_PERSIST_DRAIN_TIMEOUT_MS;
    const timers = deps.timers ?? realStreamerTimers;
    const chains = new Map<string, Promise<void>>();

    function report(event: string, error: unknown, sessionId: string): void {
        try {
            deps.report(event, error, { sessionId });
        } catch {
            // A reporter that throws must not break the chain.
        }
    }

    function enqueue<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
        const result = (chains.get(sessionId) ?? Promise.resolve()).then(run);
        const tail = result.then(
            () => undefined,
            () => undefined,
        );
        chains.set(sessionId, tail);
        void tail.then(() => {
            if (chains.get(sessionId) === tail) chains.delete(sessionId);
        });
        return result;
    }

    function write(sessionId: string, event: string, run: () => Promise<unknown>): Promise<boolean> {
        return enqueue(sessionId, run).then(
            () => true,
            (error: unknown) => {
                report(event, storeFailure(error), sessionId);
                return false;
            },
        );
    }

    /** `promise`, or `onTimeout()` once the wall clock reaches `deadline`. */
    async function until<T>(promise: Promise<T>, deadline: number, onTimeout: () => T): Promise<T> {
        let handle: unknown;
        const bound = new Promise<T>((resolve) => {
            handle = timers.setTimeout(() => resolve(onTimeout()), Math.max(0, deadline - timers.now()));
        });
        try {
            return await Promise.race([promise, bound]);
        } finally {
            timers.clearTimeout(handle);
        }
    }

    async function drainUntil(sessionId: string, deadline: number): Promise<boolean> {
        const tail = chains.get(sessionId);
        if (!tail) return true;
        const drained = await until(
            tail.then(() => true),
            deadline,
            () => false,
        );
        if (!drained) report("streamer_session.persist_drain_timeout", new Error(`stream session writes still pending after ${timeoutMs} ms`), sessionId);
        return drained;
    }

    const drain = (sessionId: string) => drainUntil(sessionId, timers.now() + timeoutMs);

    return {
        write,
        request<T>(sessionId: string, event: string, run: () => Promise<T>, undo: () => Promise<unknown>): Promise<T> {
            let abandoned = false;
            const queued = enqueue(sessionId, async () => {
                if (abandoned) throw new StreamerSessionError("busy");
                let result: T;
                try {
                    result = await run();
                } catch (error) {
                    // The caller gets (and may log) the failure: never the call's arguments.
                    const safe = storeFailure(error);
                    if (abandoned) report(event, safe, sessionId);
                    throw safe;
                }
                if (abandoned) {
                    try {
                        await undo();
                    } catch (error) {
                        report(event, storeFailure(error), sessionId);
                    }
                }
                return result;
            });
            const answered = queued.then((result) => ({ result }));
            // The caller may have gone already: a late failure is nobody's unhandled rejection.
            answered.catch(() => undefined);
            return until<{ result: T } | null>(answered, timers.now() + timeoutMs, () => {
                abandoned = true;
                return null;
            }).then((outcome) => {
                if (!outcome || abandoned) throw new StreamerSessionError("busy");
                return outcome.result;
            });
        },
        roundResult(result, counted) {
            const { sessionId } = result;
            return enqueue(sessionId, async () => {
                try {
                    await deps.store.addRoundResult(result);
                } catch (error) {
                    report("streamer_session.round_result_failed", storeFailure(error), sessionId);
                    return false;
                }
                const roundCount = counted();
                try {
                    await deps.store.update(sessionId, { roundCount });
                } catch (error) {
                    report("streamer_session.round_count_failed", storeFailure(error), sessionId);
                }
                return true;
            });
        },
        async finalWrite(sessionId, event, patch) {
            // One deadline for both waits: the pending writes, then this one, never twice the bound.
            const deadline = timers.now() + timeoutMs;
            const drained = await drainUntil(sessionId, deadline);
            void write(sessionId, event, () => deps.store.update(sessionId, patch()));
            if (drained) await drainUntil(sessionId, deadline);
        },
        drain,
        async drainAll() {
            await Promise.all([...chains.keys()].map(drain));
        },
    };
}
