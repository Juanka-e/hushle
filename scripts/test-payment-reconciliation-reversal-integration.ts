import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@hushle/platform-db";
import {
    approvePaymentReversalRequest,
    fulfillPaidPaymentOrder,
    PaymentCaseResolutionError,
    PaymentReversalError,
    reconcilePaytrOrder,
    requestExternallyConfirmedPaymentReversal,
    resolvePaymentReconciliationCase,
} from "@hushle/platform-payments";

async function createOrder(input: {
    userId: number;
    suffix: string;
    status: "paid" | "awaiting_payment";
    kind: "coin_pack" | "cosmetic_item";
    grantSnapshot: Prisma.InputJsonValue;
}) {
    const id = randomUUID();
    return prisma.paymentOrder.create({ data: {
        id,
        userId: input.userId,
        provider: "paytr",
        status: input.status,
        idempotencyKey: `reversal:${input.suffix}`,
        requestFingerprint: "c".repeat(64),
        productKind: input.kind,
        productReference: `product_${input.suffix}`,
        productVersion: 1,
        productNameSnapshot: `Product ${input.suffix}`,
        quantity: 1,
        unitAmountMinor: 10_000,
        totalAmountMinor: 10_000,
        currency: "TRY",
        grantSnapshot: input.grantSnapshot,
        providerOrderReference: id.replaceAll("-", ""),
        paidAt: input.status === "paid" ? new Date() : null,
    } });
}

