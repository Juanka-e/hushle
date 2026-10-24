import { Prisma, getUniqueConstraintTarget, type WalletLedgerSource } from "@hushle/platform-db";

const MAX_COIN_BALANCE = 2_147_483_647;

type TransactionClient = Prisma.TransactionClient;

type LockedWallet = {
    id: number;
    userId: number;
    coinBalance: number;
    updatedAt: Date;
};

export type WalletLedgerMutationResult = {
    ledgerEntryId: number;
    walletId: number;
    balanceBefore: number;
    balanceAfter: number;
    duplicate: boolean;
};

export class WalletLedgerInsufficientBalanceError extends Error {
    constructor() {
        super("Wallet balance is insufficient for this operation.");
        this.name = "WalletLedgerInsufficientBalanceError";
    }
}

export class WalletCoinProvenanceInvariantError extends Error {
    constructor(message = "Wallet payment coin provenance is inconsistent.") {
        super(message);
        this.name = "WalletCoinProvenanceInvariantError";
    }
}

function assertCoinInteger(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_COIN_BALANCE) {
        throw new RangeError(`${field} must be a safe 32-bit coin integer.`);
    }
}

export function resolveWalletBalanceAfterDelta(balanceBefore: number, deltaCoin: number): number {
    assertCoinInteger(balanceBefore, "balanceBefore");
    assertCoinInteger(deltaCoin, "deltaCoin");

    const balanceAfter = balanceBefore + deltaCoin;
    if (!Number.isSafeInteger(balanceAfter) || balanceAfter > MAX_COIN_BALANCE) {
        throw new RangeError("Wallet balance exceeds the supported coin range.");
    }
    if (balanceAfter < 0) {
        throw new WalletLedgerInsufficientBalanceError();
    }
    return balanceAfter;
}

/**
 * Opens the user's wallet with a zero balance if it does not exist yet. Safe
 * when several requests open the same wallet at once. Callers whose
 * transaction may roll back should call it with the plain client before the
 * transaction, so the new row is committed and nobody queues behind it.
 */
export async function ensureWallet(tx: TransactionClient, userId: number): Promise<void> {
    // Same plain read Prisma's upsert issued, so existing wallets lock as before.
    const existing = await tx.wallet.findUnique({
        where: { userId },
        select: { id: true },
    });
    if (existing) return;

    // Prisma's upsert is a read followed by an INSERT on MySQL, so two first
    // opens could both insert and one failed on wallets_user_id_key. The
    // duplicate check of ON DUPLICATE KEY UPDATE takes an exclusive lock, so
    // later openers wait for the first insert and reuse its row. INSERT IGNORE
    // would take shared locks, and two holders deadlock on SELECT ... FOR UPDATE.
    await tx.$executeRaw`
        INSERT INTO wallets (user_id, coin_balance, updated_at)
        VALUES (${userId}, 0, ${new Date()})
        ON DUPLICATE KEY UPDATE user_id = user_id
    `;
}

async function lockWallet(tx: TransactionClient, userId: number): Promise<LockedWallet> {
    await ensureWallet(tx, userId);

    const rows = await tx.$queryRaw<LockedWallet[]>(Prisma.sql`
        SELECT
            id,
            user_id AS userId,
            coin_balance AS coinBalance,
            updated_at AS updatedAt
        FROM wallets
        WHERE user_id = ${userId}
        FOR UPDATE
    `);
    const wallet = rows[0];
    if (!wallet) {
        throw new Error(`Wallet lock failed for user ${userId}.`);
    }
    return wallet;
}

// Prisma's update first re-reads the row from the transaction snapshot, which
// can predate a wallet opened by a concurrent first mutation, and then fails
// with "record not found". updateMany is a single UPDATE on the locked row.
async function writeLockedWalletBalance(
    tx: TransactionClient,
    walletId: number,
    coinBalance: number
): Promise<void> {
    const updated = await tx.wallet.updateMany({
        where: { id: walletId },
        data: { coinBalance },
    });
    if (updated.count !== 1) {
        throw new Error(`Wallet balance update failed for wallet ${walletId}.`);
    }
}

