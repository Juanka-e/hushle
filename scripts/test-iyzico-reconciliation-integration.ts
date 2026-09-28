import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, prisma, type PaymentOrder } from "@hushle/platform-db";
import {
    reconcileIyzicoOrder,
    runPaymentReconciliation,
    type IyzicoCheckoutVerification,
} from "@hushle/platform-payments";

const credentials = {
    apiKey: "sandbox-reconciliation-api-key",
    secretKey: "sandbox-reconciliation-secret-key",
};

async function createOrder(input: {
    userId: number;
    itemId: number;
    suffix: string;
    status: "awaiting_payment" | "pending_provider" | "paid";
    token?: string;
    createdAt?: Date;
}): Promise<PaymentOrder> {
    const id = randomUUID();
    return prisma.paymentOrder.create({
        data: {
            id,
            userId: input.userId,
            provider: "iyzico",
            status: input.status,
            idempotencyKey: `iyzico-reconciliation:${input.suffix}`,
            requestFingerprint: "e".repeat(64),
            productKind: "cosmetic_item",
            productReference: `item:${input.itemId}`,
            productVersion: 1,
            productNameSnapshot: "Iyzico Reconciliation Avatar",
            quantity: 1,
            unitAmountMinor: 12_500,
            totalAmountMinor: 12_500,
            currency: "TRY",
            grantSnapshot: {
                schemaVersion: 1,
                items: [{
                    shopItemId: input.itemId,
                    renderSnapshot: { type: "avatar", imageUrl: "/iyzico-reconciliation.png" },
                }],
            } satisfies Prisma.InputJsonValue,
            providerOrderReference: id,
            providerSessionReference: input.token,
            paidAt: input.status === "paid" ? new Date() : null,
            createdAt: input.createdAt,
        },
    });
}

