import { Prisma } from "@hushle/platform-db";
import { getMatchRewardGuardState } from "@/lib/system-settings/economy";
import type { SystemSettings } from "@/types/system-settings";

export type RewardCeilingBand = "none" | "soft_cap" | "hard_ceiling";

export interface MatchRewardSafetyCeilingResult {
    triggered: boolean;
    band: RewardCeilingBand;
    requestedRewardCoin: number;
    allowedRewardCoin: number;
    blockedRewardCoin: number;
    earnedInWindowBefore: number;
    windowHours: number;
    softCapCoin: number;
    hardCapCoin: number;
    minMultiplier: number;
    dampingProfile: "gentle" | "standard" | "strict";
    appliedMultiplier: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function roundCoinAmount(amount: number): number {
    return Math.max(0, Math.round(amount));
}

function resolveProfileProgress(progress: number, profile: "gentle" | "standard" | "strict"): number {
    if (profile === "gentle") {
        return Math.pow(progress, 1.5);
    }

    if (profile === "strict") {
        return Math.pow(progress, 0.7);
    }

    return progress;
}

function buildWindowStart(now: Date, windowHours: number): Date {
    return new Date(now.getTime() - windowHours * 60 * 60 * 1000);
}

export async function resolveMatchRewardSafetyCeiling(
    tx: Prisma.TransactionClient,
    input: {
        userId: number;
        requestedRewardCoin: number;
        settings: SystemSettings;
        now: Date;
    }
): Promise<MatchRewardSafetyCeilingResult> {
    const { userId, requestedRewardCoin, settings, now } = input;
    const guard = getMatchRewardGuardState(settings);

    if (!guard.enabled || requestedRewardCoin <= 0) {
        return {
            triggered: false,
            band: "none",
            requestedRewardCoin,
            allowedRewardCoin: requestedRewardCoin,
            blockedRewardCoin: 0,
            earnedInWindowBefore: 0,
            windowHours: guard.windowHours,
            softCapCoin: guard.softCapCoin,
            hardCapCoin: guard.hardCapCoin,
            minMultiplier: guard.minMultiplier,
            dampingProfile: guard.dampingProfile,
            appliedMultiplier: 1,
        };
    }

    const windowStart = buildWindowStart(now, guard.windowHours);
    const earnedAggregate = await tx.matchResult.aggregate({
        where: {
            userId,
            createdAt: {
                gte: windowStart,
            },
        },
        _sum: {
            coinEarned: true,
        },
    });

    const earnedInWindowBefore = earnedAggregate._sum.coinEarned ?? 0;

    if (earnedInWindowBefore >= guard.hardCapCoin) {
        return {
            triggered: true,
            band: "hard_ceiling",
            requestedRewardCoin,
            allowedRewardCoin: 0,
            blockedRewardCoin: requestedRewardCoin,
            earnedInWindowBefore,
            windowHours: guard.windowHours,
            softCapCoin: guard.softCapCoin,
            hardCapCoin: guard.hardCapCoin,
            minMultiplier: guard.minMultiplier,
            dampingProfile: guard.dampingProfile,
            appliedMultiplier: 0,
        };
    }

    const projectedTotal = earnedInWindowBefore + requestedRewardCoin;
    if (projectedTotal <= guard.softCapCoin) {
        return {
            triggered: false,
            band: "none",
            requestedRewardCoin,
            allowedRewardCoin: requestedRewardCoin,
            blockedRewardCoin: 0,
            earnedInWindowBefore,
            windowHours: guard.windowHours,
            softCapCoin: guard.softCapCoin,
            hardCapCoin: guard.hardCapCoin,
            minMultiplier: guard.minMultiplier,
            dampingProfile: guard.dampingProfile,
            appliedMultiplier: 1,
        };
    }

    const span = Math.max(1, guard.hardCapCoin - guard.softCapCoin);
    const cappedStart = clamp(Math.max(earnedInWindowBefore, guard.softCapCoin), guard.softCapCoin, guard.hardCapCoin);
    const cappedEnd = clamp(projectedTotal, guard.softCapCoin, guard.hardCapCoin);
    const midpoint = (cappedStart + cappedEnd) / 2;
    const progress = clamp((midpoint - guard.softCapCoin) / span, 0, 1);
    const profiledProgress = resolveProfileProgress(progress, guard.dampingProfile);
    const appliedMultiplier = clamp(1 - (1 - guard.minMultiplier) * profiledProgress, guard.minMultiplier, 1);
    const maxAllowedByHardCap = Math.max(0, guard.hardCapCoin - earnedInWindowBefore);
    const dampedAllowed = roundCoinAmount(requestedRewardCoin * appliedMultiplier);
    const allowedRewardCoin = Math.min(maxAllowedByHardCap, dampedAllowed);
    const blockedRewardCoin = Math.max(0, requestedRewardCoin - allowedRewardCoin);
    const band: RewardCeilingBand = projectedTotal > guard.hardCapCoin ? "hard_ceiling" : "soft_cap";

    return {
        triggered: blockedRewardCoin > 0,
        band,
        requestedRewardCoin,
        allowedRewardCoin,
        blockedRewardCoin,
        earnedInWindowBefore,
        windowHours: guard.windowHours,
        softCapCoin: guard.softCapCoin,
        hardCapCoin: guard.hardCapCoin,
        minMultiplier: guard.minMultiplier,
        dampingProfile: guard.dampingProfile,
        appliedMultiplier: allowedRewardCoin <= 0 ? 0 : appliedMultiplier,
    };
}
