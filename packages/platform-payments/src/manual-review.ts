import { getRedisKey, invalidateJsonCache } from "@hushle/platform-cache";
import { Prisma, prisma } from "@hushle/platform-db";
import { z } from "zod";

const DEFAULT_NOTICE = "Ödeme işleminizle ilgili inceleme tamamlandı. Sorunuz varsa destek bölümünden bize ulaşabilirsiniz.";
const resolutionSchema = z.object({
    reversalId: z.string().uuid(),
    decision: z.enum(["resolved", "waived"]),
    resolutionNote: z.string().trim().min(3).max(500),
    resolvedByUserId: z.number().int().positive(),
    notifyUser: z.boolean().default(false),
    noticeMessage: z.string().trim().max(500).optional(),
    now: z.date().optional(),
});

export class PaymentManualReviewError extends Error {
    constructor(public readonly code:
        | "invalid_input"
        | "case_not_found"
        | "case_not_open"
        | "reversal_not_manual_review"
        | "admin_actor_required"
    ) {
        super(code);
        this.name = "PaymentManualReviewError";
    }
}

export async function resolvePaymentManualReview(
    input: z.input<typeof resolutionSchema>
) {
    const parsed = resolutionSchema.safeParse(input);
    if (!parsed.success) throw new PaymentManualReviewError("invalid_input");
    const value = parsed.data;
    const initial = await prisma.paymentManualReviewCase.findUnique({
        where: { reversalId: value.reversalId },
        select: { reversal: { select: { orderId: true } } },
    });
    if (!initial) throw new PaymentManualReviewError("case_not_found");
    const now = value.now ?? new Date();
    const noticeMessage = value.notifyUser
        ? value.noticeMessage?.trim() || DEFAULT_NOTICE
        : null;

    const result = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM payment_orders WHERE id = ${initial.reversal.orderId} FOR UPDATE
        `);
        if (rows.length !== 1) throw new PaymentManualReviewError("case_not_found");
        const actor = await tx.user.findUnique({
            where: { id: value.resolvedByUserId },
            select: { role: true },
        });
        if (actor?.role !== "admin") throw new PaymentManualReviewError("admin_actor_required");
        const reviewCase = await tx.paymentManualReviewCase.findUnique({
            where: { reversalId: value.reversalId },
            include: {
                reversal: {
                    select: { status: true, order: { select: { userId: true } } },
                },
            },
        });
        if (!reviewCase) throw new PaymentManualReviewError("case_not_found");
        if (reviewCase.status !== "open") throw new PaymentManualReviewError("case_not_open");
        if (reviewCase.reversal.status !== "manual_review") {
            throw new PaymentManualReviewError("reversal_not_manual_review");
        }

        if (noticeMessage) {
            await tx.notification.create({
                data: {
                    userId: reviewCase.reversal.order.userId,
                    type: "economy",
                    title: "Ödeme incelemesi güncellendi",
                    body: noticeMessage,
                    resourceType: "payment_manual_review_case",
                    resourceId: reviewCase.id,
                    metadata: { decision: value.decision },
                },
            });
        }
        const updated = await tx.paymentManualReviewCase.update({
            where: { id: reviewCase.id },
            data: {
                status: value.decision,
                resolutionNote: value.resolutionNote,
                resolvedByUserId: value.resolvedByUserId,
                resolvedAt: now,
                noticeMessage,
                noticeSentAt: noticeMessage ? now : null,
            },
        });
        return { reviewCase: updated, userId: reviewCase.reversal.order.userId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    if (noticeMessage) {
        await invalidateJsonCache(
            getRedisKey("cache", "notification-unread-count", "v1", result.userId)
        ).catch(() => undefined);
    }
    return result.reviewCase;
}
