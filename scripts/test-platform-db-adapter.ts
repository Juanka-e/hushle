import assert from "node:assert/strict";
import {
    DEFAULT_DATABASE_CONNECTION_LIMIT,
    createPrismaClient,
    getUniqueConstraintTarget,
    isRetryableWriteConflict,
    resolveDatabasePoolConfig,
} from "../packages/platform-db/src/index";

// Pool settings for the MariaDB driver adapter (Prisma 7) and the error helpers that read
// both Prisma 6 and Prisma 7 error shapes.

const noEnv = {};

{
    const config = resolveDatabasePoolConfig("mysql://hushle:secret@mysql:3306/hushle", noEnv);
    assert.deepEqual(config, {
        host: "mysql",
        port: 3306,
        user: "hushle",
        password: "secret",
        database: "hushle",
        connectionLimit: DEFAULT_DATABASE_CONNECTION_LIMIT,
        connectTimeout: 5_000,
        acquireTimeout: 10_000,
        minimumIdle: 0,
        idleTimeout: 300,
        allowPublicKeyRetrieval: true,
    });
    assert.equal(DEFAULT_DATABASE_CONNECTION_LIMIT, 20);
}

{
    const config = resolveDatabasePoolConfig("mysql://us%40er:p%40ss%3Aw%2Frd@db.internal/tabu%5Ftest", noEnv);
    assert.equal(config.user, "us@er", "user names are URL-decoded");
    assert.equal(config.password, "p@ss:w/rd", "passwords are URL-decoded");
    assert.equal(config.database, "tabu_test");
    assert.equal(config.port, 3306, "the MySQL port is the default");
    assert.equal(resolveDatabasePoolConfig("mysql://root@[::1]:3307/tabu_test", noEnv).host, "::1", "IPv6 hosts lose their brackets");
    assert.equal(resolveDatabasePoolConfig("mariadb://root@localhost/db", noEnv).host, "localhost", "mariadb:// is accepted too");
    assert.equal(resolveDatabasePoolConfig("mysql://root@localhost/db", noEnv).password, "", "a missing password is empty");
}

{
    const url = "mysql://root@localhost/db";
    assert.equal(resolveDatabasePoolConfig(url, { DATABASE_CONNECTION_LIMIT: "7" }).connectionLimit, 7);
    assert.equal(resolveDatabasePoolConfig(url, { DATABASE_CONNECTION_LIMIT: "100" }).connectionLimit, 100);
    for (const invalid of ["0", "101", "abc", "5.5", "-3", "", " "]) {
        assert.equal(
            resolveDatabasePoolConfig(url, { DATABASE_CONNECTION_LIMIT: invalid }).connectionLimit,
            20,
            `DATABASE_CONNECTION_LIMIT=${JSON.stringify(invalid)} falls back to the default`
        );
    }
    assert.equal(
        resolveDatabasePoolConfig(`${url}?connection_limit=3`, { DATABASE_CONNECTION_LIMIT: "7" }).connectionLimit,
        3,
        "connection_limit in the URL wins, as with Prisma 6"
    );
    assert.throws(() => resolveDatabasePoolConfig(`${url}?connection_limit=0`, noEnv), /connection_limit/);
    assert.throws(() => resolveDatabasePoolConfig(`${url}?connection_limit=many`, noEnv), /connection_limit/);
}

{
    const config = resolveDatabasePoolConfig("mysql://root@localhost/db?connect_timeout=2&pool_timeout=30&socket_timeout=60", noEnv);
    assert.equal(config.connectTimeout, 2_000, "connect_timeout is in seconds");
    assert.equal(config.acquireTimeout, 30_000, "pool_timeout is in seconds");
    assert.equal(config.socketTimeout, 60_000, "socket_timeout is in seconds");
    assert.equal("socketTimeout" in resolveDatabasePoolConfig("mysql://root@localhost/db", noEnv), false, "no socket timeout unless asked for");
    for (const bad of ["connect_timeout=0", "pool_timeout=abc", "socket_timeout=3601", "connect_timeout=1.5"]) {
        assert.throws(() => resolveDatabasePoolConfig(`mysql://root@localhost/db?${bad}`, noEnv), /whole number of seconds/, bad);
    }
}

