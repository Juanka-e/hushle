import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
    Prisma,
    WalletLedgerSource,
    createPrismaClient,
    getUniqueConstraintTarget,
    isRetryableWriteConflict,
} from "../packages/platform-db/src/index";

// What the code relies on from the database driver, checked against real MySQL: the error
// helpers recognise real unique violations and deadlocks, isolation levels reach MySQL, and
// dates keep their instant and milliseconds. A Prisma or driver upgrade that changes any of
// these fails here instead of in wallet retries or checkout control.

async function rejectionOf(work: Promise<unknown>): Promise<unknown> {
    try {
        await work;
    } catch (error) {
        return error;
    }
    assert.fail("expected the database to refuse");
}

async function run(): Promise<void> {
    assert.equal(process.env.PLATFORM_DB_ADAPTER_INTEGRATION_TEST, "true", "PLATFORM_DB_ADAPTER_INTEGRATION_TEST=true is required");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/, "A disposable tabu_test database is required");

    const prisma = createPrismaClient();
    const other = createPrismaClient();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const userIds: number[] = [];
    try {
        const first = await prisma.user.create({ data: { username: `adapter_a_${suffix}`, password: "x", role: "user" } });
        const second = await prisma.user.create({ data: { username: `adapter_b_${suffix}`, password: "x", role: "user" } });
        userIds.push(first.id, second.id);

        const duplicateUser = await rejectionOf(
            prisma.user.create({ data: { username: first.username, password: "x", role: "user" } })
        );
        assert.ok(duplicateUser instanceof Prisma.PrismaClientKnownRequestError);
        assert.equal(duplicateUser.code, "P2002");
        assert.match(getUniqueConstraintTarget(duplicateUser) ?? "", /username/, "a duplicate user names the username index");
        assert.equal(isRetryableWriteConflict(duplicateUser), false);

        await prisma.$executeRaw`INSERT INTO wallets (user_id, coin_balance, updated_at) VALUES (${first.id}, 0, ${new Date()})`;
        const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: first.id } });
        const entry = {
            walletId: wallet.id,
            source: Object.values(WalletLedgerSource)[0],
            deltaCoin: 0,
            balanceBefore: 0,
            balanceAfter: 0,
            idempotencyKey: `adapter:${suffix}`,
        };
        await prisma.walletLedgerEntry.create({ data: entry });
        const duplicateEntry = await rejectionOf(prisma.$transaction((tx) => tx.walletLedgerEntry.create({ data: entry })));
        assert.match(
            getUniqueConstraintTarget(duplicateEntry) ?? "",
            /idempotency/,
            "a replayed ledger entry inside a transaction names the idempotency index (wallet replays rely on it)"
        );
        console.log("  ok unique violations name their index");

        // Two transactions lock two rows in opposite order; MySQL aborts one of them.
        async function deadlockError(raw: boolean): Promise<unknown> {
            let lockedRows = 0;
            let bothLocked!: () => void;
            const barrier = new Promise<void>((resolve) => {
                bothLocked = resolve;
            });
            const lockInOrder = (client: typeof prisma, firstId: number, thenId: number) =>
                client.$transaction(async (tx) => {
                    const touch = (id: number) =>
                        raw
                            ? tx.$executeRaw`UPDATE users SET password = ${`lock-${id}`} WHERE id = ${id}`
                            : tx.user.update({ where: { id }, data: { password: `lock-${id}` } });
                    await touch(firstId);
                    lockedRows += 1;
                    if (lockedRows === 2) bothLocked();
                    await barrier;
                    await touch(thenId);
                }, { timeout: 20_000 });
            const results = await Promise.allSettled([
                lockInOrder(prisma, first.id, second.id),
                lockInOrder(other, second.id, first.id),
            ]);
            const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
            assert.equal(rejected.length, 1, `exactly one ${raw ? "raw" : "ORM"} transaction is the deadlock victim`);
            return rejected[0].reason;
        }
        const ormDeadlock = await deadlockError(false);
        assert.equal((ormDeadlock as { code?: string }).code, "P2034");
        assert.equal(isRetryableWriteConflict(ormDeadlock), true, "an ORM deadlock is retryable");
        const rawDeadlock = await deadlockError(true);
        assert.equal((rawDeadlock as { code?: string }).code, "P2010");
        assert.equal(isRetryableWriteConflict(rawDeadlock), true, "a raw-SQL deadlock is retryable (checkout control relies on it)");
        console.log("  ok deadlocks are recognised as retryable");

        async function seenAcrossCommit(level: Prisma.TransactionIsolationLevel): Promise<string> {
            await prisma.user.update({ where: { id: second.id }, data: { password: "before" } });
            return prisma.$transaction(async (tx) => {
                const read = async () =>
                    (await tx.$queryRaw<Array<{ password: string }>>`SELECT password FROM users WHERE id = ${second.id}`)[0].password;
                const before = await read();
                await other.user.update({ where: { id: second.id }, data: { password: "after" } });
                return `${before}->${await read()}`;
            }, { isolationLevel: level });
        }
        assert.equal(await seenAcrossCommit(Prisma.TransactionIsolationLevel.ReadCommitted), "before->after");
        assert.equal(await seenAcrossCommit(Prisma.TransactionIsolationLevel.RepeatableRead), "before->before");
        let writerFinished = false;
        let writer: Promise<unknown> = Promise.resolve();
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT password FROM users WHERE id = ${second.id}`;
            writer = other.user.update({ where: { id: second.id }, data: { password: "late" } }).then(() => {
                writerFinished = true;
            });
            await sleep(1_000);
            assert.equal(writerFinished, false, "a serializable read holds back a concurrent writer");
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
        await writer;
        assert.equal(writerFinished, true);
        console.log("  ok isolation levels reach MySQL");

        const instant = new Date("2026-03-29T00:30:15.123Z"); // inside a DST change for many zones
        await prisma.user.update({ where: { id: first.id }, data: { createdAt: instant } });
        assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: first.id } })).createdAt.toISOString(), instant.toISOString());
        await prisma.$executeRaw`UPDATE users SET created_at = ${instant} WHERE id = ${second.id}`;
        const rawRows = await prisma.$queryRaw<Array<{ createdAt: Date; storedText: string }>>`
            SELECT created_at AS createdAt, CAST(created_at AS CHAR) AS storedText FROM users WHERE id = ${second.id}`;
        assert.equal(rawRows[0].storedText, "2026-03-29 00:30:15.123", "dates are stored as UTC with milliseconds");
        assert.equal(rawRows[0].createdAt.toISOString(), instant.toISOString());
        assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: second.id } })).createdAt.toISOString(), instant.toISOString());
        console.log("  ok dates keep their instant");

        const counted = await prisma.$queryRaw<Array<{ total: unknown; sum: unknown }>>`
            SELECT COUNT(*) AS total, SUM(id) AS sum FROM users WHERE id IN (${first.id}, ${second.id})`;
        assert.equal(typeof counted[0].total, "bigint", "COUNT(*) comes back as bigint");
        assert.equal(Number(counted[0].sum), first.id + second.id);
        console.log("  ok raw result types");
    } finally {
        if (userIds.length > 0) {
            await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
            await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        }
        await Promise.all([prisma.$disconnect(), other.$disconnect()]);
    }
}

run()
    .then(() => console.log("Platform DB adapter integration checks passed."))
    .catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
