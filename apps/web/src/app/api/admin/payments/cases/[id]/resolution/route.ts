import { NextRequest, NextResponse } from "next/server";
import {
    PaymentCaseResolutionError,
    resolvePaymentReconciliationCase,
} from "@hushle/platform-payments";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { writeAuditLog } from "@/lib/security/audit-log";
import { buildRateLimitHeaders, consumeRequestRateLimit, getRequestIp } from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
    resolution: z.enum(["resolved", "ignored"]),
    note: z.string().trim().min(3).max(500),
    confirmationCaseId: z.string().uuid(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const admin = await requireAdminSession();
    if (admin instanceof NextResponse) return admin;
    const params = paramsSchema.safeParse(await context.params);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!params.success || !body.success || body.data.confirmationCaseId !== params.data.id) {
        return NextResponse.json({ error: "Vaka onayı geçersiz." }, { status: 422 });
    }
    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-payment-case-resolution",
        key: `admin:${admin.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json({ error: "Çok fazla vaka çözüm isteği." }, { status: 429, headers: buildRateLimitHeaders(rateLimit) });
    }
    try {
        const result = await resolvePaymentReconciliationCase({
            caseId: params.data.id,
            resolution: body.data.resolution,
            note: body.data.note,
            resolvedByUserId: admin.id,
        });
        await writeAuditLog({
            actor: admin,
            action: `admin.payment.case.${body.data.resolution}`,
            resourceType: "payment_reconciliation_case",
            resourceId: params.data.id,
            summary: `${body.data.resolution} payment reconciliation case`,
            metadata: { note: body.data.note, orderId: result.orderId },
            request,
        });
        return NextResponse.json({ ok: true }, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        if (error instanceof PaymentCaseResolutionError) {
            const status = error.code === "case_not_found" ? 404 : 409;
            return NextResponse.json({ error: error.code }, { status });
        }
        console.error("Payment case resolution failed", error);
        return NextResponse.json({ error: "Vaka çözülemedi." }, { status: 500 });
    }
}
