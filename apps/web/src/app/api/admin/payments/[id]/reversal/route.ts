import { NextRequest, NextResponse } from "next/server";
import {
    getPaymentRefundReadiness,
    requestExternallyConfirmedPaymentReversal,
    requestProviderApiPaymentRefund,
    PaymentReversalError,
} from "@hushle/platform-payments";
import { prisma } from "@hushle/platform-db";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { writeAuditLog } from "@/lib/security/audit-log";
import { buildRateLimitHeaders, consumeRequestRateLimit, getRequestIp } from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
    executionMode: z.enum(["externally_confirmed", "provider_api"]).default("externally_confirmed"),
    outcome: z.enum(["refund", "chargeback"]),
    externalReference: z.string().trim().max(191).optional(),
    reason: z.string().trim().min(3).max(500),
    confirmationOrderId: z.string().uuid(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const admin = await requireAdminSession();
    if (admin instanceof NextResponse) return admin;
    const params = paramsSchema.safeParse(await context.params);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!params.success || !body.success || body.data.confirmationOrderId !== params.data.id) {
        return NextResponse.json({ error: "Sipariş onayı veya ters işlem verisi geçersiz." }, { status: 422 });
    }
    if (
        (body.data.executionMode === "externally_confirmed" && (!body.data.externalReference || body.data.externalReference.length < 3))
        || (body.data.executionMode === "provider_api" && body.data.outcome !== "refund")
    ) {
        return NextResponse.json({ error: "execution_mode_conflict" }, { status: 422 });
    }
    if (body.data.executionMode === "provider_api") {
        const order = await prisma.paymentOrder.findUnique({
            where: { id: params.data.id },
            select: { provider: true },
        });
        if (!order || !getPaymentRefundReadiness(order.provider).ready) {
            return NextResponse.json({ error: "provider_refund_unavailable" }, { status: 503 });
        }
    }
    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-payment-reversal",
        key: `admin:${admin.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 10,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json({ error: "Çok fazla ters işlem isteği." }, { status: 429, headers: buildRateLimitHeaders(rateLimit) });
    }
    try {
        const result = body.data.executionMode === "provider_api"
            ? await requestProviderApiPaymentRefund({
                orderId: params.data.id,
                reason: body.data.reason,
                requestedByUserId: admin.id,
            })
            : await requestExternallyConfirmedPaymentReversal({
                orderId: params.data.id,
                outcome: body.data.outcome,
                externalReference: body.data.externalReference!,
                reason: body.data.reason,
                requestedByUserId: admin.id,
            });
        await writeAuditLog({
            actor: admin,
            action: "admin.payment.reversal.request",
            resourceType: "payment_order",
            resourceId: params.data.id,
            summary: `Requested ${body.data.executionMode} ${body.data.outcome} reversal`,
            metadata: {
                executionMode: body.data.executionMode,
                outcome: body.data.outcome,
                externalReference: result.externalReference,
                reason: body.data.reason,
                requestId: result.id,
            },
            request,
        });
        return NextResponse.json({ requestId: result.id, status: result.status }, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        if (error instanceof PaymentReversalError) {
            const status = error.code === "order_not_found" ? 404 : 409;
            return NextResponse.json({ error: error.code }, { status });
        }
        console.error("Payment reversal failed", error);
        return NextResponse.json({ error: "Ters işlem tamamlanamadı." }, { status: 500 });
    }
}
