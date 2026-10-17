import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, prisma, type WalletLedgerSource } from "@hushle/platform-db";
import {
    applyWalletLedgerMutation,
    ensureWallet,
    initializeWalletLedger,
    WalletLedgerInsufficientBalanceError,
    type WalletLedgerMutationResult,
} from "@hushle/platform-wallet";

const BURST = 20;
const ROUNDS = 3;
// A burst queues on one wallet lock. Leave room above Prisma's interactive
// transaction defaults (2 s wait, 5 s run) so a slow CI host does not time out.
const TX_OPTIONS = { maxWait: 20_000, timeout: 30_000 };

const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const createdUserIds: number[] = [];
let userCounter = 0;

type MutationOp = {
    key: string;
    deltaCoin: number;
    // Read inside the transaction before touching the wallet, like purchases
    // and match rewards do, so the snapshot predates concurrent commits.
    readFirst: boolean;
};

type LedgerWallet = Prisma.WalletGetPayload<{ include: { ledgerEntries: true } }>;

function nextHandle(label: string): string {
    userCounter += 1;
    return `wfo_${runId}_${label}${userCounter}`;
}

async function createUser(label: string, coinBalance?: number): Promise<number> {
    const handle = nextHandle(label);
    const user = await prisma.user.create({
        data: {
            username: handle,
            email: `${handle}@example.test`,
            normalizedEmail: `${handle}@example.test`,
            password: "integration-test-only",
            ...(coinBalance === undefined ? {} : { wallet: { create: { coinBalance } } }),
        },
        select: { id: true },
    });
    createdUserIds.push(user.id);
    return user.id;
}

function mutate(userId: number, op: MutationOp): Promise<WalletLedgerMutationResult> {
    return prisma.$transaction(async (tx) => {
        if (op.readFirst) {
            await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true } });
        }
        return applyWalletLedgerMutation(tx, {
            userId,
            source: "admin_adjustment",
            deltaCoin: op.deltaCoin,
            idempotencyKey: op.key,
            referenceType: "integration_test",
            referenceId: runId,
        });
    }, TX_OPTIONS);
}

function describeFailure(reason: unknown): string {
    if (reason instanceof WalletLedgerInsufficientBalanceError) return "insufficient_balance";
    if (reason instanceof Prisma.PrismaClientKnownRequestError) {
        return `${reason.code} ${JSON.stringify(reason.meta ?? {})}`;
    }
    if (reason instanceof Error) {
        return `${reason.name}: ${reason.message.trim().split("\n").at(-1)}`;
    }
    return String(reason);
}

function summarize(label: string, results: PromiseSettledResult<unknown>[]): string[] {
    const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => describeFailure(result.reason));
    console.log(
        `${label}: ${results.length - failures.length}/${results.length} ok`
            + (failures.length > 0 ? `, failures: ${[...new Set(failures)].join(" | ")}` : "")
    );
    return failures;
}

function assertNoFailures(label: string, results: PromiseSettledResult<unknown>[]): void {
    const failures = summarize(label, results);
    assert.deepEqual(failures, [], `${label} must not fail`);
}

async function readWallet(userId: number): Promise<LedgerWallet> {
    const wallets = await prisma.wallet.findMany({
        where: { userId },
        include: { ledgerEntries: { orderBy: { id: "asc" } } },
    });
    assert.equal(wallets.length, 1, "a user must have exactly one wallet row");
    return wallets[0]!;
}

