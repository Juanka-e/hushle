import type { Prisma } from "@hushle/platform-db";
import type { SystemSettings } from "@/types/system-settings";
import { evaluateMatchRewardEligibility } from "@/lib/economy/reward-eligibility";
import {
    resolveRepeatedGroupReward,
    type RepeatedGroupRewardResult,
} from "@/lib/economy/reward-repeated-group";
import {
    resolveMatchRewardSafetyCeiling,
    type MatchRewardSafetyCeilingResult,
} from "@/lib/economy/reward-safety-ceiling";
import type {
    RewardEligibilityAllowed,
    RewardEligibilityDenied,
} from "@/lib/economy/reward-types";
import { applyWalletLedgerMutation } from "@/lib/wallet-ledger/service";
import { toRewardRoomSnapshot } from "./snapshot";
import type { MatchSettlementSnapshot } from "./types";

export type ParticipantRewardOutcome =
    | {
          kind: "rewarded";
          matchResultId: number;
          coinEarned: number;
          won: boolean;
          evaluation: RewardEligibilityAllowed;
          repeatedGroup: RepeatedGroupRewardResult;
          ceiling: MatchRewardSafetyCeilingResult;
      }
    | {
          kind: "already_settled";
          matchResultId: number;
          coinEarned: number;
          won: boolean;
      }
    | {
          kind: "not_eligible";
          evaluation: RewardEligibilityDenied;
      };

function toSafeNumber(value: unknown): number {
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "number") return value;
    return 0;
}

/**
 * Settles one registered participant inside the caller's transaction. Reward
 * math is the pre-existing pipeline; only the clock and the host_ended policy
 * are settlement-specific.
 */
export async function settleParticipantReward(
    tx: Prisma.TransactionClient,
    input: {
        snapshot: MatchSettlementSnapshot;
        userId: number;
        settings: SystemSettings;
        now: Date;
    }
): Promise<ParticipantRewardOutcome> {
    const { snapshot, userId, settings, now } = input;
    const matchStartedAt = new Date(snapshot.matchStartedAt);

    await tx.wallet.upsert({
        where: { userId },
        update: {},
        create: { userId, coinBalance: 0 },
    });
    await tx.userProfile.upsert({
        where: { userId },
        update: {},
        create: { userId },
    });
    // Serialize rewards for this wallet before reading rolling-window aggregates.
    await tx.$queryRaw`SELECT user_id FROM wallets WHERE user_id = ${userId} FOR UPDATE`;

    const existing = await tx.matchResult.findUnique({
        where: {
            roomCode_userId_matchStartedAt: {
                roomCode: snapshot.roomCode,
                userId,
                matchStartedAt,
            },
        },
        select: { id: true, coinEarned: true, won: true },
    });
    if (existing) {
        return {
            kind: "already_settled",
            matchResultId: existing.id,
            coinEarned: existing.coinEarned,
            won: existing.won,
        };
    }

    // Weekend boosts follow when the match ended, even if settlement is retried later.
    const evaluation = evaluateMatchRewardEligibility({
        userId,
        room: toRewardRoomSnapshot(snapshot),
        existingMatchResult: null,
        settings,
        now: new Date(snapshot.matchEndedAt),
    });
    if (evaluation.decision === "deny") {
        return { kind: "not_eligible", evaluation };
    }

    const hostEnded = snapshot.endReason === "host_ended";
    const won = hostEnded ? false : evaluation.won;
    const repeatedGroup = await resolveRepeatedGroupReward(tx, {
        userId,
        lineupKey: evaluation.lineupKey,
        requestedRewardCoin: hostEnded ? 0 : evaluation.finalRewardCoin,
        settings,
        now,
    });
    const ceiling = await resolveMatchRewardSafetyCeiling(tx, {
        userId,
        requestedRewardCoin: repeatedGroup.allowedRewardCoin,
        settings,
        now,
    });
    const coinEarned = ceiling.allowedRewardCoin;

    const affectedRows = await tx.$executeRaw`
        INSERT INTO match_results (
          room_code,
          match_started_at,
          match_ended_at,
          match_duration_seconds,
          match_format,
          match_target,
          game_type,
          user_id,
          player_id,
          team,
          won,
          score_a,
          score_b,
          coin_earned,
          lineup_key,
          lineup_player_count,
          lineup_authenticated_count,
          lineup_guest_count,
          end_reason
        ) VALUES (
          ${snapshot.roomCode},
          ${matchStartedAt},
          ${new Date(snapshot.matchEndedAt)},
          ${snapshot.durationSeconds},
          ${snapshot.matchFormat},
          ${snapshot.matchTarget},
          ${snapshot.gameMode},
          ${userId},
          ${evaluation.participantPlayerId},
          ${evaluation.participantTeam},
          ${won},
          ${snapshot.score.A},
          ${snapshot.score.B},
          ${coinEarned},
          ${evaluation.lineupKey},
          ${evaluation.roomMetrics.totalPlayers},
          ${evaluation.roomMetrics.authenticatedPlayers},
          ${evaluation.roomMetrics.guestPlayers},
          ${snapshot.endReason}
        )
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
    `;
    const insertedRows = await tx.$queryRaw<Array<{ id: number | bigint }>>`SELECT LAST_INSERT_ID() AS id`;
    const matchResultId = toSafeNumber(insertedRows[0]?.id ?? 0);

    if (affectedRows !== 1) {
        const raced = await tx.matchResult.findUniqueOrThrow({
            where: { id: matchResultId },
            select: { id: true, coinEarned: true, won: true },
        });
        return {
            kind: "already_settled",
            matchResultId: raced.id,
            coinEarned: raced.coinEarned,
            won: raced.won,
        };
    }

    if (coinEarned > 0) {
        await applyWalletLedgerMutation(tx, {
            userId,
            source: "match_reward",
            deltaCoin: coinEarned,
            idempotencyKey: `match_result:${matchResultId}:reward`,
            referenceType: "match_result",
            referenceId: matchResultId,
            metadata: {
                gameMode: snapshot.gameMode,
                won,
            },
        });
    }

    return {
        kind: "rewarded",
        matchResultId,
        coinEarned,
        won,
        evaluation,
        repeatedGroup,
        ceiling,
    };
}