{
    assert.throws(
        () => resolveDatabasePoolConfig("mysql://root@localhost/db?sslaccept=strict", noEnv),
        /parameter sslaccept is not supported/,
        "a TLS setting is refused instead of silently dropped"
    );
    assert.throws(() => resolveDatabasePoolConfig("mysql://root@localhost/db?socket=/tmp/mysql.sock", noEnv), /socket is not supported/);
    assert.throws(() => resolveDatabasePoolConfig("postgresql://root@localhost/db", noEnv), /must use mysql:\/\//);
    assert.throws(() => resolveDatabasePoolConfig("mysql://root@localhost/", noEnv), /no database name/);
    assert.throws(() => resolveDatabasePoolConfig("not a url", noEnv), /not a valid mysql:\/\/ URL/);
}

// Unique violations: Prisma 7 (driver adapter) and Prisma 6 (engine) shapes.
const prisma7Unique = {
    code: "P2002",
    meta: {
        modelName: "WalletLedgerEntry",
        driverAdapterError: {
            name: "DriverAdapterError",
            cause: {
                originalCode: "1062",
                kind: "UniqueConstraintViolation",
                constraint: { index: "wallet_ledger_entries_idempotency_key_key" },
                table: "wallet_ledger_entries",
            },
        },
    },
};
assert.equal(getUniqueConstraintTarget(prisma7Unique), "wallet_ledger_entries_idempotency_key_key");
assert.equal(getUniqueConstraintTarget({ code: "P2002", meta: { target: "users_username_key" } }), "users_username_key");
assert.equal(getUniqueConstraintTarget({ code: "P2002", meta: { target: ["campaign_id", "user_id"] } }), "campaign_id,user_id");
assert.equal(
    getUniqueConstraintTarget({ code: "P2002", meta: { driverAdapterError: { cause: { constraint: { fields: ["code"] } } } } }),
    "code"
);
assert.equal(getUniqueConstraintTarget({ code: "P2002" }), null, "a P2002 without details names nothing");
assert.equal(getUniqueConstraintTarget({ code: "P2034", meta: { target: "x" } }), null, "only P2002 is a unique violation");
for (const notAnError of [null, undefined, "P2002", 2002, new Error("P2002")]) {
    assert.equal(getUniqueConstraintTarget(notAnError), null);
}

// Retryable write conflicts.
const prisma7RawDeadlock = {
    code: "P2010",
    meta: {
        driverAdapterError: {
            name: "DriverAdapterError",
            cause: {
                originalCode: "1213",
                originalMessage: "Deadlock found when trying to get lock; try restarting transaction",
                kind: "TransactionWriteConflict",
            },
        },
    },
};
assert.equal(isRetryableWriteConflict(prisma7RawDeadlock), true, "Prisma 7 raw deadlock");
assert.equal(isRetryableWriteConflict({ code: "P2010", meta: { code: "1213", message: "Deadlock" } }), true, "Prisma 6 raw deadlock");
assert.equal(isRetryableWriteConflict({ code: "P2010", meta: { code: 1213 } }), true, "a numeric MySQL code");
assert.equal(isRetryableWriteConflict({ code: "P2010", meta: { driverAdapterError: { cause: { kind: "TransactionWriteConflict" } } } }), true);
assert.equal(isRetryableWriteConflict({ code: "P2034" }), true, "Prisma's own write conflict");
assert.equal(isRetryableWriteConflict({ ...prisma7Unique, code: "P2010" }), false, "a raw duplicate key is not retried");
assert.equal(isRetryableWriteConflict({ code: "P2010", meta: { code: "1205" } }), false, "a lock wait timeout is not a deadlock");
assert.equal(isRetryableWriteConflict(prisma7Unique), false);
for (const notAnError of [null, undefined, "P2034", 1213, new Error("Deadlock")]) {
    assert.equal(isRetryableWriteConflict(notAnError), false);
}

async function checkClientWithoutUrl(): Promise<void> {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
        // Importing and creating a client works without DATABASE_URL (the image build); queries fail.
        const client = createPrismaClient();
        await assert.rejects(client.$queryRaw`SELECT 1`, /DATABASE_URL is not set/);
        await client.$disconnect();
    } finally {
        if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
}

checkClientWithoutUrl()
    .then(() => console.log("Platform DB adapter checks passed."))
    .catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
