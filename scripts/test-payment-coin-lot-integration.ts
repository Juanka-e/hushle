import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@hushle/platform-db";
import {
    approvePaymentReversalRequest,
    fulfillPaidPaymentOrder,
    PaymentManualReviewError,
    requestExternallyConfirmedPaymentReversal,
    resolvePaymentManualReview,
} from "@hushle/platform-payments";
import {
    applyWalletLedgerMutation,
    WalletLedgerInsufficientBalanceError,
} from "@hushle/platform-wallet";

async function run(): Promise<void> {
    assert.equal(process.env.PAYMENT_COIN_LOT_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
    const user = await prisma.user.create({
        data: {
            username: `coin_lot_${suffix}`,
            password: "integration-test",
            wallet: { create: { coinBalance: 100 } },
        },
    });
    const requester = await prisma.user.create({
        data: { username: `coin_req_${suffix}`, password: "integration-test", role: "admin" },
    });
    const reviewer = await prisma.user.create({
        data: { username: `coin_rev_${suffix}`, password: "integration-test", role: "admin" },
    });
    const order = await prisma.paymentOrder.create({
        data: {
            id: randomUUID(),
            userId: user.id,
            provider: "paytr",
            status: "paid",
            idempotencyKey: `coin-lot:${suffix}`,
            requestFingerprint: "d".repeat(64),
            productKind: "coin_pack",
            productReference: `coin_pack_${suffix}`,
            productVersion: 1,
            productNameSnapshot: "Integration Coin Pack",
            quantity: 1,
            unitAmountMinor: 10_000,
            totalAmountMinor: 10_000,
            currency: "TRY",
            grantSnapshot: { schemaVersion: 1, coinAmount: 500 },
            paidAt: new Date(),
        },
    });

    try {
        const fulfillment = await fulfillPaidPaymentOrder({ orderId: order.id });
        assert.equal(fulfillment.grant.kind, "coin_pack");
        if (fulfillment.grant.kind !== "coin_pack" || !fulfillment.grant.coinLotId) {
            assert.fail("coin fulfillment must contain a lot id");
        }
        const coinLotId = fulfillment.grant.coinLotId;
        assert.equal((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).coinBalance, 600);

        await prisma.$transaction((tx) => applyWalletLedgerMutation(tx, {
            userId: user.id,
            source: "store_item_purchase",
            deltaCoin: -80,
            idempotencyKey: `coin-lot:${suffix}:earned-first`,
        }));
        let lot = await prisma.paymentCoinLot.findUniqueOrThrow({ where: { id: coinLotId } });
        assert.equal(lot.remainingCoin, 500, "non-payment balance must be consumed first");

        const mixedDebit = await prisma.$transaction((tx) => applyWalletLedgerMutation(tx, {
            userId: user.id,
            source: "store_item_purchase",
            deltaCoin: -70,
            idempotencyKey: `coin-lot:${suffix}:mixed`,
        }));
        lot = await prisma.paymentCoinLot.findUniqueOrThrow({ where: { id: coinLotId } });
        assert.equal(lot.remainingCoin, 450);
        assert.equal(lot.spentCoin, 50);
        assert.equal(
            await prisma.paymentCoinLotAllocation.aggregate({
                where: { lotId: coinLotId, ledgerEntryId: mixedDebit.ledgerEntryId },
                _sum: { amountCoin: true },
            }).then((result) => result._sum.amountCoin),
            50
        );

        const request = await requestExternallyConfirmedPaymentReversal({
            orderId: order.id,
            outcome: "refund",
            externalReference: `coin-refund-${suffix}`,
            reason: "coin lot race test",
            requestedByUserId: requester.id,
        });
        const raced = await Promise.allSettled([
            approvePaymentReversalRequest({
                requestId: request.id,
                reviewedByUserId: reviewer.id,
                reviewNote: "approved coin refund",
            }),
            prisma.$transaction(
                (tx) => applyWalletLedgerMutation(tx, {
                    userId: user.id,
                    source: "store_bundle_purchase",
                    deltaCoin: -100,
                    idempotencyKey: `coin-lot:${suffix}:race-debit`,
                }),
                { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
            ),
        ]);
        assert.equal(raced[0]?.status, "fulfilled", "reversal approval must complete");
        if (raced[1]?.status === "rejected") {
            assert.ok(raced[1].reason instanceof WalletLedgerInsufficientBalanceError);
        }

        const finalWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
        lot = await prisma.paymentCoinLot.findUniqueOrThrow({ where: { id: coinLotId } });
        const reversal = await prisma.paymentReversal.findUniqueOrThrow({ where: { orderId: order.id } });
        assert.equal(finalWallet.coinBalance, 0);
        assert.equal(lot.remainingCoin, 0);
        assert.equal(lot.spentCoin + lot.reversedCoin, lot.grantedCoin);
        assert.equal(reversal.status, "manual_review");
        const evidence = reversal.evidence as Record<string, unknown>;
        assert.equal(Number(evidence.reversedCoin) + Number(evidence.unrecoveredCoin), 500);
        const reviewCase = await prisma.paymentManualReviewCase.findUniqueOrThrow({
            where: { reversalId: reversal.id },
        });
        assert.equal(reviewCase.status, "open");
        assert.equal(reviewCase.reasonCode, "coin_spent_unrecovered");
        assert.equal(reviewCase.unrecoveredCoin, Number(evidence.unrecoveredCoin));

        await assert.rejects(
            resolvePaymentManualReview({
                reversalId: reversal.id,
                decision: "resolved",
                resolutionNote: "must not resolve as player",
                resolvedByUserId: user.id,
                notifyUser: false,
            }),
            (error: unknown) => error instanceof PaymentManualReviewError
                && error.code === "admin_actor_required"
        );
        const resolved = await resolvePaymentManualReview({
            reversalId: reversal.id,
            decision: "resolved",
            resolutionNote: "provider evidence and paid coin usage reviewed",
            resolvedByUserId: reviewer.id,
            notifyUser: true,
            noticeMessage: "Ödeme incelemeniz tamamlandı. Destek ekibimizle iletişime geçebilirsiniz.",
        });
        assert.equal(resolved.status, "resolved");
        assert.equal(resolved.resolvedByUserId, reviewer.id);
        assert.ok(resolved.noticeSentAt);
        assert.equal(await prisma.notification.count({
            where: { userId: user.id, resourceType: "payment_manual_review_case", resourceId: resolved.id },
        }), 1);
        await assert.rejects(
            resolvePaymentManualReview({
                reversalId: reversal.id,
                decision: "waived",
                resolutionNote: "duplicate resolution attempt",
                resolvedByUserId: reviewer.id,
                notifyUser: true,
            }),
            (error: unknown) => error instanceof PaymentManualReviewError
                && error.code === "case_not_open"
        );
        assert.equal(await prisma.notification.count({
            where: { userId: user.id, resourceType: "payment_manual_review_case", resourceId: resolved.id },
        }), 1);
        assert.equal(await prisma.walletLedgerEntry.count({
            where: { walletId: finalWallet.id, source: "payment_reversal" },
        }), 1);
    } finally {
        await prisma.notification.deleteMany({ where: { userId: user.id } });
        await prisma.paymentManualReviewCase.deleteMany({ where: { reversal: { orderId: order.id } } });
        await prisma.paymentReversalRequest.deleteMany({ where: { orderId: order.id } });
        await prisma.paymentReversal.deleteMany({ where: { orderId: order.id } });
        await prisma.paymentCoinLot.deleteMany({ where: { orderId: order.id } });
        await prisma.paymentFulfillment.deleteMany({ where: { orderId: order.id } });
        await prisma.paymentOrder.deleteMany({ where: { id: order.id } });
        await prisma.walletLedgerEntry.deleteMany({ where: { wallet: { userId: user.id } } });
        await prisma.wallet.deleteMany({ where: { userId: user.id } });
        await prisma.user.deleteMany({ where: { id: { in: [user.id, requester.id, reviewer.id] } } });
        await prisma.$disconnect();
    }
    console.log("Payment coin lot race and reversal integration checks passed");
}

void run();