async function writeExactProof(order: PaymentOrder, paymentId: string, now: Date): Promise<void> {
    await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
            SELECT id FROM payment_orders WHERE id = ${order.id} FOR UPDATE
        `);
        await tx.paymentCheckoutVerification.upsert({
            where: { orderId: order.id },
            create: {
                orderId: order.id,
                provider: "iyzico",
                providerPaymentReference: paymentId,
                amountMinor: order.totalAmountMinor,
                paidAmountMinor: order.totalAmountMinor,
                currency: order.currency,
                providerPaymentStatus: "SUCCESS",
                providerRiskStatus: 1,
                verifiedAt: now,
            },
            update: {
                providerPaymentReference: paymentId,
                amountMinor: order.totalAmountMinor,
                paidAmountMinor: order.totalAmountMinor,
                currency: order.currency,
                providerPaymentStatus: "SUCCESS",
                providerRiskStatus: 1,
                verifiedAt: now,
            },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

function exactVerifier(order: PaymentOrder, paymentId: string): IyzicoCheckoutVerification {
    return async ({ orderId, token, now }) => {
        assert.equal(orderId, order.id);
        assert.equal(token, order.providerSessionReference);
        await writeExactProof(order, paymentId, now ?? new Date());
        return {
            orderId,
            providerPaymentReference: paymentId,
            paymentStatus: "SUCCESS",
            fraudStatus: 1,
            providerReportedSuccess: true,
        };
    };
}

async function run(): Promise<void> {
    assert.equal(process.env.IYZICO_RECONCILIATION_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 60_000);
    const user = await prisma.user.create({
        data: { username: `iyzico_reconciliation_${suffix}`, password: "integration-test-only" },
    });
    const item = await prisma.shopItem.create({
        data: {
            code: `iyzico_reconciliation_${suffix}`,
            type: "avatar",
            name: "Iyzico Reconciliation Avatar",
            priceCoin: 0,
            imageUrl: "/iyzico-reconciliation.png",
        },
    });
    const orderIds: string[] = [];
    try {
        const concurrent = await createOrder({
            userId: user.id,
            itemId: item.id,
            suffix: `${suffix}:concurrent`,
            status: "awaiting_payment",
            token: `reconciliation-token-${suffix}`,
            createdAt: old,
        });
        orderIds.push(concurrent.id);
        const verifier = exactVerifier(concurrent, `payment-${suffix}`);
        const results = await Promise.all([
            reconcileIyzicoOrder({ order: concurrent, credentials, verify: verifier, now, retryDelayMinutes: 15 }),
            reconcileIyzicoOrder({ order: concurrent, credentials, verify: verifier, now, retryDelayMinutes: 15 }),
        ]);
        assert.deepEqual(results, ["fulfilled", "fulfilled"]);
        const completed = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: concurrent.id } });
        assert.equal(completed.status, "fulfilled");
        assert.equal(completed.providerSessionReference, null);
        assert.equal(await prisma.inventoryItem.count({ where: { userId: user.id, shopItemId: item.id } }), 1);
        assert.equal(await prisma.notification.count({ where: { resourceId: concurrent.id } }), 1);
        assert.equal((await prisma.paymentReconciliationCase.findUniqueOrThrow({ where: { orderId: concurrent.id } })).status, "resolved");

        const forged = await createOrder({
            userId: user.id,
            itemId: item.id,
            suffix: `${suffix}:forged`,
            status: "awaiting_payment",
            token: `forged-token-${suffix}`,
            createdAt: old,
        });
        orderIds.push(forged.id);
        const forgedOutcome = await reconcileIyzicoOrder({
            order: forged,
            credentials,
            verify: async () => {
                await writeExactProof(forged, `different-payment-${suffix}`, now);
                return {
                    orderId: forged.id,
                    providerPaymentReference: `forged-payment-${suffix}`,
                    paymentStatus: "SUCCESS",
                    fraudStatus: 1,
                    providerReportedSuccess: true,
                };
            },
            now,
            retryDelayMinutes: 15,
        });
        assert.equal(forgedOutcome, "review");
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: forged.id } })).status, "awaiting_payment");
        assert.equal((await prisma.paymentReconciliationCase.findUniqueOrThrow({ where: { orderId: forged.id } })).lastErrorCode, "iyzico_exact_proof_required");

        const uncertain = await createOrder({
            userId: user.id,
            itemId: item.id,
            suffix: `${suffix}:uncertain`,
            status: "pending_provider",
            createdAt: old,
        });
        orderIds.push(uncertain.id);
        await prisma.paymentAttempt.create({
            data: {
                orderId: uncertain.id,
                attemptNumber: 1,
                status: "uncertain",
                requestFingerprint: uncertain.requestFingerprint,
                errorCode: "provider_timeout",
            },
        });
        await prisma.paymentReconciliationCase.create({
            data: {
                orderId: uncertain.id,
                reasonCode: "iyzico_initialize_uncertain",
                nextCheckAt: now,
            },
        });
        let providerCalls = 0;
        const uncertainOutcome = await reconcileIyzicoOrder({
            order: uncertain,
            credentials,
            verify: async () => {
                providerCalls += 1;
                throw new Error("must_not_call_provider_without_token");
            },
            now,
            retryDelayMinutes: 15,
        });
        assert.equal(uncertainOutcome, "review");
        assert.equal(providerCalls, 0);
        const uncertainCase = await prisma.paymentReconciliationCase.findUniqueOrThrow({ where: { orderId: uncertain.id } });
        assert.equal(uncertainCase.reasonCode, "iyzico_initialize_uncertain_manual_review");
        assert.equal(uncertainCase.lastErrorCode, "provider_session_missing");

        const paidWithoutProof = await createOrder({
            userId: user.id,
            itemId: item.id,
            suffix: `${suffix}:paid-no-proof`,
            status: "paid",
            createdAt: old,
        });
        orderIds.push(paidWithoutProof.id);
        assert.equal(await reconcileIyzicoOrder({
            order: paidWithoutProof,
            credentials,
            now,
            retryDelayMinutes: 15,
        }), "review");
        assert.equal(await prisma.paymentFulfillment.count({ where: { orderId: paidWithoutProof.id } }), 0);

        const retryWindowElapsed = new Date(now.getTime() + 16 * 60_000);
        const enabledDryRun = await runPaymentReconciliation({
            config: { batchSize: 100, minAgeMinutes: 5, retryDelayMinutes: 15, maxAttempts: 12 },
            dryRun: true,
            environment: {
                IYZICO_CHECKOUT_MODE: "sandbox",
                IYZICO_RECONCILIATION_MODE: "sandbox",
            },
            now: retryWindowElapsed,
        });
        assert.equal(enabledDryRun.iyzicoEnabled, true);
        assert.ok(enabledDryRun.candidatesByProvider.iyzico >= 1);
        const disabledDryRun = await runPaymentReconciliation({
            config: { batchSize: 100, minAgeMinutes: 5, retryDelayMinutes: 15, maxAttempts: 12 },
            dryRun: true,
            environment: { IYZICO_CHECKOUT_MODE: "sandbox", IYZICO_RECONCILIATION_MODE: "disabled" },
            now: retryWindowElapsed,
        });
        assert.equal(disabledDryRun.iyzicoEnabled, false);
        assert.equal(disabledDryRun.candidatesByProvider.iyzico, 0);
    } finally {
        await prisma.notification.deleteMany({ where: { userId: user.id } });
        await prisma.paymentReconciliationCase.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentCheckoutVerification.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentFulfillment.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.paymentOrder.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.inventoryItem.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.shopItem.delete({ where: { id: item.id } });
        await prisma.$disconnect();
    }
    console.log("iyzico reconciliation exact-proof and uncertainty checks passed");
}

void run();
