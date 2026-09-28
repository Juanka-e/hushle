import type { PaymentWebhookEvent } from "@hushle/platform-db";
import { fulfillPaidPaymentOrder, PaymentFulfillmentError } from "./fulfillment";
import { createPaymentFulfillmentNotification, invalidatePaymentFulfillmentCaches } from "./fulfillment-effects";
import { applyShopierVerifiedPaymentProof, ShopierPaymentProofError } from "./shopier-proof";
import { observeProviderRefund, PaymentReversalError } from "./reversal";
import { PaymentWebhookProcessingError } from "./webhook-inbox";

type Metadata = { productId: string; productTitle: string; buyerEmailHmac: string };

function failure(code: string, retryable = false): PaymentWebhookProcessingError {
    return new PaymentWebhookProcessingError(code, retryable);
}

function readMetadata(event: PaymentWebhookEvent): Metadata {
    const value = event.metadata;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("shopier_metadata_missing");
    const metadata = value as Record<string, unknown>;
    if (
        typeof metadata.productId !== "string" || !/^\d{1,64}$/.test(metadata.productId)
        || typeof metadata.productTitle !== "string" || metadata.productTitle.length > 240
        || typeof metadata.buyerEmailHmac !== "string" || !/^[a-f0-9]{64}$/.test(metadata.buyerEmailHmac)
    ) throw failure("shopier_metadata_invalid");
    return metadata as Metadata;
}

async function applyOutcome(event: PaymentWebhookEvent, webhookToken: string, now: Date): Promise<{
    action: "fulfill" | "duplicate" | "review";
    order: Awaited<ReturnType<typeof applyShopierVerifiedPaymentProof>>["order"];
}> {
    if (event.provider !== "shopier_v2" || event.outcome !== "payment_succeeded") {
        throw failure("shopier_outcome_not_supported");
    }
    if (!event.providerOrderReference || !event.providerPaymentReference) {
        throw failure("shopier_reference_missing");
    }
    if (event.amountMinor === null || !event.currency) throw failure("shopier_amount_missing");
    const amountMinor = event.amountMinor;
    const currency = event.currency;
    const providerOrderReference = event.providerOrderReference;
    const metadata = readMetadata(event);
    try {
        return await applyShopierVerifiedPaymentProof({
            productId: metadata.productId,
            productTitle: metadata.productTitle,
            buyerEmailHmac: metadata.buyerEmailHmac,
            providerOrderReference,
            amountMinor,
            currency,
            occurredAt: event.occurredAt ?? now,
            webhookToken,
            now,
            webhookEventId: event.id,
        });
    } catch (error) {
        if (error instanceof ShopierPaymentProofError) throw failure(error.code, error.retryable);
        throw error;
    }
}

export async function processShopierPaymentWebhook(
    event: PaymentWebhookEvent,
    input: { webhookToken: string; now?: Date }
): Promise<"processed" | "ignored"> {
    if (event.outcome === "ignored") return "ignored";
    const now = input.now ?? new Date();
    if (event.outcome === "refund") {
        const metadata = event.metadata;
        const refundStatus = metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>).refundStatus
            : null;
        const refundType = metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>).refundType
            : null;
        const refundCreatedAtEpochMs = metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>).refundCreatedAtEpochMs
            : null;
        if (
            !event.providerOrderReference
            || !event.providerPaymentReference
            || event.amountMinor === null
            || !event.currency
            || !["pending", "failed", "succeeded"].includes(String(refundStatus))
            || !["full", "partial"].includes(String(refundType))
            || typeof refundCreatedAtEpochMs !== "number"
            || !Number.isFinite(refundCreatedAtEpochMs)
        ) throw failure("shopier_refund_metadata_invalid");
        try {
            await observeProviderRefund({
                provider: "shopier_v2",
                providerOrderReference: event.providerOrderReference,
                providerRefundReference: event.providerPaymentReference,
                amountMinor: event.amountMinor,
                currency: event.currency,
                status: refundStatus as "pending" | "failed" | "succeeded",
                refundType: refundType as "full" | "partial",
                refundCreatedAt: new Date(refundCreatedAtEpochMs),
                now,
            });
            return "processed";
        } catch (error) {
            if (error instanceof PaymentReversalError) throw failure(`shopier_refund_${error.code}`);
            throw error;
        }
    }
    const result = await applyOutcome(event, input.webhookToken, now);
    if (result.action === "review") return "ignored";
    try {
        await fulfillPaidPaymentOrder({ orderId: result.order.id, now });
        const userId = await createPaymentFulfillmentNotification(result.order.id, now, "shopier_v2");
        await invalidatePaymentFulfillmentCaches(userId).catch(() => undefined);
        return "processed";
    } catch (error) {
        if (error instanceof PaymentFulfillmentError) {
            throw failure(`fulfillment_${error.code}`, error.retryable);
        }
        throw failure("fulfillment_internal_error", true);
    }
}
