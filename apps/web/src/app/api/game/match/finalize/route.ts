import { NextResponse } from "next/server";
import { invalidateUserDashboardMatchSummaryCache } from "@/lib/cache/application-cache";
import { z } from "zod";
import { Prisma } from "@hushle/platform-db";
import { getSessionUser } from "@/lib/session";
import { enforceAccountCapability } from "@/lib/auth/account-capability";
import { prisma } from "@/lib/prisma";
import { ensureUserCore } from "@/lib/economy";
import { getRoomMatchSnapshot } from "@/lib/socket/game-socket";
import { evaluateMatchRewardEligibility } from "@/lib/economy/reward-eligibility";
import { resolveRepeatedGroupReward } from "@/lib/economy/reward-repeated-group";
import { resolveMatchRewardSafetyCeiling } from "@/lib/economy/reward-safety-ceiling";
import {
  buildRateLimitHeaders,
  consumeRequestRateLimit,
  getRequestIp,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
  recordMatchFinalizeTelemetry,
  requiresDetailedMatchFinalizeAudit,
} from "@/lib/security/telemetry-rollup";
import { getSystemSettings } from "@/lib/system-settings/service";
import { applyWalletLedgerMutation } from "@/lib/wallet-ledger/service";

const finalizeSchema = z.object({
  roomCode: z.string().trim().min(4).max(10),
});

function toAuditLineupIdentities(
  lineupIdentities: {
    playerId: string;
    userId: number | null;
    identityType: "registered" | "guest";
    usernameSnapshot: string | null;
    displayNameSnapshot: string;
    team: "A" | "B" | null;
    roleAtStart: string;
  }[]
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

function toSafeNumber(value: unknown): number {
  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "number") {
    return value;
  }

  return 0;
}

async function safeWriteAuditLog(
  input: Parameters<typeof writeAuditLog>[0]
): Promise<void> {
  try {
    await writeAuditLog(input);
  } catch (error) {
    console.error("Audit log could not be written for match finalize", error);
  }
}

