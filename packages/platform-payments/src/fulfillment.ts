import { Prisma, prisma, type PaymentOrder } from "@hushle/platform-db";
import { grantPaymentCoinLot } from "@hushle/platform-wallet";
import { z } from "zod";
import { assertPaymentOrderTransition } from "./order-state-machine";
import {
    normalizePaymentGrantContract,
    PaymentGrantContractError,
    type NormalizedPaymentGrant,
} from "./grant-contract";

export type PaymentFulfillmentGrantResult =
    | {
        schemaVersion: 1;
        kind: "coin_pack";
        coinAmount: number;
        ledgerEntryId: number;
        coinLotId?: string;
        balanceAfter: number;
    }
    | {
        schemaVersion: 1;
        kind: "cosmetic_item" | "cosmetic_bundle";
        shopItemIds: number[];
        inventoryItemIds: number[];
    };

const paymentFulfillmentGrantResultSchema = z.discriminatedUnion("kind", [
    z.object({
        schemaVersion: z.literal(1),
        kind: z.literal("coin_pack"),
        coinAmount: z.number().int().positive(),
        ledgerEntryId: z.number().int().positive(),
        coinLotId: z.string().uuid().optional(),
        balanceAfter: z.number().int().min(0),
    }),
    z.object({
        schemaVersion: z.literal(1),
        kind: z.enum(["cosmetic_item", "cosmetic_bundle"]),
        shopItemIds: z.array(z.number().int().positive()).min(1).max(100),
        inventoryItemIds: z.array(z.number().int().positive()).min(1).max(100),
    }).refine((value) => value.shopItemIds.length === value.inventoryItemIds.length),
]);

export type PaymentFulfillmentResult = {
    orderId: string;
    fulfillmentId: string;
    duplicate: boolean;
    grant: PaymentFulfillmentGrantResult;
};

export class PaymentFulfillmentError extends Error {
    constructor(
        public readonly code:
            | "order_not_found"
            | "invalid_order_id"
            | "order_not_paid"
            | "invalid_grant_snapshot"
            | "grant_target_missing"
            | "grant_already_owned"
            | "grant_balance_overflow"
            | "fulfillment_identity_conflict"
            | "fulfillment_state_conflict"
            | "fulfillment_internal_error",
        public readonly retryable = false
    ) {
        super(code);
        this.name = "PaymentFulfillmentError";
    }
}

export function normalizePaymentGrantSnapshot(input: {
    productKind: PaymentOrder["productKind"];
    quantity: number;
    grantSnapshot: Prisma.JsonValue;
}): NormalizedPaymentGrant {
    try {
        return normalizePaymentGrantContract(input);
    } catch (error) {
        if (error instanceof PaymentGrantContractError && error.code === "grant_balance_overflow") {
            throw new PaymentFulfillmentError("grant_balance_overflow");
        }
        throw new PaymentFulfillmentError("invalid_grant_snapshot");
    }
}

function parseGrantSnapshot(order: PaymentOrder) {
    return normalizePaymentGrantSnapshot({
        productKind: order.productKind,
        quantity: order.quantity,
        grantSnapshot: order.grantSnapshot,
    });
}

function readCompletedGrant(value: Prisma.JsonValue | null): PaymentFulfillmentGrantResult {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new PaymentFulfillmentError("fulfillment_identity_conflict");
    }
    const parsed = paymentFulfillmentGrantResultSchema.safeParse(value);
    if (!parsed.success) {
        throw new PaymentFulfillmentError("fulfillment_identity_conflict");
    }
    return parsed.data;
}

