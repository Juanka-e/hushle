import { Prisma, prisma } from "@hushle/platform-db";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
    IyzicoAdapterError,
    requestIyzicoCheckoutForm,
    retrieveIyzicoCheckoutForm,
    type IyzicoCredentials,
} from "./adapters/iyzico";
import { assertPaymentOrderTransition } from "./order-state-machine";
import {
    buildIyzicoEphemeralBuyer,
    iyzicoCheckoutBuyerDataSchema,
    type IyzicoCheckoutBuyerData,
} from "./sensitive-checkout-data";

const REQUEST_LEASE_MS = 60_000;
const orderIdSchema = z.string().uuid();
const callbackUrlSchema = z.string().url().refine((value) => new URL(value).protocol === "https:");

export class IyzicoCheckoutError extends Error {
    constructor(
        public readonly code:
            | "invalid_request"
            | "order_not_found"
            | "order_not_eligible"
            | "checkout_in_progress"
            | "checkout_uncertain"
            | "provider_timeout"
            | "provider_unavailable"
            | "provider_rejected"
            | "invalid_provider_response"
            | "checkout_state_conflict",
        public readonly retryable = false
    ) {
        super(code);
        this.name = "IyzicoCheckoutError";
    }
}

type PreparedAttempt = {
    kind: "request";
    attemptId: string;
    attemptNumber: number;
    order: {
        id: string;
        userId: number;
        email: string;
        productKind: string;
        productNameSnapshot: string;
        totalAmountMinor: number;
        currency: string;
    };
} | {
    kind: "existing";
    orderId: string;
    paymentPageUrl: string;
} | {
    kind: "uncertain";
};

