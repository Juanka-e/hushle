import { Prisma, prisma } from "@hushle/platform-db";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
    PAYTR_IFRAME_URL_PREFIX,
    PaytrAdapterError,
    requestPaytrIframeToken,
    type PaytrCredentials,
} from "./adapters/paytr";
import { assertPaymentOrderTransition } from "./order-state-machine";
import { paymentCheckoutContactSchema } from "./sensitive-checkout-data";

const REQUEST_LEASE_MS = 60_000;

export const paytrCheckoutContactSchema = paymentCheckoutContactSchema;

export type PaytrCheckoutContact = z.input<typeof paytrCheckoutContactSchema>;

export class PaytrCheckoutError extends Error {
    constructor(
        public readonly code:
            | "invalid_request"
            | "order_not_found"
            | "order_not_eligible"
            | "checkout_in_progress"
            | "provider_timeout"
            | "provider_unavailable"
            | "provider_rejected"
            | "invalid_provider_response"
            | "checkout_state_conflict",
        public readonly retryable = false
    ) {
        super(code);
        this.name = "PaytrCheckoutError";
    }
}

type PreparedAttempt = {
    kind: "request";
    attemptId: string;
    attemptNumber: number;
    merchantOrderId: string;
    order: {
        id: string;
        productNameSnapshot: string;
        totalAmountMinor: number;
        currency: string;
    };
} | {
    kind: "existing";
    orderId: string;
    token: string;
};

