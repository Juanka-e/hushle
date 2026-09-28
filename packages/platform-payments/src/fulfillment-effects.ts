import { getRedisKey, invalidateJsonCache } from "@hushle/platform-cache";
import { Prisma, prisma, type PaymentProvider } from "@hushle/platform-db";
import { PaymentWebhookProcessingError } from "./webhook-inbox";

function processingError(code: string, retryable = false): PaymentWebhookProcessingError {
    return new PaymentWebhookProcessingError(code, retryable);
}

export async function createPaymentFulfillmentNotification(
    orderId: string,
    now: Date,
    provider: PaymentProvider
): Promise<number> {
    return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id
            FROM payment_fulfillments
            WHERE order_id = ${orderId}
            FOR UPDATE
        `);
        if (rows.length !== 1) throw processingError("fulfillment_not_found", true);
        const fulfillment = await tx.paymentFulfillment.findUniqueOrThrow({
            where: { orderId },
            include: { order: true },
        });
        if (fulfillment.status !== "completed") {
            throw processingError("fulfillment_not_completed", true);
        }
        if (fulfillment.notificationSentAt) return fulfillment.order.userId;

        await tx.notification.create({
            data: {
                userId: fulfillment.order.userId,
                type: "economy",
                title: "Satın alım tamamlandı",
                body: `${fulfillment.order.productNameSnapshot} hesabına eklendi.`,
                resourceType: "payment_order",
                resourceId: fulfillment.order.id,
                actionLabel: "Envanteri aç",
                actionHref: "/dashboard?tab=inventory",
                metadata: {
                    provider,
                    productKind: fulfillment.order.productKind,
                },
            },
        });
        await tx.paymentFulfillment.update({
            where: { id: fulfillment.id },
            data: { notificationSentAt: now },
        });
        return fulfillment.order.userId;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function invalidatePaymentFulfillmentCaches(userId: number): Promise<void> {
    await invalidateJsonCache(getRedisKey("cache", "notification-unread-count", "v1", userId));
}
