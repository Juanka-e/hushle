import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ensureUserProfile, Prisma, prisma } from "@hushle/platform-db";
import { fulfillPaidPaymentOrder } from "@hushle/platform-payments";
import { updatePlayerProfile } from "@hushle/platform-player";
import {
    applyWalletLedgerMutation,
    ensureWallet,
    WalletLedgerInsufficientBalanceError,
    type WalletLedgerMutationResult,
} from "@hushle/platform-wallet";
import { applyAdminWalletAdjustment } from "../apps/web/src/lib/admin-user-operations/service";
import { redeemCoinGrantCode } from "../apps/web/src/lib/coin-grants/service";
import { ensureUserCore } from "../apps/web/src/lib/economy";

// A burst queues on one wallet lock. Leave room above Prisma's interactive
// transaction defaults (2 s wait, 5 s run) so a slow CI host does not time out.
const TX_OPTIONS = { maxWait: 20_000, timeout: 30_000 };

const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const createdUserIds: number[] = [];
const createdOrderIds: string[] = [];
const createdCampaignIds: number[] = [];
let counter = 0;

function nextHandle(label: string): string {
    counter += 1;
    return `wcc_${runId}_${label}${counter}`;
}

async function createUser(
    label: string,
    options: { coinBalance?: number; role?: string } = {}
): Promise<number> {
    const handle = nextHandle(label);
    const user = await prisma.user.create({
        data: {
            username: handle,
            email: `${handle}@example.test`,
            normalizedEmail: `${handle}@example.test`,
            password: "integration-test-only",
            role: options.role ?? "user",
            ...(options.coinBalance === undefined
                ? {}
                : { wallet: { create: { coinBalance: options.coinBalance } } }),
        },
        select: { id: true },
    });
    createdUserIds.push(user.id);
    return user.id;
}

async function createPaidCoinOrder(userId: number, coinAmount: number): Promise<string> {
    const id = randomUUID();
    await prisma.paymentOrder.create({
        data: {
            id,
            userId,
            provider: "paytr",
            status: "paid",
            idempotencyKey: `wcc:${runId}:${id}`,
            requestFingerprint: "e".repeat(64),
            productKind: "coin_pack",
            productReference: `coin_pack_${runId}`,
            productVersion: 1,
            productNameSnapshot: "Integration Coin Pack",
            quantity: 1,
            unitAmountMinor: 1_000,
            totalAmountMinor: 1_000,
            currency: "TRY",
            grantSnapshot: { schemaVersion: 1, coinAmount },
            paidAt: new Date(),
        },
    });
    createdOrderIds.push(id);
    return id;
}

function describeFailure(reason: unknown): string {
    if (reason instanceof WalletLedgerInsufficientBalanceError) return "insufficient_balance";
    if (reason instanceof Prisma.PrismaClientKnownRequestError) {
        return `${reason.code} ${JSON.stringify(reason.meta ?? {})}`;
    }
    if (reason instanceof Error) {
        const code = "code" in reason ? ` ${String((reason as { code: unknown }).code)}` : "";
        return `${reason.name}${code}: ${reason.message.trim().split("\n").at(-1)}`;
    }
    return String(reason);
}

function assertNoFailures(label: string, results: PromiseSettledResult<unknown>[]): void {
    const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => describeFailure(result.reason));
    console.log(
        `${label}: ${results.length - failures.length}/${results.length} ok`
            + (failures.length > 0 ? `, failures: ${[...new Set(failures)].join(" | ")}` : "")
    );
    assert.deepEqual(failures, [], `${label} must not fail`);
}

