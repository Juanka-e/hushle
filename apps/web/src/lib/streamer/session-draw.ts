import type { StreamCard } from "@hushle/domain-streamer";
import { StreamerSessionError } from "./session-errors";
import type { StreamerErrorReporter } from "./session-persistence";
import type { WordSource } from "./session-runtime-types";
import type { WordFilters } from "./session-settings";
import { withinTurn, type StreamerTimers } from "./session-timers";

// A session's word draws, bounded. A draw runs on the session's action queue: one that never
// returns (a hung pool read) would hold every later action of that session, its end included,
// until a restart.

/** How long one word draw may take: past it the action answers `busy` and the queue moves on. */
export const STREAM_DRAW_TIMEOUT_MS = 10_000;

export interface CardDrawDeps {
    wordSource: WordSource;
    timers: StreamerTimers;
    timeoutMs?: number;
    report: StreamerErrorReporter;
}

/**
 * The next card for a session, `word_source_empty` when no word matches at all, or `busy` once
 * the bound passed (reported once, with the session id only). A card or a failure that comes back
 * after the bound is dropped: the action that asked for it has already answered.
 */
export function createCardDraw(deps: CardDrawDeps): (sessionId: string, poolKey: string, filters: WordFilters) => Promise<StreamCard> {
    const timeoutMs = deps.timeoutMs ?? STREAM_DRAW_TIMEOUT_MS;
    return async (sessionId, poolKey, filters) => {
        const card = await withinTurn(deps.timers, timeoutMs, deps.wordSource.next(poolKey, filters), () => false, () => {
            deps.report("streamer_session.draw_timeout", new Error(`a word draw outlived ${timeoutMs} ms`), { sessionId });
            return new StreamerSessionError("busy");
        });
        if (!card) throw new StreamerSessionError("word_source_empty");
        return card;
    };
}
