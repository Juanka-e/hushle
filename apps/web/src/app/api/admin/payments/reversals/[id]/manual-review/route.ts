import { NextRequest, NextResponse } from "next/server";
import {
    PaymentManualReviewError,
    resolvePaymentManualReview,
} from "@hushle/platform-payments";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
    decision: z.enum(["resolved", "waived"]),
    resolutionNote: z.string().trim().min(3).max(500),
    notifyUser: z.boolean(),
    noticeMessage: z.string().trim().max(500).optional(),
    confirmationReversalId: z.string().uuid(),
}).superRefine((value, context) => {
    if (!value.notifyUser && value.noticeMessage) {
        context.addIssue({
            code: "custom",
            path: ["noticeMessage"],
            message: "Bildirim kapalıyken mesaj gönderilemez.",
        });
    }
});

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const admin = await requireAdminSession();
    if (admin instanceof NextResponse) return admin;

    const params = paramsSchema.safeParse(await context.params);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!params.success || !body.success || body.data.confirmationReversalId !== params.data.id) {
        return NextResponse.json({ error: "Manuel inceleme onayı geçersiz." }, { status: 422 });
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-payment-manual-review-resolution",
        key: `admin:${admin.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 10,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Çok fazla manuel inceleme isteği. Lütfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const result = await resolvePaymentManualReview({
            reversalId: params.data.id,
            decision: body.data.decision,
            resolutionNote: body.data.resolutionNote,
            resolvedByUserId: admin.id,
            notifyUser: body.data.notifyUser,
            noticeMessage: body.data.noticeMessage,
        });
        await writeAuditLog({
            actor: admin,
            action: `admin.payment.manual_review.${body.data.decision}`,
            resourceType: "payment_manual_review_case",
            resourceId: result.id,
            summary: `${body.data.decision} payment manual review case`,
            metadata: {
                reversalId: params.data.id,
                reasonCode: result.reasonCode,
                unrecoveredCoin: result.unrecoveredCoin,
                notifyUser: body.data.notifyUser,
            },
            request,
        });
        return NextResponse.json({ ok: true }, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        if (error instanceof PaymentManualReviewError) {
            const status = error.code === "case_not_found" ? 404 : 409;
            return NextResponse.json({ error: error.code }, { status });
        }
        console.error("Payment manual review resolution failed", error);
        return NextResponse.json({ error: "Manuel inceleme tamamlanamadı." }, { status: 500 });
    }
}
