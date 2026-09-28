import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma, prisma, type PaymentOrder, type PaymentWebhookEvent } from "@hushle/platform-db";
import type { IyzicoCredentials } from "./adapters/iyzico";
import { fulfillPaidPaymentOrder, PaymentFulfillmentError } from "./fulfillment";
import {
    createPaymentFulfillmentNotification,
    invalidatePaymentFulfillmentCaches,
} from "./fulfillment-effects";
import { verifyIyzicoSandboxCheckoutResult, IyzicoCheckoutError } from "./iyzico-checkout";
import { assertPaymentOrderTransition } from "./order-state-machine";
import { PaymentWebhookProcessingError } from "./webhook-inbox";

type IyzicoOrderWithVerification = PaymentOrder & {
    checkoutVerification: {
        provider: string;
        providerPaymentReference: string;
        amountMinor: number;
        paidAmountMinor: number;
        currency: string;
        providerPaymentStatus: string;
        providerRiskStatus: number | null;
    } | null;
};

function processingError(code: string, retryable = false): PaymentWebhookProcessingError {
    return new PaymentWebhookProcessingError(code, retryable);
}

function readTokenHash(event: PaymentWebhookEvent): string {
    if (!event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata)) {
        throw processingError("token_correlation_missing");
    }
    const value = (event.metadata as Record<string, unknown>).tokenSha256;
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
        throw processingError("token_correlation_missing");
    }
    return value;
}

