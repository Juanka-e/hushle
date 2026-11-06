import { ranking, type StreamCard, type StreamPhase, type StreamSessionState } from "@hushle/domain-streamer";
import type {
    StreamRoundOutcomeValue,
    StreamRoundResultInput,
    StreamSessionPatch,
    StreamSessionStore,
    StreamSessionSummary,
} from "./session-store";

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

export interface StreamerSessionPersistence {
    /** Queues a write after the session's earlier ones. Never rejects: false once its failure was reported. */
    write(sessionId: string, event: string, run: () => Promise<unknown>): Promise<boolean>;
    /** Queues a write in the same order whose failure goes to the caller instead (not reported). */
    request<T>(sessionId: string, run: () => Promise<T>): Promise<T>;
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
}

export function createStreamerSessionPersistence(deps: StreamerSessionPersistenceDeps): StreamerSessionPersistence {
    const timeoutMs = deps.drainTimeoutMs ?? STREAM_PERSIST_DRAIN_TIMEOUT_MS;
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
                report(event, error, sessionId);
                return false;
            },
        );
    }

    async function drain(sessionId: string): Promise<boolean> {
        const tail = chains.get(sessionId);
        if (!tail) return true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const bound = new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), timeoutMs);
        });
        const drained = await Promise.race([tail.then(() => true as const), bound]);
        clearTimeout(timer);
        if (!drained) report("streamer_session.persist_drain_timeout", new Error(`stream session writes still pending after ${timeoutMs} ms`), sessionId);
        return drained;
    }

    return {
        write,
        request: enqueue,
        roundResult(result, counted) {
            const { sessionId } = result;
            return enqueue(sessionId, async () => {
                try {
                    await deps.store.addRoundResult(result);
                } catch (error) {
                    report("streamer_session.round_result_failed", error, sessionId);
                    return false;
                }
                const roundCount = counted();
                try {
                    await deps.store.update(sessionId, { roundCount });
                } catch (error) {
                    report("streamer_session.round_count_failed", error, sessionId);
                }
                return true;
            });
        },
        async finalWrite(sessionId, event, patch) {
            const drained = await drain(sessionId);
            void write(sessionId, event, () => deps.store.update(sessionId, patch()));
            if (drained) await drain(sessionId);
        },
        drain,
        async drainAll() {
            await Promise.all([...chains.keys()].map(drain));
        },
    };
}
