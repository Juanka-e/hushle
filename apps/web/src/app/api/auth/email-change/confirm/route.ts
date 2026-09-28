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

const confirmSchema = z.object({
    token: z.string().trim().min(40).max(160),
});

export async function POST(request: Request) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json({ error: "Geçersiz istek." }, { status: 403 });
    }
    const limit = await consumeDistributedRequestRateLimit({
        bucket: "email-change-confirm",
        key: `ip:${getRequestIp(request)}`,
        windowMs: 15 * 60_000,
        maxRequests: 15,
    });
    if (!limit.allowed) {
        return NextResponse.json(
            { error: "Çok fazla doğrulama denemesi yapıldı." },
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
                {
                    error:
                        "Bağlantı geçersiz, süresi dolmuş veya değişiklik artık kullanılamıyor.",
                },
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
                { error: "Geçersiz doğrulama isteği." },
                { status: 400 }
            );
        }
        console.error("Email change confirmation failed", error);
        return NextResponse.json(
            { error: "E-posta adresi değiştirilemedi." },
            { status: 500 }
        );
    }
}
