import type { Prisma } from "@hushle/platform-db";
import { getRepeatedGroupGuardState } from "@/lib/system-settings/economy";
import type { SystemSettings } from "@/types/system-settings";

export interface RepeatedGroupRewardResult {
    triggered: boolean;
    priorMatchingRewards: number;
    currentOrdinal: number;
    threshold: number;
    windowHours: number;
    requestedRewardCoin: number;
    allowedRewardCoin: number;
    blockedRewardCoin: number;
    appliedMultiplier: number;
    lineupKey: string | null;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function roundCoinAmount(amount: number): number {
    return Math.max(0, Math.round(amount));
}

function buildWindowStart(now: Date, windowHours: number): Date {
    return new Date(now.getTime() - windowHours * 60 * 60 * 1000);
}

export async function resolveRepeatedGroupReward(
    tx: Prisma.TransactionClient,
    input: {
        userId: number;
        lineupKey: string | null;
        requestedRewardCoin: number;
        settings: SystemSettings;
        now: Date;
    }
): Promise<RepeatedGroupRewardResult> {
    const { userId, lineupKey, requestedRewardCoin, settings, now } = input;
    const guard = getRepeatedGroupGuardState(settings);

    if (!guard.enabled || requestedRewardCoin <= 0 || !lineupKey) {
        return {
            triggered: false,
            priorMatchingRewards: 0,
            currentOrdinal: 1,
            threshold: guard.threshold,
            windowHours: guard.windowHours,
            requestedRewardCoin,
            allowedRewardCoin: requestedRewardCoin,
            blockedRewardCoin: 0,
            appliedMultiplier: 1,
            lineupKey,
        };
    }

    const windowStart = buildWindowStart(now, guard.windowHours);
    const priorMatchingRewards = await tx.matchResult.count({
        where: {
            userId,
            lineupKey,
            createdAt: {
                gte: windowStart,
            },
        },
    });

    const currentOrdinal = priorMatchingRewards + 1;
    if (currentOrdinal <= guard.threshold) {
        return {
            triggered: false,
            priorMatchingRewards,
            currentOrdinal,
            threshold: guard.threshold,
            windowHours: guard.windowHours,
            requestedRewardCoin,
            allowedRewardCoin: requestedRewardCoin,
            blockedRewardCoin: 0,
            appliedMultiplier: 1,
            lineupKey,
        };
    }

    const extraRepeats = currentOrdinal - guard.threshold;
    const rampLength = Math.max(1, guard.threshold);
    const progress = clamp(extraRepeats / rampLength, 0, 1);
    const appliedMultiplier = clamp(
        1 - (1 - guard.minMultiplier) * progress,
        guard.minMultiplier,
        1
    );
    const allowedRewardCoin = roundCoinAmount(requestedRewardCoin * appliedMultiplier);

    return {
        triggered: allowedRewardCoin < requestedRewardCoin,
        priorMatchingRewards,
        currentOrdinal,
        threshold: guard.threshold,
        windowHours: guard.windowHours,
        requestedRewardCoin,
        allowedRewardCoin,
        blockedRewardCoin: Math.max(0, requestedRewardCoin - allowedRewardCoin),
        appliedMultiplier,
        lineupKey,
    };
}
