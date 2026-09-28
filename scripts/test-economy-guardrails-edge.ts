import assert from "node:assert/strict";
import { normalizeSystemSettings } from "../apps/web/src/lib/system-settings/schema";
import { resolveRepeatedGroupReward } from "../apps/web/src/lib/economy/reward-repeated-group";
import { resolveMatchRewardSafetyCeiling } from "../apps/web/src/lib/economy/reward-safety-ceiling";

function createMockTx(input: {
    count?: number;
    sumCoinEarned?: number;
}) {
    return {
        matchResult: {
            count: async () => input.count ?? 0,
            aggregate: async () => ({
                _sum: {
                    coinEarned: input.sumCoinEarned ?? 0,
                },
            }),
        },
    } as const;
}

async function testRepeatedGroupDisabled(): Promise<void> {
    const settings = normalizeSystemSettings({
        economy: {
            repeatedGroupEnabled: false,
        },
    });

    const result = await resolveRepeatedGroupReward(createMockTx({ count: 99 }) as never, {
        userId: 1,
        lineupKey: "lineup",
        requestedRewardCoin: 120,
        settings,
        now: new Date("2026-04-01T12:00:00.000Z"),
    });

    assert.equal(result.triggered, false);
    assert.equal(result.allowedRewardCoin, 120);
}

async function testRepeatedGroupWithoutLineupKey(): Promise<void> {
    const settings = normalizeSystemSettings({
        economy: {
            repeatedGroupEnabled: true,
            repeatedGroupThreshold: 2,
            repeatedGroupMinMultiplier: 0.5,
        },
    });

    const result = await resolveRepeatedGroupReward(createMockTx({ count: 99 }) as never, {
        userId: 1,
        lineupKey: null,
        requestedRewardCoin: 120,
        settings,
        now: new Date("2026-04-01T12:00:00.000Z"),
    });

    assert.equal(result.triggered, false);
    assert.equal(result.allowedRewardCoin, 120);
}

async function testRepeatedGroupFloor(): Promise<void> {
    const settings = normalizeSystemSettings({
        economy: {
            repeatedGroupEnabled: true,
            repeatedGroupThreshold: 3,
            repeatedGroupMinMultiplier: 0.55,
        },
    });

    const result = await resolveRepeatedGroupReward(createMockTx({ count: 25 }) as never, {
        userId: 1,
        lineupKey: "dense-lineup",
        requestedRewardCoin: 120,
        settings,
        now: new Date("2026-04-01T12:00:00.000Z"),
    });

    assert.equal(result.triggered, true);
    assert.equal(result.allowedRewardCoin, 66);
    assert.equal(result.appliedMultiplier, 0.55);
}

async function testSafetyCeilingDisabled(): Promise<void> {
    const settings = normalizeSystemSettings({
        economy: {
            matchRewardGuardEnabled: false,
        },
    });

    const result = await resolveMatchRewardSafetyCeiling(createMockTx({ sumCoinEarned: 9999 }) as never, {
        userId: 1,
        requestedRewardCoin: 120,
        settings,
        now: new Date("2026-04-01T12:00:00.000Z"),
    });

    assert.equal(result.triggered, false);
    assert.equal(result.allowedRewardCoin, 120);
}

async function testSafetyCeilingSoftBand(): Promise<void> {
    const settings = normalizeSystemSettings({
        economy: {
            matchRewardGuardEnabled: true,
            matchRewardWindowHours: 24,
            matchRewardSoftCapCoin: 300,
            matchRewardHardCapCoin: 500,
            matchRewardMinMultiplier: 0.5,
            matchRewardDampingProfile: "gentle",
        },
    });

    const result = await resolveMatchRewardSafetyCeiling(createMockTx({ sumCoinEarned: 320 }) as never, {
        userId: 1,
        requestedRewardCoin: 60,
        settings,
        now: new Date("2026-04-01T12:00:00.000Z"),
    });

    assert.equal(result.band, "soft_cap");
    assert.equal(result.triggered, true);
    assert.ok(result.allowedRewardCoin < 60);
    assert.ok(result.allowedRewardCoin > 0);
}

async function testSafetyCeilingHardStop(): Promise<void> {
    const settings = normalizeSystemSettings({
        economy: {
            matchRewardGuardEnabled: true,
            matchRewardWindowHours: 24,
            matchRewardSoftCapCoin: 300,
            matchRewardHardCapCoin: 400,
            matchRewardMinMultiplier: 0.35,
            matchRewardDampingProfile: "gentle",
        },
    });

    const result = await resolveMatchRewardSafetyCeiling(createMockTx({ sumCoinEarned: 410 }) as never, {
        userId: 1,
        requestedRewardCoin: 120,
        settings,
        now: new Date("2026-04-01T12:00:00.000Z"),
    });

    assert.equal(result.band, "hard_ceiling");
    assert.equal(result.allowedRewardCoin, 0);
    assert.equal(result.blockedRewardCoin, 120);
}

async function main(): Promise<void> {
    await testRepeatedGroupDisabled();
    await testRepeatedGroupWithoutLineupKey();
    await testRepeatedGroupFloor();
    await testSafetyCeilingDisabled();
    await testSafetyCeilingSoftBand();
    await testSafetyCeilingHardStop();
    console.log("economy guardrails edge-case test passed");
}

void main();
