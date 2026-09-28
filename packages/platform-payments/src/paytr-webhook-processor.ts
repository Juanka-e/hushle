import {
    Prisma,
    prisma,
    type PaymentOrder,
    type PaymentWebhookEvent,
} from "@hushle/platform-db";
import { fulfillPaidPaymentOrder, PaymentFulfillmentError } from "./fulfillment";
import {
    createPaymentFulfillmentNotification,
    invalidatePaymentFulfillmentCaches,
} from "./fulfillment-effects";
import { assertPaymentOrderTransition } from "./order-state-machine";
import {
    PaymentWebhookProcessingError,
} from "./webhook-inbox";

type OrderProcessingResult = {
    action: "fulfill" | "failed" | "duplicate";
    order: PaymentOrder;
};

function processingError(code: string, retryable = false): PaymentWebhookProcessingError {
    return new PaymentWebhookProcessingError(code, retryable);
}
function readSandboxMode(event: PaymentWebhookEvent): boolean | null {
    if (!event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata)) {
        return null;
    }
    const value = (event.metadata as Record<string, unknown>).testMode;
    return typeof value === "boolean" ? value : null;
}

async function lockOrderByProviderReference(
    tx: Prisma.TransactionClient,
    providerOrderReference: string
): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM payment_orders
        WHERE provider = 'paytr'
          AND provider_order_reference = ${providerOrderReference}
        FOR UPDATE
    `);
    if (rows.length !== 1) throw processingError("order_not_found");
    return rows[0].id;
}

function validatePaytrEvent(event: PaymentWebhookEvent, order: PaymentOrder): void {
    if (event.provider !== "paytr") throw processingError("provider_not_supported");
    if (event.amountMinor === null) throw processingError("amount_missing");
    if (event.amountMinor !== order.totalAmountMinor) throw processingError("amount_mismatch");
    if (!event.currency) throw processingError("currency_missing");
    if (event.currency.toUpperCase() !== order.currency.toUpperCase()) {
        throw processingError("currency_mismatch");
    }
    if (readSandboxMode(event) !== true) throw processingError("sandbox_mode_mismatch");
}

async function applyPaytrOrderOutcome(
    event: PaymentWebhookEvent,
    now: Date
): Promise<OrderProcessingResult> {
    if (event.provider !== "paytr") throw processingError("provider_not_supported");
    if (!event.providerOrderReference) throw processingError("order_reference_missing");
    if (event.outcome !== "payment_succeeded" && event.outcome !== "payment_failed") {
        throw processingError("reversal_not_supported");
    }

    return prisma.$transaction(async (tx) => {
        const orderId = await lockOrderByProviderReference(tx, event.providerOrderReference!);
        const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
        validatePaytrEvent(event, order);

        if (event.orderId && event.orderId !== order.id) {
            throw processingError("event_order_conflict");
        }
        await tx.paymentWebhookEvent.update({
            where: { id: event.id },
            data: { orderId: order.id },
        });

        if (event.outcome === "payment_failed") {
            if (order.status === "failed" || order.status === "expired") {
                return { action: "duplicate", order };
            }
            if (order.status === "paid" || order.status === "fulfilled") {
                throw processingError("paid_order_failure_conflict");
            }
            if (order.status === "created" || order.status === "pending_provider") {
                throw processingError("order_not_ready", true);
            }
            if (order.status !== "awaiting_payment") {
                throw processingError("order_state_conflict");
            }
            assertPaymentOrderTransition(order.status, "failed");
            const failed = await tx.paymentOrder.update({
                where: { id: order.id },
                data: {
                    status: "failed",
                    failedAt: now,
                    providerSessionReference: null,
                    providerHostedUrl: null,
                    version: { increment: 1 },
                },
            });
            return { action: "failed", order: failed };
        }

        if (order.status === "paid" || order.status === "fulfilled") {
            return { action: "duplicate", order };
        }
        if (order.status === "created" || order.status === "pending_provider") {
            throw processingError("order_not_ready", true);
        }
        if (order.status !== "awaiting_payment") {
            throw processingError("order_state_conflict");
        }
        assertPaymentOrderTransition(order.status, "paid");
        const paid = await tx.paymentOrder.update({
            where: { id: order.id },
            data: {
                status: "paid",
                paidAt: event.occurredAt ?? now,
                providerSessionReference: null,
                providerHostedUrl: null,
                version: { increment: 1 },
            },
        });
        return { action: "fulfill", order: paid };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

function normalizeFulfillmentFailure(error: unknown): PaymentWebhookProcessingError {
    if (error instanceof PaymentWebhookProcessingError) return error;
    if (error instanceof PaymentFulfillmentError) {
        return processingError(`fulfillment_${error.code}`, error.retryable);
    }
    return processingError("fulfillment_internal_error", true);
}

export async function processPaytrPaymentWebhook(
    event: PaymentWebhookEvent,
    now = new Date()
): Promise<"processed" | "ignored"> {
    const result = await applyPaytrOrderOutcome(event, now);
    if (result.action === "failed") return "processed";
    if (event.outcome !== "payment_succeeded") return "ignored";

    try {
        await fulfillPaidPaymentOrder({ orderId: result.order.id, now });
        const userId = await createPaymentFulfillmentNotification(result.order.id, now, "paytr");
        await invalidatePaymentFulfillmentCaches(userId).catch(() => undefined);
        return "processed";
    } catch (error) {
        throw normalizeFulfillmentFailure(error);
    }
}
