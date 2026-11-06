import { NextResponse } from "next/server";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";
import { buildRateLimitHeaders, type RequestRateLimitResult } from "@/lib/security/request-rate-limit";
import type { StreamUrls } from "@/types/streamer-session";
import { isStreamerSessionError, type StreamerSessionErrorCode } from "./session-service";

export type { CardBackOption, CreateStreamSessionResponse, RotateViewKeyResponse, StreamSessionResponse, StreamUrls } from "@/types/streamer-session";

const MAPPING: Record<StreamerSessionErrorCode, { code: PlayerErrorCode; status: number }> = {
    session_active: { code: PlayerErrorCode.STREAMER_SESSION_ACTIVE, status: 409 },
    connection_required: { code: PlayerErrorCode.STREAMER_CONNECTION_REQUIRED, status: 409 },
    not_found: { code: PlayerErrorCode.STREAMER_SESSION_NOT_FOUND, status: 404 },
    invalid_phase: { code: PlayerErrorCode.STREAMER_ACTION_INVALID_PHASE, status: 409 },
    invalid_settings: { code: PlayerErrorCode.INVALID_REQUEST, status: 400 },
    word_source_empty: { code: PlayerErrorCode.STREAMER_WORD_POOL_EMPTY, status: 422 },
    card_not_allowed: { code: PlayerErrorCode.STREAMER_CARD_NOT_ALLOWED, status: 422 },
    card_catalogue_unavailable: { code: PlayerErrorCode.STREAMER_CARD_CATALOGUE_UNAVAILABLE, status: 503 },
    busy: { code: PlayerErrorCode.SERVER_BUSY, status: 503 },
};

/** The response for a known session-service error, or null so the caller falls through to its own 500. */
export function streamerSessionErrorResponse(error: unknown): NextResponse | null {
    if (!isStreamerSessionError(error)) return null;
    const mapped = MAPPING[error.code];
    if (!mapped) return null;
    return NextResponse.json(playerError(mapped.code), { status: mapped.status });
}

/** The answer of a streamer session route whose quota ran out. */
export function rateLimitedResponse(limit: RequestRateLimitResult): NextResponse {
    return NextResponse.json(playerError(PlayerErrorCode.RATE_LIMITED), { status: 429, headers: buildRateLimitHeaders(limit) });
}

/** A failure inside a streamer session route: a known session error's own answer, anything else logged and a 500. */
export function streamerRouteFailure(error: unknown, label: string): NextResponse {
    const mapped = streamerSessionErrorResponse(error);
    if (mapped) return mapped;
    console.error(label, error);
    return NextResponse.json(playerError(PlayerErrorCode.UNKNOWN_ERROR), { status: 500 });
}

export function buildStreamUrls(origin: string, viewKey: string): StreamUrls {
    const full = `${origin}/stream/${viewKey}`;
    return { full, half: `${full}?layout=half`, stripTop: `${full}?overlay=top`, stripBottom: `${full}?overlay=bottom` };
}
