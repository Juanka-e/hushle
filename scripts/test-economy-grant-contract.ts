import assert from "node:assert/strict";
import {
    economyGrantPlanSchema,
    unsupportedEconomyEffects,
} from "@hushle/domain-economy";
import {
    isPaymentGrantSnapshotSupported,
    normalizePaymentGrantContract,
    PaymentGrantContractError,
} from "@hushle/platform-payments";

const v2Coin = {
    schemaVersion: 2 as const,
    plan: {
        schemaVersion: 1 as const,
        effects: [{ effectId: "paid-coin", type: "balance_credit" as const, assetCode: "COIN", amount: 250 }],
    },
};
assert.deepEqual(normalizePaymentGrantContract({
    productKind: "coin_pack", quantity: 2, grantSnapshot: v2Coin,
}), { kind: "coin_pack", coinAmount: 500 });

const v2Cosmetic = {
    schemaVersion: 2 as const,
    plan: {
        schemaVersion: 1 as const,
        effects: [{
            effectId: "avatar", type: "inventory_entitlement" as const,
            catalog: "shop_item", itemReference: "42",
            renderSnapshot: { renderSpecVersion: 3 },
        }],
    },
};
assert.deepEqual(normalizePaymentGrantContract({
    productKind: "cosmetic_item", quantity: 1, grantSnapshot: v2Cosmetic,
}), {
    kind: "cosmetic_item",
    items: [{ shopItemId: 42, renderSnapshot: { renderSpecVersion: 3 } }],
});

const futureAssetPlan = {
    schemaVersion: 1 as const,
    effects: [{ effectId: "gem", type: "balance_credit" as const, assetCode: "GEM", amount: 5 }],
};
assert.equal(economyGrantPlanSchema.safeParse(futureAssetPlan).success, true, "contract is extensible");
assert.equal(unsupportedEconomyEffects(futureAssetPlan).length, 1, "runtime remains fail-closed");
assert.equal(isPaymentGrantSnapshotSupported({
    productKind: "coin_pack", quantity: 1,
    grantSnapshot: { schemaVersion: 2, plan: futureAssetPlan },
}), false);

for (const invalidPlan of [
    { ...v2Coin.plan, effects: [v2Coin.plan.effects[0], v2Coin.plan.effects[0]] },
    { ...v2Coin.plan, effects: [{ ...v2Coin.plan.effects[0], probability: 0.5 }] },
    { ...v2Coin.plan, effects: [] },
]) assert.equal(economyGrantPlanSchema.safeParse(invalidPlan).success, false);

assert.throws(() => normalizePaymentGrantContract({
    productKind: "coin_pack", quantity: 1,
    grantSnapshot: { schemaVersion: 2, plan: futureAssetPlan },
}), (error: unknown) => error instanceof PaymentGrantContractError
    && error.code === "unsupported_grant_effect");

assert.deepEqual(normalizePaymentGrantContract({
    productKind: "coin_pack", quantity: 3,
    grantSnapshot: { schemaVersion: 1, coinAmount: 100 },
}), { kind: "coin_pack", coinAmount: 300 }, "legacy orders remain readable");

console.log("Versioned economy grant contract checks passed");