async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM payment_orders WHERE id = ${orderId} FOR UPDATE
    `);
    if (rows.length === 0) throw new IyzicoCheckoutError("order_not_found");
}

function isPersistableHostedUrl(value: string): boolean {
    if (value.length > 1_000) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:"
            && url.username === ""
            && url.password === ""
            && (url.hostname === "iyzipay.com" || url.hostname.endsWith(".iyzipay.com"));
    } catch {
        return false;
    }
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, "utf8");
    const rightBuffer = Buffer.from(right, "utf8");
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function prepareAttempt(input: {
    orderId: string;
    userId: number;
    now: Date;
}): Promise<PreparedAttempt> {
    return prisma.$transaction(async (tx) => {
        await lockOrder(tx, input.orderId);
        const order = await tx.paymentOrder.findUnique({
            where: { id: input.orderId },
            include: {
                user: { select: { email: true, emailVerifiedAt: true } },
                attempts: { orderBy: { attemptNumber: "desc" }, take: 1 },
            },
        });
        if (!order) throw new IyzicoCheckoutError("order_not_found");
        if (
            order.userId !== input.userId
            || order.provider !== "iyzico"
            || !order.user.email
            || !order.user.emailVerifiedAt
        ) throw new IyzicoCheckoutError("order_not_eligible");
        if (
            order.status === "awaiting_payment"
            && order.providerSessionReference
            && order.providerHostedUrl
            && isPersistableHostedUrl(order.providerHostedUrl)
        ) {
            return {
                kind: "existing",
                orderId: order.id,
                paymentPageUrl: order.providerHostedUrl,
            };
        }
        if (order.status !== "created" && order.status !== "pending_provider") {
            throw new IyzicoCheckoutError("order_not_eligible");
        }

        const latest = order.attempts[0];
        if (latest?.status === "uncertain") {
            return { kind: "uncertain" };
        }
        if (latest?.status === "requested") {
            const ageMs = input.now.getTime() - latest.updatedAt.getTime();
            if (ageMs < REQUEST_LEASE_MS) {
                throw new IyzicoCheckoutError("checkout_in_progress", true);
            }
            await tx.paymentAttempt.update({
                where: { id: latest.id },
                data: { status: "uncertain", errorCode: "provider_request_lease_expired" },
            });
            await tx.paymentReconciliationCase.upsert({
                where: { orderId: order.id },
                create: {
                    orderId: order.id,
                    reasonCode: "iyzico_initialize_uncertain",
                    nextCheckAt: input.now,
                },
                update: {
                    status: "open",
                    reasonCode: "iyzico_initialize_uncertain",
                    nextCheckAt: input.now,
                    resolvedAt: null,
                },
            });
            return { kind: "uncertain" };
        }

        const attemptNumber = (latest?.attemptNumber ?? 0) + 1;
        const attempt = await tx.paymentAttempt.create({
            data: {
                orderId: order.id,
                attemptNumber,
                status: "requested",
                requestFingerprint: order.requestFingerprint,
            },
        });
        if (order.status === "created") assertPaymentOrderTransition("created", "pending_provider");
        await tx.paymentOrder.update({
            where: { id: order.id },
            data: {
                status: "pending_provider",
                providerOrderReference: order.id,
                version: { increment: 1 },
            },
        });
        return {
            kind: "request",
            attemptId: attempt.id,
            attemptNumber,
            order: {
                id: order.id,
                userId: order.userId,
                email: order.user.email,
                productKind: order.productKind,
                productNameSnapshot: order.productNameSnapshot,
                totalAmountMinor: order.totalAmountMinor,
                currency: order.currency,
            },
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

async function finishFailedAttempt(attemptId: string, errorCode: string): Promise<void> {
    await prisma.paymentAttempt.updateMany({
        where: { id: attemptId, status: "requested" },
        data: { status: "failed", errorCode },
    });
}

async function finishUncertainAttempt(attemptId: string, orderId: string, errorCode: string, now: Date): Promise<void> {
    await prisma.$transaction(async (tx) => {
        await lockOrder(tx, orderId);
        const updated = await tx.paymentAttempt.updateMany({
            where: { id: attemptId, status: "requested" },
            data: { status: "uncertain", errorCode },
        });
        if (updated.count !== 1) return;
        await tx.paymentReconciliationCase.upsert({
            where: { orderId },
            create: { orderId, reasonCode: "iyzico_initialize_uncertain", lastErrorCode: errorCode, nextCheckAt: now },
            update: {
                status: "open",
                reasonCode: "iyzico_initialize_uncertain",
                lastErrorCode: errorCode,
                nextCheckAt: now,
                resolvedAt: null,
            },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

function normalizeAdapterError(error: unknown, operation: "initialize" | "retrieve"): IyzicoCheckoutError {
    if (!(error instanceof IyzicoAdapterError)) {
        return new IyzicoCheckoutError("provider_unavailable", operation === "retrieve");
    }
    if (error.code === "provider_timeout") {
        return new IyzicoCheckoutError("provider_timeout", operation === "retrieve");
    }
    if (error.code === "provider_unavailable") {
        return new IyzicoCheckoutError("provider_unavailable", operation === "retrieve");
    }
    if (error.code === "provider_rejected") return new IyzicoCheckoutError("provider_rejected");
    if (error.code === "invalid_request") return new IyzicoCheckoutError("invalid_request");
    return new IyzicoCheckoutError("invalid_provider_response");
}

export async function createIyzicoSandboxCheckoutSession(input: {
    orderId: string;
    userId: number;
    requestIp: string;
    buyerData: IyzicoCheckoutBuyerData;
    callbackUrl: string;
    credentials: IyzicoCredentials;
    fetchImpl?: typeof fetch;
    now?: Date;
}): Promise<{
    orderId: string;
    paymentPageUrl: string;
    duplicate: boolean;
    attemptNumber: number | null;
}> {
    const parsed = z.object({
        orderId: orderIdSchema,
        userId: z.number().int().positive(),
        requestIp: z.string().trim().min(3).max(64),
        buyerData: iyzicoCheckoutBuyerDataSchema,
        callbackUrl: callbackUrlSchema,
    }).safeParse(input);
    if (!parsed.success) throw new IyzicoCheckoutError("invalid_request");

    const now = input.now ?? new Date();
    const prepared = await prepareAttempt({ orderId: parsed.data.orderId, userId: parsed.data.userId, now });
    if (prepared.kind === "existing") {
        return { orderId: prepared.orderId, paymentPageUrl: prepared.paymentPageUrl, duplicate: true, attemptNumber: null };
    }
    if (prepared.kind === "uncertain") throw new IyzicoCheckoutError("checkout_uncertain");

    const ephemeral = buildIyzicoEphemeralBuyer({
        userId: prepared.order.userId,
        verifiedEmail: prepared.order.email,
        requestIp: parsed.data.requestIp,
        data: parsed.data.buyerData,
    });
    let session: Awaited<ReturnType<typeof requestIyzicoCheckoutForm>>;
    try {
        session = await requestIyzicoCheckoutForm({
            conversationId: prepared.order.id,
            amountMinor: prepared.order.totalAmountMinor,
            currency: prepared.order.currency as "TRY" | "USD" | "EUR" | "GBP" | "NOK" | "CHF",
            callbackUrl: parsed.data.callbackUrl,
            ...ephemeral,
            basketItem: {
                id: `order:${prepared.order.id.replaceAll("-", "")}`,
                name: prepared.order.productNameSnapshot,
                category: prepared.order.productKind,
            },
            credentials: input.credentials,
            fetchImpl: input.fetchImpl,
        });
        if (session.token.length > 191 || !isPersistableHostedUrl(session.paymentPageUrl)) {
            throw new IyzicoAdapterError("invalid_provider_response");
        }
    } catch (error) {
        const normalized = normalizeAdapterError(error, "initialize");
        const uncertain = normalized.code === "provider_timeout"
            || normalized.code === "provider_unavailable"
            || normalized.code === "invalid_provider_response";
        if (uncertain) {
            await finishUncertainAttempt(prepared.attemptId, prepared.order.id, normalized.code, now);
            throw new IyzicoCheckoutError("checkout_uncertain");
        }
        await finishFailedAttempt(prepared.attemptId, normalized.code);
        throw normalized;
    }

    try {
        await prisma.$transaction(async (tx) => {
            await lockOrder(tx, prepared.order.id);
            const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id: prepared.order.id } });
            const updated = await tx.paymentAttempt.updateMany({
                where: { id: prepared.attemptId, status: "requested" },
                data: {
                    status: "succeeded",
                    providerRequestId: `iyzico-token-sha256:${createHash("sha256").update(session.token).digest("hex")}`,
                    errorCode: null,
                },
            });
            if (updated.count !== 1 || order.status !== "pending_provider") {
                throw new IyzicoCheckoutError("checkout_state_conflict", true);
            }
            assertPaymentOrderTransition("pending_provider", "awaiting_payment");
            await tx.paymentOrder.update({
                where: { id: order.id },
                data: {
                    status: "awaiting_payment",
                    providerSessionReference: session.token,
                    providerHostedUrl: session.paymentPageUrl,
                    version: { increment: 1 },
                },
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
        const errorCode = error instanceof IyzicoCheckoutError
            ? error.code
            : "checkout_state_conflict";
        await finishUncertainAttempt(prepared.attemptId, prepared.order.id, errorCode, now);
        throw new IyzicoCheckoutError("checkout_uncertain");
    }

    return {
        orderId: prepared.order.id,
        paymentPageUrl: session.paymentPageUrl,
        duplicate: false,
        attemptNumber: prepared.attemptNumber,
    };
}

export async function verifyIyzicoSandboxCheckoutResult(input: {
    orderId: string;
    token: string;
    credentials: IyzicoCredentials;
    fetchImpl?: typeof fetch;
    now?: Date;
}): Promise<{
    orderId: string;
    providerPaymentReference: string;
    paymentStatus: string;
    fraudStatus: number;
    providerReportedSuccess: boolean;
}> {
    const parsed = z.object({ orderId: orderIdSchema, token: z.string().min(1).max(191) }).safeParse(input);
    if (!parsed.success) throw new IyzicoCheckoutError("invalid_request");
    const order = await prisma.paymentOrder.findUnique({ where: { id: parsed.data.orderId } });
    if (!order) throw new IyzicoCheckoutError("order_not_found");
    if (
        order.provider !== "iyzico"
        || (order.status !== "awaiting_payment" && order.status !== "pending_provider")
        || !order.providerSessionReference
        || !safeEqual(order.providerSessionReference, parsed.data.token)
    ) throw new IyzicoCheckoutError("order_not_eligible");

    let result: Awaited<ReturnType<typeof retrieveIyzicoCheckoutForm>>;
    try {
        result = await retrieveIyzicoCheckoutForm({
            conversationId: order.id,
            token: parsed.data.token,
            credentials: input.credentials,
            fetchImpl: input.fetchImpl,
        });
    } catch (error) {
        throw normalizeAdapterError(error, "retrieve");
    }
    if (
        result.paymentId.length > 191
        || result.amountMinor !== order.totalAmountMinor
        || result.paidAmountMinor !== order.totalAmountMinor
        || result.currency !== order.currency
    ) throw new IyzicoCheckoutError("invalid_provider_response");

    const verifiedAt = input.now ?? new Date();
    try {
        await prisma.$transaction(async (tx) => {
            await lockOrder(tx, order.id);
            const current = await tx.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
            if (
                current.provider !== "iyzico"
                || !current.providerSessionReference
                || !safeEqual(current.providerSessionReference, parsed.data.token)
                || current.totalAmountMinor !== result.amountMinor
                || current.currency !== result.currency
            ) throw new IyzicoCheckoutError("checkout_state_conflict", true);
            const existing = await tx.paymentCheckoutVerification.findUnique({
                where: { orderId: current.id },
                select: { providerPaymentReference: true },
            });
            if (existing && existing.providerPaymentReference !== result.paymentId) {
                throw new IyzicoCheckoutError("checkout_state_conflict", true);
            }
            await tx.paymentCheckoutVerification.upsert({
                where: { orderId: current.id },
                create: {
                    orderId: current.id,
                    provider: "iyzico",
                    providerPaymentReference: result.paymentId,
                    amountMinor: result.amountMinor,
                    paidAmountMinor: result.paidAmountMinor,
                    currency: result.currency,
                    providerPaymentStatus: result.paymentStatus,
                    providerRiskStatus: result.fraudStatus,
                    verifiedAt,
                },
                update: {
                    amountMinor: result.amountMinor,
                    paidAmountMinor: result.paidAmountMinor,
                    currency: result.currency,
                    providerPaymentStatus: result.paymentStatus,
                    providerRiskStatus: result.fraudStatus,
                    verifiedAt,
                },
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
        if (error instanceof IyzicoCheckoutError) throw error;
        throw new IyzicoCheckoutError("checkout_state_conflict", true);
    }

    return {
        orderId: order.id,
        providerPaymentReference: result.paymentId,
        paymentStatus: result.paymentStatus,
        fraudStatus: result.fraudStatus,
        providerReportedSuccess: result.paymentStatus === "SUCCESS" && result.fraudStatus === 1,
    };
}
