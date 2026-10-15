import { NextResponse } from "next/server";
import {
    getEmailProviderReadiness,
    requestEmailVerification,
} from "@hushle/platform-email";
import { isEmailVerificationRestrictionActive } from "@hushle/platform-auth";
import { getSessionUser } from "@/lib/session";
import { getSystemSettings } from "@/lib/system-settings/service";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

export async function POST(request: Request) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json(playerError(PlayerErrorCode.ORIGIN_REJECTED), { status: 403 });
    }
    const user = await getSessionUser();
    if (!user) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }

    const ip = getRequestIp(request);
    const [shortLimit, dailyLimit] = await Promise.all([
        consumeDistributedRequestRateLimit({
            bucket: "email-verification-request-short",
            key: `user:${user.id}:ip:${ip}`,
            windowMs: 15 * 60_000,
            maxRequests: 3,
        }),
        consumeDistributedRequestRateLimit({
            bucket: "email-verification-request-daily",
            key: `user:${user.id}`,
            windowMs: 24 * 60 * 60_000,
            maxRequests: 5,
        }),
    ]);
    const limit = shortLimit.allowed ? dailyLimit : shortLimit;
    if (!shortLimit.allowed || !dailyLimit.allowed) {
        return NextResponse.json(
            playerError(PlayerErrorCode.RATE_LIMITED),
            {
                status: 429,
                headers: buildRateLimitHeaders(limit),
            }
        );
    }

    const settings = await getSystemSettings();
    if (
        settings.security.emailVerification.mode === "off" &&
        !isEmailVerificationRestrictionActive(user)
    ) {
        return NextResponse.json(
            playerError(PlayerErrorCode.EMAIL_VERIFICATION_DISABLED),
            { status: 409 }
        );
    }
    if (!getEmailProviderReadiness().configured) {
        return NextResponse.json(
            playerError(PlayerErrorCode.EMAIL_SERVICE_UNAVAILABLE),
            { status: 503 }
        );
    }

    const result = await requestEmailVerification({
        userId: user.id,
        siteName: settings.branding.siteName,
    });
    if (result === "already_verified") {
        return NextResponse.json({
            status: "already_verified",
            message: "E-posta adresin zaten doğrulanmış.",
        });
    }
    if (result === "email_missing") {
        return NextResponse.json(
            playerError(PlayerErrorCode.NO_EMAIL_TO_VERIFY),
            { status: 409 }
        );
    }

    return NextResponse.json(
        {
            status: "queued",
            message: "Doğrulama bağlantısı gönderim kuyruğuna alındı.",
        },
        { status: 202, headers: buildRateLimitHeaders(limit) }
    );
}
