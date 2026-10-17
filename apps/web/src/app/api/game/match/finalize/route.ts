import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { enforceAccountCapability } from "@/lib/auth/account-capability";
import { prisma } from "@/lib/prisma";
import { getRoomMatchSnapshot } from "@/lib/socket/game-socket";
import {
  findParticipantSettlement,
  recordMatchSettlement,
  settleMatchSettlement,
} from "@/lib/match-settlement/service";
import { createSettlementSnapshot } from "@/lib/match-settlement/snapshot";
import type { MatchSettlementSnapshot } from "@/lib/match-settlement/types";
import {
  buildRateLimitHeaders,
  consumeDistributedRequestRateLimit,
  getRequestIp,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

const finalizeSchema = z.object({
  roomCode: z.string().trim().min(4).max(10),
});

async function safeWriteAuditLog(
  input: Parameters<typeof writeAuditLog>[0]
): Promise<void> {
  try {
    await writeAuditLog(input);
  } catch (error) {
    console.error("Audit log could not be written for match finalize", error);
  }
}

async function findOwnResult(snapshot: MatchSettlementSnapshot, userId: number) {
  return prisma.matchResult.findUnique({
    where: {
      roomCode_userId_matchStartedAt: {
        roomCode: snapshot.roomCode,
        userId,
        matchStartedAt: new Date(snapshot.matchStartedAt),
      },
    },
    select: { id: true, coinEarned: true, won: true, endReason: true },
  });
}

/**
 * Rewards are settled server-side when a match ends. This endpoint only reports
 * the caller's result and nudges a settlement that has not run yet.
 */
export async function POST(req: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
  }
  const capabilityError = enforceAccountCapability(sessionUser, "reward");
  if (capabilityError) return capabilityError;

  try {
    const rateLimit = await consumeDistributedRequestRateLimit({
      bucket: "match-finalize",
      key: `user:${sessionUser.id}:${getRequestIp(req)}`,
      windowMs: 60_000,
      maxRequests: 6,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        playerError(PlayerErrorCode.RATE_LIMITED),
        { status: 429, headers: buildRateLimitHeaders(rateLimit) }
      );
    }

    const body = await req.json();
    const roomCode = finalizeSchema.parse(body).roomCode.toUpperCase();
    const live = getRoomMatchSnapshot(roomCode);

    let settlement: { id: number; snapshot: MatchSettlementSnapshot } | null = null;
    if (live && !live.oyunAktifMi && live.matchStartedAt && live.matchEndedAt) {
      // Idempotent: covers a finish whose record is still waiting in the in-process buffer.
      const snapshot = createSettlementSnapshot(live, live.matchEndReason ?? "completed");
      const recorded = await recordMatchSettlement(snapshot);
      settlement = { id: recorded.id, snapshot };
    } else if (live?.oyunAktifMi) {
      return NextResponse.json(playerError(PlayerErrorCode.MATCH_NOT_FINISHED), { status: 409 });
    } else {
      settlement = await findParticipantSettlement(roomCode, sessionUser.id);
    }

    if (!settlement) {
      return NextResponse.json(playerError(PlayerErrorCode.ROOM_NOT_FOUND), { status: 404 });
    }

    const participant = settlement.snapshot.participants.find(
      (entry) => entry.userId === sessionUser.id
    );
    if (!participant || participant.roleAtStart === "İzleyici") {
      const reason = participant ? "spectator_not_eligible" : "participant_not_found";
      await safeWriteAuditLog({
        actor: sessionUser,
        action: "game.match.finalize.denied",
        resourceType: "match_reward",
        resourceId: roomCode,
        summary: `Denied match reward finalize for room ${roomCode}`,
        metadata: {
          gameMode: settlement.snapshot.gameMode,
          eligibilityDecision: "deny",
          eligibilityReasons: [reason],
          settlementId: settlement.id,
          matchStartedAt: settlement.snapshot.matchStartedAt,
          roomCode,
        },
        request: req,
      });
      return NextResponse.json(
        playerError(
          participant
            ? PlayerErrorCode.SPECTATOR_REWARD_INELIGIBLE
            : PlayerErrorCode.PLAYER_NOT_VERIFIED
        ),
        { status: 403 }
      );
    }

    let result = await findOwnResult(settlement.snapshot, sessionUser.id);
    if (!result) {
      await settleMatchSettlement(settlement.id);
      result = await findOwnResult(settlement.snapshot, sessionUser.id);
    }

    if (result) {
      const wallet = await prisma.wallet.findUnique({
        where: { userId: sessionUser.id },
        select: { coinBalance: true },
      });
      return NextResponse.json({
        status: "settled",
        coinEarned: result.coinEarned,
        won: result.won,
        endReason: result.endReason,
        matchId: result.id,
        coinBalance: wallet?.coinBalance ?? 0,
      });
    }

    const current = await prisma.matchSettlement.findUnique({
      where: { id: settlement.id },
      select: { status: true },
    });
    if (current?.status === "settled") {
      return NextResponse.json({
        status: "settled",
        coinEarned: 0,
        won: false,
        rewardSkipped: true,
      });
    }
    return NextResponse.json({ status: "pending" }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(playerError(PlayerErrorCode.INVALID_REQUEST), { status: 422 });
    }

    console.error("Match finalize lookup failed", error);
    return NextResponse.json(playerError(PlayerErrorCode.MATCH_RESULT_UNAVAILABLE), { status: 500 });
  }
}