async function ensureWalletLedgerBaseline(
    tx: TransactionClient,
    wallet: LockedWallet,
    source: Extract<WalletLedgerSource, "legacy_balance_snapshot" | "account_opening"> = "legacy_balance_snapshot"
) {
    assertCoinInteger(wallet.coinBalance, "wallet.coinBalance");
    if (wallet.coinBalance < 0) {
        throw new Error("Existing wallet balance cannot be negative.");
    }

    const existing = await tx.walletLedgerEntry.findFirst({
        where: { walletId: wallet.id },
        orderBy: { id: "asc" },
        select: { id: true },
    });
    if (existing) {
        return existing;
    }

    // The read above uses the transaction snapshot. When that snapshot is
    // older than the locked wallet row, an opening entry committed while this
    // transaction waited for the lock is invisible to it, so look it up with a
    // locking read. Inserting a duplicate instead would fail, and in
    // repeatable read the rolled-back insert leaves a gap lock at the end of
    // the ledger table that deadlocks concurrent ledger inserts.
    const idempotencyKey = `wallet:${wallet.id}:opening`;
    if (!(await snapshotShowsLockedWallet(tx, wallet))) {
        const committed = await findCommittedLedgerEntry(tx, idempotencyKey);
        if (committed) return { id: committed.id };
    }
    try {
        return await tx.walletLedgerEntry.create({
            data: {
                walletId: wallet.id,
                source,
                deltaCoin: wallet.coinBalance,
                balanceBefore: 0,
                balanceAfter: wallet.coinBalance,
                idempotencyKey,
                referenceType: source === "account_opening" ? "user_registration" : "wallet_migration",
                referenceId: String(wallet.userId),
                metadata: {
                    strategy: source === "account_opening" ? "account_opening" : "lazy_legacy_snapshot",
                },
            },
            select: { id: true },
        });
    } catch (error) {
        const committed = isIdempotencyKeyConflict(error)
            ? await findCommittedLedgerEntry(tx, idempotencyKey)
            : null;
        if (!committed) throw error;
        return { id: committed.id };
    }
}

// True when this transaction's snapshot shows the locked wallet row as it is
// now. Every ledger write changes the wallet row in its transaction, except
// the opening entry written with a brand-new wallet, so a snapshot that shows
// the current row cannot be missing a committed entry of this wallet.
async function snapshotShowsLockedWallet(
    tx: TransactionClient,
    wallet: LockedWallet
): Promise<boolean> {
    const seen = await tx.wallet.findUnique({
        where: { id: wallet.id },
        select: { coinBalance: true, updatedAt: true },
    });
    return seen !== null
        && seen.coinBalance === wallet.coinBalance
        && seen.updatedAt.getTime() === new Date(wallet.updatedAt).getTime();
}

type LedgerEntryIdentity = {
    id: number;
    walletId: number;
    balanceBefore: number;
    balanceAfter: number;
};

function duplicateMutationResult(
    entry: LedgerEntryIdentity,
    wallet: LockedWallet
): WalletLedgerMutationResult {
    if (entry.walletId !== wallet.id) {
        throw new Error("Wallet ledger idempotency key belongs to a different wallet.");
    }
    return {
        ledgerEntryId: entry.id,
        walletId: entry.walletId,
        balanceBefore: entry.balanceBefore,
        balanceAfter: entry.balanceAfter,
        duplicate: true,
    };
}

// A locking read returns the latest committed row, not the snapshot version.
async function findCommittedLedgerEntry(
    tx: TransactionClient,
    idempotencyKey: string
): Promise<LedgerEntryIdentity | null> {
    const rows = await tx.$queryRaw<LedgerEntryIdentity[]>(Prisma.sql`
        SELECT
            id,
            wallet_id AS walletId,
            balance_before AS balanceBefore,
            balance_after AS balanceAfter
        FROM wallet_ledger_entries
        WHERE idempotency_key = ${idempotencyKey}
        FOR SHARE
    `);
    const row = rows[0];
    return row
        ? {
            id: Number(row.id),
            walletId: Number(row.walletId),
            balanceBefore: Number(row.balanceBefore),
            balanceAfter: Number(row.balanceAfter),
        }
        : null;
}

function isIdempotencyKeyConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError
        && (getUniqueConstraintTarget(error)?.includes("idempotency") ?? false);
}

