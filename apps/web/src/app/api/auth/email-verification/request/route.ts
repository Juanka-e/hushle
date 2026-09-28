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

export async function POST(request: Request) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json({ error: "Geçersiz istek." }, { status: 403 });
    }
    const user = await getSessionUser();
    if (!user) {
        return NextResponse.json({ error: "Giriş gerekli." }, { status: 401 });
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
            {
                error:
                    "Çok fazla doğrulama isteği gönderdin. Daha sonra tekrar dene.",
            },
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
            { error: "E-posta doğrulaması şu anda kapalı." },
            { status: 409 }
        );
    }
    if (!getEmailProviderReadiness().configured) {
        return NextResponse.json(
            {
                error:
                    "E-posta servisi şu anda hazır değil. Lütfen daha sonra tekrar dene.",
            },
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
            { error: "Hesabında doğrulanacak bir e-posta adresi yok." },
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