async function assertLedgerChain(userId: number): Promise<{ id: number; coinBalance: number }> {
    const wallets = await prisma.wallet.findMany({
        where: { userId },
        include: { ledgerEntries: { orderBy: { id: "asc" } } },
    });
    assert.equal(wallets.length, 1, "a user must have exactly one wallet row");
    const wallet = wallets[0]!;
    const [opening, ...mutations] = wallet.ledgerEntries;
    assert.ok(opening, "the wallet must have an opening entry");
    assert.equal(opening.idempotencyKey, `wallet:${wallet.id}:opening`);
    let balance = opening.balanceAfter;
    for (const entry of mutations) {
        assert.equal(entry.balanceBefore, balance, `ledger chain breaks at entry ${entry.id}`);
        assert.equal(entry.balanceAfter, entry.balanceBefore + entry.deltaCoin);
        assert.ok(entry.balanceAfter >= 0);
        balance = entry.balanceAfter;
    }
    assert.equal(wallet.coinBalance, balance, "wallet balance must match the last ledger entry");
    return { id: wallet.id, coinBalance: wallet.coinBalance };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A wallet-touching transaction fails while admin adjustments and coin
// fulfillments for the same, wallet-less user wait behind it. Every path opens
// the wallet before its transaction, so the failure leaves nothing to deadlock on.
async function rollbackWhileOthersWait(adminId: number): Promise<void> {
    for (let round = 1; round <= 3; round += 1) {
        const userId = await createUser("rollback");
        const orderIds = await Promise.all([1, 2, 3].map(() => createPaidCoinOrder(userId, 25)));
        const opener = (async () => {
            await ensureWallet(prisma, userId);
            await prisma.$transaction(async (tx) => {
                await applyWalletLedgerMutation(tx, {
                    userId,
                    source: "admin_adjustment",
                    deltaCoin: 5,
                    idempotencyKey: `wcc:${runId}:rollback:${userId}`,
                });
                await sleep(250);
                throw new Error("planned rollback");
            }, TX_OPTIONS);
        })().then(() => "committed", () => "rolled back");
        await sleep(60);
        const waiters = await Promise.allSettled([
            ...[11, 12, 13].map(async (amount) => {
                const result = await applyAdminWalletAdjustment({
                    admin: { id: adminId, role: "admin", name: "integration" },
                    targetUserId: userId,
                    adjustment: { adjustmentType: "credit", amount, reason: "integration credit" },
                });
                assert.ok(result.ok, "admin credit must succeed");
                return result;
            }),
            ...orderIds.map((orderId) => fulfillPaidPaymentOrder({ orderId })),
        ]);
        assert.equal(await opener, "rolled back");
        assertNoFailures(`rollback with 6 waiters, round ${round}`, waiters);
        const wallet = await assertLedgerChain(userId);
        assert.equal(wallet.coinBalance, 11 + 12 + 13 + 3 * 25, "only the waiters' coin is applied");
    }
}

async function concurrentProfileOpens(): Promise<void> {
    const userId = await createUser("profile", { coinBalance: 0 });
    const results = await Promise.allSettled([
        ...Array.from({ length: 8 }, () => ensureUserCore(userId)),
        ...Array.from({ length: 6 }, (_, index) => updatePlayerProfile({
            userId,
            patch: { displayName: `Integration ${index}` },
            auditContext: { actorRole: "user" },
        })),
        ...Array.from({ length: 6 }, (_, index) =>
            index % 2 === 0
                ? ensureUserProfile(prisma, userId)
                : prisma.$transaction(async (tx) => {
                    await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true } });
                    await ensureUserProfile(tx, userId);
                }, TX_OPTIONS)
        ),
    ]);
    assertNoFailures("concurrent profile opens and edits", results);
    const profiles = await prisma.userProfile.findMany({ where: { userId } });
    assert.equal(profiles.length, 1, "a user must have exactly one profile row");
    assert.match(profiles[0]!.displayName ?? "", /^Integration [0-5]$/, "the last edit must stick");
}

