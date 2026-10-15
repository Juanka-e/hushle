import { NextResponse } from "next/server";
import {
    PlayerCoreError,
    updatePlayerProfile,
} from "@hushle/platform-player";
import { getSessionUser } from "@/lib/session";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

function getUserAgent(request: Request): string | null {
    return request.headers.get("user-agent")?.slice(0, 255) ?? null;
}

function mapPlayerError(error: PlayerCoreError) {
    switch (error.code) {
        case "invalid_profile":
            return NextResponse.json(
                playerError(PlayerErrorCode.PROFILE_INVALID),
                { status: 422 }
            );
        case "user_not_found":
            return NextResponse.json(
                playerError(PlayerErrorCode.USER_NOT_FOUND),
                { status: 404 }
            );
    }
}

export async function PATCH(req: Request) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(
            playerError(PlayerErrorCode.AUTH_REQUIRED),
            { status: 401 }
        );
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "user-profile-update",
        key: `user:${sessionUser.id}:${getRequestIp(req)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            playerError(PlayerErrorCode.RATE_LIMITED),
            {
                status: 429,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    }

    try {
        const result = await updatePlayerProfile({
            userId: sessionUser.id,
            patch: await req.json(),
            auditContext: {
                actorRole: sessionUser.role,
                ipAddress: getRequestIp(req),
                userAgent: getUserAgent(req),
            },
        });
        return NextResponse.json(
            { profile: result.profile },
            { headers: buildRateLimitHeaders(rateLimit) }
        );
    } catch (error) {
        if (error instanceof PlayerCoreError) {
            return mapPlayerError(error);
        }
        if (error instanceof SyntaxError) {
            return NextResponse.json(
                playerError(PlayerErrorCode.INVALID_REQUEST),
                { status: 422 }
            );
        }
        return NextResponse.json(
            playerError(PlayerErrorCode.PROFILE_UPDATE_FAILED),
            { status: 500 }
        );
    }
}
