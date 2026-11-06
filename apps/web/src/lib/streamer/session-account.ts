import { isStreamerSessionError, STREAM_PERSIST_DRAIN_TIMEOUT_MS, type StreamerSessionRuntime } from "./session-runtime";
import { reportStreamerSessionError } from "./session-service";

// Account actions on a user's live stream (an admin suspension). The runtime is the one on
// globalThis (session-deps.ts creates it at boot); this module never creates one, so a process
// without a running runtime (a job, a route served elsewhere) does nothing here.

const globalForStreamerSessions = globalThis as typeof globalThis & { __hushleStreamerSessionRuntime?: StreamerSessionRuntime };

/**
 * Takes the user's stream off the air: their live session ends with reason `stopped`. Bounded by
 * the drain timeout: behind a stuck action the caller gets its answer (false, reported) and the
 * session's own queue still runs the end in its turn. Never throws; true when a session ended.
 */
export async function endStreamerSessionsForUser(userId: number, options: { timeoutMs?: number } = {}): Promise<boolean> {
    const runtime = globalForStreamerSessions.__hushleStreamerSessionRuntime;
    const live = runtime?.forUser(userId);
    if (!runtime || !live) return false;
    const timeoutMs = options.timeoutMs ?? STREAM_PERSIST_DRAIN_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
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
        if (!(isStreamerSessionError(error) && error.code === "not_found")) {
            reportStreamerSessionError("streamer_session.account_stop_failed", error, { sessionId: live.id });
        }
        return false;
    } finally {
        clearTimeout(timer);
    }
}
