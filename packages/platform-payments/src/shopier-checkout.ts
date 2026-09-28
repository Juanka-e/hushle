import { Prisma, prisma } from "@hushle/platform-db";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
    createShopierCustomListing,
    ShopierAdapterError,
    type ShopierCredentials,
} from "./adapters/shopier";
import { assertPaymentOrderTransition } from "./order-state-machine";

const REQUEST_LEASE_MS = 60_000;

export class ShopierCheckoutError extends Error {
    constructor(
        public readonly code:
            | "invalid_request"
            | "order_not_found"
            | "order_not_eligible"
            | "checkout_in_progress"
            | "checkout_uncertain"
            | "provider_timeout"
            | "provider_unavailable"
            | "provider_rate_limited"
            | "provider_rejected"
            | "invalid_provider_response"
            | "checkout_state_conflict",
        public readonly retryable = false
    ) {
        super(code);
        this.name = "ShopierCheckoutError";
    }
}

type PreparedAttempt = {
    kind: "request";
    attemptId: string;
    attemptNumber: number;
    order: {
        id: string;
        productNameSnapshot: string;
        totalAmountMinor: number;
        currency: string;
    };
} | {
    kind: "existing";
    orderId: string;
    productId: string;
    checkoutUrl: string;
} | {
    kind: "uncertain";
};

