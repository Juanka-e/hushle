import { NextResponse } from "next/server";
import { z } from "zod";
import bcryptjs from "bcryptjs";
import { evaluatePasswordPolicy } from "@hushle/auth-policy";
import { resetPasswordWithToken } from "@hushle/platform-email";
import { getSystemSettings } from "@/lib/system-settings/service";
import { checkPasswordBreach } from "@/lib/security/password-breach";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { disconnectUserSockets } from "@/lib/socket/user-session-control";
import { PlayerErrorCode, playerError, playerErrorFromValidation } from "@/lib/errors/player-error";
import { passwordPolicyError } from "@/lib/auth/password-policy-error";

const confirmSchema = z.object({
    token: z.string().trim().min(40).max(160),
    password: z.string().max(256),
});

export async function POST(request: Request) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json(playerError(PlayerErrorCode.ORIGIN_REJECTED), { status: 403 });
    }
    const limit = await consumeDistributedRequestRateLimit({
        bucket: "password-reset-confirm",
        key: `ip:${getRequestIp(request)}`,
        windowMs: 15 * 60_000,
        maxRequests: 10,
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
        const policy = evaluatePasswordPolicy(input.password, {
            siteName: settings.branding.siteName,
        });
        if (!policy.accepted) {
            return NextResponse.json(
                passwordPolicyError(input.password, policy),
                { status: 400, headers: buildRateLimitHeaders(limit) }
            );
        }
        const breach = await checkPasswordBreach(input.password);
        if (breach.status === "breached") {
            return NextResponse.json(
                playerError(PlayerErrorCode.PASSWORD_BREACHED),
                { status: 400, headers: buildRateLimitHeaders(limit) }
            );
        }

        const passwordHash = await bcryptjs.hash(input.password, 10);
        const result = await resetPasswordWithToken({
            token: input.token,
            passwordHash,
            siteName: settings.branding.siteName,
        });
        if (!result.ok) {
            return NextResponse.json(
                playerError(PlayerErrorCode.PASSWORD_RESET_LINK_INVALID),
                { status: 400, headers: buildRateLimitHeaders(limit) }
            );
        }
        await writeAuditLog({
            actor: { id: result.userId, role: "user" },
            action: "user.password.reset",
            resourceType: "user",
            resourceId: result.userId,
            summary: "Reset account password and revoked active sessions",
            request,
        }).catch((error) =>
            console.error("Password reset audit could not be written", error)
        );
        await disconnectUserSockets(result.userId);
        return NextResponse.json(
            { ok: true },
            { headers: buildRateLimitHeaders(limit) }
        );
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
            return NextResponse.json(
                error instanceof z.ZodError
                    ? playerErrorFromValidation(error, {
                          token: PlayerErrorCode.PASSWORD_RESET_LINK_INVALID,
                          password: PlayerErrorCode.PASSWORD_TOO_LONG,
                      })
                    : playerError(PlayerErrorCode.INVALID_REQUEST),
                { status: 400, headers: buildRateLimitHeaders(limit) }
            );
        }
        console.error("Password reset confirmation failed", error);
        return NextResponse.json(
            playerError(PlayerErrorCode.PASSWORD_RESET_FAILED),
            { status: 500, headers: buildRateLimitHeaders(limit) }
        );
    }
}
