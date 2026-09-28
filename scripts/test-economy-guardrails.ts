import assert from "node:assert/strict";
import { normalizeSystemSettings } from "../apps/web/src/lib/system-settings/schema";
import { evaluateMatchRewardEligibility } from "../apps/web/src/lib/economy/reward-eligibility";
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

async function testGuestRoomEligibility(): Promise<void> {
    const settings = normalizeSystemSettings({});
    const result = evaluateMatchRewardEligibility({
        userId: 99,
        existingMatchResult: null,
        settings,
        now: new Date("2026-04-01T12:00:00.000Z"),
        room: {
            odaKodu: "ECO01",
            gameMode: "tabu",
            oyunAktifMi: false,
            skor: { A: 5, B: 3 },
            matchStartedAt: "2026-04-01T12:00:00.000Z",
            matchEndedAt: "2026-04-01T12:03:00.000Z",
            sureSeconds: 180,
            matchFormat: "skor",
            matchTarget: 10,
            oyuncular: [
                {
                    playerId: "user:99",
                    userId: 99,
                    identityType: "registered",
                    usernameSnapshot: "testuser",
                    ad: "TestUser",
                    takim: "A",
                    roleAtStart: "Oyuncu",
                },
                {
                    playerId: "guest:a",
                    userId: null,
                    identityType: "guest",
                    usernameSnapshot: null,
                    ad: "Guest A",
                    takim: "A",
                    roleAtStart: "Oyuncu",
                },
                {
                    playerId: "guest:b",
                    userId: null,
                    identityType: "guest",
                    usernameSnapshot: null,
                    ad: "Guest B",
                    takim: "B",
                    roleAtStart: "Oyuncu",
                },
                {
                    playerId: "guest:c",
                    userId: null,
                    identityType: "guest",
                    usernameSnapshot: null,
                    ad: "Guest C",
                    takim: "B",
                    roleAtStart: "Oyuncu",
                },
            ],
        },
    });

    assert.equal(result.decision, "allow_full");
    assert.equal(result.source, "match_reward");
    assert.ok(result.reviewFlags.includes("single_authenticated_player_room"));
    assert.ok(result.reviewFlags.includes("guest_majority_room"));
    assert.ok(result.lineupKey);
    assert.equal(result.finalRewardCoin > 0, true);
}

async function testSpectatorCannotClaimReward(): Promise<void> {
    const result = evaluateMatchRewardEligibility({
        userId: 99,
        existingMatchResult: null,
        settings: normalizeSystemSettings({}),
        now: new Date("2026-04-01T12:03:00.000Z"),
        room: {
            odaKodu: "SPEC01",
            gameMode: "tabu",
            oyunAktifMi: false,
            skor: { A: 5, B: 3 },
            matchStartedAt: "2026-04-01T12:00:00.000Z",
            matchEndedAt: "2026-04-01T12:03:00.000Z",
            sureSeconds: 180,
            matchFormat: "skor",
            matchTarget: 10,
            oyuncular: [
                {
                    playerId: "user:99",
                    userId: 99,
                    identityType: "registered",
                    usernameSnapshot: "spectator",
                    ad: "Spectator",
                    takim: null,
                    roleAtStart: "İzleyici",
                },
            ],
        },
    });

    assert.equal(result.decision, "deny");
    assert.deepEqual(result.reasonCodes, ["spectator_not_eligible"]);
}

async function testUnfinishedMatchCannotClaimReward(): Promise<void> {
    const result = evaluateMatchRewardEligibility({
        userId: 99,
        existingMatchResult: null,
        settings: normalizeSystemSettings({}),
        now: new Date("2026-04-01T12:03:00.000Z"),
        room: {
            odaKodu: "OPEN01",
            gameMode: "tabu",
            oyunAktifMi: false,
            skor: { A: 0, B: 0 },
            matchStartedAt: "2026-04-01T12:00:00.000Z",
            matchEndedAt: null,
            sureSeconds: 1,
            matchFormat: "skor",
            matchTarget: 10,
            oyuncular: [],
        },
    });

    assert.equal(result.decision, "deny");
    assert.deepEqual(result.reasonCodes, ["match_not_completed"]);
}

async function testRepeatedGroupDamping(): Promise<void> {
    const settings = normalizeSystemSettings({
        economy: {
            repeatedGroupEnabled: true,
            repeatedGroupWindowHours: 12,
            repeatedGroupThreshold: 3,
            repeatedGroupMinMultiplier: 0.5,
        },
    });

    const result = await resolveRepeatedGroupReward(createMockTx({ count: 3 }) as never, {
        userId: 42,
        lineupKey: "repeat-lineup-test",
        requestedRewardCoin: 120,
        settings,
        now: new Date("2026-04-01T12:00:00.000Z"),
    });

    assert.equal(result.triggered, true);
    assert.equal(result.priorMatchingRewards, 3);
    assert.equal(result.currentOrdinal, 4);
    assert.equal(result.allowedRewardCoin < 120, true);
    assert.equal(result.allowedRewardCoin, 100);
}

async function testSafetyCeiling(): Promise<void> {
    const settings = normalizeSystemSettings({
        economy: {
            matchRewardGuardEnabled: true,
            matchRewardWindowHours: 24,
            matchRewardSoftCapCoin: 300,
            matchRewardHardCapCoin: 400,
            matchRewardMinMultiplier: 0.5,
            matchRewardDampingProfile: "standard",
        },
    });

    const result = await resolveMatchRewardSafetyCeiling(
        createMockTx({ sumCoinEarned: 320 }) as never,
        {
            userId: 42,
            requestedRewardCoin: 120,
            settings,
            now: new Date("2026-04-01T12:00:00.000Z"),
        }
    );

    assert.equal(result.triggered, true);
    assert.equal(result.band, "hard_ceiling");
    assert.equal(result.earnedInWindowBefore, 320);
    assert.equal(result.allowedRewardCoin, 80);
    assert.equal(result.blockedRewardCoin, 40);
}

async function main(): Promise<void> {
    await testGuestRoomEligibility();
    await testSpectatorCannotClaimReward();
    await testUnfinishedMatchCannotClaimReward();
    await testRepeatedGroupDamping();
    await testSafetyCeiling();
    console.log("economy guardrails smoke test passed");
}

void main();
