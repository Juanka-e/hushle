import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@hushle/platform-db";
import {
    createPaymentRefundAdapter,
    PaymentReversalError,
    recoverProviderApiRefundRequest,
} from "@hushle/platform-payments";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { writeAuditLog } from "@/lib/security/audit-log";
import { buildRateLimitHeaders, consumeRequestRateLimit, getRequestIp } from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({ confirmationRequestId: z.string().uuid() });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const admin = await requireAdminSession();
    if (admin instanceof NextResponse) return admin;
    const params = paramsSchema.safeParse(await context.params);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!params.success || !body.success || body.data.confirmationRequestId !== params.data.id) {
        return NextResponse.json({ error: "Talep onayı geçersiz." }, { status: 422 });
    }
    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-payment-refund-recovery",
        key: `admin:${admin.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 10,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json({ error: "Çok fazla iade doğrulama isteği." }, { status: 429, headers: buildRateLimitHeaders(rateLimit) });
    }
    try {
        const reversalRequest = await prisma.paymentReversalRequest.findUnique({
            where: { id: params.data.id },
            select: { order: { select: { providerOrderReference: true, provider: true } } },
        });
        if (!reversalRequest?.order.providerOrderReference) throw new PaymentReversalError("request_not_found");
        const result = await recoverProviderApiRefundRequest({
            requestId: params.data.id,
            checkedByUserId: admin.id,
            adapter: createPaymentRefundAdapter({ provider: reversalRequest.order.provider }),
        });
        await writeAuditLog({
            actor: admin,
            action: "admin.payment.refund.recover",
            resourceType: "payment_reversal_request",
            resourceId: params.data.id,
            summary: `Checked provider refund state: ${result.outcome}`,
            metadata: { outcome: result.outcome },
            request,
        });
        return NextResponse.json({ ok: true, result }, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        if (error instanceof PaymentReversalError) {
            return NextResponse.json({ error: error.code }, { status: error.code === "request_not_found" ? 404 : 409 });
        }
        console.error("Provider refund recovery failed", error);
        return NextResponse.json({ error: "İade durumu doğrulanamadı." }, { status: 502 });
    }
}
