import type { StreamerPlatform } from "@hushle/platform-streamer";
import type { StreamerErrorReporter } from "./session-persistence";
import type { StreamerTimers } from "./session-timers";

// The checks that run beside the live sessions, off their action queues: the hourly validation of
// the channel link each session runs on, and the watch on the admin's streamer-mode switch.

/** How often the streamer-mode switch is read while sessions may be live (the settings cache is 15 s too). */
export const STREAMER_MODE_CHECK_MS = 15_000;
/** How often a live session's channel link is validated (Twitch asks apps holding tokens for hourly checks). */
export const STREAM_CONNECTION_CHECK_MS = 3_600_000;

/** What a link check found: still valid, now needing a reconnect, or no answer this time (transient). */
export type ConnectionCheck = "valid" | "needs_reconnect" | "unavailable";

/** The channel link a live session was opened on. */
export interface SessionConnection {
    id: string;
    userId: number;
    platform: StreamerPlatform;
}

export type ConnectionChecker = (connection: SessionConnection) => Promise<ConnectionCheck>;

/** The admin's streamer-mode switch as read (streamer-mode.ts): unknown while the database does not answer. */
export type StreamerModeState = "on" | "off" | "unknown";

export interface StreamerWatchesDeps {
    timers: StreamerTimers;
    checkConnection?: ConnectionChecker;
    connectionCheckMs?: number;
    /** The link of a live session stopped being valid (told once until it is valid again). */
    onNeedsReconnect(sessionId: string, platform: StreamerPlatform): void;
    /** The streamer-mode switch reads off. */
    onModeOff(): Promise<unknown>;
    report: StreamerErrorReporter;
}

export interface StreamerWatches {
    /** Checks a live session's link every hour until `forget`; nothing without a checker or a link. */
    watchConnection(sessionId: string, connection: SessionConnection | null): void;
    forget(sessionId: string): void;
    /** Reads the switch every `intervalMs` (one watch at a time) and acts on "off" only; returns its unwatch. */
    watchMode(readMode: () => Promise<StreamerModeState>, intervalMs?: number): () => void;
    stopAll(): void;
}

interface Watched {
    handle: unknown;
    valid: boolean;
    checking: boolean;
}

export function createStreamerWatches(deps: StreamerWatchesDeps): StreamerWatches {
    const { timers } = deps;
    const connections = new Map<string, Watched>();
    let mode: { handle: unknown; checking: boolean } | null = null;

    function report(event: string, error: unknown, sessionId?: string): void {
        try {
            deps.report(event, error, sessionId ? { sessionId } : undefined);
        } catch {
            // A reporter that throws stops no check.
        }
    }

    async function checkConnection(sessionId: string, connection: SessionConnection, watched: Watched): Promise<void> {
        if (watched.checking || !deps.checkConnection) return;
        watched.checking = true;
        try {
            const found = await deps.checkConnection(connection);
            // The session ended meanwhile: whatever was found is nobody's business now.
            if (connections.get(sessionId) !== watched) return;
            if (found === "valid") watched.valid = true;
            if (found === "needs_reconnect" && watched.valid) {
                watched.valid = false;
                deps.onNeedsReconnect(sessionId, connection.platform);
            }
        } catch (error) {
            report("streamer_session.connection_check_failed", error, sessionId);
        } finally {
            watched.checking = false;
        }
    }

    function forget(sessionId: string): void {
        const watched = connections.get(sessionId);
        if (watched) timers.clearInterval(watched.handle);
        connections.delete(sessionId);
    }

    async function checkMode(watch: { checking: boolean }, readMode: () => Promise<StreamerModeState>): Promise<void> {
        if (watch.checking) return;
        watch.checking = true;
        try {
            // Only an authoritative "off" ends the streams: "unknown" (the database away) changes nothing.
            if ((await readMode()) === "off") await deps.onModeOff();
        } catch (error) {
            report("streamer_session.mode_check_failed", error);
        } finally {
            watch.checking = false;
        }
    }

    function unwatchMode(): void {
        if (mode) timers.clearInterval(mode.handle);
        mode = null;
    }

    return {
        watchConnection(sessionId, connection) {
            if (!deps.checkConnection || !connection || connections.has(sessionId)) return;
            const watched: Watched = { handle: null, valid: true, checking: false };
            watched.handle = timers.setInterval(() => void checkConnection(sessionId, connection, watched), deps.connectionCheckMs ?? STREAM_CONNECTION_CHECK_MS);
            connections.set(sessionId, watched);
        },
        forget,
        watchMode(readMode, intervalMs = STREAMER_MODE_CHECK_MS) {
            unwatchMode();
            const watch = { handle: null as unknown, checking: false };
            watch.handle = timers.setInterval(() => void checkMode(watch, readMode), intervalMs);
            mode = watch;
            return () => {
                if (mode === watch) unwatchMode();
            };
        },
        stopAll() {
            for (const sessionId of [...connections.keys()]) forget(sessionId);
            unwatchMode();
        },
    };
}
