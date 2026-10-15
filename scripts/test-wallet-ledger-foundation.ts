import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    resolveWalletBalanceAfterDelta,
    WalletLedgerInsufficientBalanceError,
} from "../apps/web/src/lib/wallet-ledger/service";

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

assert.equal(resolveWalletBalanceAfterDelta(100, 25), 125);
assert.equal(resolveWalletBalanceAfterDelta(100, -80), 20);
assert.throws(
    () => resolveWalletBalanceAfterDelta(20, -21),
    WalletLedgerInsufficientBalanceError
);

const schema = read("prisma/schema.prisma");
for (const source of [
    "legacy_balance_snapshot",
    "account_opening",
    "match_reward",
    "store_item_purchase",
    "store_bundle_purchase",
    "coin_grant",
    "admin_adjustment",
    "payment_topup",
]) {
    assert.match(schema, new RegExp(`\\b${source}\\b`));
}
assert.match(schema, /idempotencyKey String\s+@unique/);
assert.match(schema, /@@index\(\[walletId, createdAt\]\)/);

const mutationPaths = [
    "apps/web/src/app/api/auth/register/route.ts",
    "apps/web/src/app/api/game/match/finalize/route.ts",
    "apps/web/src/lib/economy.ts",
    "apps/web/src/lib/coin-grants/service.ts",
    "apps/web/src/lib/admin-user-operations/service.ts",
];
for (const path of mutationPaths) {
    const source = read(path);
    assert.match(
        source,
        /initializeWalletLedger|applyWalletLedgerMutation/,
        `${path} must use the wallet ledger service`
    );
    assert.doesNotMatch(
        source,
        /wallet\.update\s*\(/,
        `${path} must not mutate wallet balance directly`
    );
}

const adminRoute = read(
    "apps/web/src/app/api/admin/users/[id]/wallet-ledger/route.ts"
);
assert.match(adminRoute, /requireAdminSession/);
assert.doesNotMatch(
    read("apps/web/src/lib/wallet-ledger/admin-service.ts"),
    /idempotencyKey|metadata:/,
    "admin response must not expose internal idempotency keys or metadata"
);

const walletPackage = read("packages/platform-wallet/src/index.ts");
assert.match(
    walletPackage,
    /INSERT INTO wallets[\s\S]*ON DUPLICATE KEY UPDATE user_id = user_id/,
    "wallet creation must queue concurrent first opens on an exclusive duplicate-key lock"
);
for (const path of [
    "packages/platform-wallet/src/index.ts",
    "apps/web/src/lib/economy.ts",
    "apps/web/src/lib/coin-grants/service.ts",
]) {
    assert.doesNotMatch(
        read(path),
        /wallet\.(upsert|create|update)\s*\(/,
        `${path} must open wallets with ensureWallet and write balances with a plain UPDATE`
    );
}

assert.match(
    walletPackage,
    /FROM payment_coin_lots[\s\S]*?remaining_coin > 0[\s\S]*?FOR UPDATE/,
    "debits must read paid-coin lots with a locking read after the wallet lock"
);
for (const path of [
    "apps/web/src/lib/admin-user-operations/service.ts",
    "packages/platform-payments/src/fulfillment.ts",
]) {
    assert.match(read(path), /ensureWallet\(prisma,/, `${path} must open the wallet before its transaction`);
}
for (const path of [
    "apps/web/src/lib/economy.ts",
    "apps/web/src/lib/admin-inventory-operations/service.ts",
    "packages/platform-inventory/src/index.ts",
    "packages/platform-player/src/index.ts",
]) {
    assert.doesNotMatch(
        read(path),
        /userProfile\.upsert\s*\(/,
        `${path} must open profiles with ensureUserProfile, not a racing Prisma upsert`
    );
}
assert.doesNotMatch(
    read("apps/web/src/lib/coin-grants/service.ts"),
    /TransactionIsolationLevel\.Serializable/,
    "coin grant redemption must not use serializable reads that deadlock under contention"
);

console.log("test:wallet-ledger-foundation ok");