async function allocatePaymentCoinLotsForDebit(
    tx: TransactionClient,
    wallet: LockedWallet,
    ledgerEntryId: number,
    debitCoin: number
): Promise<void> {
    // Every lot writer holds the wallet lock first, so after it these rows are
    // final. A locking read sees them even when the transaction snapshot
    // predates a top-up that committed while this debit waited for the wallet.
    // The (wallet_id, created_at) index keeps the scan on this wallet's rows:
    // with an equality-only range InnoDB stops at the next wallet's entry
    // without locking its row. The (wallet_id, remaining_coin, created_at)
    // index has a range on remaining_coin, so the scan also locked the next
    // wallet's lot row, while that wallet's own debit locks its row first and
    // then rewrites the same index entry: two debits on neighbouring wallets
    // deadlocked. Spent lots are filtered after the scan.
    const lots = (await tx.$queryRaw<Array<{ id: string; remainingCoin: number }>>(Prisma.sql`
        SELECT id, remaining_coin AS remainingCoin
        FROM payment_coin_lots FORCE INDEX (payment_coin_lots_wallet_id_created_at_idx)
        WHERE wallet_id = ${wallet.id}
        ORDER BY created_at ASC, id ASC
        FOR UPDATE
    `))
        .map((lot) => ({ id: lot.id, remainingCoin: Number(lot.remainingCoin) }))
        .filter((lot) => lot.remainingCoin > 0);
    const trackedPaymentCoin = lots.reduce((sum, lot) => sum + lot.remainingCoin, 0);
    if (!Number.isSafeInteger(trackedPaymentCoin) || trackedPaymentCoin > wallet.coinBalance) {
        throw new WalletCoinProvenanceInvariantError();
    }

    // Preserve refundable paid coin while non-payment coin is available.
    let paymentCoinToConsume = Math.max(
        0,
        debitCoin - (wallet.coinBalance - trackedPaymentCoin)
    );
    if (paymentCoinToConsume === 0) return;
    for (const lot of lots) {
        if (paymentCoinToConsume === 0) break;
        const amountCoin = Math.min(paymentCoinToConsume, lot.remainingCoin);
        const updated = await tx.paymentCoinLot.updateMany({
            where: { id: lot.id, remainingCoin: { gte: amountCoin } },
            data: {
                remainingCoin: { decrement: amountCoin },
                spentCoin: { increment: amountCoin },
            },
        });
        if (updated.count !== 1) throw new WalletCoinProvenanceInvariantError();
        await tx.paymentCoinLotAllocation.create({
            data: { lotId: lot.id, ledgerEntryId, amountCoin },
        });
        paymentCoinToConsume -= amountCoin;
    }
    if (paymentCoinToConsume !== 0) throw new WalletCoinProvenanceInvariantError();
}

export async function initializeWalletLedger(
    tx: TransactionClient,
    input: {
        userId: number;
        source: Extract<WalletLedgerSource, "legacy_balance_snapshot" | "account_opening">;
    }
): Promise<{ ledgerEntryId: number; walletId: number; coinBalance: number }> {
    const wallet = await lockWallet(tx, input.userId);
    const entry = await ensureWalletLedgerBaseline(tx, wallet, input.source);
    return {
        ledgerEntryId: entry.id,
        walletId: wallet.id,
        coinBalance: wallet.coinBalance,
    };
}