function tokenMatches(token: string, expectedHash: string): boolean {
    const actual = Buffer.from(createHash("sha256").update(token, "utf8").digest("hex"), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hasExactSuccessProof(order: IyzicoOrderWithVerification, event: PaymentWebhookEvent): boolean {
    const proof = order.checkoutVerification;
    return Boolean(
        proof
        && proof.provider === "iyzico"
        && event.providerPaymentReference
        && proof.providerPaymentReference === event.providerPaymentReference
        && proof.amountMinor === order.totalAmountMinor
        && proof.paidAmountMinor === order.totalAmountMinor
        && proof.currency.toUpperCase() === order.currency.toUpperCase()
        && proof.providerPaymentStatus === "SUCCESS"
        && proof.providerRiskStatus === 1
    );
}

async function lockIyzicoOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM payment_orders
        WHERE id = ${orderId} AND provider = 'iyzico'
        FOR UPDATE
    `);
    if (rows.length !== 1) throw processingError("order_not_found");
}

async function getOrderForEvent(event: PaymentWebhookEvent): Promise<IyzicoOrderWithVerification> {
    if (event.provider !== "iyzico") throw processingError("provider_not_supported");
    if (!event.providerOrderReference) throw processingError("order_reference_missing");
    if (!event.providerPaymentReference) throw processingError("payment_reference_missing");
    const order = await prisma.paymentOrder.findUnique({
        where: { id: event.providerOrderReference },
        include: { checkoutVerification: true },
    });
    if (!order || order.provider !== "iyzico") throw processingError("order_not_found");
    return order;
}

function validateActiveToken(order: PaymentOrder, event: PaymentWebhookEvent): string {
    if (!order.providerSessionReference) throw processingError("provider_session_missing");
    if (!tokenMatches(order.providerSessionReference, readTokenHash(event))) {
        throw processingError("token_correlation_mismatch");
    }
    return order.providerSessionReference;
}

function normalizeRetrieveError(error: unknown): PaymentWebhookProcessingError {
    if (error instanceof PaymentWebhookProcessingError) return error;
    if (error instanceof IyzicoCheckoutError) {
        const retryable = error.retryable
            || error.code === "provider_timeout"
            || error.code === "provider_unavailable"
            || error.code === "checkout_state_conflict";
        return processingError(`iyzico_retrieve_${error.code}`, retryable);
    }
    return processingError("iyzico_retrieve_internal_error", true);
}

async function ensureSuccessProof(input: {
    event: PaymentWebhookEvent;
    order: IyzicoOrderWithVerification;
    credentials: IyzicoCredentials;
    fetchImpl?: typeof fetch;
    now: Date;
}): Promise<void> {
    if (hasExactSuccessProof(input.order, input.event)) return;
    const token = validateActiveToken(input.order, input.event);
    try {
        const result = await verifyIyzicoSandboxCheckoutResult({
            orderId: input.order.id,
            token,
            credentials: input.credentials,
            fetchImpl: input.fetchImpl,
            now: input.now,
        });
        if (result.providerPaymentReference !== input.event.providerPaymentReference) {
            throw processingError("payment_reference_mismatch");
        }
        if (!result.providerReportedSuccess) throw processingError("provider_proof_not_ready", true);
    } catch (error) {
        throw normalizeRetrieveError(error);
    }
}

async function applyIyzicoOutcome(
    event: PaymentWebhookEvent,
    now: Date
): Promise<{ action: "fulfill" | "failed" | "duplicate"; order: PaymentOrder }> {
    if (!event.providerOrderReference) throw processingError("order_reference_missing");
    return prisma.$transaction(async (tx) => {
        await lockIyzicoOrder(tx, event.providerOrderReference!);
        const order = await tx.paymentOrder.findUniqueOrThrow({
            where: { id: event.providerOrderReference! },
            include: { checkoutVerification: true },
        });
        if (event.orderId && event.orderId !== order.id) throw processingError("event_order_conflict");
        await tx.paymentWebhookEvent.update({ where: { id: event.id }, data: { orderId: order.id } });

        if (event.outcome === "payment_failed") {
            if (order.status === "failed" || order.status === "expired") return { action: "duplicate", order };
            if (order.status === "paid" || order.status === "fulfilled") {
                throw processingError("paid_order_failure_conflict");
            }
            if (order.status === "created" || order.status === "pending_provider") {
                throw processingError("order_not_ready", true);
            }
            if (order.status !== "awaiting_payment") throw processingError("order_state_conflict");
            validateActiveToken(order, event);
            assertPaymentOrderTransition(order.status, "failed");
            const failed = await tx.paymentOrder.update({
                where: { id: order.id },
                data: {
                    status: "failed",
                    failedAt: event.occurredAt ?? now,
                    providerSessionReference: null,
                    providerHostedUrl: null,
                    version: { increment: 1 },
                },
            });
            return { action: "failed", order: failed };
        }

        if (event.outcome !== "payment_succeeded") throw processingError("outcome_not_supported");
        if (!hasExactSuccessProof(order, event)) throw processingError("provider_proof_missing", true);
        if (order.status === "paid" || order.status === "fulfilled") return { action: "duplicate", order };
        if (order.status === "created" || order.status === "pending_provider") {
            throw processingError("order_not_ready", true);
        }
        if (order.status !== "awaiting_payment") throw processingError("order_state_conflict");
        validateActiveToken(order, event);
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

function normalizeFulfillmentError(error: unknown): PaymentWebhookProcessingError {
    if (error instanceof PaymentWebhookProcessingError) return error;
    if (error instanceof PaymentFulfillmentError) {
        return processingError(`fulfillment_${error.code}`, error.retryable);
    }
    return processingError("fulfillment_internal_error", true);
}

export async function processIyzicoPaymentWebhook(
    event: PaymentWebhookEvent,
    input: { credentials: IyzicoCredentials; fetchImpl?: typeof fetch; now?: Date }
): Promise<"processed" | "ignored"> {
    if (event.provider !== "iyzico") throw processingError("provider_not_supported");
    if (event.outcome !== "payment_succeeded" && event.outcome !== "payment_failed") return "ignored";
    const now = input.now ?? new Date();
    const order = await getOrderForEvent(event);
    if (event.outcome === "payment_succeeded" && order.status !== "paid" && order.status !== "fulfilled") {
        await ensureSuccessProof({ event, order, credentials: input.credentials, fetchImpl: input.fetchImpl, now });
    }
    const result = await applyIyzicoOutcome(event, now);
    if (result.action === "failed") return "processed";
    try {
        await fulfillPaidPaymentOrder({ orderId: result.order.id, now });
        const userId = await createPaymentFulfillmentNotification(result.order.id, now, "iyzico");
        await invalidatePaymentFulfillmentCaches(userId).catch(() => undefined);
        return "processed";
    } catch (error) {
        throw normalizeFulfillmentError(error);
    }
}
