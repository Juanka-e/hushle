import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { markAllNotificationsReadForUser } from "@/lib/notifications/service";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "notifications-read-all",
        key: `user:${sessionUser.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            playerError(PlayerErrorCode.RATE_LIMITED),
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const updatedCount = await markAllNotificationsReadForUser(sessionUser.id);
    return NextResponse.json(
        { updatedCount },
        { headers: buildRateLimitHeaders(rateLimit) }
    );
}
