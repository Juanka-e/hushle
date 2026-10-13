import { verifyGuestIdentityToken } from "@/lib/security/player-identity";
import type { MatchSettlementSnapshot } from "./types";

/** Guest identity tokens live 24h; a match can be claimed while its guest token is valid. */
export const GUEST_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A guest who finishes a match just before the token expires still gets time to sign up. */
export const GUEST_CLAIM_TOKEN_GRACE_MS = 60 * 60 * 1000;
/** Claims of accounts that never verify their email stop waiting after a week. */
export const GUEST_CLAIM_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * How often the worker re-checks a claim whose account cannot earn rewards yet. Link
 * verification settles at once; this covers Google linking and email changes.
 */
export const GUEST_CLAIM_RECHECK_MS = 60 * 60 * 1000;
export const GUEST_CLAIM_MAX_ATTEMPTS = 8;

// Matches guest_progress.player_id; server-issued guest ids are "guest:" + a UUID.
const GUEST_PLAYER_ID_MAX_LENGTH = 64;

export function isServerIssuedGuestPlayerId(playerId: string): boolean {
    return (
        playerId.startsWith("guest:") &&
        playerId.length > "guest:".length &&
        playerId.length <= GUEST_PLAYER_ID_MAX_LENGTH
    );
}

/** Guest seats a guest could later move to an account; spectators never earn a match. */
export function getClaimableGuestSeats(snapshot: MatchSettlementSnapshot): string[] {
    const seats = new Set<string>();
    for (const participant of snapshot.participants) {
        if (
            participant.identityType === "guest" &&
            participant.userId === null &&
            participant.roleAtStart !== "İzleyici" &&
            isServerIssuedGuestPlayerId(participant.playerId)
        ) {
            seats.add(participant.playerId);
        }
    }
    return [...seats];
}

/**
 * The guest player id a signed guest token proves. Expired tokens are accepted for a
 * short grace period; forged or malformed tokens resolve to null.
 */
export function resolveClaimableGuestPlayerId(token: string, now = Date.now()): string | null {
    const verified = verifyGuestIdentityToken(token, now - GUEST_CLAIM_TOKEN_GRACE_MS);
    if (!verified) return null;
    const playerId = `guest:${verified.guestId}`;
    return isServerIssuedGuestPlayerId(playerId) ? playerId : null;
}

/**
 * The snapshot as if the claimant had played the guest seat signed in, so the regular
 * reward pipeline (team, win, lineup, repeated-group and ceiling rules) applies unchanged.
 * Returns null when the seat is missing or the claimant already played the match.
 */
export function toClaimedSnapshot(
    snapshot: MatchSettlementSnapshot,
    guestPlayerId: string,
    claimant: { userId: number; username: string | null }
): MatchSettlementSnapshot | null {
    if (snapshot.participants.some((participant) => participant.userId === claimant.userId)) {
        return null;
    }
    const seatIndex = snapshot.participants.findIndex(
        (participant) =>
            participant.playerId === guestPlayerId && participant.identityType === "guest"
    );
    if (seatIndex === -1) return null;

    const participants = snapshot.participants.map((participant, index) =>
        index === seatIndex
            ? {
                  ...participant,
                  playerId: `user:${claimant.userId}`,
                  userId: claimant.userId,
                  identityType: "registered" as const,
                  usernameSnapshot: claimant.username?.trim().slice(0, 64) || null,
              }
            : participant
    );
    return { ...snapshot, participants };
}

export type GuestSeatSettleOutcome =
    | "settled"
    | "awaiting_verification"
    | "suspended_waiting"
    | "already_recorded"
    | "already_participant"
    | "not_eligible"
    | "suspended"
    | "user_missing"
    | "invalid_snapshot"
    | "expired"
    | "retry"
    | "failed"
    | "not_pending";

export interface GuestSeatSettleResult {
    seatId: number;
    outcome: GuestSeatSettleOutcome;
    coinEarned: number | null;
    matchResultId: number | null;
    error?: string;
}

export type GuestClaimResult =
    | { status: "invalid_token" }
    | { status: "linked_elsewhere" }
    | {
          status: "ok";
          guestPlayerId: string;
          newlyClaimed: number;
          seats: GuestSeatSettleResult[];
          previouslySettled: number;
          /** Seats still attached and waiting (verification, suspension or back-off). */
          stillPending: number;
      };

export interface GuestClaimSummary {
    status: "ok" | "invalid_token" | "linked_elsewhere";
    /** Matches of this guest that are now attached to the account, settled or waiting. */
    matches: number;
    settledNow: number;
    coinEarnedNow: number;
    awaitingVerification: number;
    alreadyMoved: number;
}

/** The seat stays attached to the account and settles later. */
export function isWaitingOutcome(outcome: GuestSeatSettleOutcome): boolean {
    return outcome === "awaiting_verification" || outcome === "suspended_waiting" || outcome === "retry";
}

export function summarizeGuestClaim(result: GuestClaimResult): GuestClaimSummary {
    if (result.status !== "ok") {
        return {
            status: result.status,
            matches: 0,
            settledNow: 0,
            coinEarnedNow: 0,
            awaitingVerification: 0,
            alreadyMoved: 0,
        };
    }
    const settled = result.seats.filter((seat) => seat.outcome === "settled");
    return {
        status: "ok",
        matches: settled.length + result.stillPending + result.previouslySettled,
        settledNow: settled.length,
        coinEarnedNow: settled.reduce((total, seat) => total + (seat.coinEarned ?? 0), 0),
        awaitingVerification: result.seats.filter((seat) => seat.outcome === "awaiting_verification").length,
        alreadyMoved: result.previouslySettled,
    };
}
