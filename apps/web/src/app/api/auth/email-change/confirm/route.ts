import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmEmailChange } from "@hushle/platform-email";
import { getSystemSettings } from "@/lib/system-settings/service";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { disconnectUserSockets } from "@/lib/socket/user-session-control";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

const confirmSchema = z.object({
    token: z.string().trim().min(40).max(160),
});

export async function POST(request: Request) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json(playerError(PlayerErrorCode.ORIGIN_REJECTED), { status: 403 });
    }
    const limit = await consumeDistributedRequestRateLimit({
        bucket: "email-change-confirm",
        key: `ip:${getRequestIp(request)}`,
        windowMs: 15 * 60_000,
        maxRequests: 15,
    });
    if (!limit.allowed) {
        return NextResponse.json(
            playerError(PlayerErrorCode.RATE_LIMITED),
            { status: 429, headers: buildRateLimitHeaders(limit) }
        );
    }

    try {
        const input = confirmSchema.parse(await request.json());
        const settings = await getSystemSettings();
        const result = await confirmEmailChange({
            token: input.token,
            siteName: settings.branding.siteName,
        });
        if (!result.ok) {
            return NextResponse.json(
                playerError(PlayerErrorCode.EMAIL_CHANGE_LINK_INVALID),
                { status: 400, headers: buildRateLimitHeaders(limit) }
            );
        }
        await writeAuditLog({
            actor: { id: result.userId, role: "user" },
            action: "user.email_change.confirm",
            resourceType: "user",
            resourceId: result.userId,
            summary: "Confirmed new email and revoked active sessions",
            request,
        }).catch((error) =>
            console.error("Email change confirmation audit failed", error)
        );
        await disconnectUserSockets(result.userId);
        return NextResponse.json(
            { ok: true },
            { headers: buildRateLimitHeaders(limit) }
        );
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
            return NextResponse.json(
                playerError(PlayerErrorCode.INVALID_REQUEST),
                { status: 400 }
            );
        }
        console.error("Email change confirmation failed", error);
        return NextResponse.json(
            playerError(PlayerErrorCode.EMAIL_CHANGE_CONFIRM_FAILED),
            { status: 500 }
        );
    }
}
