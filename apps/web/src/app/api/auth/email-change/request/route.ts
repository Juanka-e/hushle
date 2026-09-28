import { NextResponse } from "next/server";
import { z } from "zod";
import bcryptjs from "bcryptjs";
import {
    enqueueEmailChange,
    getEmailProviderReadiness,
} from "@hushle/platform-email";
import { Prisma } from "@hushle/platform-db";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { getSystemSettings } from "@/lib/system-settings/service";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    areEmailsEqual,
    isEmailWithinLimit,
    normalizeEmail,
    sanitizeEmail,
} from "@/lib/users/email";

const requestSchema = z.object({
    newEmail: z.email("Geçerli bir e-posta adresi gir.").max(191),
    currentPassword: z.string().min(1).max(256),
});

export async function POST(request: Request) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json({ error: "Geçersiz istek." }, { status: 403 });
    }
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: "Giriş gerekli." }, { status: 401 });
    }
    const limit = await consumeDistributedRequestRateLimit({
        bucket: "email-change-request",
        key: `user:${sessionUser.id}:ip:${getRequestIp(request)}`,
        windowMs: 30 * 60_000,
        maxRequests: 3,
    });
    if (!limit.allowed) {
        return NextResponse.json(
            { error: "Çok fazla e-posta değişikliği denemesi yapıldı." },
            { status: 429, headers: buildRateLimitHeaders(limit) }
        );
    }

    try {
        const input = requestSchema.parse(await request.json());
        const newEmail = sanitizeEmail(input.newEmail);
        const normalizedNewEmail = normalizeEmail(newEmail);
        if (!isEmailWithinLimit(newEmail)) {
            return NextResponse.json(
                { error: "E-posta adresi çok uzun." },
                { status: 400 }
            );
        }
        if (!getEmailProviderReadiness().configured) {
            return NextResponse.json(
                { error: "E-posta servisi şu anda hazır değil." },
                { status: 503 }
            );
        }
        const user = await prisma.user.findUnique({
            where: { id: sessionUser.id },
            select: {
                id: true,
                email: true,
                password: true,
            },
        });
        if (
            !user ||
            !user.password ||
            !(await bcryptjs.compare(input.currentPassword, user.password))
        ) {
            return NextResponse.json(
                { error: "Mevcut parola doğrulanamadı." },
                { status: 403, headers: buildRateLimitHeaders(limit) }
            );
        }
        if (areEmailsEqual(user.email, newEmail)) {
            return NextResponse.json(
                { error: "Yeni adres mevcut e-posta adresinle aynı." },
                { status: 409 }
            );
        }
        const owner = await prisma.user.findFirst({
            where: {
                normalizedEmail: normalizedNewEmail,
                id: { not: user.id },
            },
            select: { id: true },
        });
        if (owner) {
            return NextResponse.json(
                { error: "Bu adres değişiklik için kullanılamıyor." },
                { status: 409 }
            );
        }

        const settings = await getSystemSettings();
        await prisma.$transaction((tx) =>
            enqueueEmailChange(tx, {
                userId: user.id,
                currentEmail: user.email,
                newEmail,
                normalizedNewEmail,
                siteName: settings.branding.siteName,
            })
        );
        await writeAuditLog({
            actor: { id: user.id, role: sessionUser.role },
            action: "user.email_change.request",
            resourceType: "user",
            resourceId: user.id,
            summary: "Requested a verified email address change",
            request,
        }).catch((error) =>
            console.error("Email change request audit failed", error)
        );
        return NextResponse.json(
            {
                status: "pending",
                pendingEmail: newEmail,
                message:
                    "Yeni adrese doğrulama bağlantısı gönderim kuyruğuna alındı.",
            },
            { status: 202, headers: buildRateLimitHeaders(limit) }
        );
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
            return NextResponse.json(
                {
                    error:
                        error instanceof z.ZodError
                            ? error.issues[0]?.message
                            : "Geçersiz istek.",
                },
                { status: 400 }
            );
        }
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            return NextResponse.json(
                { error: "Bu adres değişiklik için kullanılamıyor." },
                { status: 409 }
            );
        }
        console.error("Email change request failed", error);
        return NextResponse.json(
            { error: "E-posta değişikliği başlatılamadı." },
            { status: 500 }
        );
    }
}