// Paid coin only: every debit must spend lots while top-ups add new ones.
async function paidCoinDebitsRacingTopUps(): Promise<void> {
    const userId = await createUser("lots", { coinBalance: 0 });
    await fulfillPaidPaymentOrder({ orderId: await createPaidCoinOrder(userId, 200) });
    const topUps = await Promise.all(Array.from({ length: 10 }, () => createPaidCoinOrder(userId, 50)));
    const results = await Promise.allSettled([
        ...topUps.map((orderId) => fulfillPaidPaymentOrder({ orderId })),
        // Admin debits run in repeatable read and read before the wallet lock,
        // so their snapshot predates top-ups that commit while they wait.
        ...Array.from({ length: 10 }, (_, index) => prisma.$transaction(async (tx) => {
            await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true } });
            return applyWalletLedgerMutation(tx, {
                userId,
                source: "admin_adjustment",
                deltaCoin: -30,
                idempotencyKey: `wcc:${runId}:lots:${index}`,
            });
        }, TX_OPTIONS)),
    ]);
    results.forEach((result, index) => {
        if (result.status === "fulfilled") return;
        assert.ok(index >= topUps.length, `a top-up must not fail: ${describeFailure(result.reason)}`);
        assert.ok(
            result.reason instanceof WalletLedgerInsufficientBalanceError,
            `only an insufficient-balance debit may fail, got ${describeFailure(result.reason)}`
        );
    });
    const applied = results.filter((result) => result.status === "fulfilled").length;
    console.log(`paid-coin debits racing top-ups: ${applied}/${results.length} applied, the rest insufficient balance`);

    const probe = await prisma.$transaction((tx) => applyWalletLedgerMutation(tx, {
        userId,
        source: "admin_adjustment",
        deltaCoin: -1,
        idempotencyKey: `wcc:${runId}:lots:probe`,
    }), TX_OPTIONS);
    assert.equal(probe.duplicate, false, "a later debit must still find consistent lots");

    const wallet = await assertLedgerChain(userId);
    const lots = await prisma.paymentCoinLot.findMany({ where: { walletId: wallet.id } });
    assert.equal(lots.length, 11);
    assert.equal(
        lots.reduce((sum, lot) => sum + lot.remainingCoin, 0),
        wallet.coinBalance,
        "with paid coin only, unspent lots must equal the wallet balance"
    );
    for (const lot of lots) {
        assert.equal(lot.grantedCoin, lot.remainingCoin + lot.spentCoin + lot.reversedCoin);
    }
    const debits = await prisma.walletLedgerEntry.findMany({
        where: { walletId: wallet.id, deltaCoin: { lt: 0 } },
        include: { paymentCoinLotAllocations: true },
    });
    for (const debit of debits) {
        assert.equal(
            debit.paymentCoinLotAllocations.reduce((sum, allocation) => sum + allocation.amountCoin, 0),
            -debit.deltaCoin,
            "each debit must be fully allocated to paid lots"
        );
    }
}

async function sameKeyAtOnce(): Promise<void> {
    const userId = await createUser("samekey", { coinBalance: 100 });
    await prisma.$transaction((tx) => applyWalletLedgerMutation(tx, {
        userId,
        source: "admin_adjustment",
        deltaCoin: 1,
        idempotencyKey: `wcc:${runId}:samekey:seed`,
    }));
    for (const [label, deltaCoin] of [["credit", 7], ["debit", -80]] as const) {
        const settled = await Promise.allSettled(Array.from({ length: 10 }, () => prisma.$transaction(async (tx) => {
            await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true } });
            return applyWalletLedgerMutation(tx, {
                userId,
                source: "admin_adjustment",
                deltaCoin,
                idempotencyKey: `wcc:${runId}:samekey:${label}`,
            });
        }, TX_OPTIONS)));
        assertNoFailures(`same key x10 at once (${label})`, settled);
        const results = settled.map((result) => (result as PromiseFulfilledResult<WalletLedgerMutationResult>).value);
        assert.equal(results.filter((result) => !result.duplicate).length, 1, "the key applies once");
        assert.equal(new Set(results.map((result) => result.ledgerEntryId)).size, 1, "every request reports the same entry");
    }
    const wallet = await assertLedgerChain(userId);
    assert.equal(wallet.coinBalance, 100 + 1 + 7 - 80);
}

async function createCampaign(input: {
    coinAmount: number;
    perUserClaimLimit: number;
    totalBudgetCoin?: number;
    codes: Array<{ maxClaims?: number }>;
}): Promise<{ campaignId: number; codes: string[] }> {
    counter += 1;
    const campaign = await prisma.coinGrantCampaign.create({
        data: {
            code: `WCC${runId}${counter}`.toUpperCase(),
            name: "Integration campaign",
            coinAmount: input.coinAmount,
            perUserClaimLimit: input.perUserClaimLimit,
            totalBudgetCoin: input.totalBudgetCoin ?? null,
        },
    });
    createdCampaignIds.push(campaign.id);
    const codes = await Promise.all(input.codes.map(async (code, index) => (await prisma.coinGrantCode.create({
        data: {
            campaignId: campaign.id,
            code: `WCC-${runId}-${counter}-${index}`.toUpperCase(),
            maxClaims: code.maxClaims ?? null,
        },
    })).code));
    return { campaignId: campaign.id, codes };
}

