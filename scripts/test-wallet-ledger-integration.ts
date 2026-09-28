import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@hushle/platform-db";
import { prisma } from "../apps/web/src/lib/prisma";
import {
    applyWalletLedgerMutation,
    WalletLedgerInsufficientBalanceError,
} from "../apps/web/src/lib/wallet-ledger/service";

async function run(): Promise<void> {
    assert.equal(
        process.env.WALLET_LEDGER_INTEGRATION_TEST,
        "true",
        "WALLET_LEDGER_INTEGRATION_TEST=true is required"
    );
    assert.match(
        process.env.DATABASE_URL ?? "",
        /tabu_test/,
        "Wallet ledger integration test requires a tabu_test database"
    );

    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const user = await prisma.user.create({
        data: {
            username: `ledger_${suffix}`,
            password: "integration-test-only",
            wallet: { create: { coinBalance: 100 } },
        },
        select: { id: true },
    });
    const firstKey = `integration:${suffix}:first`;
    const secondKey = `integration:${suffix}:second`;

    try {
        const attempts = await Promise.allSettled(
            [firstKey, secondKey].map((idempotencyKey) =>
                prisma.$transaction(
                    (tx) =>
                        applyWalletLedgerMutation(tx, {
                            userId: user.id,
                            source: "admin_adjustment",
                            deltaCoin: -80,
                            idempotencyKey,
                            referenceType: "integration_test",
                            referenceId: suffix,
                        }),
                    {
                        isolationLevel:
                            Prisma.TransactionIsolationLevel.ReadCommitted,
                    }
                )
            )
        );
        assert.equal(
            attempts.filter((attempt) => attempt.status === "fulfilled").length,
            1,
            "only one concurrent debit may succeed"
        );
        const rejected = attempts.find(
            (attempt): attempt is PromiseRejectedResult =>
                attempt.status === "rejected"
        );
        assert.ok(rejected?.reason instanceof WalletLedgerInsufficientBalanceError);

        const successfulKey =
            attempts[0]?.status === "fulfilled" ? firstKey : secondKey;
        const duplicate = await prisma.$transaction((tx) =>
            applyWalletLedgerMutation(tx, {
                userId: user.id,
                source: "admin_adjustment",
                deltaCoin: -80,
                idempotencyKey: successfulKey,
                referenceType: "integration_test",
                referenceId: suffix,
            })
        );
        assert.equal(duplicate.duplicate, true);

        const wallet = await prisma.wallet.findUniqueOrThrow({
            where: { userId: user.id },
            include: {
                ledgerEntries: {
                    orderBy: { id: "asc" },
                },
            },
        });
        assert.equal(wallet.coinBalance, 20);
        assert.equal(wallet.ledgerEntries.length, 2);
        assert.deepEqual(
            wallet.ledgerEntries.map((entry) => entry.deltaCoin),
            [100, -80]
        );
        assert.equal(wallet.ledgerEntries.at(-1)?.balanceAfter, wallet.coinBalance);
    } finally {
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.$disconnect();
    }

    console.log("test:wallet-ledger-integration ok");
}

void run();
