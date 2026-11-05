import { StreamerConfigError } from "@hushle/platform-streamer";
import { NextResponse } from "next/server";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import { buildRateLimitHeaders, consumeDistributedRequestRateLimit, getRequestIp } from "@/lib/security/request-rate-limit";
import { getSessionUser } from "@/lib/session";
import { disconnectPlatform } from "@/lib/streamer/connections-view";
import { createConnectFlowDeps } from "@/lib/streamer/deps";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ platform: string }> }) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json(playerError(PlayerErrorCode.ORIGIN_REJECTED), { status: 403 });
    }
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }
    const limit = await consumeDistributedRequestRateLimit({
        bucket: "streamer-disconnect",
        key: `user:${sessionUser.id}`,
        windowMs: 15 * 60_000,
        maxRequests: 5,
    });
    if (!limit.allowed) {
        return NextResponse.json(playerError(PlayerErrorCode.RATE_LIMITED), { status: 429, headers: buildRateLimitHeaders(limit) });
    }
    const { platform } = await params;
    try {
        const result = await disconnectPlatform(createConnectFlowDeps(request), {
            user: { id: sessionUser.id, role: sessionUser.role },
            platform,
            requestIp: getRequestIp(request),
        });
        if ("error" in result) {
            return NextResponse.json(playerError(PlayerErrorCode.STREAMER_CONNECTION_NOT_FOUND), { status: 404 });
        }
        return NextResponse.json({ ok: true });
    } catch (error) {
        if (error instanceof StreamerConfigError) {
            return NextResponse.json(playerError(PlayerErrorCode.STREAMER_PLATFORM_UNAVAILABLE), { status: 503 });
        }
        console.error("streamer disconnect failed", error);
        return NextResponse.json(playerError(PlayerErrorCode.UNKNOWN_ERROR), { status: 500 });
    }
}
