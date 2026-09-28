import assert from "node:assert/strict";
import {
    applyStorePriceMultiplier,
    getStoreLiveopsState,
    resolveMatchRewardCoin,
} from "../apps/web/src/lib/system-settings/economy";
import { normalizeSystemSettings } from "../apps/web/src/lib/system-settings/schema";

const defaultSettings = normalizeSystemSettings({});
assert.equal(defaultSettings.economy.matchCoinMultiplier, 1);
assert.equal(defaultSettings.economy.weekendCoinMultiplierEnabled, false);
assert.equal(defaultSettings.economy.storePriceMultiplier, 1);
assert.equal(defaultSettings.economy.bundlesEnabled, true);
assert.equal(defaultSettings.economy.discountCampaignsEnabled, true);
assert.equal(defaultSettings.economy.couponsEnabled, true);

const boostedSettings = normalizeSystemSettings({
    economy: {
        startingCoinBalance: 250,
        winRewardCoin: 120,
        lossRewardCoin: 40,
        drawRewardCoin: 40,
        matchCoinMultiplier: 1.5,
        weekendCoinMultiplierEnabled: true,
        weekendCoinMultiplier: 2,
        storePriceMultiplier: 1.25,
        bundlesEnabled: false,
        discountCampaignsEnabled: false,
        couponsEnabled: false,
    },
});

const saturday = new Date("2026-03-14T12:00:00.000Z");
const reward = resolveMatchRewardCoin(120, boostedSettings, saturday);
assert.equal(reward.baseRewardCoin, 120);
assert.equal(reward.weekendBoostApplied, true);
assert.equal(reward.multiplier, 3);
assert.equal(reward.finalRewardCoin, 360);

assert.equal(applyStorePriceMultiplier(199, boostedSettings), 249);

const liveops = getStoreLiveopsState(boostedSettings, saturday);
assert.equal(liveops.bundlesEnabled, false);
assert.equal(liveops.couponsEnabled, false);
assert.equal(liveops.discountCampaignsEnabled, false);
assert.equal(liveops.storePriceMultiplier, 1.25);
assert.equal(liveops.activeMatchCoinMultiplier, 3);
assert.equal(liveops.weekendBoostApplied, true);

console.log("economy liveops smoke test passed");
