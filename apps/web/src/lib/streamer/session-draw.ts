import type { StreamCard } from "@hushle/domain-streamer";
import { StreamerSessionError } from "./session-errors";
import type { StreamerErrorReporter } from "./session-persistence";
import type { WordSource } from "./session-runtime-types";
import type { WordFilters } from "./session-settings";
import { withinTurn, type StreamerTimers } from "./session-timers";

// A session's word draws, bounded. A draw runs on the session's action queue: one that never
// returns (a hung pool read) would hold every later action of that session, its end included,
// until a restart.

/**
 * How long one word draw may take: past it the action answers `busy` and the queue moves on. Just
 * below the 10 s turn bound (STREAM_PERSIST_DRAIN_TIMEOUT_MS), so an end asked in the same tick as
 * a stuck start still gets its turn instead of answering `busy` itself.
 */
export const STREAM_DRAW_TIMEOUT_MS = 9_500;

export interface CardDrawDeps {
    wordSource: WordSource;
    timers: StreamerTimers;
    timeoutMs?: number;
    report: StreamerErrorReporter;
    /** Whether the session still runs; a session that is over gets a late draw's pool cleared. */
    isLive?: (sessionId: string) => boolean;
}

/**
 * The next card for a session, `word_source_empty` when no word matches at all, or `busy` once
 * the bound passed (reported once, with the session id only). A card or a failure that comes back
 * after the bound is dropped: the action that asked for it has already answered. That late read
 * may have rebuilt the pool after the session's end cleared it, so once it settles a session that
 * is over gets its pool cleared again: no pool outlives its session.
 */
export function createCardDraw(deps: CardDrawDeps): (sessionId: string, poolKey: string, filters: WordFilters) => Promise<StreamCard> {
    const timeoutMs = deps.timeoutMs ?? STREAM_DRAW_TIMEOUT_MS;
    const clearIfOver = (sessionId: string, poolKey: string) => {
        if (!deps.isLive || deps.isLive(sessionId)) return;
        try {
            deps.wordSource.clear(poolKey);
        } catch (error) {
            deps.report("streamer_session.pool_clear_failed", error, { sessionId });
        }
    };
    return async (sessionId, poolKey, filters) => {
        const drawing = deps.wordSource.next(poolKey, filters);
        const card = await withinTurn(deps.timers, timeoutMs, drawing, () => false, () => {
            deps.report("streamer_session.draw_timeout", new Error(`a word draw outlived ${timeoutMs} ms`), { sessionId });
            const settled = () => clearIfOver(sessionId, poolKey);
            drawing.then(settled, settled);
            return new StreamerSessionError("busy");
        });
        if (!card) throw new StreamerSessionError("word_source_empty");
        return card;
    };
}
