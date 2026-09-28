import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
    enqueuePasswordReset,
    getEmailProviderReadiness,
} from "@hushle/platform-email";
import { prisma } from "@/lib/prisma";
import { getSystemSettings } from "@/lib/system-settings/service";
import { verifyCaptchaForAction } from "@/lib/security/captcha";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { normalizeEmail } from "@/lib/users/email";

const requestSchema = z.object({
    identifier: z.string().trim().min(1).max(191),
    captchaToken: z.string().trim().min(1).max(2048).optional().nullable(),
});

const GENERIC_MESSAGE =
    "Bilgiler bir hesapla eşleşiyorsa parola sıfırlama bağlantısı gönderilecek.";

function identifierKey(identifier: string): string {
    return createHash("sha256")
        .update(identifier.trim().toLowerCase(), "utf8")
        .digest("hex")
        .slice(0, 32);
}

export async function POST(request: Request) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json({ error: "Geçersiz istek." }, { status: 403 });
    }

    try {
        const input = requestSchema.parse(await request.json());
        const ip = getRequestIp(request);
        const [ipLimit, identifierLimit] = await Promise.all([
            consumeDistributedRequestRateLimit({
                bucket: "password-reset-request-ip",
                key: `ip:${ip}`,
                windowMs: 15 * 60_000,
                maxRequests: 5,
            }),
            consumeDistributedRequestRateLimit({
                bucket: "password-reset-request-identifier",
                key: `id:${identifierKey(input.identifier)}`,
                windowMs: 30 * 60_000,
                maxRequests: 3,
            }),
        ]);
        const limit = ipLimit.allowed ? identifierLimit : ipLimit;
        if (!ipLimit.allowed || !identifierLimit.allowed) {
            return NextResponse.json(
                { message: GENERIC_MESSAGE },
                {
                    status: 202,
                    headers: buildRateLimitHeaders(limit),
                }
            );
        }

        const settings = await getSystemSettings();
        const captchaResult = await verifyCaptchaForAction({
            action: "password_reset",
            token: input.captchaToken ?? null,
            remoteIp: ip,
            settings,
        });
        if (!captchaResult.ok) {
            return NextResponse.json(
                { error: "Güvenlik doğrulaması başarısız." },
                { status: 403, headers: buildRateLimitHeaders(limit) }
            );
        }

        if (getEmailProviderReadiness().configured) {
            const normalizedIdentifier = normalizeEmail(input.identifier);
            const user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { username: input.identifier },
                        { normalizedEmail: normalizedIdentifier },
                    ],
                },
                select: { id: true, email: true },
            });
            if (user?.email) {
                await prisma.$transaction((tx) =>
                    enqueuePasswordReset(tx, {
                        userId: user.id,
                        email: user.email!,
                        siteName: settings.branding.siteName,
                    })
                );
            }
        }

        return NextResponse.json(
            { message: GENERIC_MESSAGE },
            { status: 202, headers: buildRateLimitHeaders(limit) }
        );
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
            return NextResponse.json(
                { error: "Geçerli bir kullanıcı adı veya e-posta gir." },
                { status: 400 }
            );
        }
        console.error("Password reset request failed", error);
        return NextResponse.json(
            { message: GENERIC_MESSAGE },
            { status: 202 }
        );
    }
}