function assertLedger(
    wallet: LedgerWallet,
    expected: { openingCoin: number; openingSource: WalletLedgerSource; mutationCount: number }
): void {
    const openingKey = `wallet:${wallet.id}:opening`;
    const [opening, ...mutations] = wallet.ledgerEntries;
    assert.ok(opening, "the wallet must have an opening entry");
    assert.equal(
        wallet.ledgerEntries.filter(
            (entry) =>
                entry.idempotencyKey === openingKey
                || entry.source === "legacy_balance_snapshot"
                || entry.source === "account_opening"
        ).length,
        1,
        "exactly one opening entry"
    );
    assert.equal(opening.idempotencyKey, openingKey, "the opening entry must come first");
    assert.equal(opening.source, expected.openingSource);
    assert.equal(opening.balanceBefore, 0);
    assert.equal(opening.deltaCoin, expected.openingCoin);
    assert.equal(opening.balanceAfter, expected.openingCoin);
    assert.equal(mutations.length, expected.mutationCount);

    let balance = opening.balanceAfter;
    for (const entry of mutations) {
        assert.equal(entry.balanceBefore, balance, `ledger chain breaks at entry ${entry.id}`);
        assert.equal(entry.balanceAfter, entry.balanceBefore + entry.deltaCoin);
        assert.ok(entry.balanceAfter >= 0, "balance must never go negative");
        balance = entry.balanceAfter;
    }
    assert.equal(wallet.coinBalance, balance, "wallet balance must match the last ledger entry");
    assert.equal(
        wallet.ledgerEntries.reduce((sum, entry) => sum + entry.deltaCoin, 0),
        wallet.coinBalance,
        "wallet balance must equal the sum of ledger deltas"
    );
}

function assertResultsMatchLedger(
    wallet: LedgerWallet,
    ops: MutationOp[],
    results: PromiseSettledResult<WalletLedgerMutationResult>[]
): void {
    results.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const entry = wallet.ledgerEntries.find((row) => row.id === result.value.ledgerEntryId);
        assert.ok(entry, "every result must point at a ledger entry");
        assert.equal(entry.idempotencyKey, ops[index]!.key);
        assert.equal(entry.walletId, wallet.id);
        assert.equal(result.value.walletId, wallet.id);
        assert.equal(result.value.balanceBefore, entry.balanceBefore);
        assert.equal(result.value.balanceAfter, entry.balanceAfter);
    });
}

function buildOps(label: string, deltas: number[]): MutationOp[] {
    return deltas.map((deltaCoin, index) => ({
        key: `wfo:${runId}:${label}:${index}`,
        deltaCoin,
        readFirst: index % 2 === 0,
    }));
}

async function firstOpenBurst(round: number): Promise<{ userId: number; ops: MutationOp[]; results: WalletLedgerMutationResult[] }> {
    const userId = await createUser("burst");
    const ops = buildOps(`burst${round}`, Array.from({ length: BURST }, (_, index) => 10 + index));
    const settled = await Promise.allSettled(ops.map((op) => mutate(userId, op)));
    assertNoFailures(`first-open credit burst, round ${round}`, settled);

    const wallet = await readWallet(userId);
    assertLedger(wallet, {
        openingCoin: 0,
        openingSource: "legacy_balance_snapshot",
        mutationCount: BURST,
    });
    assert.equal(wallet.coinBalance, ops.reduce((sum, op) => sum + op.deltaCoin, 0));
    assertResultsMatchLedger(wallet, ops, settled);
    const results = settled.map((result) => (result as PromiseFulfilledResult<WalletLedgerMutationResult>).value);
    assert.ok(results.every((result) => result.duplicate === false));
    return { userId, ops, results };
}

async function idempotentRepeats(
    userId: number,
    ops: MutationOp[],
    firstResults: WalletLedgerMutationResult[]
): Promise<void> {
    const before = await readWallet(userId);
    const settled = await Promise.allSettled(ops.map((op) => mutate(userId, op)));
    assertNoFailures("concurrent idempotent repeats", settled);
    settled.forEach((result, index) => {
        assert.equal(result.status, "fulfilled");
        if (result.status !== "fulfilled") return;
        assert.equal(result.value.duplicate, true, "a repeated key must report duplicate");
        assert.equal(result.value.ledgerEntryId, firstResults[index]!.ledgerEntryId);
        assert.equal(result.value.balanceBefore, firstResults[index]!.balanceBefore);
        assert.equal(result.value.balanceAfter, firstResults[index]!.balanceAfter);
    });
    const after = await readWallet(userId);
    assert.equal(after.coinBalance, before.coinBalance, "repeats must not apply twice");
    assert.equal(after.ledgerEntries.length, before.ledgerEntries.length);
}

