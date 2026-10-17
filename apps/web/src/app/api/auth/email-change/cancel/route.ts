import { NextResponse } from "next/server";
import { z } from "zod";
import bcryptjs from "bcryptjs";
import { cancelPendingEmailChange } from "@hushle/platform-email";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

const cancelSchema = z.object({
    currentPassword: z.string().min(1).max(256),
});

export async function POST(request: Request) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json(playerError(PlayerErrorCode.ORIGIN_REJECTED), { status: 403 });
    }
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }
    const limit = await consumeDistributedRequestRateLimit({
        bucket: "email-change-cancel",
        key: `user:${sessionUser.id}:ip:${getRequestIp(request)}`,
        windowMs: 15 * 60_000,
        maxRequests: 5,
    });
    if (!limit.allowed) {
        return NextResponse.json(
            playerError(PlayerErrorCode.RATE_LIMITED),
            { status: 429, headers: buildRateLimitHeaders(limit) }
        );
    }

    try {
        const input = cancelSchema.parse(await request.json());
        const user = await prisma.user.findUnique({
            where: { id: sessionUser.id },
            select: { password: true },
        });
        if (
            !user ||
            !user.password ||
            !(await bcryptjs.compare(input.currentPassword, user.password))
        ) {
            return NextResponse.json(
                playerError(PlayerErrorCode.CURRENT_PASSWORD_INVALID),
                { status: 403, headers: buildRateLimitHeaders(limit) }
            );
        }
        const cancelled = await cancelPendingEmailChange({
            userId: sessionUser.id,
        });
        if (cancelled) {
            await writeAuditLog({
                actor: { id: sessionUser.id, role: sessionUser.role },
                action: "user.email_change.cancel",
                resourceType: "user",
                resourceId: sessionUser.id,
                summary: "Cancelled pending email address change",
                request,
            }).catch((error) =>
                console.error("Email change cancel audit failed", error)
            );
        }
        return NextResponse.json(
            { ok: true, cancelled },
            { headers: buildRateLimitHeaders(limit) }
        );
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
            return NextResponse.json(
                playerError(PlayerErrorCode.INVALID_REQUEST),
                { status: 400 }
            );
        }
        return NextResponse.json(
            playerError(PlayerErrorCode.EMAIL_CHANGE_CANCEL_FAILED),
            { status: 500 }
        );
    }
}
