import { NextResponse, type NextRequest } from "next/server";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import { buildRateLimitHeaders, consumeDistributedRequestRateLimit } from "@/lib/security/request-rate-limit";
import { getSessionUser } from "@/lib/session";
import { publicOriginFor } from "@/lib/streamer/redirects";
import { createSessionServiceDeps } from "@/lib/streamer/session-deps";
import { buildStreamUrls, streamerSessionErrorResponse } from "@/lib/streamer/session-http";
import { rotateViewKey } from "@/lib/streamer/session-service";
import type { RotateViewKeyResponse } from "@/types/streamer-session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json(playerError(PlayerErrorCode.ORIGIN_REJECTED), { status: 403 });
    }
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }
    const limit = await consumeDistributedRequestRateLimit({
        bucket: "streamer-view-key",
        key: `user:${sessionUser.id}`,
        windowMs: 15 * 60_000,
        maxRequests: 10,
    });
    if (!limit.allowed) {
        return NextResponse.json(playerError(PlayerErrorCode.RATE_LIMITED), { status: 429, headers: buildRateLimitHeaders(limit) });
    }
    try {
        const { viewKey } = await rotateViewKey(createSessionServiceDeps(), sessionUser.id);
        const origin = publicOriginFor(process.env, request.nextUrl.origin);
        const body: RotateViewKeyResponse = { viewKey, urls: buildStreamUrls(origin, viewKey) };
        return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
    } catch (error) {
        const mapped = streamerSessionErrorResponse(error);
        if (mapped) return mapped;
        console.error("streamer view key rotation failed", error);
        return NextResponse.json(playerError(PlayerErrorCode.UNKNOWN_ERROR), { status: 500 });
    }
}
