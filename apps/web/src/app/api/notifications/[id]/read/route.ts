import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { notificationParamsSchema } from "@/lib/notifications/schema";
import {
    archiveNotificationForUser,
    markNotificationReadForUser,
} from "@/lib/notifications/service";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

export const dynamic = "force-dynamic";

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }

    const params = notificationParamsSchema.safeParse(await context.params);
    if (!params.success) {
        return NextResponse.json(playerError(PlayerErrorCode.INVALID_REQUEST), { status: 422 });
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "notifications-mark-read",
        key: `user:${sessionUser.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 60,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            playerError(PlayerErrorCode.RATE_LIMITED),
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const updated = await markNotificationReadForUser(params.data.id, sessionUser.id);

        if (!updated) {
            return NextResponse.json(playerError(PlayerErrorCode.NOTIFICATION_NOT_FOUND), { status: 404 });
        }

        return NextResponse.json(
            { ok: true },
            { headers: buildRateLimitHeaders(rateLimit) }
        );
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                playerError(PlayerErrorCode.INVALID_REQUEST),
                { status: 422 }
            );
        }

        console.error("Failed to mark notification as read:", error);
        return NextResponse.json(
            playerError(PlayerErrorCode.NOTIFICATION_UPDATE_FAILED),
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }

    const params = notificationParamsSchema.safeParse(await context.params);
    if (!params.success) {
        return NextResponse.json(playerError(PlayerErrorCode.INVALID_REQUEST), { status: 422 });
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "notifications-archive-one",
        key: `user:${sessionUser.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 40,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            playerError(PlayerErrorCode.RATE_LIMITED),
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const result = await archiveNotificationForUser(params.data.id, sessionUser.id);
    if (!result.updated) {
        return NextResponse.json(playerError(PlayerErrorCode.NOTIFICATION_NOT_FOUND), { status: 404 });
    }

    return NextResponse.json(result, { headers: buildRateLimitHeaders(rateLimit) });
}