async function insufficientDebit(userId: number): Promise<void> {
    const before = await readWallet(userId);
    const failingKey = `wfo:${runId}:overdraw`;
    await assert.rejects(
        mutate(userId, { key: failingKey, deltaCoin: -(before.coinBalance + 1), readFirst: true }),
        WalletLedgerInsufficientBalanceError
    );
    const afterFailure = await readWallet(userId);
    assert.equal(afterFailure.coinBalance, before.coinBalance);
    assert.equal(afterFailure.ledgerEntries.length, before.ledgerEntries.length);
    assert.equal(
        await prisma.walletLedgerEntry.count({ where: { idempotencyKey: failingKey } }),
        0,
        "a rejected debit must not keep its idempotency key"
    );

    await mutate(userId, { key: `wfo:${runId}:topup`, deltaCoin: 1, readFirst: false });
    const retried = await mutate(userId, {
        key: failingKey,
        deltaCoin: -(before.coinBalance + 1),
        readFirst: false,
    });
    assert.equal(retried.duplicate, false);
    assert.equal(retried.balanceAfter, 0, "the same key succeeds once funds exist");
    const finalWallet = await readWallet(userId);
    assertLedger(finalWallet, {
        openingCoin: 0,
        openingSource: "legacy_balance_snapshot",
        mutationCount: before.ledgerEntries.length + 1,
    });
}

async function mixedFirstOpenWithPreparedWallet(): Promise<void> {
    // Purchases, coin grants and profile loads create the wallet before their
    // transaction; the mutations then race on a wallet with no ledger yet.
    const userId = await createUser("mixed");
    const deltas = Array.from({ length: BURST }, (_, index) => (index % 3 === 2 ? -25 : 40));
    const ops = buildOps("mixed", deltas);
    const settled = await Promise.allSettled(
        ops.map(async (op) => {
            await ensureWallet(prisma, userId);
            return mutate(userId, op);
        })
    );
    const failures = summarize("first-open credit/debit mix", settled);
    settled.forEach((result, index) => {
        if (result.status === "fulfilled") return;
        assert.ok(
            result.reason instanceof WalletLedgerInsufficientBalanceError,
            `only an insufficient-balance debit may fail, got ${describeFailure(result.reason)}`
        );
        assert.ok(ops[index]!.deltaCoin < 0, "a credit must never fail");
    });
    const applied = ops.filter((_, index) => settled[index]!.status === "fulfilled");
    assert.equal(applied.length, BURST - failures.length);

    const wallet = await readWallet(userId);
    assertLedger(wallet, {
        openingCoin: 0,
        openingSource: "legacy_balance_snapshot",
        mutationCount: applied.length,
    });
    assert.equal(wallet.coinBalance, applied.reduce((sum, op) => sum + op.deltaCoin, 0));
    assertResultsMatchLedger(wallet, ops, settled);
    const rejectedKeys = ops.filter((_, index) => settled[index]!.status === "rejected").map((op) => op.key);
    assert.equal(
        await prisma.walletLedgerEntry.count({ where: { idempotencyKey: { in: rejectedKeys } } }),
        0
    );
}

async function legacyWalletBurst(): Promise<void> {
    // Wallet rows created before the ledger (or by profile loads) have a
    // balance but no opening entry until their first mutation.
    const userId = await createUser("legacy", 1_000);
    const deltas = Array.from({ length: BURST }, (_, index) => (index % 5 < 3 ? 50 : -100));
    const ops = buildOps("legacy", deltas);
    const settled = await Promise.allSettled(ops.map((op) => mutate(userId, op)));
    assertNoFailures("legacy wallet first-ledger burst", settled);

    const wallet = await readWallet(userId);
    assertLedger(wallet, {
        openingCoin: 1_000,
        openingSource: "legacy_balance_snapshot",
        mutationCount: BURST,
    });
    assert.equal(wallet.coinBalance, 1_000 + deltas.reduce((sum, delta) => sum + delta, 0));
    assertResultsMatchLedger(wallet, ops, settled);
}

