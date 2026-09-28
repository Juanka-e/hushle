import { Prisma, prisma } from "@hushle/platform-db";
import { z } from "zod";

const resolutionSchema = z.object({
    caseId: z.string().uuid(),
    resolution: z.enum(["resolved", "ignored"]),
    note: z.string().trim().min(3).max(500),
    resolvedByUserId: z.number().int().positive(),
    now: z.date().optional(),
});

const resolvableOrderStatuses = new Set([
    "fulfilled",
    "failed",
    "expired",
    "refunded",
    "chargeback",
]);

export class PaymentCaseResolutionError extends Error {
    constructor(public readonly code:
        | "invalid_input"
        | "case_not_found"
        | "case_not_open"
        | "admin_actor_required"
        | "order_not_terminal"
    ) {
        super(code);
        this.name = "PaymentCaseResolutionError";
    }
}

export async function resolvePaymentReconciliationCase(
    input: z.input<typeof resolutionSchema>
) {
    const parsed = resolutionSchema.safeParse(input);
    if (!parsed.success) throw new PaymentCaseResolutionError("invalid_input");
    const value = parsed.data;
    const initial = await prisma.paymentReconciliationCase.findUnique({
        where: { id: value.caseId },
        select: { orderId: true },
    });
    if (!initial) throw new PaymentCaseResolutionError("case_not_found");
    const now = value.now ?? new Date();

    return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM payment_orders WHERE id = ${initial.orderId} FOR UPDATE
        `);
        if (rows.length !== 1) throw new PaymentCaseResolutionError("case_not_found");
        const actor = await tx.user.findUnique({
            where: { id: value.resolvedByUserId },
            select: { role: true },
        });
        if (actor?.role !== "admin") {
            throw new PaymentCaseResolutionError("admin_actor_required");
        }
        const reconciliationCase = await tx.paymentReconciliationCase.findUnique({
            where: { id: value.caseId },
            include: { order: { select: { status: true } } },
        });
        if (!reconciliationCase) throw new PaymentCaseResolutionError("case_not_found");
        if (reconciliationCase.status !== "open") {
            throw new PaymentCaseResolutionError("case_not_open");
        }
        if (
            value.resolution === "resolved"
            && !resolvableOrderStatuses.has(reconciliationCase.order.status)
        ) {
            throw new PaymentCaseResolutionError("order_not_terminal");
        }
        return tx.paymentReconciliationCase.update({
            where: { id: reconciliationCase.id },
            data: {
                status: value.resolution,
                resolvedAt: now,
                resolvedByUserId: value.resolvedByUserId,
                resolutionNote: value.note,
                nextCheckAt: null,
            },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