export async function applyWalletLedgerMutation(
    tx: TransactionClient,
    input: {
        userId: number;
        source: WalletLedgerSource;
        deltaCoin: number;
        idempotencyKey: string;
        referenceType?: string | null;
        referenceId?: string | number | null;
        actorUserId?: number | null;
        metadata?: Prisma.InputJsonValue;
    }
): Promise<WalletLedgerMutationResult> {
    assertCoinInteger(input.deltaCoin, "deltaCoin");
    if (input.deltaCoin === 0) {
        throw new RangeError("deltaCoin must not be zero for a wallet mutation.");
    }

    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 191) {
        throw new RangeError("idempotencyKey must contain 1-191 characters.");
    }

    const wallet = await lockWallet(tx, input.userId);
    await ensureWalletLedgerBaseline(tx, wallet);

    const existing = await tx.walletLedgerEntry.findUnique({
        where: { idempotencyKey },
        select: {
            id: true,
            walletId: true,
            balanceBefore: true,
            balanceAfter: true,
        },
    });
    if (existing) return duplicateMutationResult(existing, wallet);

    // The read above uses the transaction snapshot and can miss an entry with
    // the same key that a concurrent request committed while this one waited
    // for the wallet lock. That entry decides the outcome, so a balance error
    // or a key conflict below turns into a duplicate result when it exists.
    let balanceAfter: number;
    try {
        balanceAfter = resolveWalletBalanceAfterDelta(wallet.coinBalance, input.deltaCoin);
    } catch (error) {
        // A current snapshot already answered the duplicate question above.
        const committed = (await snapshotShowsLockedWallet(tx, wallet))
            ? null
            : await findCommittedLedgerEntry(tx, idempotencyKey);
        if (committed) return duplicateMutationResult(committed, wallet);
        throw error;
    }
    // Write the entry before the balance: a key conflict then leaves nothing
    // of this mutation behind.
    let ledgerEntry: { id: number };
    try {
        ledgerEntry = await tx.walletLedgerEntry.create({
            data: {
                walletId: wallet.id,
                source: input.source,
                deltaCoin: input.deltaCoin,
                balanceBefore: wallet.coinBalance,
                balanceAfter,
                idempotencyKey,
                referenceType: input.referenceType ?? null,
                referenceId:
                    input.referenceId === undefined || input.referenceId === null
                        ? null
                        : String(input.referenceId),
                actorUserId: input.actorUserId ?? null,
                metadata: input.metadata,
            },
            select: { id: true },
        });
    } catch (error) {
        const committed = isIdempotencyKeyConflict(error)
            ? await findCommittedLedgerEntry(tx, idempotencyKey)
            : null;
        if (!committed) throw error;
        return duplicateMutationResult(committed, wallet);
    }
    await writeLockedWalletBalance(tx, wallet.id, balanceAfter);
    if (input.deltaCoin < 0) {
        await allocatePaymentCoinLotsForDebit(
            tx,
            wallet,
            ledgerEntry.id,
            Math.abs(input.deltaCoin)
        );
    }

    return {
        ledgerEntryId: ledgerEntry.id,
        walletId: wallet.id,
        balanceBefore: wallet.coinBalance,
        balanceAfter,
        duplicate: false,
    };
}

// A duplicate top-up entry may have been committed after this transaction's
// snapshot; its lot is read the same way, past the snapshot.
async function findCommittedCoinLotForOrder(
    tx: TransactionClient,
    orderId: string
): Promise<{ id: string; walletId: number; grantLedgerEntryId: number; grantedCoin: number } | null> {
    const rows = await tx.$queryRaw<Array<{
        id: string;
        walletId: number;
        grantLedgerEntryId: number;
        grantedCoin: number;
    }>>(Prisma.sql`
        SELECT
            id,
            wallet_id AS walletId,
            grant_ledger_entry_id AS grantLedgerEntryId,
            granted_coin AS grantedCoin
        FROM payment_coin_lots
        WHERE order_id = ${orderId}
        FOR SHARE
    `);
    const row = rows[0];
    return row
        ? {
            id: row.id,
            walletId: Number(row.walletId),
            grantLedgerEntryId: Number(row.grantLedgerEntryId),
            grantedCoin: Number(row.grantedCoin),
        }
        : null;
}

export async function grantPaymentCoinLot(
    tx: TransactionClient,
    input: {
        userId: number;
        orderId: string;
        coinAmount: number;
        idempotencyKey: string;
        metadata?: Prisma.InputJsonValue;
    }
): Promise<WalletLedgerMutationResult & { coinLotId: string }> {
    assertCoinInteger(input.coinAmount, "coinAmount");
    if (input.coinAmount <= 0) throw new RangeError("coinAmount must be positive.");

    const mutation = await applyWalletLedgerMutation(tx, {
        userId: input.userId,
        source: "payment_topup",
        deltaCoin: input.coinAmount,
        idempotencyKey: input.idempotencyKey,
        referenceType: "payment_order",
        referenceId: input.orderId,
        metadata: input.metadata,
    });
    const existing = await tx.paymentCoinLot.findUnique({
        where: { orderId: input.orderId },
        select: { id: true, walletId: true, grantLedgerEntryId: true, grantedCoin: true },
    }) ?? (mutation.duplicate ? await findCommittedCoinLotForOrder(tx, input.orderId) : null);
    if (existing) {
        if (
            existing.walletId !== mutation.walletId
            || existing.grantLedgerEntryId !== mutation.ledgerEntryId
            || existing.grantedCoin !== input.coinAmount
        ) {
            throw new WalletCoinProvenanceInvariantError("Payment coin lot identity conflict.");
        }
        return { ...mutation, coinLotId: existing.id };
    }
    if (mutation.duplicate) {
        throw new WalletCoinProvenanceInvariantError("Payment top-up ledger exists without its coin lot.");
    }
    const lot = await tx.paymentCoinLot.create({
        data: {
            orderId: input.orderId,
            walletId: mutation.walletId,
            grantLedgerEntryId: mutation.ledgerEntryId,
            grantedCoin: input.coinAmount,
            remainingCoin: input.coinAmount,
        },
        select: { id: true },
    });
    return { ...mutation, coinLotId: lot.id };
}