async function lockPaymentOrder(
    tx: Prisma.TransactionClient,
    orderId: string
): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM payment_orders
        WHERE id = ${orderId}
        FOR UPDATE
    `);
    if (rows.length === 0) throw new PaymentFulfillmentError("order_not_found");
}

async function executeGrant(
    tx: Prisma.TransactionClient,
    order: PaymentOrder,
    fulfillmentKey: string
): Promise<PaymentFulfillmentGrantResult> {
    const grant = parseGrantSnapshot(order);
    if (grant.kind === "coin_pack") {
        try {
            const wallet = await grantPaymentCoinLot(tx, {
                userId: order.userId,
                orderId: order.id,
                coinAmount: grant.coinAmount,
                idempotencyKey: `${fulfillmentKey}:coin`,
                metadata: {
                    provider: order.provider,
                    productReference: order.productReference,
                    productVersion: order.productVersion,
                },
            });
            return {
                schemaVersion: 1,
                kind: "coin_pack",
                coinAmount: grant.coinAmount,
                ledgerEntryId: wallet.ledgerEntryId,
                coinLotId: wallet.coinLotId,
                balanceAfter: wallet.balanceAfter,
            };
        } catch (error) {
            if (error instanceof RangeError) {
                throw new PaymentFulfillmentError("grant_balance_overflow");
            }
            throw error;
        }
    }

    const shopItemIds = grant.items.map((item) => item.shopItemId);
    const [existingCount, targetCount] = await Promise.all([
        tx.inventoryItem.count({
            where: { userId: order.userId, shopItemId: { in: shopItemIds } },
        }),
        tx.shopItem.count({ where: { id: { in: shopItemIds } } }),
    ]);
    if (targetCount !== shopItemIds.length) {
        throw new PaymentFulfillmentError("grant_target_missing");
    }
    if (existingCount > 0) {
        throw new PaymentFulfillmentError("grant_already_owned");
    }

    const inserted = await tx.inventoryItem.createMany({
        data: grant.items.map((item) => ({
            userId: order.userId,
            shopItemId: item.shopItemId,
            source: "purchase",
            renderSnapshot: item.renderSnapshot as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
    });
    if (inserted.count !== shopItemIds.length) {
        throw new PaymentFulfillmentError("grant_already_owned");
    }
    const inventoryItems = await tx.inventoryItem.findMany({
        where: { userId: order.userId, shopItemId: { in: shopItemIds } },
        orderBy: { id: "asc" },
        select: { id: true, shopItemId: true },
    });
    if (inventoryItems.length !== shopItemIds.length) {
        throw new PaymentFulfillmentError("fulfillment_internal_error", true);
    }
    return {
        schemaVersion: 1,
        kind: grant.kind,
        shopItemIds,
        inventoryItemIds: inventoryItems.map((item) => item.id),
    };
}

async function runFulfillmentTransaction(
    orderId: string,
    now: Date
): Promise<PaymentFulfillmentResult> {
    return prisma.$transaction(async (tx) => {
        await lockPaymentOrder(tx, orderId);
        const order = await tx.paymentOrder.findUnique({
            where: { id: orderId },
            include: { fulfillment: true },
        });
        if (!order) throw new PaymentFulfillmentError("order_not_found");
        if (order.fulfillment?.status === "completed") {
            if (order.status !== "fulfilled") {
                throw new PaymentFulfillmentError("fulfillment_state_conflict", true);
            }
            return {
                orderId,
                fulfillmentId: order.fulfillment.id,
                duplicate: true,
                grant: readCompletedGrant(order.fulfillment.grantResult),
            };
        }
        if (order.status === "fulfilled") {
            throw new PaymentFulfillmentError("fulfillment_state_conflict", true);
        }
        if (order.status !== "paid" || !order.paidAt) {
            throw new PaymentFulfillmentError("order_not_paid");
        }

        assertPaymentOrderTransition(order.status, "fulfilled");
        const fulfillmentKey = `payment:${order.id}:grant:v1`;
        if (
            order.fulfillment
            && order.fulfillment.fulfillmentKey !== fulfillmentKey
        ) {
            throw new PaymentFulfillmentError("fulfillment_identity_conflict");
        }
        const fulfillment = await tx.paymentFulfillment.upsert({
            where: { orderId: order.id },
            create: {
                orderId: order.id,
                fulfillmentKey,
                status: "pending",
                attemptCount: 1,
            },
            update: {
                status: "pending",
                attemptCount: { increment: 1 },
                errorCode: null,
            },
        });
        const grant = await executeGrant(tx, order, fulfillmentKey);
        await tx.paymentFulfillment.update({
            where: { id: fulfillment.id },
            data: {
                status: "completed",
                grantResult: grant as Prisma.InputJsonValue,
                errorCode: null,
                completedAt: now,
            },
        });
        const transitioned = await tx.paymentOrder.updateMany({
            where: { id: order.id, status: "paid", version: order.version },
            data: {
                status: "fulfilled",
                fulfilledAt: now,
                version: { increment: 1 },
            },
        });
        if (transitioned.count !== 1) {
            throw new PaymentFulfillmentError("fulfillment_state_conflict", true);
        }
        return {
            orderId,
            fulfillmentId: fulfillment.id,
            duplicate: false,
            grant,
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

async function recordFulfillmentFailure(
    orderId: string,
    error: PaymentFulfillmentError
): Promise<void> {
    if (
        error.code === "order_not_found"
        || error.code === "invalid_order_id"
        || error.code === "order_not_paid"
    ) return;
    await prisma.$transaction(async (tx) => {
        await lockPaymentOrder(tx, orderId);
        const order = await tx.paymentOrder.findUnique({
            where: { id: orderId },
            include: { fulfillment: true },
        });
        if (!order || order.status !== "paid" || order.fulfillment?.status === "completed") return;
        const fulfillmentKey = `payment:${order.id}:grant:v1`;
        if (order.fulfillment && order.fulfillment.fulfillmentKey !== fulfillmentKey) return;
        await tx.paymentFulfillment.upsert({
            where: { orderId },
            create: {
                orderId,
                fulfillmentKey,
                status: "failed",
                attemptCount: 1,
                errorCode: error.code,
            },
            update: {
                status: "failed",
                attemptCount: { increment: 1 },
                errorCode: error.code,
            },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

function normalizeFulfillmentError(error: unknown): PaymentFulfillmentError {
    if (error instanceof PaymentFulfillmentError) return error;
    return new PaymentFulfillmentError("fulfillment_internal_error", true);
}

export async function fulfillPaidPaymentOrder(input: {
    orderId: string;
    now?: Date;
}): Promise<PaymentFulfillmentResult> {
    const parsedOrderId = z.string().uuid().safeParse(input.orderId);
    if (!parsedOrderId.success) {
        throw new PaymentFulfillmentError("invalid_order_id");
    }
    const orderId = parsedOrderId.data;
    const now = input.now ?? new Date();
    try {
        return await runFulfillmentTransaction(orderId, now);
    } catch (error) {
        const normalized = normalizeFulfillmentError(error);
        try {
            await recordFulfillmentFailure(orderId, normalized);
        } catch {
            // The original bounded failure remains authoritative for worker retry policy.
        }
        throw normalized;
    }
}
