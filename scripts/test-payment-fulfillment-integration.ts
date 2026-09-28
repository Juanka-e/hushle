import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@hushle/platform-db";
import {
    PaymentFulfillmentError,
    fulfillPaidPaymentOrder,
} from "@hushle/platform-payments";

async function createPaidOrder(input: {
    userId: number;
    suffix: string;
    productKind: "coin_pack" | "cosmetic_item" | "cosmetic_bundle";
    grantSnapshot: Prisma.InputJsonValue;
    quantity?: number;
}) {
    return prisma.paymentOrder.create({
        data: {
            id: randomUUID(),
            userId: input.userId,
            provider: "paytr",
            providerConfigVersion: 1,
            status: "paid",
            idempotencyKey: `fulfillment:${input.suffix}`,
            requestFingerprint: "a".repeat(64),
            productKind: input.productKind,
            productReference: `product_${input.suffix}`,
            productVersion: 1,
            productNameSnapshot: `Product ${input.suffix}`,
            quantity: input.quantity ?? 1,
            unitAmountMinor: 100,
            totalAmountMinor: 100 * (input.quantity ?? 1),
            currency: "TRY",
            grantSnapshot: input.grantSnapshot,
            paidAt: new Date(),
        },
    });
}

async function run(): Promise<void> {
    assert.equal(
        process.env.PAYMENT_FULFILLMENT_INTEGRATION_TEST,
        "true",
        "PAYMENT_FULFILLMENT_INTEGRATION_TEST=true is required"
    );
    assert.match(
        process.env.DATABASE_URL ?? "",
        /tabu_test/,
        "Payment fulfillment integration test requires a tabu_test database"
    );

    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const user = await prisma.user.create({
        data: {
            username: `fulfill_${suffix}`,
            password: "integration-test-only",
        },
        select: { id: true },
    });
    const item = await prisma.shopItem.create({
        data: {
            code: `paid_avatar_${suffix}`,
            type: "avatar",
            name: "Paid Avatar",
            rarity: "epic",
            renderMode: "image",
            renderSpecVersion: 1,
            priceCoin: 0,
            imageUrl: "/images/paid-avatar.png",
        },
    });
    const secondItem = await prisma.shopItem.create({
        data: {
            code: `paid_frame_${suffix}`,
            type: "frame",
            name: "Paid Frame",
            rarity: "rare",
            renderMode: "image",
            renderSpecVersion: 1,
            priceCoin: 0,
            imageUrl: "/images/paid-frame.png",
        },
    });
    const renderSnapshot = {
        type: item.type,
        rarity: item.rarity,
        renderMode: item.renderMode,
        renderSpecVersion: item.renderSpecVersion,
        imageUrl: item.imageUrl,
        templateKey: item.templateKey,
        templateConfig: item.templateConfig,
        badgeText: item.badgeText,
    } as Prisma.InputJsonObject;

    try {
        const coinOrder = await createPaidOrder({
            userId: user.id,
            suffix: `${suffix}:coin`,
            productKind: "coin_pack",
            quantity: 2,
            grantSnapshot: {
                schemaVersion: 2,
                plan: { schemaVersion: 1, effects: [{
                    effectId: "paid-coin", type: "balance_credit",
                    assetCode: "COIN", amount: 250,
                }] },
            },
        });
        const concurrent = await Promise.all([
            fulfillPaidPaymentOrder({ orderId: coinOrder.id }),
            fulfillPaidPaymentOrder({ orderId: coinOrder.id }),
        ]);
        assert.equal(concurrent.filter((result) => !result.duplicate).length, 1);
        assert.equal(concurrent.filter((result) => result.duplicate).length, 1);

        const wallet = await prisma.wallet.findUniqueOrThrow({
            where: { userId: user.id },
            include: { ledgerEntries: true },
        });
        assert.equal(wallet.coinBalance, 500);
        assert.equal(
            wallet.ledgerEntries.filter((entry) => entry.source === "payment_topup").length,
            1
        );
        const coinLot = await prisma.paymentCoinLot.findUniqueOrThrow({
            where: { orderId: coinOrder.id },
        });
        assert.equal(coinLot.grantedCoin, 500);
        assert.equal(coinLot.remainingCoin, 500);
        assert.equal(
            coinLot.grantLedgerEntryId,
            wallet.ledgerEntries.find((entry) => entry.source === "payment_topup")?.id
        );
        assert.equal(
            (await prisma.paymentOrder.findUniqueOrThrow({ where: { id: coinOrder.id } })).status,
            "fulfilled"
        );

        const cosmeticOrder = await createPaidOrder({
            userId: user.id,
            suffix: `${suffix}:cosmetic`,
            productKind: "cosmetic_item",
            grantSnapshot: {
                schemaVersion: 1,
                items: [{ shopItemId: item.id, renderSnapshot }],
            },
        });
        const firstCosmetic = await fulfillPaidPaymentOrder({ orderId: cosmeticOrder.id });
        const duplicateCosmetic = await fulfillPaidPaymentOrder({ orderId: cosmeticOrder.id });
        assert.equal(firstCosmetic.duplicate, false);
        assert.equal(duplicateCosmetic.duplicate, true);
        assert.equal(
            await prisma.inventoryItem.count({
                where: { userId: user.id, shopItemId: item.id },
            }),
            1
        );

        const bundleOrder = await createPaidOrder({
            userId: user.id,
            suffix: `${suffix}:bundle-owned-race`,
            productKind: "cosmetic_bundle",
            grantSnapshot: {
                schemaVersion: 1,
                items: [
                    { shopItemId: item.id, renderSnapshot },
                    {
                        shopItemId: secondItem.id,
                        renderSnapshot: {
                            ...renderSnapshot,
                            type: secondItem.type,
                            rarity: secondItem.rarity,
                            imageUrl: secondItem.imageUrl,
                        },
                    },
                ],
            },
        });
        await assert.rejects(
            () => fulfillPaidPaymentOrder({ orderId: bundleOrder.id }),
            (error: unknown) =>
                error instanceof PaymentFulfillmentError
                && error.code === "grant_already_owned"
        );
        assert.equal(
            await prisma.inventoryItem.count({
                where: { userId: user.id, shopItemId: secondItem.id },
            }),
            0,
            "a rejected bundle must not partially grant unowned items"
        );

        const invalidOrder = await createPaidOrder({
            userId: user.id,
            suffix: `${suffix}:invalid`,
            productKind: "coin_pack",
            grantSnapshot: { schemaVersion: 1, coinAmount: 0 },
        });
        await assert.rejects(
            () => fulfillPaidPaymentOrder({ orderId: invalidOrder.id }),
            (error: unknown) =>
                error instanceof PaymentFulfillmentError
                && error.code === "invalid_grant_snapshot"
        );
        const failed = await prisma.paymentFulfillment.findUniqueOrThrow({
            where: { orderId: invalidOrder.id },
        });
        assert.equal(failed.status, "failed");
        assert.equal(failed.errorCode, "invalid_grant_snapshot");
        assert.equal(
            (await prisma.paymentOrder.findUniqueOrThrow({ where: { id: invalidOrder.id } })).status,
            "paid"
        );

        const unpaidOrder = await prisma.paymentOrder.create({
            data: {
                id: randomUUID(),
                userId: user.id,
                provider: "paytr",
                providerConfigVersion: 1,
                status: "awaiting_payment",
                idempotencyKey: `fulfillment:${suffix}:unpaid`,
                requestFingerprint: "b".repeat(64),
                productKind: "coin_pack",
                productReference: "unpaid_pack",
                productVersion: 1,
                productNameSnapshot: "Unpaid Pack",
                quantity: 1,
                unitAmountMinor: 100,
                totalAmountMinor: 100,
                currency: "TRY",
                grantSnapshot: { schemaVersion: 1, coinAmount: 9999 },
            },
        });
        await assert.rejects(
            () => fulfillPaidPaymentOrder({ orderId: unpaidOrder.id }),
            (error: unknown) =>
                error instanceof PaymentFulfillmentError
                && error.code === "order_not_paid"
        );
        assert.equal(
            await prisma.paymentFulfillment.count({ where: { orderId: unpaidOrder.id } }),
            0
        );
        assert.equal(
            (await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).coinBalance,
            500
        );
    } finally {
        await prisma.paymentCoinLot.deleteMany({ where: { wallet: { userId: user.id } } });
        await prisma.paymentFulfillment.deleteMany({
            where: { order: { userId: user.id } },
        });
        await prisma.paymentOrder.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.shopItem.delete({ where: { id: item.id } });
        await prisma.shopItem.delete({ where: { id: secondItem.id } });
        await prisma.$disconnect();
    }

    console.log("payment fulfillment integration checks passed");
}

void run();
