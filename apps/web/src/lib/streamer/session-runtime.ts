import {
    acceptGuess,
    beginRound,
    endSession,
    hostSnapshot,
    pause,
    publicSnapshot,
    resume,
    skipRound,
    tick,
    type StreamCard,
    type StreamPhase,
    type StreamSessionState,
} from "@hushle/domain-streamer";
import type { StreamerPlatform } from "@hushle/platform-streamer";
import { createCardDraw } from "./session-draw";
import { isStreamerSessionError, StreamerSessionError } from "./session-errors";
import {
    createStreamerSessionPersistence,
    STREAM_PERSIST_DRAIN_TIMEOUT_MS,
    markRound,
    roundResultOf,
    sessionSummary,
    type RoundMark,
    type StreamerErrorReporter,
} from "./session-persistence";
import type {
    LiveStreamSession,
    StreamerEmitter,
    StreamerEndedListener,
    StreamerHostNoticeListener,
    StreamerSessionRuntime,
    StreamerSessionRuntimeDeps,
    StreamSessionEndReason,
} from "./session-runtime-types";
import {
    createSessionInputSchema,
    resolvedScreenPatchSchema,
    screenPatchFields,
    screenPatchInput,
    wordFiltersOf,
    type CreateSessionInput,
} from "./session-settings";
import type { StreamSessionSummary } from "./session-store";
import { realStreamerTimers, withinTurn } from "./session-timers";
import { createStreamerWatches } from "./session-watch";
import { createViewKey } from "./view-key";

// Live stream sessions of this process (single realtime replica, ADR-003). The runtime is the
// only writer of a session's game state: every action runs on the session's own queue, ticks
// once a second and re-emits the host and public projections. Its writes (each finished round,
// the session row) go to a per-session chain the queue never waits on (session-persistence.ts).

export { STREAM_DRAW_TIMEOUT_MS } from "./session-draw";
export { STREAM_PERSIST_DRAIN_TIMEOUT_MS, SUMMARY_SCORE_LIMIT, type StreamerErrorReporter } from "./session-persistence";
export { isStreamerSessionError, STREAMER_SESSION_ERROR_CODES, StreamerSessionError, type StreamerSessionErrorCode } from "./session-errors";
export { STREAM_CONNECTION_CHECK_MS, STREAMER_MODE_CHECK_MS, type ConnectionCheck, type ConnectionChecker, type SessionConnection, type StreamerModeState } from "./session-watch";
export type * from "./session-runtime-types";

export const STREAM_TICK_MS = 1_000;
export const STREAM_SESSION_IDLE_TIMEOUT_MS = 6 * 3_600_000;
// Phase 2 has no chat adapters yet; the stream screen always reads as connected.
const SNAPSHOT_OPTIONS = { connected: true } as const;

interface SessionEntry {
    id: string;
    userId: number;
    platform: StreamerPlatform;
    viewKeyHash: string;
    poolKey: string;
    startedAt: Date;
    input: CreateSessionInput;
    state: StreamSessionState;
    revision: number;
    /** Round results written so far: bumped only once a result row is stored. */
    roundCount: number;
    /** The last host action or guess the round took; chat that was not taken never counts. */
    lastActivityAt: number;
    timer: unknown;
    queue: Promise<unknown>;
    closed: boolean;
}

export const streamerPoolKey = (sessionId: string): string => `streamer:${sessionId}`;
const invalidPhase = (): StreamerSessionError => new StreamerSessionError("invalid_phase");

