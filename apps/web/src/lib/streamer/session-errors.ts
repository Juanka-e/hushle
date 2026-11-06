// What the stream session runtime and service refuse with: a typed code the HTTP routes and the
// socket layer map to player error codes (session-http.ts, streamer-socket.ts).

export const STREAMER_SESSION_ERROR_CODES = [
    "session_active",
    "connection_required",
    "not_found",
    "invalid_phase",
    "invalid_settings",
    "word_source_empty",
    "card_not_allowed",
    "card_catalogue_unavailable",
    // The database did not answer within the drain bound: nothing changed, try again.
    "busy",
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
