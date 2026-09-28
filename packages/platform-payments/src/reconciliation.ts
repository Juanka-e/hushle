import { Prisma, prisma, type PaymentOrder, type PaymentProvider } from "@hushle/platform-db";
import { createHash } from "node:crypto";
import type { IyzicoCredentials } from "./adapters/iyzico";
import {
    isAllowedShopierHostedUrl,
    listShopierCustomListings,
    listShopierPaidOrdersByProduct,
    parseShopierMinorUnits,
    ShopierAdapterError,
    type ShopierCredentials,
    type ShopierPaidOrder,
    type ShopierProduct,
} from "./adapters/shopier";
import { buildShopierBuyerEmailHmac } from "./adapters/shopier-webhook";
import {
    PaytrAdapterError,
    queryPaytrPaymentStatus,
    type PaytrCredentials,
    type PaytrStatusQueryResult,
} from "./adapters/paytr";
import { fulfillPaidPaymentOrder } from "./fulfillment";
import {
    IyzicoCheckoutError,
    verifyIyzicoSandboxCheckoutResult,
} from "./iyzico-checkout";
import { assertPaymentOrderTransition } from "./order-state-machine";
import {
    createPaymentFulfillmentNotification,
    invalidatePaymentFulfillmentCaches,
} from "./fulfillment-effects";
import { applyShopierVerifiedPaymentProof, ShopierPaymentProofError } from "./shopier-proof";

export interface PaymentReconciliationConfig {
    batchSize: number;
    minAgeMinutes: number;
    retryDelayMinutes: number;
    maxAttempts: number;
}

export type PaytrStatusQuery = (input: {
    merchantOrderId: string;
    credentials: PaytrCredentials;
}) => Promise<PaytrStatusQueryResult>;

function paytrCredentialsFromEnvironment(
    environment: Readonly<Record<string, string | undefined>>
): PaytrCredentials {
    return {
        merchantId: environment.PAYTR_MERCHANT_ID ?? "",
        merchantKey: environment.PAYTR_MERCHANT_KEY ?? "",
        merchantSalt: environment.PAYTR_MERCHANT_SALT ?? "",
    };
}

function iyzicoCredentialsFromEnvironment(
    environment: Readonly<Record<string, string | undefined>>
): IyzicoCredentials {
    return {
        apiKey: environment.IYZICO_API_KEY ?? "",
        secretKey: environment.IYZICO_SECRET_KEY ?? "",
    };
}

function shopierCredentialsFromEnvironment(
    environment: Readonly<Record<string, string | undefined>>
): ShopierCredentials {
    return { personalAccessToken: environment.SHOPIER_PERSONAL_ACCESS_TOKEN ?? "" };
}

function isIyzicoReconciliationEnabled(
    environment: Readonly<Record<string, string | undefined>>
): boolean {
    return environment.IYZICO_CHECKOUT_MODE?.trim().toLowerCase() === "sandbox"
        && environment.IYZICO_RECONCILIATION_MODE?.trim().toLowerCase() === "sandbox";
}

function isShopierReconciliationEnabled(
    environment: Readonly<Record<string, string | undefined>>
): boolean {
    return environment.SHOPIER_CHECKOUT_MODE?.trim().toLowerCase() === "live"
        && environment.SHOPIER_WEBHOOK_MODE?.trim().toLowerCase() === "live"
        && environment.SHOPIER_RECONCILIATION_MODE?.trim().toLowerCase() === "live"
        && /^[\x21-\x7e]{20,2048}$/.test(environment.SHOPIER_PERSONAL_ACCESS_TOKEN ?? "")
        && /^[\x21-\x7e]{20,2048}$/.test(environment.SHOPIER_WEBHOOK_TOKEN ?? "");
}

