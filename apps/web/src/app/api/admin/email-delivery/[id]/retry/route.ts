import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { retryDeadLetterEmail } from "@/lib/email-delivery/admin-service";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.string().uuid() });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const admin = await requireAdminSession();
    if (admin instanceof NextResponse) return admin;
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) return NextResponse.json({ error: "Geçersiz mesaj kimliği." }, { status: 422 });

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-email-delivery-retry",
        key: `admin:${admin.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Çok fazla yeniden deneme isteği. Lütfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const result = await retryDeadLetterEmail(parsed.data.id);
    if (!result.ok) {
        const status = result.reason === "not_found" ? 404 : 409;
        const error =
            result.reason === "suppressed"
                ? "Bu adres teslimat engeli altında. Engel incelenmeden yeniden denenemez."
                : "Mesaj artık yeniden denenebilir durumda değil.";
        return NextResponse.json({ error }, { status, headers: buildRateLimitHeaders(rateLimit) });
    }

    await writeAuditLog({
        actor: admin,
        action: "admin.email_delivery.retry",
        resourceType: "email_outbox_message",
        resourceId: result.message.id,
        summary: `retried email outbox message ${result.message.id}`,
        metadata: {
            template: result.message.template,
            previousAttemptCount: result.message.attemptCount,
        },
        request,
    });
    return NextResponse.json({ ok: true }, { headers: buildRateLimitHeaders(rateLimit) });
}
