import { isStreamerSessionError, STREAM_PERSIST_DRAIN_TIMEOUT_MS, type StreamerSessionRuntime } from "./session-runtime";
import { reportStreamerSessionError } from "./session-service";
import { realStreamerTimers, type StreamerTimers } from "./session-timers";

// Account actions on a user's live stream (an admin suspension). The runtime is the one on
// globalThis (session-deps.ts creates it at boot); this module never creates one, so a process
// without a running runtime (a job, a route served elsewhere) does nothing here.

const globalForStreamerSessions = globalThis as typeof globalThis & { __hushleStreamerSessionRuntime?: StreamerSessionRuntime };

/**
 * The helper's own bound: past the runtime's (its wait for the session's turn, then its final
 * write), so a stuck end is answered and reported by the runtime first, once. It only fires if the
 * runtime's bounds did not.
 */
export const ACCOUNT_STOP_TIMEOUT_MS = 2 * STREAM_PERSIST_DRAIN_TIMEOUT_MS + 1_000;

/**
 * Takes the user's stream off the air: their live session ends with reason `stopped`. Bounded:
 * behind a stuck action the runtime answers `busy` (and reports it) and the session's own queue
 * still runs the end in its turn; the helper's own bound is a last resort past that. Never
 * throws; true when a session ended.
 */
export async function endStreamerSessionsForUser(userId: number, options: { timers?: StreamerTimers; timeoutMs?: number } = {}): Promise<boolean> {
    const runtime = globalForStreamerSessions.__hushleStreamerSessionRuntime;
    const live = runtime?.forUser(userId);
    if (!runtime || !live) return false;
    const timers = options.timers ?? realStreamerTimers;
    const timeoutMs = options.timeoutMs ?? ACCOUNT_STOP_TIMEOUT_MS;
    let handle: unknown;
    const bound = new Promise<"timeout">((resolve) => {
        handle = timers.setTimeout(() => resolve("timeout"), timeoutMs);
    });
    try {
        const ending = runtime.end(live.id, "stopped");
        ending.catch(() => undefined);
        const outcome = await Promise.race([ending.then(() => "ended" as const), bound]);
        if (outcome === "timeout") {
            reportStreamerSessionError("streamer_session.account_stop_timeout", new Error(`the stream end took longer than ${timeoutMs} ms`), { sessionId: live.id });
            return false;
        }
        return true;
    } catch (error) {
        // busy: the runtime already reported the stuck turn. not_found: nothing was left to end.
        if (!(isStreamerSessionError(error) && (error.code === "busy" || error.code === "not_found"))) {
            reportStreamerSessionError("streamer_session.account_stop_failed", error, { sessionId: live.id });
        }
        return false;
    } finally {
        timers.clearTimeout(handle);
    }
}