async function upsertCase(input: {
    orderId: string;
    reasonCode: string;
    snapshot?: Prisma.InputJsonValue;
    errorCode?: string;
    now: Date;
    retryDelayMinutes: number;
}): Promise<void> {
    const nextCheckAt = new Date(input.now.getTime() + input.retryDelayMinutes * 60_000);
    await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM payment_orders WHERE id = ${input.orderId} FOR UPDATE
        `);
        if (rows.length !== 1) return;
        await tx.paymentReconciliationCase.upsert({
            where: { orderId: input.orderId },
            create: {
                orderId: input.orderId,
                status: "open",
                reasonCode: input.reasonCode,
                attemptCount: 1,
                providerSnapshot: input.snapshot,
                lastErrorCode: input.errorCode,
                lastCheckedAt: input.now,
                nextCheckAt,
            },
            update: {
                status: "open",
                reasonCode: input.reasonCode,
                attemptCount: { increment: 1 },
                providerSnapshot: input.snapshot,
                lastErrorCode: input.errorCode,
                lastCheckedAt: input.now,
                nextCheckAt,
                resolvedAt: null,
                resolvedByUserId: null,
                resolutionNote: null,
            },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

async function markPaid(order: PaymentOrder, now: Date): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM payment_orders WHERE id = ${order.id} FOR UPDATE
        `);
        if (rows.length !== 1) return false;
        const current = await tx.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
        if (current.status === "paid" || current.status === "fulfilled") return false;
        if (current.status !== "awaiting_payment") return false;
        assertPaymentOrderTransition(current.status, "paid");
        await tx.paymentOrder.update({
            where: { id: current.id },
            data: {
                status: "paid",
                paidAt: now,
                providerSessionReference: null,
                providerHostedUrl: null,
                version: { increment: 1 },
            },
        });
        await tx.paymentReconciliationCase.upsert({
            where: { orderId: current.id },
            create: {
                orderId: current.id,
                status: "resolved",
                reasonCode: "provider_paid",
                attemptCount: 1,
                lastCheckedAt: now,
                resolvedAt: now,
                resolutionNote: "provider_status_confirmed_paid",
            },
            update: {
                status: "resolved",
                reasonCode: "provider_paid",
                attemptCount: { increment: 1 },
                lastErrorCode: null,
                lastCheckedAt: now,
                nextCheckAt: null,
                resolvedAt: now,
                resolutionNote: "provider_status_confirmed_paid",
            },
        });
        return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