async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM payment_orders WHERE id = ${orderId} FOR UPDATE
    `);
    if (rows.length === 0) throw new ShopierCheckoutError("order_not_found");
}

async function prepareAttempt(orderId: string, now: Date): Promise<PreparedAttempt> {
    return prisma.$transaction(async (tx) => {
        await lockOrder(tx, orderId);
        const order = await tx.paymentOrder.findUnique({
            where: { id: orderId },
            include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } },
        });
        if (!order) throw new ShopierCheckoutError("order_not_found");
        if (order.provider !== "shopier_v2") throw new ShopierCheckoutError("order_not_eligible");
        if (
            order.status === "awaiting_payment"
            && order.providerSessionReference
            && order.providerHostedUrl
        ) {
            return {
                kind: "existing",
                orderId: order.id,
                productId: order.providerSessionReference,
                checkoutUrl: order.providerHostedUrl,
            };
        }
        if (order.status !== "created" && order.status !== "pending_provider") {
            throw new ShopierCheckoutError("order_not_eligible");
        }
        const latest = order.attempts[0];
        if (latest?.status === "uncertain") {
            return { kind: "uncertain" };
        }
        if (latest?.status === "requested") {
            const ageMs = now.getTime() - latest.updatedAt.getTime();
            if (ageMs < REQUEST_LEASE_MS) {
                throw new ShopierCheckoutError("checkout_in_progress", true);
            }
            // Shopier product creation has no idempotency key. A timed-out create must be reviewed,
            // never retried blindly because it may produce a second purchasable listing.
            await tx.paymentAttempt.updateMany({
                where: { id: latest.id, status: "requested" },
                data: { status: "uncertain", errorCode: "shopier_create_result_unknown" },
            });
            await tx.paymentReconciliationCase.upsert({
                where: { orderId: order.id },
                create: {
                    orderId: order.id,
                    reasonCode: "shopier_listing_create_uncertain",
                    lastErrorCode: "shopier_create_result_unknown",
                    nextCheckAt: now,
                },
                update: {
                    status: "open",
                    reasonCode: "shopier_listing_create_uncertain",
                    lastErrorCode: "shopier_create_result_unknown",
                    nextCheckAt: now,
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
            data: { status: "pending_provider", version: { increment: 1 } },
        });
        return {
            kind: "request",
            attemptId: attempt.id,
            attemptNumber,
            order: {
                id: order.id,
                productNameSnapshot: order.productNameSnapshot,
                totalAmountMinor: order.totalAmountMinor,
                currency: order.currency,
            },
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

function normalizeAdapterError(error: unknown): ShopierCheckoutError {
    if (!(error instanceof ShopierAdapterError)) {
        return new ShopierCheckoutError("provider_unavailable", true);
    }
    if (["provider_timeout", "provider_unavailable", "invalid_provider_response"].includes(error.code)) {
        return new ShopierCheckoutError("checkout_uncertain");
    }
    return new ShopierCheckoutError(
        error.code,
        error.code === "provider_unavailable" || error.code === "provider_rate_limited"
    );
}

export async function createShopierCheckoutListing(input: {
    orderId: string;
    mediaUrl: string;
    credentials: ShopierCredentials;
    fetchImpl?: typeof fetch;
    now?: Date;
}): Promise<{
    orderId: string;
    productId: string;
    checkoutUrl: string;
    duplicate: boolean;
    attemptNumber: number | null;
}> {
    const parsedOrderId = z.string().uuid().safeParse(input.orderId);
    if (!parsedOrderId.success) throw new ShopierCheckoutError("invalid_request");
    const prepared = await prepareAttempt(parsedOrderId.data, input.now ?? new Date());
    if (prepared.kind === "uncertain") {
        throw new ShopierCheckoutError("checkout_uncertain");
    }
    if (prepared.kind === "existing") {
        return { ...prepared, duplicate: true, attemptNumber: null };
    }
    let listing: Awaited<ReturnType<typeof createShopierCustomListing>>;
    try {
        listing = await createShopierCustomListing({
            orderId: prepared.order.id,
            amountMinor: prepared.order.totalAmountMinor,
            currency: prepared.order.currency as "TRY" | "USD" | "EUR",
            productName: prepared.order.productNameSnapshot,
            mediaUrl: input.mediaUrl,
            credentials: input.credentials,
            fetchImpl: input.fetchImpl,
        });
    } catch (error) {
        const normalized = normalizeAdapterError(error);
        await prisma.paymentAttempt.updateMany({
            where: { id: prepared.attemptId, status: "requested" },
            data: {
                status: normalized.code === "checkout_uncertain" ? "uncertain" : "failed",
                errorCode: normalized.code,
            },
        });
        if (normalized.code === "checkout_uncertain") {
            await prisma.paymentReconciliationCase.upsert({
                where: { orderId: prepared.order.id },
                create: {
                    orderId: prepared.order.id,
                    reasonCode: "shopier_listing_create_uncertain",
                    lastErrorCode: normalized.code,
                    nextCheckAt: input.now ?? new Date(),
                },
                update: {
                    status: "open",
                    reasonCode: "shopier_listing_create_uncertain",
                    lastErrorCode: normalized.code,
                    nextCheckAt: input.now ?? new Date(),
                },
            });
        }
        throw normalized;
    }
    try {
        await prisma.$transaction(async (tx) => {
            await lockOrder(tx, prepared.order.id);
            const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id: prepared.order.id } });
            const updatedAttempt = await tx.paymentAttempt.updateMany({
                where: { id: prepared.attemptId, status: "requested" },
                data: {
                    status: "succeeded",
                    providerRequestId: `shopier-product-sha256:${createHash("sha256").update(listing.productId).digest("hex")}`,
                    errorCode: null,
                },
            });
            if (updatedAttempt.count !== 1 || order.status !== "pending_provider") {
                throw new ShopierCheckoutError("checkout_state_conflict", true);
            }
            assertPaymentOrderTransition("pending_provider", "awaiting_payment");
            await tx.paymentOrder.update({
                where: { id: order.id },
                data: {
                    status: "awaiting_payment",
                    providerSessionReference: listing.productId,
                    providerHostedUrl: listing.checkoutUrl,
                    version: { increment: 1 },
                },
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
        await prisma.paymentAttempt.updateMany({
            where: { id: prepared.attemptId, status: "requested" },
            data: { status: "uncertain", errorCode: "checkout_state_conflict" },
        });
        await prisma.paymentReconciliationCase.upsert({
            where: { orderId: prepared.order.id },
            create: {
                orderId: prepared.order.id,
                reasonCode: "shopier_listing_persist_uncertain",
                lastErrorCode: "checkout_state_conflict",
                nextCheckAt: input.now ?? new Date(),
            },
            update: {
                status: "open",
                reasonCode: "shopier_listing_persist_uncertain",
                lastErrorCode: "checkout_state_conflict",
                nextCheckAt: input.now ?? new Date(),
            },
        });
        throw error instanceof ShopierCheckoutError
            ? error
            : new ShopierCheckoutError("checkout_state_conflict", true);
    }
    return {
        orderId: prepared.order.id,
        productId: listing.productId,
        checkoutUrl: listing.checkoutUrl,
        duplicate: false,
        attemptNumber: prepared.attemptNumber,
    };
}
