import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getNotificationUnreadCountForUser } from "@/lib/notifications/service";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "notifications-unread-count",
        key: `user:${sessionUser.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 120,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            playerError(PlayerErrorCode.RATE_LIMITED),
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const result = await getNotificationUnreadCountForUser(sessionUser.id);
    return NextResponse.json(result, { headers: buildRateLimitHeaders(rateLimit) });
}
