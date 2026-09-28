import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
    "prisma/migrations/20260809060000_payment_coin_lot_provenance/migration.sql",
    "utf8"
);
const wallet = readFileSync("packages/platform-wallet/src/index.ts", "utf8");
const fulfillment = readFileSync("packages/platform-payments/src/fulfillment.ts", "utf8");
const reversal = readFileSync("packages/platform-payments/src/reversal.ts", "utf8");

assert.match(schema, /model PaymentCoinLot/);
assert.match(schema, /model PaymentCoinLotAllocation/);
assert.match(schema, /payment_reversal/);
assert.match(migration, /payment_coin_lots_amounts_check/);
assert.match(migration, /payment_coin_lot_allocations_amount_check/);
assert.match(wallet, /Preserve refundable paid coin while non-payment coin is available/);
assert.match(wallet, /grantPaymentCoinLot/);
assert.match(wallet, /reversePaymentCoinLot/);
assert.match(wallet, /FOR UPDATE/);
assert.match(fulfillment, /coinLotId: wallet\.coinLotId/);
assert.match(reversal, /exact_payment_lot_reversal/);
assert.match(reversal, /legacy_manual_review_no_wallet_mutation/);

console.log("Payment coin lot provenance checks passed");
