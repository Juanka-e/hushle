import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmEmailVerification } from "@hushle/platform-email";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";

const confirmSchema = z.object({
    token: z.string().trim().min(40).max(160),
});

export async function POST(request: Request) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json({ error: "Geçersiz istek." }, { status: 403 });
    }
    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "email-verification-confirm",
        key: `ip:${getRequestIp(request)}`,
        windowMs: 10 * 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            {
                error:
                    "Çok fazla doğrulama denemesi yapıldı. Lütfen daha sonra tekrar deneyin.",
            },
            {
                status: 429,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    }

    try {
        const input = confirmSchema.parse(await request.json());
        const result = await confirmEmailVerification({
            token: input.token,
        });
        if (!result.ok) {
            return NextResponse.json(
                {
                    error:
                        "Doğrulama bağlantısı geçersiz, süresi dolmuş veya daha önce kullanılmış.",
                },
                {
                    status: 400,
                    headers: buildRateLimitHeaders(rateLimit),
                }
            );
        }

        try {
            await writeAuditLog({
                actor: { id: result.userId, role: "user" },
                action: "user.email.verify",
                resourceType: "user",
                resourceId: result.userId,
                summary: "Verified account email address",
                metadata: {
                    verificationMethod: "email_link",
                },
                request,
            });
        } catch (error) {
            console.error("Email verification audit could not be written", error);
        }
        return NextResponse.json(
            { ok: true },
            { headers: buildRateLimitHeaders(rateLimit) }
        );
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
            return NextResponse.json(
                { error: "Geçersiz doğrulama isteği." },
                {
                    status: 400,
                    headers: buildRateLimitHeaders(rateLimit),
                }
            );
        }
        return NextResponse.json(
            { error: "E-posta doğrulanamadı." },
            {
                status: 500,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    }
}