async function ensureWalletBurst(): Promise<void> {
    const userId = await createUser("ensure");
    const settled = await Promise.allSettled(
        Array.from({ length: BURST }, (_, index) =>
            index % 2 === 0
                ? ensureWallet(prisma, userId)
                : prisma.$transaction(async (tx) => {
                    await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true } });
                    await ensureWallet(tx, userId);
                }, TX_OPTIONS)
        )
    );
    assertNoFailures("concurrent ensureWallet", settled);
    const wallet = await readWallet(userId);
    assert.equal(wallet.coinBalance, 0, "a new wallet opens with zero coin");
    assert.equal(wallet.ledgerEntries.length, 0, "ensureWallet must not write ledger entries");
}

async function accountOpening(): Promise<void> {
    const startingCoin = 250;
    const handles = Array.from({ length: 10 }, () => nextHandle("register"));
    const settled = await Promise.allSettled(
        handles.map((handle) =>
            prisma.$transaction(async (tx) => {
                const user = await tx.user.create({
                    data: {
                        username: handle,
                        email: `${handle}@example.test`,
                        normalizedEmail: `${handle}@example.test`,
                        password: "integration-test-only",
                        wallet: { create: { coinBalance: startingCoin } },
                    },
                    select: { id: true },
                });
                createdUserIds.push(user.id);
                const opening = await initializeWalletLedger(tx, {
                    userId: user.id,
                    source: "account_opening",
                });
                return { userId: user.id, opening };
            }, TX_OPTIONS)
        )
    );
    assertNoFailures("concurrent account openings", settled);

    for (const result of settled) {
        if (result.status !== "fulfilled") continue;
        const { userId, opening } = result.value;
        const wallet = await readWallet(userId);
        assertLedger(wallet, {
            openingCoin: startingCoin,
            openingSource: "account_opening",
            mutationCount: 0,
        });
        assert.equal(opening.ledgerEntryId, wallet.ledgerEntries[0]!.id);
        assert.equal(opening.walletId, wallet.id);
        assert.equal(opening.coinBalance, startingCoin);
        assert.equal(wallet.ledgerEntries[0]!.referenceType, "user_registration");
    }

    const first = settled[0];
    assert.ok(first?.status === "fulfilled");
    const userId = first.value.userId;
    const ops = buildOps("opened", Array.from({ length: BURST }, (_, index) => (index % 2 === 0 ? 30 : -20)));
    const burst = await Promise.allSettled(ops.map((op) => mutate(userId, op)));
    assertNoFailures("mutations after account opening", burst);
    const wallet = await readWallet(userId);
    assertLedger(wallet, {
        openingCoin: startingCoin,
        openingSource: "account_opening",
        mutationCount: BURST,
    });
    assertResultsMatchLedger(wallet, ops, burst);

    const replay = await prisma.$transaction(
        (tx) => initializeWalletLedger(tx, { userId, source: "account_opening" }),
        TX_OPTIONS
    );
    assert.equal(replay.ledgerEntryId, wallet.ledgerEntries[0]!.id, "the opening entry is written once");
}

async function run(): Promise<void> {
    assert.equal(
        process.env.WALLET_FIRST_OPEN_INTEGRATION_TEST,
        "true",
        "WALLET_FIRST_OPEN_INTEGRATION_TEST=true is required"
    );
    assert.match(
        process.env.DATABASE_URL ?? "",
        /tabu_test/,
        "Wallet first-open integration test requires a tabu_test database"
    );

    try {
        let firstBurst: Awaited<ReturnType<typeof firstOpenBurst>> | null = null;
        for (let round = 1; round <= ROUNDS; round += 1) {
            const burst = await firstOpenBurst(round);
            firstBurst ??= burst;
        }
        await idempotentRepeats(firstBurst!.userId, firstBurst!.ops, firstBurst!.results);
        await insufficientDebit(firstBurst!.userId);
        await mixedFirstOpenWithPreparedWallet();
        await legacyWalletBurst();
        await ensureWalletBurst();
        await accountOpening();
    } finally {
        if (createdUserIds.length > 0) {
            await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
        }
        await prisma.$disconnect();
    }

    console.log("test:wallet-first-open-integration ok");
}

void run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
