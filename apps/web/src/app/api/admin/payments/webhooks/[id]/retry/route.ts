import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@hushle/platform-db";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { writeAuditLog } from "@/lib/security/audit-log";
import { buildRateLimitHeaders, consumeRequestRateLimit, getRequestIp } from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({ confirmationEventId: z.string().uuid() });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const admin = await requireAdminSession();
    if (admin instanceof NextResponse) return admin;
    const params = paramsSchema.safeParse(await context.params);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!params.success || !body.success || body.data.confirmationEventId !== params.data.id) {
        return NextResponse.json({ error: "Webhook onayı geçersiz." }, { status: 422 });
    }
    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-payment-webhook-retry",
        key: `admin:${admin.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) return NextResponse.json({ error: "Çok fazla retry isteği." }, { status: 429 });
    const previous = await prisma.paymentWebhookEvent.findUnique({ where: { id: params.data.id } });
    if (!previous) return NextResponse.json({ error: "Webhook bulunamadı." }, { status: 404 });
    const updated = await prisma.paymentWebhookEvent.updateMany({
        where: { id: params.data.id, status: "dead_letter" },
        data: {
            status: "retry",
            attemptCount: 0,
            availableAt: new Date(),
            claimToken: null,
            claimedAt: null,
            claimExpiresAt: null,
            lastErrorCode: null,
        },
    });
    if (updated.count !== 1) return NextResponse.json({ error: "Webhook artık dead-letter durumunda değil." }, { status: 409 });
    await writeAuditLog({
        actor: admin,
        action: "admin.payment.webhook.retry",
        resourceType: "payment_webhook_event",
        resourceId: previous.id,
        summary: "Retried dead-letter payment webhook",
        metadata: { previousAttemptCount: previous.attemptCount, previousErrorCode: previous.lastErrorCode },
        request,
    });
    return NextResponse.json({ ok: true }, { headers: buildRateLimitHeaders(rateLimit) });
}