export function createStreamerSessionRuntime(deps: StreamerSessionRuntimeDeps): StreamerSessionRuntime {
    const clock = deps.now ?? Date.now;
    const tickMs = deps.tickMs ?? STREAM_TICK_MS;
    const idleTimeoutMs = deps.idleTimeoutMs ?? STREAM_SESSION_IDLE_TIMEOUT_MS;
    const onError: StreamerErrorReporter =
        deps.onError ?? ((event, error, context) => console.error(event, context?.sessionId ?? "", error));
    let emit: StreamerEmitter = deps.emit ?? (() => undefined);
    let onEnded: StreamerEndedListener = deps.onEnded ?? (() => undefined);
    let onViewKeyRotated: (sessionId: string) => void = () => undefined;
    let onHostNotice: StreamerHostNoticeListener = () => undefined;
    const entries = new Map<string, SessionEntry>();
    // Sessions whose end is writing its final row: no longer live, still awaited by stop().
    const closing = new Map<string, Promise<unknown>>();
    const timers = deps.timers ?? realStreamerTimers;
    // How long an outside caller (an end, the shutdown) waits for a session's pending action.
    const turnTimeoutMs = deps.drainTimeoutMs ?? STREAM_PERSIST_DRAIN_TIMEOUT_MS;
    const writes = createStreamerSessionPersistence({ store: deps.store, report: onError, drainTimeoutMs: deps.drainTimeoutMs, timers });
    const draw = createCardDraw({ wordSource: deps.wordSource, timers, timeoutMs: deps.drawTimeoutMs, report: onError });
    const watches = createStreamerWatches({
        timers,
        checkConnection: deps.checkConnection,
        report: onError,
        onNeedsReconnect: (sessionId, platform) =>
            guarded("streamer_session.on_host_notice_failed", sessionId, () => onHostNotice(sessionId, { kind: "connection-needs-reconnect", platform })),
        onModeOff: () => endAll("stopped"),
    });

    // ------------------------------------------------------------ plumbing

    function guarded(event: string, sessionId: string, run: () => void): void {
        try {
            run();
        } catch (error) {
            onError(event, error, { sessionId });
        }
    }

    function view(entry: SessionEntry): LiveStreamSession {
        return {
            id: entry.id,
            userId: entry.userId,
            platform: entry.platform,
            viewKeyHash: entry.viewKeyHash,
            startedAt: new Date(entry.startedAt),
            settings: structuredClone(entry.input),
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
        guarded("streamer_session.emit_failed", entry.id, () => emit(entry.id, "host", host));
        guarded("streamer_session.emit_failed", entry.id, () => emit(entry.id, "public", pub));
    }

    // One action at a time per session: draws are async, the state machine is not.
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
            catchUp(entry, now);
            return task(entry, now);
        });
    }

    function clearTimer(entry: SessionEntry): void {
        if (entry.timer) timers.clearInterval(entry.timer);
        entry.timer = null;
    }

    function reportTick(sessionId: string, error: unknown): void {
        if (isStreamerSessionError(error) && error.code === "not_found") return;
        onError("streamer_session.tick_failed", error, { sessionId });
    }

    // (Re)starts the session's 1 s tick so it lines up with the round clock just set.
    function align(entry: SessionEntry): void {
        clearTimer(entry);
        if (entry.closed) return;
        entry.timer = timers.setInterval(() => {
            run(entry.id, tickEntry).catch((error: unknown) => reportTick(entry.id, error));
        }, tickMs);
    }

    // ------------------------------------------------------------ rounds

    /** Emits the new state, then queues the result of the round `before` belonged to if it just ended. */
    function settle(entry: SessionEntry, before: RoundMark, now: number, passed = false): void {
        emitState(entry);
        const result = roundResultOf(entry.id, before, entry.state, now, passed);
        if (result) void writes.roundResult(result, () => (entry.roundCount += 1));
    }

    /** Brings a running round up to `now`; a round that ran out of time is settled. True when only the clock moved. */
    function catchUp(entry: SessionEntry, now: number): boolean {
        if (entry.state.phase !== "running") return false;
        const before = markRound(entry.state);
        const changed = tick(entry.state, now);
        if (entry.state.phase === before.phase) return changed;
        settle(entry, before, now);
        return false;
    }

    async function tickEntry(entry: SessionEntry, now: number): Promise<void> {
        if (now - entry.lastActivityAt >= idleTimeoutMs) {
            await finish(entry, "idle", now);
            return;
        }
        if (catchUp(entry, now)) emitState(entry);
    }

    // Bounded (session-draw.ts): a hung pool read answers `busy` and frees the queue.
    const drawCard = (entry: SessionEntry): Promise<StreamCard> => draw(entry.id, entry.poolKey, wordFiltersOf(entry.input));

    function beginFrom(phase: StreamPhase) {
        return (sessionId: string) =>
            hostAction(sessionId, async (entry) => {
                if (entry.state.phase !== phase) throw invalidPhase();
                const card = await drawCard(entry);
                // A draw that comes back after the session closed (a stop, a kill) changes nothing.
                if (entry.closed) throw new StreamerSessionError("not_found");
                if (!beginRound(entry.state, card, clock())) throw invalidPhase();
                align(entry);
                emitState(entry);
            });
    }

    // ------------------------------------------------------------ session end

    function finish(entry: SessionEntry, reason: StreamSessionEndReason, now: number): Promise<StreamSessionSummary> {
        const done = close(entry, reason, now);
        // From live to closing at once: a stop that runs meanwhile awaits this end, never doubles it.
        entries.delete(entry.id);
        closing.set(entry.id, done);
        const settled = () => closing.get(entry.id) === done && closing.delete(entry.id);
        done.then(settled, settled);
        return done;
    }

    async function close(entry: SessionEntry, reason: StreamSessionEndReason, now: number): Promise<StreamSessionSummary> {
        catchUp(entry, now);
        endSession(entry.state, now);
        entry.closed = true;
        clearTimer(entry);
        watches.forget(entry.id);
        emitState(entry);
        // The summary counts the rounds whose results were written: the queued writes land first.
        await writes.finalWrite(entry.id, "streamer_session.end_failed", () => ({
            status: "ended",
            endedAt: new Date(now),
            summary: sessionSummary(entry.state, entry.roundCount),
            roundCount: entry.roundCount,
        }));
        guarded("streamer_session.pool_clear_failed", entry.id, () => deps.wordSource.clear(entry.poolKey));
        guarded("streamer_session.on_ended_failed", entry.id, () => onEnded(entry.id, reason));
        return sessionSummary(entry.state, entry.roundCount);
    }

    // An end from outside waits for the session's pending action at most the bound (`busy`).
    function end(sessionId: string, reason: Exclude<StreamSessionEndReason, "interrupted">): Promise<StreamSessionSummary> {
        let started = false;
        const ending = run(sessionId, (entry, now) => {
            started = true;
            return finish(entry, reason, now);
        });
        return withinTurn(timers, turnTimeoutMs, ending, () => started, () => {
            onError("streamer_session.queue_wait_timeout", new Error(`a pending action held the session past ${turnTimeoutMs} ms`), { sessionId });
            return new StreamerSessionError("busy");
        });
    }

    async function endAll(reason: "stopped"): Promise<number> {
        const live = [...entries.values()].filter((entry) => !entry.closed);
        const ended = await Promise.allSettled(live.map((entry) => end(entry.id, reason)));
        return ended.filter((result) => result.status === "fulfilled").length;
    }

    // ------------------------------------------------------------ API

    return {
        open(row, state, link) {
            // A closing session keeps its id until its final write settled; as before, only live
            // sessions count for the one-session-per-user rule.
            if (entries.has(row.id) || closing.has(row.id) || [...entries.values()].some((entry) => entry.userId === row.userId && !entry.closed)) {
                throw new StreamerSessionError("session_active");
            }
            const now = clock();
            const entry: SessionEntry = {
                id: row.id,
                userId: row.userId,
                platform: row.platform,
                viewKeyHash: row.viewKeyHash,
                poolKey: streamerPoolKey(row.id),
                startedAt: new Date(row.startedAt),
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
            const channel = row.connectionId && link ? { id: row.connectionId, userId: row.userId, platform: row.platform, platformUserId: link.platformUserId } : null;
            watches.watchConnection(entry.id, channel);
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
            hostAction(sessionId, async (entry, now) => {
                // The clock came first (hostAction): a pass after the deadline found the round timed
                // out, already recorded, and is refused here without drawing a card.
                if (entry.state.phase !== "running" && entry.state.phase !== "paused") throw invalidPhase();
                // No next card: refused before anything changed, the round keeps its card.
                const card = await drawCard(entry);
                if (entry.closed) throw new StreamerSessionError("not_found");
                const before = markRound(entry.state);
                // Judged at `now`, when the pass was handled: one in time keeps the card it drew even
                // if the deadline went by while it was drawn. The new round starts once the card is here.
                if (!skipRound(entry.state, now, card, clock())) throw invalidPhase();
                align(entry);
                settle(entry, before, now, true);
            }),
        end,
        endAll,
        applySettings: (sessionId, patch) =>
            hostAction(sessionId, async (entry) => {
                // The runtime is an API of its own: the patch is checked here, not only by the socket.
                const parsed = resolvedScreenPatchSchema.safeParse(patch);
                if (!parsed.success) throw new StreamerSessionError("invalid_settings");
                entry.state.settings = { ...entry.state.settings, ...screenPatchFields(parsed.data) };
                entry.input = { ...entry.input, ...screenPatchInput(parsed.data) };
                emitState(entry);
                const settings = entry.input;
                void writes.write(entry.id, "streamer_session.settings_failed", () => deps.store.update(entry.id, { settings }));
            }),
        guess: (sessionId, guess) =>
            run(sessionId, async (entry, now) => {
                // acceptGuess ticks first, so a round that just ran out settles as a timeout here.
                const before = markRound(entry.state);
                const participants = entry.state.participants;
                const result = acceptGuess(entry.state, guess, now);
                // Only a guess the round took is activity: closed, stale, duplicate or invalid chat
                // never keeps a session open past the idle limit.
                if (result === "wrong" || result === "correct") entry.lastActivityAt = now;
                if (entry.state.phase !== before.phase || entry.state.participants !== participants) {
                    settle(entry, before, now);
                }
                return result;
            }),
        async rotateViewKey(sessionId) {
            const entry = await hostAction(sessionId, async (live) => live);
            const { viewKey, hash } = createViewKey();
            // The key is handed out only once stored: a failed write leaves the old key valid and
            // reaches the caller. The write takes its turn among the session's writes, off its queue,
            // and is waited for at most the drain bound (`busy`); one that lands later is undone.
            await writes.request(
                entry.id,
                "streamer_session.view_key_undo_failed",
                () => deps.store.update(entry.id, { viewKeyHash: hash }),
                () => deps.store.update(entry.id, { viewKeyHash: entry.viewKeyHash }),
            );
            if (entry.closed) throw new StreamerSessionError("not_found");
            entry.viewKeyHash = hash;
            guarded("streamer_session.on_view_key_rotated_failed", entry.id, () => onViewKeyRotated(entry.id));
            emitState(entry);
            return { viewKey };
        },
        async tickAll(at) {
            const ids = [...entries.keys()];
            await Promise.all(
                ids.map((id) => run(id, (entry, now) => tickEntry(entry, at ?? now)).catch((error: unknown) => reportTick(id, error))),
            );
        },
        flush: () => writes.drainAll(),
        setEmitter(next) {
            emit = next;
        },
        setOnEnded(listener) {
            onEnded = listener;
        },
        setOnViewKeyRotated(listener) {
            onViewKeyRotated = listener;
        },
        setOnHostNotice(listener) {
            onHostNotice = listener;
        },
        watchMode: (readMode, intervalMs) => watches.watchMode(readMode, intervalMs),
        async stop() {
            watches.stopAll();
            const open = [...entries.values()];
            for (const entry of open) {
                entry.closed = true;
                clearTimer(entry);
            }
            // Shutdown waits for pending actions and for the ends already writing (their rooms hear
            // `ended`), at most the bound, then goes on: it must reach io.close. A closing end
            // reports its own write timeout.
            const pending = new Set(open);
            for (const entry of open) void entry.queue.then(() => pending.delete(entry));
            const waited = Promise.all([...open.map((entry) => entry.queue), ...[...closing.values()].map((done) => done.catch(() => undefined))]);
            await withinTurn(timers, turnTimeoutMs, waited, () => false, () => {
                for (const entry of pending) onError("streamer_session.stop_queue_timeout", new Error("a pending action outlived the stop bound"), { sessionId: entry.id });
            }).catch(() => undefined);
            const endedAt = new Date(clock());
            await Promise.all(
                open.map(async (entry) => {
                    clearTimer(entry);
                    // A second stop() that ran alongside this one got here first: it ended the entry already.
                    if (entries.get(entry.id) !== entry) return;
                    entries.delete(entry.id);
                    // Both rooms hear it before the rows are written: shutdown closes the sockets next.
                    guarded("streamer_session.on_ended_failed", entry.id, () => onEnded(entry.id, "interrupted"));
                    await writes.finalWrite(entry.id, "streamer_session.stop_failed", () => ({ status: "interrupted", endedAt, roundCount: entry.roundCount }));
                    guarded("streamer_session.pool_clear_failed", entry.id, () => deps.wordSource.clear(entry.poolKey));
                }),
            );
        },
    };
}