export type PaymentCoinLotReversalResult = {
    coinLotId: string;
    reversedCoin: number;
    unrecoveredCoin: number;
    reversalLedgerEntryId: number | null;
    balanceAfter: number;
};

export async function reversePaymentCoinLot(
    tx: TransactionClient,
    input: {
        userId: number;
        orderId: string;
        coinLotId: string;
        reversalRequestId: string;
        metadata?: Prisma.InputJsonValue;
    }
): Promise<PaymentCoinLotReversalResult> {
    const wallet = await lockWallet(tx, input.userId);
    await ensureWalletLedgerBaseline(tx, wallet);
    // Lock order matches debits and grants: wallet row first, then the lot.
    const lotRows = await tx.$queryRaw<Array<{
        id: string;
        orderId: string;
        walletId: number;
        grantedCoin: number;
        remainingCoin: number;
        spentCoin: number;
        reversedCoin: number;
        reversalLedgerEntryId: number | null;
    }>>(Prisma.sql`
        SELECT
            id,
            order_id AS orderId,
            wallet_id AS walletId,
            granted_coin AS grantedCoin,
            remaining_coin AS remainingCoin,
            spent_coin AS spentCoin,
            reversed_coin AS reversedCoin,
            reversal_ledger_entry_id AS reversalLedgerEntryId
        FROM payment_coin_lots
        WHERE id = ${input.coinLotId}
        FOR UPDATE
    `);
    const lot = lotRows[0];
    if (!lot || lot.orderId !== input.orderId || Number(lot.walletId) !== wallet.id) {
        throw new WalletCoinProvenanceInvariantError("Payment coin lot was not found.");
    }
    if (lot.grantedCoin !== lot.remainingCoin + lot.spentCoin + lot.reversedCoin) {
        throw new WalletCoinProvenanceInvariantError();
    }
    if (lot.reversalLedgerEntryId !== null || lot.reversedCoin > 0) {
        throw new WalletCoinProvenanceInvariantError("Payment coin lot was already reversed.");
    }
    if (lot.remainingCoin > wallet.coinBalance) throw new WalletCoinProvenanceInvariantError();

    const reversedCoin = lot.remainingCoin;
    if (reversedCoin === 0) {
        return {
            coinLotId: lot.id,
            reversedCoin: 0,
            unrecoveredCoin: lot.spentCoin,
            reversalLedgerEntryId: null,
            balanceAfter: wallet.coinBalance,
        };
    }
    const balanceAfter = resolveWalletBalanceAfterDelta(wallet.coinBalance, -reversedCoin);
    await writeLockedWalletBalance(tx, wallet.id, balanceAfter);
    const ledgerEntry = await tx.walletLedgerEntry.create({
        data: {
            walletId: wallet.id,
            source: "payment_reversal",
            deltaCoin: -reversedCoin,
            balanceBefore: wallet.coinBalance,
            balanceAfter,
            idempotencyKey: `payment-reversal:${input.reversalRequestId}:coin`,
            referenceType: "payment_order",
            referenceId: input.orderId,
            metadata: input.metadata,
        },
        select: { id: true },
    });
    const updated = await tx.paymentCoinLot.updateMany({
        where: { id: lot.id, remainingCoin: reversedCoin, reversalLedgerEntryId: null },
        data: {
            remainingCoin: 0,
            reversedCoin: { increment: reversedCoin },
            reversalLedgerEntryId: ledgerEntry.id,
        },
    });
    if (updated.count !== 1) throw new WalletCoinProvenanceInvariantError();
    return {
        coinLotId: lot.id,
        reversedCoin,
        unrecoveredCoin: lot.spentCoin,
        reversalLedgerEntryId: ledgerEntry.id,
        balanceAfter,
    };
}