async function run(): Promise<void> {
    assert.equal(process.env.PAYMENT_REVERSAL_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
    const user = await prisma.user.create({ data: { username: `reversal_${suffix}`, password: "integration-test" } });
    const requester = await prisma.user.create({ data: { username: `requester_${suffix}`, password: "integration-test", role: "admin" } });
    const reviewer = await prisma.user.create({ data: { username: `reviewer_${suffix}`, password: "integration-test", role: "admin" } });
    const paidItem = await prisma.shopItem.create({ data: { code: `paid_${suffix}`, type: "avatar", name: "Paid Avatar", priceCoin: 0, imageUrl: "/paid.png" } });
    const unrelatedItem = await prisma.shopItem.create({ data: { code: `unrelated_${suffix}`, type: "frame", name: "Unrelated Frame", priceCoin: 0, imageUrl: "/unrelated.png" } });
    const cosmeticSnapshot = { schemaVersion: 1, items: [{ shopItemId: paidItem.id, renderSnapshot: { type: "avatar", imageUrl: "/paid.png" } }] };
    try {
        await prisma.inventoryItem.create({ data: { userId: user.id, shopItemId: unrelatedItem.id, source: "grant" } });
        const cosmeticOrder = await createOrder({ userId: user.id, suffix: `${suffix}:cosmetic`, status: "paid", kind: "cosmetic_item", grantSnapshot: cosmeticSnapshot });
        const grant = await fulfillPaidPaymentOrder({ orderId: cosmeticOrder.id });
        await prisma.userProfile.create({ data: { userId: user.id, avatarItemId: paidItem.id, frameItemId: unrelatedItem.id } });
        await assert.rejects(
            () => requestExternallyConfirmedPaymentReversal({
                orderId: cosmeticOrder.id,
                outcome: "refund",
                externalReference: `non-admin-${suffix}`,
                reason: "non-admin request",
                requestedByUserId: user.id,
            }),
            (error: unknown) => error instanceof PaymentReversalError && error.code === "admin_actor_required"
        );
        const refundRequest = await requestExternallyConfirmedPaymentReversal({
            orderId: cosmeticOrder.id,
            outcome: "refund",
            externalReference: `refund-${suffix}`,
            reason: "integration refund",
            requestedByUserId: requester.id,
        });
        await assert.rejects(
            () => approvePaymentReversalRequest({ requestId: refundRequest.id, reviewedByUserId: requester.id, reviewNote: "self approval" }),
            (error: unknown) => error instanceof PaymentReversalError && error.code === "second_approver_required"
        );
        await assert.rejects(
            () => approvePaymentReversalRequest({ requestId: refundRequest.id, reviewedByUserId: user.id, reviewNote: "non-admin review" }),
            (error: unknown) => error instanceof PaymentReversalError && error.code === "admin_actor_required"
        );

        const approvals = await Promise.allSettled([
            approvePaymentReversalRequest({ requestId: refundRequest.id, reviewedByUserId: reviewer.id, reviewNote: "reviewed refund" }),
            approvePaymentReversalRequest({ requestId: refundRequest.id, reviewedByUserId: reviewer.id, reviewNote: "duplicate review" }),
        ]);
        assert.equal(approvals.filter((entry) => entry.status === "fulfilled").length, 1);
        assert.equal(approvals.filter((entry) => entry.status === "rejected").length, 1);
        const approvedRequest = await prisma.paymentReversalRequest.findUniqueOrThrow({ where: { id: refundRequest.id } });
        assert.equal(approvedRequest.status, "approved");
        assert.equal(approvedRequest.reviewedByUserId, reviewer.id);
        assert.equal(await prisma.inventoryItem.count({ where: { id: { in: grant.grant.kind === "coin_pack" ? [] : grant.grant.inventoryItemIds } } }), 0);
        assert.equal(await prisma.inventoryItem.count({ where: { userId: user.id, shopItemId: unrelatedItem.id } }), 1);
        const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } });
        assert.equal(profile.avatarItemId, null);
        assert.equal(profile.frameItemId, unrelatedItem.id);
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: cosmeticOrder.id } })).status, "refunded");
        assert.equal(await prisma.notification.count({ where: { resourceId: cosmeticOrder.id } }), 1);

        const chargebackRequest = await requestExternallyConfirmedPaymentReversal({
            orderId: cosmeticOrder.id,
            outcome: "chargeback",
            externalReference: `chargeback-${suffix}`,
            reason: "integration chargeback",
            requestedByUserId: requester.id,
        });
        const chargeback = await approvePaymentReversalRequest({
            requestId: chargebackRequest.id,
            reviewedByUserId: reviewer.id,
            reviewNote: "reviewed chargeback",
        });
        assert.equal(chargeback.removedInventoryItemIds.length, 0);
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: cosmeticOrder.id } })).status, "chargeback");
        assert.equal(await prisma.notification.count({ where: { resourceId: cosmeticOrder.id } }), 2);

        const coinOrder = await createOrder({ userId: user.id, suffix: `${suffix}:coin`, status: "paid", kind: "coin_pack", grantSnapshot: { schemaVersion: 1, coinAmount: 500 } });
        await fulfillPaidPaymentOrder({ orderId: coinOrder.id });
        const balanceBefore = (await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).coinBalance;
        const coinRequest = await requestExternallyConfirmedPaymentReversal({
            orderId: coinOrder.id,
            outcome: "refund",
            externalReference: `coin-refund-${suffix}`,
            reason: "coin review",
            requestedByUserId: requester.id,
        });
        const coinReversal = await approvePaymentReversalRequest({ requestId: coinRequest.id, reviewedByUserId: reviewer.id, reviewNote: "manual coin review" });
        assert.equal(coinReversal.status, "completed");
        assert.equal((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).coinBalance, balanceBefore - 500);
        const reversedLot = await prisma.paymentCoinLot.findUniqueOrThrow({ where: { orderId: coinOrder.id } });
        assert.equal(reversedLot.remainingCoin, 0);
        assert.equal(reversedLot.reversedCoin, 500);
        assert.ok(reversedLot.reversalLedgerEntryId);

        const ignoredOrder = await createOrder({ userId: user.id, suffix: `${suffix}:ignored`, status: "awaiting_payment", kind: "cosmetic_item", grantSnapshot: cosmeticSnapshot });
        const ignoredCase = await prisma.paymentReconciliationCase.create({ data: {
            orderId: ignoredOrder.id,
            reasonCode: "provider_pending",
            nextCheckAt: new Date(Date.now() + 60_000),
        } });
        await assert.rejects(
            () => resolvePaymentReconciliationCase({ caseId: ignoredCase.id, resolution: "resolved", note: "not terminal", resolvedByUserId: reviewer.id }),
            (error: unknown) => error instanceof PaymentCaseResolutionError && error.code === "order_not_terminal"
        );
        await assert.rejects(
            () => resolvePaymentReconciliationCase({ caseId: ignoredCase.id, resolution: "ignored", note: "non-admin decision", resolvedByUserId: user.id }),
            (error: unknown) => error instanceof PaymentCaseResolutionError && error.code === "admin_actor_required"
        );
        const ignored = await resolvePaymentReconciliationCase({ caseId: ignoredCase.id, resolution: "ignored", note: "provider panel reviewed", resolvedByUserId: reviewer.id });
        assert.equal(ignored.status, "ignored");
        assert.equal(ignored.nextCheckAt, null);
        assert.equal(ignored.resolvedByUserId, reviewer.id);

        const terminalOrder = await createOrder({ userId: user.id, suffix: `${suffix}:terminal`, status: "paid", kind: "coin_pack", grantSnapshot: { schemaVersion: 1, coinAmount: 25 } });
        await fulfillPaidPaymentOrder({ orderId: terminalOrder.id });
        const terminalCase = await prisma.paymentReconciliationCase.create({ data: { orderId: terminalOrder.id, reasonCode: "manual_terminal_review" } });
        const resolved = await resolvePaymentReconciliationCase({ caseId: terminalCase.id, resolution: "resolved", note: "terminal state verified", resolvedByUserId: reviewer.id });
        assert.equal(resolved.status, "resolved");

        const reconciliationOrder = await createOrder({ userId: user.id, suffix: `${suffix}:reconcile`, status: "awaiting_payment", kind: "cosmetic_item", grantSnapshot: cosmeticSnapshot });
        const reconciled = await reconcilePaytrOrder({
            order: reconciliationOrder,
            credentials: { merchantId: "123", merchantKey: "key", merchantSalt: "salt" },
            query: async () => ({ status: "success", paymentAmountMinor: 10_000, paymentTotalMinor: 10_000, currency: "TRY", testMode: true, returnCount: 0 }),
            now: new Date(),
            retryDelayMinutes: 15,
        });
        assert.equal(reconciled, "fulfilled");
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: reconciliationOrder.id } })).status, "fulfilled");
        assert.equal((await prisma.paymentReconciliationCase.findUniqueOrThrow({ where: { orderId: reconciliationOrder.id } })).status, "resolved");
    } finally {
        await prisma.notification.deleteMany({ where: { userId: user.id } });
        await prisma.paymentProviderRefundAttempt.deleteMany({ where: { reversalRequest: { order: { userId: user.id } } } });
        await prisma.paymentReversalRequest.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentReversal.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentReconciliationCase.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentWebhookEvent.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentCoinLot.deleteMany({ where: { wallet: { userId: user.id } } });
        await prisma.paymentFulfillment.deleteMany({ where: { order: { userId: user.id } } });
        await prisma.paymentOrder.deleteMany({ where: { userId: user.id } });
        await prisma.inventoryItem.deleteMany({ where: { userId: user.id } });
        await prisma.walletLedgerEntry.deleteMany({ where: { wallet: { userId: user.id } } });
        await prisma.wallet.deleteMany({ where: { userId: user.id } });
        await prisma.userProfile.deleteMany({ where: { userId: user.id } });
        await prisma.user.deleteMany({ where: { id: { in: [user.id, requester.id, reviewer.id] } } });
        await prisma.shopItem.deleteMany({ where: { id: { in: [paidItem.id, unrelatedItem.id] } } });
        await prisma.$disconnect();
    }
    console.log("Payment reconciliation, case resolution and dual-approval reversal integration checks passed");
}

void run();
