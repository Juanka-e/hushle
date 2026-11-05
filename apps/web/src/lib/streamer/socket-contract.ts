import type { HostStreamSnapshot, PublicStreamSnapshot } from "@hushle/domain-streamer";
import type { PlayerErrorBody } from "@/lib/errors/player-error";

// The streamer-mode Socket.IO contract (default namespace, path /api/socketio), shared by the
// server handlers, the host panel and the stream screen. Types and names only: no server code.

export const STREAMER_SOCKET_EVENTS = {
    // client -> server
    hostJoin: "streamer:host:join",
    hostStart: "streamer:host:start",
    hostPause: "streamer:host:pause",
    hostResume: "streamer:host:resume",
    hostPass: "streamer:host:pass",
    hostNext: "streamer:host:next",
    hostEnd: "streamer:host:end",
    hostSettings: "streamer:host:settings",
    hostRotateKey: "streamer:host:rotate-key",
    publicJoin: "streamer:public:join",
    // server -> client
    hostState: "streamer:host:state",
    publicState: "streamer:public:state",
    ended: "streamer:ended",
} as const;

/**
 * Why a room was closed: the host ended it, it sat idle for 6 h, the view key was rotated (public
 * room only) or the server lost it (`interrupted`: reserved, the server does not send it yet).
 */
export type StreamerEndedReason = "ended" | "idle" | "view-key-rotated" | "interrupted";

export interface StreamerEndedPayload {
    reason: StreamerEndedReason;
}

export type StreamerAckFailure = { ok: false } & PlayerErrorBody;
export type StreamerHostJoinAck = { ok: true; state: HostStreamSnapshot } | StreamerAckFailure;
export type StreamerPublicJoinAck = { ok: true; state: PublicStreamSnapshot } | StreamerAckFailure;
export type StreamerActionAck = { ok: true } | StreamerAckFailure;
export type StreamerRotateKeyAck = { ok: true; viewKey: string } | StreamerAckFailure;
