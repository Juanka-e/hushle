import assert from "node:assert/strict";
import { coinGrantCampaignWriteSchema, coinGrantCodeBatchCreateSchema } from "../apps/web/src/lib/coin-grants/schema";
import { buildGeneratedCoinGrantCodes, normalizeCoinGrantCode } from "../apps/web/src/lib/coin-grants/service";

const campaign = coinGrantCampaignWriteSchema.parse({
    code: "creator_drop",
    name: "Creator Drop",
    description: "Influencer dagitimi",
    coinAmount: 250,
    totalBudgetCoin: 5000,
    totalClaimLimit: 20,
    perUserClaimLimit: 1,
    startsAt: null,
    endsAt: null,
    isActive: true,
});

assert.equal(campaign.coinAmount, 250);
assert.equal(campaign.perUserClaimLimit, 1);

const batch = coinGrantCodeBatchCreateSchema.parse({
    campaignId: 1,
    prefix: "creator",
    quantity: 5,
    maxClaims: 1,
    isActive: true,
});

assert.equal(batch.quantity, 5);
assert.equal(normalizeCoinGrantCode(" creator-ab12 "), "CREATOR-AB12");

const codes = buildGeneratedCoinGrantCodes("creator", 5);
assert.equal(codes.length, 5);
assert.equal(new Set(codes).size, 5);
assert.ok(codes.every((code) => code.startsWith("CREATOR-")));

console.log("coin grant campaign smoke test passed");