export async function POST(req: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Giris gerekli." }, { status: 401 });
  }
  const capabilityError = enforceAccountCapability(sessionUser, "reward");
  if (capabilityError) return capabilityError;

  try {
    const rateLimit = consumeRequestRateLimit({
      bucket: "match-finalize",
      key: `user:${sessionUser.id}:${getRequestIp(req)}`,
      windowMs: 60_000,
      maxRequests: 6,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Cok fazla odul denemesi yaptin. Biraz bekleyip tekrar dene." },
        { status: 429, headers: buildRateLimitHeaders(rateLimit) }
      );
    }

    const body = await req.json();
    const { roomCode } = finalizeSchema.parse(body);

    const settings = await getSystemSettings();
    const room = getRoomMatchSnapshot(roomCode.toUpperCase());
    const matchStartedAt =
      room?.matchStartedAt ? new Date(room.matchStartedAt) : null;
    const existingRows =
      matchStartedAt !== null
        ? await prisma.$queryRaw<Array<{ id: number; coinEarned: number; won: boolean }>>(
            Prisma.sql`
              SELECT id, coin_earned AS coinEarned, won
              FROM match_results
              WHERE room_code = ${roomCode.toUpperCase()}
                AND user_id = ${sessionUser.id}
                AND match_started_at = ${matchStartedAt}
              LIMIT 1
            `
          )
        : null;
    const existing = existingRows?.[0] ?? null;
    const evaluation = evaluateMatchRewardEligibility({
      userId: sessionUser.id,
      room,
      existingMatchResult: existing,
      settings,
      now: new Date(),
    });

    if (evaluation.decision === "deny") {
      const primaryReason = evaluation.reasonCodes[0];

      if (primaryReason !== "already_claimed") {
        await safeWriteAuditLog({
          actor: sessionUser,
          action: "game.match.finalize.denied",
          resourceType: "match_reward",
          resourceId: roomCode.toUpperCase(),
          summary: `Denied match reward finalize for room ${roomCode.toUpperCase()}`,
          metadata: {
            gameMode: room?.gameMode ?? null,
            rewardSource: evaluation.source,
            eligibilityDecision: evaluation.decision,
            eligibilityReasons: evaluation.reasonCodes,
            reviewFlags: evaluation.reviewFlags,
            totalPlayers: evaluation.roomMetrics.totalPlayers,
            authenticatedPlayers: evaluation.roomMetrics.authenticatedPlayers,
            guestPlayers: evaluation.roomMetrics.guestPlayers,
            matchStartedAt: evaluation.roomMetrics.matchStartedAt,
            matchEndedAt: room?.matchEndedAt ?? null,
            sureSeconds: evaluation.roomMetrics.sureSeconds,
            matchFormat: room?.matchFormat ?? null,
            matchTarget: room?.matchTarget ?? null,
            lineupPlayers: evaluation.roomMetrics.lineupPlayers,
            lineupIdentities: toAuditLineupIdentities(
              evaluation.roomMetrics.lineupIdentities
            ),
            roomCode: roomCode.toUpperCase(),
            duplicateClaim: false,
          },
          request: req,
        });
      }

      if (primaryReason === "already_claimed" && existing) {
        return NextResponse.json({
          alreadyClaimed: true,
          coinEarned: existing.coinEarned,
          won: existing.won,
        });
      }

      if (primaryReason === "room_not_found") {
        return NextResponse.json({ error: "Oda bulunamadi." }, { status: 404 });
      }

      if (primaryReason === "match_not_completed") {
        return NextResponse.json({ error: "Mac henuz tamamlanmadi." }, { status: 409 });
      }

      if (primaryReason === "participant_not_found") {
        return NextResponse.json({ error: "Oyuncu dogrulanamadi." }, { status: 403 });
      }

      if (primaryReason === "spectator_not_eligible") {
        return NextResponse.json(
          { error: "Izleyiciler mevcut mac icin coin odulu alamaz." },
          { status: 403 }
        );
      }

      return NextResponse.json({ error: "Mac odulu icin uygunluk saglanamadi." }, { status: 409 });
    }

    if (!room) {
      return NextResponse.json({ error: "Oda bulunamadi." }, { status: 404 });
    }

    await ensureUserCore(sessionUser.id);

    const result = await prisma.$transaction(async (tx) => {
      const repeatedGroup = await resolveRepeatedGroupReward(tx, {
        userId: sessionUser.id,
        lineupKey: evaluation.lineupKey,
        requestedRewardCoin: evaluation.finalRewardCoin,
        settings,
        now: new Date(),
      });
      const ceiling = await resolveMatchRewardSafetyCeiling(tx, {
        userId: sessionUser.id,
        requestedRewardCoin: repeatedGroup.allowedRewardCoin,
        settings,
        now: new Date(),
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
          lineup_guest_count
        ) VALUES (
          ${room.odaKodu},
          ${matchStartedAt ?? new Date()},
          ${room.matchEndedAt ? new Date(room.matchEndedAt) : null},
          ${evaluation.roomMetrics.sureSeconds},
          ${room.matchFormat},
          ${room.matchTarget},
          ${"tabu"},
          ${sessionUser.id},
          ${evaluation.participantPlayerId},
          ${evaluation.participantTeam},
          ${evaluation.won},
          ${room.skor.A},
          ${room.skor.B},
          ${coinEarned},
          ${evaluation.lineupKey},
          ${evaluation.roomMetrics.totalPlayers},
          ${evaluation.roomMetrics.authenticatedPlayers},
          ${evaluation.roomMetrics.guestPlayers}
        )
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
      `;

      const createdRows =
        await tx.$queryRaw<Array<{ id: number | bigint }>>`SELECT LAST_INSERT_ID() AS id`;
      const created = { id: toSafeNumber(createdRows[0]?.id ?? 0) };

      if (affectedRows !== 1) {
        const existingMatchResult = await tx.matchResult.findUnique({
          where: { id: created.id },
          select: {
            id: true,
            coinEarned: true,
            won: true,
          },
        });
        const wallet = await tx.wallet.findUnique({ where: { userId: sessionUser.id } });

        return {
          created,
          wallet,
          repeatedGroup,
          ceiling,
          coinEarned: existingMatchResult?.coinEarned ?? 0,
          duplicate: true,
          won: existingMatchResult?.won ?? evaluation.won,
        };
      }

      const ledgerMutation =
        coinEarned > 0
          ? await applyWalletLedgerMutation(tx, {
              userId: sessionUser.id,
              source: "match_reward",
              deltaCoin: coinEarned,
              idempotencyKey: `match_result:${created.id}:reward`,
              referenceType: "match_result",
              referenceId: created.id,
              metadata: {
                gameMode: room.gameMode,
                won: evaluation.won,
              },
            })
          : null;
      const wallet = ledgerMutation
        ? { coinBalance: ledgerMutation.balanceAfter }
        : await tx.wallet.findUnique({ where: { userId: sessionUser.id } });
      return {
        created,
        wallet,
        repeatedGroup,
        ceiling,
        coinEarned,
        duplicate: false,
        won: evaluation.won,
      };
    });

    if (result.duplicate) {
      return NextResponse.json({
        alreadyClaimed: true,
        coinEarned: result.coinEarned,
        won: result.won,
      });
    }

    await invalidateUserDashboardMatchSummaryCache(sessionUser.id);
    const auditMetadata = {
        gameMode: room.gameMode,
        rewardSource: evaluation.source,
        eligibilityDecision: evaluation.decision,
        eligibilityReasons: evaluation.reasonCodes,
        reviewFlags: evaluation.reviewFlags,
        totalPlayers: evaluation.roomMetrics.totalPlayers,
        authenticatedPlayers: evaluation.roomMetrics.authenticatedPlayers,
        guestPlayers: evaluation.roomMetrics.guestPlayers,
        matchStartedAt: evaluation.roomMetrics.matchStartedAt,
        matchEndedAt: room.matchEndedAt,
        sureSeconds: evaluation.roomMetrics.sureSeconds,
        matchFormat: room.matchFormat,
        matchTarget: room.matchTarget,
        lineupPlayers: evaluation.roomMetrics.lineupPlayers,
        lineupIdentities: toAuditLineupIdentities(
          evaluation.roomMetrics.lineupIdentities
        ),
        roomCode: room.odaKodu,
        won: evaluation.won,
        coinEarned: result.coinEarned,
        baseRewardCoin: evaluation.baseRewardCoin,
        requestedRewardCoin: evaluation.finalRewardCoin,
        lineupKey: evaluation.lineupKey,
        repeatedGroupTriggered: result.repeatedGroup.triggered,
        repeatedGroupPriorMatches: result.repeatedGroup.priorMatchingRewards,
        repeatedGroupCurrentOrdinal: result.repeatedGroup.currentOrdinal,
        repeatedGroupThreshold: result.repeatedGroup.threshold,
        repeatedGroupWindowHours: result.repeatedGroup.windowHours,
        repeatedGroupRequestedRewardCoin: result.repeatedGroup.requestedRewardCoin,
        repeatedGroupAllowedRewardCoin: result.repeatedGroup.allowedRewardCoin,
        repeatedGroupBlockedRewardCoin: result.repeatedGroup.blockedRewardCoin,
        repeatedGroupAppliedMultiplier: result.repeatedGroup.appliedMultiplier,
        allowedRewardCoin: result.ceiling.allowedRewardCoin,
        blockedRewardCoin: result.ceiling.blockedRewardCoin,
        earnedInWindowBefore: result.ceiling.earnedInWindowBefore,
        rewardGuardWindowHours: result.ceiling.windowHours,
        rewardGuardSoftCapCoin: result.ceiling.softCapCoin,
        rewardGuardHardCapCoin: result.ceiling.hardCapCoin,
        rewardGuardMinMultiplier: result.ceiling.minMultiplier,
        rewardGuardDampingProfile: result.ceiling.dampingProfile,
        rewardGuardTriggered: result.ceiling.triggered,
        rewardGuardBand: result.ceiling.band,
        rewardGuardAppliedMultiplier: result.ceiling.appliedMultiplier,
        rewardMultiplier: evaluation.modifiers.rewardMultiplier,
        weekendBoostApplied: evaluation.modifiers.weekendBoostApplied,
        reducedByRules:
          evaluation.modifiers.reducedByRules ||
          result.repeatedGroup.triggered ||
          result.ceiling.triggered,
    };
    const detailedAuditRequired = requiresDetailedMatchFinalizeAudit({
      reviewFlags: evaluation.reviewFlags,
      repeatedGroupTriggered: result.repeatedGroup.triggered,
      rewardGuardTriggered: result.ceiling.triggered,
    });
    const telemetryRecorded = detailedAuditRequired
      ? false
      : await recordMatchFinalizeTelemetry({
          occurredAt: room.matchEndedAt
            ? new Date(room.matchEndedAt)
            : new Date(),
          gameMode: room.gameMode,
          coinEarned: result.coinEarned,
          durationSeconds: evaluation.roomMetrics.sureSeconds,
          totalPlayers: evaluation.roomMetrics.totalPlayers,
          authenticatedPlayers:
            evaluation.roomMetrics.authenticatedPlayers,
          guestPlayers: evaluation.roomMetrics.guestPlayers,
          won: evaluation.won,
        });

    if (detailedAuditRequired || !telemetryRecorded) {
      await safeWriteAuditLog({
        actor: sessionUser,
        action: "game.match.finalize",
        resourceType: "match_result",
        resourceId: result.created.id,
        summary: `Finalized match reward for room ${room.odaKodu}`,
        metadata: {
          ...auditMetadata,
          telemetryAuditFallback:
            !detailedAuditRequired && !telemetryRecorded,
        },
        request: req,
      });
    }

    return NextResponse.json({
      coinEarned: result.coinEarned,
      won: evaluation.won,
      coinBalance: result.wallet?.coinBalance ?? 0,
      matchId: result.created.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Gecersiz veri." }, { status: 422 });
    }

    console.error("Match finalize failed", error);

    if ((error as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "Odul zaten alinmis." }, { status: 409 });
    }

    if (
      (error as { code?: string })?.code === "P2010" &&
      typeof (error as { message?: string })?.message === "string" &&
      (error as { message: string }).message.includes("Duplicate entry")
    ) {
      return NextResponse.json({ error: "Odul zaten alinmis." }, { status: 409 });
    }

    return NextResponse.json({ error: "Mac sonucu kaydedilemedi." }, { status: 500 });
  }
}
