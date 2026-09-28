import { timingSafeEqual } from "node:crypto";
import { Prisma, prisma, type PaymentOrder } from "@hushle/platform-db";
import { buildShopierBuyerEmailHmac } from "./adapters/shopier-webhook";
import { assertPaymentOrderTransition } from "./order-state-machine";

export class ShopierPaymentProofError extends Error {
    constructor(public readonly code: string, public readonly retryable = false) {
        super(code);
        this.name = "ShopierPaymentProofError";
    }
}

function hashesMatch(left: string, right: string): boolean {
    const a = Buffer.from(left, "hex");
    const b = Buffer.from(right, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
}

export async function applyShopierVerifiedPaymentProof(input: {
    productId: string;
    productTitle: string;
    buyerEmailHmac: string;
    providerOrderReference: string;
    amountMinor: number;
    currency: string;
    occurredAt: Date;
    webhookToken: string;
    now: Date;
    webhookEventId?: string;
}): Promise<{ action: "fulfill" | "duplicate" | "review"; order: PaymentOrder }> {
    return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM payment_orders
            WHERE provider = 'shopier_v2' AND provider_session_reference = ${input.productId}
            FOR UPDATE
        `);
        if (rows.length !== 1) throw new ShopierPaymentProofError("shopier_order_not_found");
        const orderId = rows[0].id;
        const order = await tx.paymentOrder.findUniqueOrThrow({
            where: { id: orderId },
            include: { user: { select: { email: true, normalizedEmail: true } } },
        });
        if (input.webhookEventId) {
            await tx.paymentWebhookEvent.update({
                where: { id: input.webhookEventId },
                data: { orderId },
            });
        }
        if (
            input.amountMinor !== order.totalAmountMinor
            || input.currency.toUpperCase() !== order.currency.toUpperCase()
            || input.productTitle !== `${order.productNameSnapshot} [${order.id.slice(0, 8)}]`
        ) throw new ShopierPaymentProofError("shopier_order_proof_mismatch");
        if (
            input.occurredAt.getTime() < order.createdAt.getTime() - 5 * 60_000
            || input.occurredAt.getTime() > input.now.getTime() + 5 * 60_000
        ) throw new ShopierPaymentProofError("shopier_event_time_mismatch");
        const email = order.user.normalizedEmail ?? order.user.email?.trim().toLowerCase();
        const emailMatches = Boolean(email && hashesMatch(
            input.buyerEmailHmac,
            buildShopierBuyerEmailHmac(email, input.webhookToken)
        ));
        if (!emailMatches) {
            await tx.paymentReconciliationCase.upsert({
                where: { orderId },
                create: {
                    orderId,
                    reasonCode: "shopier_buyer_email_mismatch",
                    lastErrorCode: "manual_review_required",
                    nextCheckAt: null,
                },
                update: {
                    status: "open",
                    reasonCode: "shopier_buyer_email_mismatch",
                    lastErrorCode: "manual_review_required",
                    nextCheckAt: null,
                },
            });
            return { action: "review", order };
        }
        if (order.status === "paid" || order.status === "fulfilled") {
            return { action: "duplicate", order };
        }
        if (order.status !== "awaiting_payment") {
            throw new ShopierPaymentProofError("shopier_order_state_conflict", true);
        }
        assertPaymentOrderTransition(order.status, "paid");
        const existingProof = await tx.paymentCheckoutVerification.findUnique({ where: { orderId } });
        if (existingProof) throw new ShopierPaymentProofError("shopier_verification_conflict");
        await tx.paymentCheckoutVerification.create({
            data: {
                orderId,
                provider: "shopier_v2",
                providerPaymentReference: input.providerOrderReference,
                amountMinor: order.totalAmountMinor,
                paidAmountMinor: input.amountMinor,
                currency: input.currency,
                providerPaymentStatus: "paid",
                verifiedAt: input.occurredAt,
            },
        });
        const paid = await tx.paymentOrder.update({
            where: { id: orderId },
            data: {
                status: "paid",
                providerOrderReference: input.providerOrderReference,
                paidAt: input.occurredAt,
                providerHostedUrl: null,
                version: { increment: 1 },
            },
        });
        return { action: "fulfill", order: paid };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
