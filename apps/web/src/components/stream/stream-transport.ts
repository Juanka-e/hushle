import { io, type Socket } from "socket.io-client";
import { SOCKET_CLIENT_AUTH } from "@/lib/socket/protocol-version";
import { STREAMER_SOCKET_EVENTS, type StreamerEndedReason } from "@/lib/streamer/socket-contract";
import { readSnapshot, type StreamState } from "./stream-renderer";

// The stream screen's link to the server: joins the public room with the view key from the URL,
// passes on the states that are newer than the last one, and says when the screen should show its
// offline scene. Socket.IO reconnects on its own after a lost transport; each new connection
// joins again. The view key goes only into the join payload: never into a log, a title or the DOM.

/** The public room's capability key: 32 random bytes in base64url. */
export function isViewKey(value: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Drops any state that is not newer than the last one taken. */
export function createRevisionGuard() {
    let last = -1;
    return {
        accept(revision: number): boolean {
            if (revision <= last) return false;
            last = revision;
            return true;
        },
        /** The join ack is the new floor (the server's count may have started over). */
        reset(revision: number): void {
            last = revision;
        },
    };
}

/** The part of a Socket.IO client socket the transport uses. */
export interface StreamSocketLike {
    readonly connected: boolean;
    on(event: string, listener: (...args: never[]) => void): unknown;
    emit(event: string, payload: unknown, ack: (reply: unknown) => void): unknown;
    connect(): unknown;
    disconnect(): unknown;
}

export interface StreamTimers {
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

export interface StreamTransportOptions {
    viewKey: string;
    socket: StreamSocketLike;
    /** A state to draw: the join ack's always, a broadcast only when it is newer. */
    onState(state: StreamState): void;
    /** No state for a while, or a refused join: show the offline scene. */
    onOffline(): void;
    /** The session closed its public room; nothing more will come. */
    onEnded(reason: StreamerEndedReason): void;
    timers?: StreamTimers;
}

export interface StreamTransport {
    close(): void;
}

const OFFLINE_AFTER_MS = 5_000;
const RETRY_MAX_MS = 30_000;
// Refusals that no retry can change: the key opens nothing (rotated, ended, never existed).
const FINAL_JOIN_CODES = new Set(["STREAMER_VIEW_KEY_INVALID", "INVALID_REQUEST"]);
// Every closed reason of the contract. A record, so a reason added there fails the typecheck
// until it is listed here too.
const ENDED_REASONS: Record<StreamerEndedReason, true> = {
    ended: true,
    idle: true,
    "view-key-rotated": true,
    interrupted: true,
    stopped: true,
};

function endedReason(payload: unknown): StreamerEndedReason {
    const reason = isBag(payload) ? payload.reason : undefined;
    return typeof reason === "string" && Object.prototype.hasOwnProperty.call(ENDED_REASONS, reason)
        ? (reason as StreamerEndedReason)
        : "interrupted";
}

const systemTimers: StreamTimers = {
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function isBag(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export function connectStreamTransport(options: StreamTransportOptions): StreamTransport {
    const { socket, viewKey } = options;
    const timers = options.timers ?? systemTimers;
    const guard = createRevisionGuard();
    let closed = false;
    let failures = 0;
    // Acks of an earlier join (an earlier connection) are ignored.
    let joinSequence = 0;
    let offlineTimer: unknown;
    let retryTimer: unknown;

    function armOffline(): void {
        timers.clearTimeout(offlineTimer);
        offlineTimer = timers.setTimeout(() => {
            if (!closed) options.onOffline();
        }, OFFLINE_AFTER_MS);
    }

    function stop(): void {
        closed = true;
        timers.clearTimeout(offlineTimer);
        timers.clearTimeout(retryTimer);
        socket.disconnect();
    }

    function join(): void {
        if (closed || !socket.connected) return;
        timers.clearTimeout(retryTimer);
        const sequence = ++joinSequence;
        socket.emit(STREAMER_SOCKET_EVENTS.publicJoin, { viewKey }, (reply: unknown) => {
            if (closed || sequence !== joinSequence) return;
            const state = isBag(reply) && reply.ok === true ? readSnapshot(reply.state) : null;
            timers.clearTimeout(offlineTimer);
            if (state) {
                failures = 0;
                guard.reset(state.revision);
                options.onState(state);
                return;
            }
            options.onOffline();
            if (isBag(reply) && typeof reply.code === "string" && FINAL_JOIN_CODES.has(reply.code)) {
                stop();
                return;
            }
            // Rate limited, a server error or an unreadable state: ask again, waiting longer each time.
            failures += 1;
            retryTimer = timers.setTimeout(join, Math.min(RETRY_MAX_MS, OFFLINE_AFTER_MS * 2 ** (failures - 1)));
        });
    }

    if (!isViewKey(viewKey)) {
        closed = true;
        options.onOffline();
        return { close: () => undefined };
    }

    socket.on("connect", join);
    socket.on("disconnect", () => {
        if (closed) return;
        joinSequence += 1;
        timers.clearTimeout(retryTimer);
        armOffline();
    });
    socket.on(STREAMER_SOCKET_EVENTS.publicState, (data: unknown) => {
        if (closed) return;
        const state = readSnapshot(data);
        if (!state || !guard.accept(state.revision)) return;
        timers.clearTimeout(offlineTimer);
        options.onState(state);
    });
    socket.on(STREAMER_SOCKET_EVENTS.ended, (payload: unknown) => {
        if (closed) return;
        const reason = endedReason(payload);
        // Every reason (ended, idle, rotated, interrupted, stopped) means the view key is dead:
        // the server will refuse it from now on, so the screen never retries after any of them.
        stop();
        options.onEnded(reason);
    });
    armOffline();
    socket.connect();
    return { close: stop };
}

/** The default-namespace client the app's other pages use; it connects when the transport says so. */
export function createStreamSocket(): Socket {
    return io({
        path: "/api/socketio",
        auth: SOCKET_CLIENT_AUTH,
        transports: ["websocket", "polling"],
        tryAllTransports: true,
        autoConnect: false,
    });
}
