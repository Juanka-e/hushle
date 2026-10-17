import type { Prisma } from "@hushle/platform-db";
import { reportError } from "@hushle/platform-observability";
import { invalidateUserDashboardMatchSummaryCache } from "@/lib/cache/application-cache";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    recordMatchFinalizeTelemetry,
    requiresDetailedMatchFinalizeAudit,
} from "@/lib/security/telemetry-rollup";
import type { RewardRoomMetrics } from "@/lib/economy/reward-types";
import type { ParticipantRewardOutcome } from "./participant-reward";
import type { MatchSettlementSnapshot } from "./types";

const SYSTEM_ACTOR_ROLE = "system";

function toAuditLineupIdentities(
    lineupIdentities: RewardRoomMetrics["lineupIdentities"]
): Prisma.InputJsonValue {
    return lineupIdentities.map((entry) => ({
        playerId: entry.playerId,
        userId: entry.userId,
        identityType: entry.identityType,
        usernameSnapshot: entry.usernameSnapshot,
        displayNameSnapshot: entry.displayNameSnapshot,
        team: entry.team,
        roleAtStart: entry.roleAtStart,
    })) as Prisma.InputJsonValue;
}

function baseMetadata(snapshot: MatchSettlementSnapshot, settlementId: number, metrics: RewardRoomMetrics) {
    return {
        settlementId,
        endReason: snapshot.endReason,
        gameMode: snapshot.gameMode,
        roomCode: snapshot.roomCode,
        totalPlayers: metrics.totalPlayers,
        authenticatedPlayers: metrics.authenticatedPlayers,
        guestPlayers: metrics.guestPlayers,
        matchStartedAt: metrics.matchStartedAt,
        matchEndedAt: snapshot.matchEndedAt,
        sureSeconds: metrics.sureSeconds,
        matchFormat: snapshot.matchFormat,
        matchTarget: snapshot.matchTarget,
        lineupPlayers: metrics.lineupPlayers,
        lineupIdentities: toAuditLineupIdentities(metrics.lineupIdentities),
    };
}

async function guard(event: string, task: () => Promise<unknown>): Promise<void> {
    try {
        await task();
    } catch (error) {
        await reportError({ service: "hushle-web", event, error }).catch(() => undefined);
    }
}

/** Post-commit side effects. Failures are reported and never undo a settlement. */
export async function publishParticipantSettlementEffects(input: {
    snapshot: MatchSettlementSnapshot;
    settlementId: number;
    userId: number;
    outcome: ParticipantRewardOutcome;
}): Promise<void> {
    const { snapshot, settlementId, userId, outcome } = input;

    if (outcome.kind === "not_eligible") {
        const { evaluation } = outcome;
        await guard("match_settlement.denied_audit.failed", () =>
            writeAuditLog({
                actor: { id: userId, role: SYSTEM_ACTOR_ROLE },
                action: "game.match.finalize.denied",
                resourceType: "match_reward",
                resourceId: snapshot.roomCode,
                summary: `Denied match reward settlement for room ${snapshot.roomCode}`,
                metadata: {
                    ...baseMetadata(snapshot, settlementId, evaluation.roomMetrics),
                    rewardSource: evaluation.source,
                    eligibilityDecision: evaluation.decision,
                    eligibilityReasons: evaluation.reasonCodes,
                    reviewFlags: evaluation.reviewFlags,
                },
            })
        );
        return;
    }

    if (outcome.kind !== "rewarded") return;

    await guard("match_settlement.cache_invalidation.failed", () =>
        invalidateUserDashboardMatchSummaryCache(userId)
    );

    const { evaluation, repeatedGroup, ceiling } = outcome;
    const metrics = evaluation.roomMetrics;
    const metadata = {
        ...baseMetadata(snapshot, settlementId, metrics),
        rewardSource: evaluation.source,
        eligibilityDecision: evaluation.decision,
        eligibilityReasons: evaluation.reasonCodes,
        reviewFlags: evaluation.reviewFlags,
        won: outcome.won,
        coinEarned: outcome.coinEarned,
        baseRewardCoin: evaluation.baseRewardCoin,
        requestedRewardCoin: evaluation.finalRewardCoin,
        lineupKey: evaluation.lineupKey,
        repeatedGroupTriggered: repeatedGroup.triggered,
        repeatedGroupPriorMatches: repeatedGroup.priorMatchingRewards,
        repeatedGroupCurrentOrdinal: repeatedGroup.currentOrdinal,
        repeatedGroupThreshold: repeatedGroup.threshold,
        repeatedGroupWindowHours: repeatedGroup.windowHours,
        repeatedGroupRequestedRewardCoin: repeatedGroup.requestedRewardCoin,
        repeatedGroupAllowedRewardCoin: repeatedGroup.allowedRewardCoin,
        repeatedGroupBlockedRewardCoin: repeatedGroup.blockedRewardCoin,
        repeatedGroupAppliedMultiplier: repeatedGroup.appliedMultiplier,
        allowedRewardCoin: ceiling.allowedRewardCoin,
        blockedRewardCoin: ceiling.blockedRewardCoin,
        earnedInWindowBefore: ceiling.earnedInWindowBefore,
        rewardGuardWindowHours: ceiling.windowHours,
        rewardGuardSoftCapCoin: ceiling.softCapCoin,
        rewardGuardHardCapCoin: ceiling.hardCapCoin,
        rewardGuardMinMultiplier: ceiling.minMultiplier,
        rewardGuardDampingProfile: ceiling.dampingProfile,
        rewardGuardTriggered: ceiling.triggered,
        rewardGuardBand: ceiling.band,
        rewardGuardAppliedMultiplier: ceiling.appliedMultiplier,
        rewardMultiplier: evaluation.modifiers.rewardMultiplier,
        weekendBoostApplied: evaluation.modifiers.weekendBoostApplied,
        reducedByRules:
            evaluation.modifiers.reducedByRules ||
            repeatedGroup.triggered ||
            ceiling.triggered ||
            snapshot.endReason === "host_ended",
    };

    const detailedAuditRequired = requiresDetailedMatchFinalizeAudit({
        reviewFlags: evaluation.reviewFlags,
        repeatedGroupTriggered: repeatedGroup.triggered,
        rewardGuardTriggered: ceiling.triggered,
    });
    let telemetryRecorded = false;
    if (!detailedAuditRequired) {
        try {
            telemetryRecorded = await recordMatchFinalizeTelemetry({
                occurredAt: new Date(snapshot.matchEndedAt),
                gameMode: snapshot.gameMode,
                coinEarned: outcome.coinEarned,
                durationSeconds: metrics.sureSeconds,
                totalPlayers: metrics.totalPlayers,
                authenticatedPlayers: metrics.authenticatedPlayers,
                guestPlayers: metrics.guestPlayers,
                won: outcome.won,
            });
        } catch (error) {
            await reportError({ service: "hushle-web", event: "match_settlement.telemetry.failed", error }).catch(() => undefined);
        }
    }

    if (detailedAuditRequired || !telemetryRecorded) {
        await guard("match_settlement.audit.failed", () =>
            writeAuditLog({
                actor: { id: userId, role: SYSTEM_ACTOR_ROLE },
                action: "game.match.finalize",
                resourceType: "match_result",
                resourceId: outcome.matchResultId,
                summary: `Settled match reward for room ${snapshot.roomCode}`,
                metadata: {
                    ...metadata,
                    telemetryAuditFallback: !detailedAuditRequired && !telemetryRecorded,
                },
            })
        );
    }
}