async function concurrentCoinGrantRedemptions(): Promise<void> {
    // Ten players share one code; one player redeems five codes at once.
    const open = await createCampaign({ coinAmount: 10, perUserClaimLimit: 5, codes: [{}, {}, {}, {}, {}, {}] });
    const players = await Promise.all(Array.from({ length: 10 }, () => createUser("grant", { coinBalance: 0 })));
    const collector = await createUser("collector", { coinBalance: 0 });
    const shared = open.codes[0]!;
    const results = await Promise.allSettled([
        ...players.map((userId) => redeemCoinGrantCode({ userId, redeem: { code: shared } })),
        ...open.codes.slice(1).map((code) => redeemCoinGrantCode({ userId: collector, redeem: { code } })),
    ]);
    assertNoFailures("coin grant redemptions at once", results);
    for (const result of results) {
        assert.ok(result.status === "fulfilled" && result.value.ok, "every redemption must succeed");
    }
    const campaign = await prisma.coinGrantCampaign.findUniqueOrThrow({ where: { id: open.campaignId } });
    assert.equal(campaign.totalClaimCount, 15);
    assert.equal(campaign.totalGrantedCoin, 150);
    assert.equal(await prisma.coinGrantClaim.count({ where: { campaignId: open.campaignId } }), 15);
    assert.equal((await assertLedgerChain(collector)).coinBalance, 50);
    for (const userId of players) {
        assert.equal((await assertLedgerChain(userId)).coinBalance, 10);
    }

    // Limits still hold under contention: budget for three claims, a code
    // that allows two, and a per-user limit of one.
    const limited = await createCampaign({
        coinAmount: 10,
        perUserClaimLimit: 1,
        totalBudgetCoin: 30,
        codes: [{}, { maxClaims: 2 }, {}, {}],
    });
    const budgetPlayers = await Promise.all(Array.from({ length: 8 }, () => createUser("budget", { coinBalance: 0 })));
    const budgetResults = await Promise.all(
        budgetPlayers.map((userId) => redeemCoinGrantCode({ userId, redeem: { code: limited.codes[0]! } }))
    );
    assert.equal(budgetResults.filter((result) => result.ok).length, 3, "the budget allows exactly three claims");
    assert.ok(budgetResults.filter((result) => !result.ok).every((result) => !result.ok && result.code === "campaign_budget_exhausted"));

    const codeLimited = await createCampaign({ coinAmount: 5, perUserClaimLimit: 1, codes: [{ maxClaims: 2 }] });
    const codePlayers = await Promise.all(Array.from({ length: 6 }, () => createUser("codecap", { coinBalance: 0 })));
    const codeResults = await Promise.all(
        codePlayers.map((userId) => redeemCoinGrantCode({ userId, redeem: { code: codeLimited.codes[0]! } }))
    );
    assert.equal(codeResults.filter((result) => result.ok).length, 2, "the code allows exactly two claims");
    assert.ok(codeResults.filter((result) => !result.ok).every((result) => !result.ok && result.code === "code_claim_limit_reached"));

    const single = await createCampaign({ coinAmount: 5, perUserClaimLimit: 1, codes: [{}, {}, {}] });
    const singleUser = await createUser("single", { coinBalance: 0 });
    const singleResults = await Promise.all(
        single.codes.map((code) => redeemCoinGrantCode({ userId: singleUser, redeem: { code } }))
    );
    assert.equal(singleResults.filter((result) => result.ok).length, 1, "the per-user limit allows one claim");
    assert.ok(singleResults.filter((result) => !result.ok).every((result) => !result.ok && result.code === "user_claim_limit_reached"));
    assert.equal((await assertLedgerChain(singleUser)).coinBalance, 5);
}

async function cleanup(): Promise<void> {
    await prisma.coinGrantClaim.deleteMany({ where: { campaignId: { in: createdCampaignIds } } });
    await prisma.coinGrantCampaign.deleteMany({ where: { id: { in: createdCampaignIds } } });
    await prisma.paymentCoinLot.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.paymentFulfillment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.paymentOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.walletAdjustment.deleteMany({ where: { targetUserId: { in: createdUserIds } } });
    await prisma.walletLedgerEntry.deleteMany({ where: { wallet: { userId: { in: createdUserIds } } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
}

async function run(): Promise<void> {
    assert.equal(
        process.env.WALLET_CONCURRENCY_INTEGRATION_TEST,
        "true",
        "WALLET_CONCURRENCY_INTEGRATION_TEST=true is required"
    );
    assert.match(
        process.env.DATABASE_URL ?? "",
        /tabu_test/,
        "Wallet concurrency integration test requires a tabu_test database"
    );

    try {
        const adminId = await createUser("admin", { role: "admin" });
        await rollbackWhileOthersWait(adminId);
        await concurrentProfileOpens();
        await paidCoinDebitsRacingTopUps();
        await sameKeyAtOnce();
        await concurrentCoinGrantRedemptions();
    } finally {
        await cleanup();
        await prisma.$disconnect();
    }

    console.log("test:wallet-concurrency-integration ok");
}

void run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