async function resolveCase(orderId: string, now: Date, note: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM payment_orders WHERE id = ${orderId} FOR UPDATE
        `);
        if (rows.length !== 1) return;
        await tx.paymentReconciliationCase.upsert({
            where: { orderId },
            create: {
                orderId,
                status: "resolved",
                reasonCode: "provider_paid",
                attemptCount: 1,
                lastCheckedAt: now,
                resolvedAt: now,
                resolutionNote: note,
            },
            update: {
                status: "resolved",
                reasonCode: "provider_paid",
                attemptCount: { increment: 1 },
                lastErrorCode: null,
                lastCheckedAt: now,
                nextCheckAt: null,
                resolvedAt: now,
                resolutionNote: note,
            },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

async function finishVerifiedOrder(
    order: PaymentOrder,
    now: Date,
    provider: PaymentProvider
): Promise<"fulfilled" | "unchanged"> {
    if (order.status === "paid") {
        await fulfillPaidPaymentOrder({ orderId: order.id, now });
    } else if (order.status !== "fulfilled") {
        return "unchanged";
    }
    const userId = await createPaymentFulfillmentNotification(order.id, now, provider);
    await invalidatePaymentFulfillmentCaches(userId);
    await resolveCase(order.id, now, "fulfillment_and_notification_completed");
    return "fulfilled";
}

function snapshot(result: Extract<PaytrStatusQueryResult, { status: "success" }>) {
    return {
        schemaVersion: 1,
        paymentAmountMinor: result.paymentAmountMinor,
        paymentTotalMinor: result.paymentTotalMinor,
        currency: result.currency,
        testMode: result.testMode,
        returnCount: result.returnCount,
    } satisfies Prisma.InputJsonValue;
}

export async function reconcilePaytrOrder(input: {
    order: PaymentOrder;
    credentials: PaytrCredentials;
    query?: PaytrStatusQuery;
    now: Date;
    retryDelayMinutes: number;
}): Promise<"fulfilled" | "review" | "unchanged"> {
    if (input.order.status === "paid" || input.order.status === "fulfilled") {
        return finishVerifiedOrder(input.order, input.now, "paytr");
    }
    const reference = input.order.providerOrderReference;
    if (!reference) {
        await upsertCase({
            orderId: input.order.id,
            reasonCode: "provider_reference_missing",
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }

    let result: PaytrStatusQueryResult;
    try {
        result = await (input.query ?? queryPaytrPaymentStatus)({
            merchantOrderId: reference,
            credentials: input.credentials,
        });
    } catch (error) {
        await upsertCase({
            orderId: input.order.id,
            reasonCode: "provider_query_failed",
            errorCode: error instanceof PaytrAdapterError ? error.code : "provider_unavailable",
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }

    if (result.status === "error") {
        await upsertCase({
            orderId: input.order.id,
            reasonCode: "provider_order_not_confirmed",
            errorCode: result.errorCode,
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }
    const providerSnapshot = snapshot(result);
    const mismatch = result.paymentAmountMinor !== input.order.totalAmountMinor
        || result.currency !== input.order.currency.toUpperCase()
        || result.testMode !== true;
    if (mismatch || result.returnCount > 0) {
        await upsertCase({
            orderId: input.order.id,
            reasonCode: result.returnCount > 0 ? "provider_return_detected" : "provider_payment_mismatch",
            snapshot: providerSnapshot,
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }

    const transitioned = await markPaid(input.order, input.now);
    if (!transitioned) return "unchanged";
    return finishVerifiedOrder({ ...input.order, status: "paid", paidAt: input.now }, input.now, "paytr");
}

export type IyzicoCheckoutVerification = (input: {
    orderId: string;
    token: string;
    credentials: IyzicoCredentials;
    now?: Date;
}) => Promise<{
    orderId: string;
    providerPaymentReference: string;
    paymentStatus: string;
    fraudStatus: number;
    providerReportedSuccess: boolean;
}>;

function iyzicoSnapshot(result: Awaited<ReturnType<IyzicoCheckoutVerification>>): Prisma.InputJsonValue {
    return {
        schemaVersion: 1,
        providerPaymentReference: result.providerPaymentReference,
        paymentStatus: result.paymentStatus,
        fraudStatus: result.fraudStatus,
    };
}

async function hasExactIyzicoProof(
    order: PaymentOrder,
    expectedPaymentReference?: string
): Promise<boolean> {
    const proof = await prisma.paymentCheckoutVerification.findUnique({ where: { orderId: order.id } });
    return Boolean(
        proof
        && proof.provider === "iyzico"
        && (!expectedPaymentReference || proof.providerPaymentReference === expectedPaymentReference)
        && proof.amountMinor === order.totalAmountMinor
        && proof.paidAmountMinor === order.totalAmountMinor
        && proof.currency.toUpperCase() === order.currency.toUpperCase()
        && proof.providerPaymentStatus === "SUCCESS"
        && proof.providerRiskStatus === 1
    );
}

export async function reconcileIyzicoOrder(input: {
    order: PaymentOrder;
    credentials: IyzicoCredentials;
    verify?: IyzicoCheckoutVerification;
    now: Date;
    retryDelayMinutes: number;
}): Promise<"fulfilled" | "review" | "unchanged"> {
    if (input.order.provider !== "iyzico") return "unchanged";
    if (input.order.status === "paid" || input.order.status === "fulfilled") {
        if (!await hasExactIyzicoProof(input.order)) {
            await upsertCase({
                orderId: input.order.id,
                reasonCode: "provider_proof_missing",
                errorCode: "iyzico_exact_proof_required",
                now: input.now,
                retryDelayMinutes: input.retryDelayMinutes,
            });
            return "review";
        }
        return finishVerifiedOrder(input.order, input.now, "iyzico");
    }
    if (input.order.status !== "awaiting_payment" && input.order.status !== "pending_provider") {
        return "unchanged";
    }
    if (!input.order.providerSessionReference) {
        await upsertCase({
            orderId: input.order.id,
            reasonCode: "iyzico_initialize_uncertain_manual_review",
            errorCode: "provider_session_missing",
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }

    let verification: Awaited<ReturnType<IyzicoCheckoutVerification>>;
    try {
        verification = await (input.verify ?? verifyIyzicoSandboxCheckoutResult)({
            orderId: input.order.id,
            token: input.order.providerSessionReference,
            credentials: input.credentials,
            now: input.now,
        });
    } catch (error) {
        await upsertCase({
            orderId: input.order.id,
            reasonCode: "provider_query_failed",
            errorCode: error instanceof IyzicoCheckoutError ? error.code : "provider_unavailable",
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }
    if (!verification.providerReportedSuccess) {
        await upsertCase({
            orderId: input.order.id,
            reasonCode: "provider_payment_not_approved",
            snapshot: iyzicoSnapshot(verification),
            errorCode: verification.paymentStatus === "SUCCESS"
                ? "provider_risk_pending"
                : "provider_payment_failed",
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }
    if (!await hasExactIyzicoProof(input.order, verification.providerPaymentReference)) {
        await upsertCase({
            orderId: input.order.id,
            reasonCode: "provider_proof_missing",
            snapshot: iyzicoSnapshot(verification),
            errorCode: "iyzico_exact_proof_required",
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }
    if (input.order.status === "pending_provider") {
        await upsertCase({
            orderId: input.order.id,
            reasonCode: "checkout_state_conflict",
            snapshot: iyzicoSnapshot(verification),
            errorCode: "pending_provider_with_payment_proof",
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }

    const transitioned = await markPaid(input.order, input.now);
    if (transitioned) {
        return finishVerifiedOrder(
            { ...input.order, status: "paid", paidAt: input.now },
            input.now,
            "iyzico"
        );
    }
    const current = await prisma.paymentOrder.findUnique({ where: { id: input.order.id } });
    if (current?.status === "paid" || current?.status === "fulfilled") {
        return finishVerifiedOrder(current, input.now, "iyzico");
    }
    return "unchanged";
}

export type ShopierProductLookup = (input: {
    dateStart: Date;
    dateEnd: Date;
    credentials: ShopierCredentials;
}) => Promise<ShopierProduct[]>;

export type ShopierOrderLookup = (input: {
    productId: string;
    credentials: ShopierCredentials;
}) => Promise<ShopierPaidOrder[]>;

function shopierProductMatches(order: PaymentOrder, product: ShopierProduct): boolean {
    return product.title === `${order.productNameSnapshot} [${order.id.slice(0, 8)}]`
        && product.type === "digital"
        && product.customListing === true
        && product.shippingPayer === "sellerPays"
        && product.priceData.currency === order.currency.toUpperCase()
        && parseShopierMinorUnits(product.priceData.price) === order.totalAmountMinor
        && (product.stockQuantity === 0 || product.stockQuantity === 1)
        && isAllowedShopierHostedUrl(product.url, product.id);
}

async function recoverShopierListing(input: {
    order: PaymentOrder;
    credentials: ShopierCredentials;
    lookup?: ShopierProductLookup;
    now: Date;
    retryDelayMinutes: number;
}): Promise<PaymentOrder | null> {
    const latestAttempt = await prisma.paymentAttempt.findFirst({
        where: { orderId: input.order.id },
        orderBy: { attemptNumber: "desc" },
        select: { createdAt: true },
    });
    const requestTime = latestAttempt?.createdAt ?? input.order.updatedAt;
    let products: ShopierProduct[];
    try {
        products = await (input.lookup ?? listShopierCustomListings)({
            dateStart: new Date(requestTime.getTime() - 5 * 60_000),
            dateEnd: new Date(requestTime.getTime() + 5 * 60_000),
            credentials: input.credentials,
        });
    } catch (error) {
        await upsertCase({
            orderId: input.order.id,
            reasonCode: "provider_query_failed",
            errorCode: error instanceof ShopierAdapterError ? error.code : "provider_unavailable",
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return null;
    }
    const matches = products.filter((product) => shopierProductMatches(input.order, product));
    if (matches.length !== 1) {
        await upsertCase({
            orderId: input.order.id,
            reasonCode: matches.length === 0
                ? "shopier_listing_not_confirmed"
                : "shopier_listing_match_ambiguous",
            errorCode: matches.length === 0 ? "provider_result_missing" : "manual_review_required",
            snapshot: { schemaVersion: 1, matchingListingCount: matches.length },
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return null;
    }
    const product = matches[0];
    try {
        return await prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT id FROM payment_orders WHERE id = ${input.order.id} FOR UPDATE
            `);
            if (rows.length !== 1) return null;
            const current = await tx.paymentOrder.findUniqueOrThrow({ where: { id: input.order.id } });
            if (current.status === "awaiting_payment" && current.providerSessionReference) return current;
            if (current.status !== "pending_provider" || current.providerSessionReference) return null;
            assertPaymentOrderTransition("pending_provider", "awaiting_payment");
            await tx.paymentAttempt.updateMany({
                where: { orderId: current.id, status: { in: ["requested", "uncertain"] } },
                data: {
                    status: "succeeded",
                    providerRequestId: `shopier-product-sha256:${createHash("sha256").update(product.id).digest("hex")}`,
                    errorCode: null,
                },
            });
            return tx.paymentOrder.update({
                where: { id: current.id },
                data: {
                    status: "awaiting_payment",
                    providerSessionReference: product.id,
                    providerHostedUrl: product.url,
                    version: { increment: 1 },
                },
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch {
        await upsertCase({
            orderId: input.order.id,
            reasonCode: "shopier_listing_persist_uncertain",
            errorCode: "checkout_state_conflict",
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return null;
    }
}

function shopierOrderSnapshot(order: ShopierPaidOrder): Prisma.InputJsonValue {
    return {
        schemaVersion: 1,
        providerOrderReference: order.id,
        paymentStatus: order.paymentStatus,
        currency: order.currency,
        total: order.totals.total,
        refundStatuses: order.refunds.map((refund) => refund.status),
        productId: order.lineItems[0].productId,
    };
}

async function hasExactShopierProof(order: PaymentOrder): Promise<boolean> {
    const proof = await prisma.paymentCheckoutVerification.findUnique({ where: { orderId: order.id } });
    return Boolean(
        proof
        && proof.provider === "shopier_v2"
        && proof.providerPaymentReference === order.providerOrderReference
        && proof.amountMinor === order.totalAmountMinor
        && proof.paidAmountMinor === order.totalAmountMinor
        && proof.currency.toUpperCase() === order.currency.toUpperCase()
        && proof.providerPaymentStatus === "paid"
    );
}

export async function reconcileShopierOrder(input: {
    order: PaymentOrder;
    credentials: ShopierCredentials;
    webhookToken: string;
    productLookup?: ShopierProductLookup;
    orderLookup?: ShopierOrderLookup;
    now: Date;
    retryDelayMinutes: number;
}): Promise<"fulfilled" | "review" | "unchanged"> {
    if (input.order.provider !== "shopier_v2") return "unchanged";
    if (input.order.status === "paid" || input.order.status === "fulfilled") {
        if (!await hasExactShopierProof(input.order)) {
            await upsertCase({
                orderId: input.order.id,
                reasonCode: "provider_proof_missing",
                errorCode: "shopier_exact_proof_required",
                now: input.now,
                retryDelayMinutes: input.retryDelayMinutes,
            });
            return "review";
        }
        return finishVerifiedOrder(input.order, input.now, "shopier_v2");
    }
    let order = input.order;
    if (order.status === "pending_provider" && !order.providerSessionReference) {
        const recovered = await recoverShopierListing({
            order,
            credentials: input.credentials,
            lookup: input.productLookup,
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        if (!recovered) return "review";
        order = recovered;
    }
    if (order.status !== "awaiting_payment" || !order.providerSessionReference) return "unchanged";

    let providerOrders: ShopierPaidOrder[];
    try {
        providerOrders = await (input.orderLookup ?? listShopierPaidOrdersByProduct)({
            productId: order.providerSessionReference,
            credentials: input.credentials,
        });
    } catch (error) {
        await upsertCase({
            orderId: order.id,
            reasonCode: "provider_query_failed",
            errorCode: error instanceof ShopierAdapterError ? error.code : "provider_unavailable",
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }
    if (providerOrders.length !== 1) {
        await upsertCase({
            orderId: order.id,
            reasonCode: providerOrders.length === 0
                ? "provider_order_not_confirmed"
                : "shopier_order_match_ambiguous",
            errorCode: providerOrders.length === 0 ? "provider_result_missing" : "manual_review_required",
            snapshot: { schemaVersion: 1, matchingOrderCount: providerOrders.length },
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }
    const providerOrder = providerOrders[0];
    const line = providerOrder.lineItems[0];
    const total = parseShopierMinorUnits(providerOrder.totals.total);
    const exactAmounts = total !== null
        && parseShopierMinorUnits(providerOrder.totals.subtotal) === total
        && parseShopierMinorUnits(providerOrder.totals.shipping) === 0
        && parseShopierMinorUnits(providerOrder.totals.discount) === 0
        && parseShopierMinorUnits(line.price) === total
        && parseShopierMinorUnits(line.total) === total;
    const hasActiveRefund = providerOrder.refunds.some((refund) => refund.status !== "failed");
    if (
        !exactAmounts
        || total !== order.totalAmountMinor
        || providerOrder.currency !== order.currency.toUpperCase()
        || line.productId !== order.providerSessionReference
        || line.title !== `${order.productNameSnapshot} [${order.id.slice(0, 8)}]`
        || hasActiveRefund
    ) {
        await upsertCase({
            orderId: order.id,
            reasonCode: hasActiveRefund ? "provider_return_detected" : "provider_payment_mismatch",
            snapshot: shopierOrderSnapshot(providerOrder),
            errorCode: "manual_review_required",
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }
    const occurredAt = new Date(providerOrder.dateCreated);
    if (!Number.isFinite(occurredAt.getTime())) {
        await upsertCase({
            orderId: order.id,
            reasonCode: "provider_payment_mismatch",
            snapshot: shopierOrderSnapshot(providerOrder),
            errorCode: "invalid_provider_timestamp",
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }
    try {
        const result = await applyShopierVerifiedPaymentProof({
            productId: line.productId,
            productTitle: line.title,
            buyerEmailHmac: buildShopierBuyerEmailHmac(providerOrder.shippingInfo.email, input.webhookToken),
            providerOrderReference: providerOrder.id,
            amountMinor: total,
            currency: providerOrder.currency,
            occurredAt,
            webhookToken: input.webhookToken,
            now: input.now,
        });
        if (result.action === "review") return "review";
        return finishVerifiedOrder(result.order, input.now, "shopier_v2");
    } catch (error) {
        await upsertCase({
            orderId: order.id,
            reasonCode: "provider_payment_mismatch",
            snapshot: shopierOrderSnapshot(providerOrder),
            errorCode: error instanceof ShopierPaymentProofError ? error.code : "local_completion_failed",
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
        return "review";
    }
}

export async function reconcilePaymentOrder(input: {
    order: PaymentOrder;
    environment?: Readonly<Record<string, string | undefined>>;
    paytrQuery?: PaytrStatusQuery;
    iyzicoVerify?: IyzicoCheckoutVerification;
    shopierProductLookup?: ShopierProductLookup;
    shopierOrderLookup?: ShopierOrderLookup;
    now: Date;
    retryDelayMinutes: number;
}): Promise<"fulfilled" | "review" | "unchanged"> {
    const environment = input.environment ?? process.env;
    if (input.order.provider === "paytr") {
        return reconcilePaytrOrder({
            order: input.order,
            credentials: paytrCredentialsFromEnvironment(environment),
            query: input.paytrQuery,
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
    }
    if (input.order.provider === "iyzico") {
        if (!isIyzicoReconciliationEnabled(environment)) {
            throw new Error("iyzico_reconciliation_not_configured");
        }
        return reconcileIyzicoOrder({
            order: input.order,
            credentials: iyzicoCredentialsFromEnvironment(environment),
            verify: input.iyzicoVerify,
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
    }
    if (input.order.provider === "shopier_v2") {
        if (!isShopierReconciliationEnabled(environment)) {
            throw new Error("shopier_reconciliation_not_configured");
        }
        return reconcileShopierOrder({
            order: input.order,
            credentials: shopierCredentialsFromEnvironment(environment),
            webhookToken: environment.SHOPIER_WEBHOOK_TOKEN ?? "",
            productLookup: input.shopierProductLookup,
            orderLookup: input.shopierOrderLookup,
            now: input.now,
            retryDelayMinutes: input.retryDelayMinutes,
        });
    }
    return "unchanged";
}

export async function runPaymentReconciliation(input: {
    config: PaymentReconciliationConfig;
    dryRun: boolean;
    environment?: Readonly<Record<string, string | undefined>>;
    query?: PaytrStatusQuery;
    iyzicoVerify?: IyzicoCheckoutVerification;
    shopierProductLookup?: ShopierProductLookup;
    shopierOrderLookup?: ShopierOrderLookup;
    now?: Date;
}) {
    const now = input.now ?? new Date();
    const environment = input.environment ?? process.env;
    const cutoff = new Date(now.getTime() - input.config.minAgeMinutes * 60_000);
    const enabledProviders: PaymentProvider[] = ["paytr"];
    if (isIyzicoReconciliationEnabled(environment)) enabledProviders.push("iyzico");
    if (isShopierReconciliationEnabled(environment)) enabledProviders.push("shopier_v2");
    const orders = await prisma.paymentOrder.findMany({
        where: {
            provider: { in: enabledProviders },
            createdAt: { lte: cutoff },
            OR: [
                {
                    provider: { in: ["iyzico", "shopier_v2"] },
                    status: "pending_provider",
                    reconciliationCase: {
                        status: "open",
                        attemptCount: { lt: input.config.maxAttempts },
                        nextCheckAt: { lte: now },
                    },
                },
                {
                    status: { in: ["awaiting_payment", "paid"] },
                    OR: [
                        { reconciliationCase: null },
                        { reconciliationCase: { status: "open", attemptCount: { lt: input.config.maxAttempts }, nextCheckAt: { lte: now } } },
                    ],
                },
                {
                    status: "fulfilled",
                    fulfillment: { notificationSentAt: null },
                    OR: [
                        { reconciliationCase: null },
                        { reconciliationCase: { status: "open", attemptCount: { lt: input.config.maxAttempts }, nextCheckAt: { lte: now } } },
                    ],
                },
            ],
        },
        orderBy: { createdAt: "asc" },
        take: input.config.batchSize,
    });
    const candidatesByProvider = {
        paytr: orders.filter((order) => order.provider === "paytr").length,
        iyzico: orders.filter((order) => order.provider === "iyzico").length,
        shopier: orders.filter((order) => order.provider === "shopier_v2").length,
    };
    if (input.dryRun) {
        return {
            dryRun: true,
            candidateCount: orders.length,
            candidatesByProvider,
            iyzicoEnabled: enabledProviders.includes("iyzico"),
            shopierEnabled: enabledProviders.includes("shopier_v2"),
        };
    }

    let fulfilled = 0;
    let review = 0;
    let unchanged = 0;
    for (const order of orders) {
        try {
            const outcome = await reconcilePaymentOrder({
                order,
                environment,
                paytrQuery: input.query,
                iyzicoVerify: input.iyzicoVerify,
                shopierProductLookup: input.shopierProductLookup,
                shopierOrderLookup: input.shopierOrderLookup,
                now,
                retryDelayMinutes: input.config.retryDelayMinutes,
            });
            if (outcome === "fulfilled") fulfilled += 1;
            else if (outcome === "review") review += 1;
            else unchanged += 1;
        } catch (error) {
            await upsertCase({
                orderId: order.id,
                reasonCode: "local_completion_failed",
                errorCode: error instanceof Error ? error.name.slice(0, 80) : "unknown_error",
                now,
                retryDelayMinutes: input.config.retryDelayMinutes,
            });
            review += 1;
        }
    }
    return {
        dryRun: false,
        candidateCount: orders.length,
        candidatesByProvider,
        iyzicoEnabled: enabledProviders.includes("iyzico"),
        shopierEnabled: enabledProviders.includes("shopier_v2"),
        fulfilled,
        review,
        unchanged,
    };
}
