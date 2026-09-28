import assert from "node:assert/strict";
import { walletAdjustmentSchema } from "../apps/web/src/lib/admin-user-operations/schema";
import { resolveWalletBalanceAfter } from "../apps/web/src/lib/admin-user-operations/service";

const parsedCredit = walletAdjustmentSchema.parse({
    adjustmentType: "credit",
    amount: 250,
    reason: "Turnuva odulu",
});

const parsedDebit = walletAdjustmentSchema.parse({
    adjustmentType: "debit",
    amount: 75,
    reason: "Yanlis grant duzeltmesi",
});

assert.equal(parsedCredit.adjustmentType, "credit");
assert.equal(parsedDebit.adjustmentType, "debit");
assert.equal(resolveWalletBalanceAfter({ adjustmentType: "credit", amount: 250, balanceBefore: 100 }), 350);
assert.equal(resolveWalletBalanceAfter({ adjustmentType: "debit", amount: 75, balanceBefore: 100 }), 25);

assert.throws(() => {
    walletAdjustmentSchema.parse({
        adjustmentType: "credit",
        amount: 0,
        reason: "xx",
    });
});

console.log("test:admin-user-operations ok");