async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM payment_orders WHERE id = ${orderId} FOR UPDATE
    `);
    if (rows.length === 0) throw new PaytrCheckoutError("order_not_found");
}

async function prepareAttempt(orderId: string, now: Date): Promise<PreparedAttempt> {
    return prisma.$transaction(async (tx) => {
        await lockOrder(tx, orderId);
        const order = await tx.paymentOrder.findUnique({
            where: { id: orderId },
            include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } },
        });
        if (!order) throw new PaytrCheckoutError("order_not_found");
        if (order.provider !== "paytr") throw new PaytrCheckoutError("order_not_eligible");
        if (order.status === "awaiting_payment" && order.providerSessionReference) {
            return {
                kind: "existing",
                orderId: order.id,
                token: order.providerSessionReference,
            };
        }
        if (order.status !== "created" && order.status !== "pending_provider") {
            throw new PaytrCheckoutError("order_not_eligible");
        }

        const latest = order.attempts[0];
        if (latest?.status === "requested") {
            const ageMs = now.getTime() - latest.updatedAt.getTime();
            if (ageMs < REQUEST_LEASE_MS) {
                throw new PaytrCheckoutError("checkout_in_progress", true);
            }
            await tx.paymentAttempt.update({
                where: { id: latest.id },
                data: { status: "failed", errorCode: "provider_request_timeout" },
            });
        }

        const merchantOrderId = order.id.replaceAll("-", "");
        const attemptNumber = (latest?.attemptNumber ?? 0) + 1;
        const attempt = await tx.paymentAttempt.create({
            data: {
                orderId: order.id,
                attemptNumber,
                status: "requested",
                requestFingerprint: order.requestFingerprint,
            },
        });
        if (order.status === "created") {
            assertPaymentOrderTransition("created", "pending_provider");
        }
        await tx.paymentOrder.update({
            where: { id: order.id },
            data: {
                status: "pending_provider",
                providerOrderReference: merchantOrderId,
                version: { increment: 1 },
            },
        });
        return {
            kind: "request",
            attemptId: attempt.id,
            attemptNumber,
            merchantOrderId,
            order: {
                id: order.id,
                productNameSnapshot: order.productNameSnapshot,
                totalAmountMinor: order.totalAmountMinor,
                currency: order.currency,
            },
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

async function failAttempt(attemptId: string, errorCode: string): Promise<void> {
    await prisma.paymentAttempt.updateMany({
        where: { id: attemptId, status: "requested" },
        data: { status: "failed", errorCode },
    });
}

function normalizeAdapterError(error: unknown): PaytrCheckoutError {
    if (!(error instanceof PaytrAdapterError)) {
        return new PaytrCheckoutError("provider_unavailable", true);
    }
    if (error.code === "provider_timeout") {
        return new PaytrCheckoutError("provider_timeout", true);
    }
    if (error.code === "provider_unavailable") {
        return new PaytrCheckoutError("provider_unavailable", true);
    }
    if (error.code === "provider_rejected") {
        return new PaytrCheckoutError("provider_rejected");
    }
    return new PaytrCheckoutError("invalid_provider_response");
}

export async function createPaytrSandboxCheckoutSession(input: {
    orderId: string;
    email: string;
    userIp: string;
    contact: PaytrCheckoutContact;
    successUrl: string;
    failureUrl: string;
    credentials: PaytrCredentials;
    fetchImpl?: typeof fetch;
    now?: Date;
}): Promise<{
    orderId: string;
    iframeUrl: string;
    duplicate: boolean;
    attemptNumber: number | null;
}> {
    const orderId = z.string().uuid().safeParse(input.orderId);
    const email = z.string().trim().email().max(100)
        .refine((value) => /^[\x20-\x7e]+$/.test(value))
        .safeParse(input.email);
    const contact = paytrCheckoutContactSchema.safeParse(input.contact);
    if (!orderId.success || !email.success || !contact.success) {
        throw new PaytrCheckoutError("invalid_request");
    }

    const prepared = await prepareAttempt(orderId.data, input.now ?? new Date());
    if (prepared.kind === "existing") {
        return {
            orderId: prepared.orderId,
            iframeUrl: `${PAYTR_IFRAME_URL_PREFIX}${encodeURIComponent(prepared.token)}`,
            duplicate: true,
            attemptNumber: null,
        };
    }

    let token: string;
    let iframeUrl: string;
    try {
        const response = await requestPaytrIframeToken({
            request: {
                merchantOrderId: prepared.merchantOrderId,
                userIp: input.userIp,
                email: email.data,
                amountMinor: prepared.order.totalAmountMinor,
                currency: prepared.order.currency as "TRY" | "EUR" | "USD" | "GBP" | "RUB",
                basket: [{
                    name: prepared.order.productNameSnapshot,
                    unitAmountMinor: prepared.order.totalAmountMinor,
                    quantity: 1,
                }],
                fullName: contact.data.fullName,
                address: contact.data.address,
                phone: contact.data.phone,
                successUrl: input.successUrl,
                failureUrl: input.failureUrl,
                noInstallment: true,
                maxInstallment: 0,
                testMode: true,
                language: "tr",
            },
            credentials: input.credentials,
            fetchImpl: input.fetchImpl,
        });
        token = response.token;
        iframeUrl = response.iframeUrl;
        if (token.length > 191) throw new PaytrCheckoutError("invalid_provider_response");
    } catch (error) {
        const normalized = error instanceof PaytrCheckoutError
            ? error
            : normalizeAdapterError(error);
        await failAttempt(prepared.attemptId, normalized.code);
        throw normalized;
    }

    try {
        await prisma.$transaction(async (tx) => {
            await lockOrder(tx, prepared.order.id);
            const order = await tx.paymentOrder.findUniqueOrThrow({
                where: { id: prepared.order.id },
            });
            const updatedAttempt = await tx.paymentAttempt.updateMany({
                where: { id: prepared.attemptId, status: "requested" },
                data: {
                    status: "succeeded",
                    providerRequestId: createProviderRequestReference(token),
                    errorCode: null,
                },
            });
            if (updatedAttempt.count !== 1 || order.status !== "pending_provider") {
                throw new PaytrCheckoutError("checkout_state_conflict", true);
            }
            assertPaymentOrderTransition("pending_provider", "awaiting_payment");
            await tx.paymentOrder.update({
                where: { id: order.id },
                data: {
                    status: "awaiting_payment",
                    providerSessionReference: token,
                    version: { increment: 1 },
                },
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
        const normalized = error instanceof PaytrCheckoutError
            ? error
            : new PaytrCheckoutError("checkout_state_conflict", true);
        await failAttempt(prepared.attemptId, normalized.code);
        throw normalized;
    }

    return {
        orderId: prepared.order.id,
        iframeUrl,
        duplicate: false,
        attemptNumber: prepared.attemptNumber,
    };
}

function createProviderRequestReference(token: string): string {
    return `paytr-token-sha256:${createHash("sha256").update(token).digest("hex")}`;
}
