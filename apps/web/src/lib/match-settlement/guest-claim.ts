import type { Prisma } from "@hushle/platform-db";
import { canUseAccountCapability } from "@hushle/platform-auth";
import { reportError } from "@hushle/platform-observability";
import { prisma } from "@/lib/prisma";
import { isSuspensionActive } from "@/lib/moderation/service";
import { getSystemSettings } from "@/lib/system-settings/service";
import type { SystemSettings } from "@/types/system-settings";
import { publishParticipantSettlementEffects } from "./effects";
import {
    GUEST_CLAIM_MAX_ATTEMPTS,
    GUEST_CLAIM_PENDING_TTL_MS,
    GUEST_CLAIM_RECHECK_MS,
    GUEST_CLAIM_TOKEN_GRACE_MS,
    GUEST_CLAIM_WINDOW_MS,
    resolveClaimableGuestPlayerId,
    isWaitingOutcome,
    toClaimedSnapshot,
    type GuestClaimResult,
    type GuestSeatSettleOutcome,
    type GuestSeatSettleResult,
} from "./guest-claim-rules";
import { settleParticipantReward, type ParticipantRewardOutcome } from "./participant-reward";
import { formatSettlementError, getSettlementRetryDelayMs } from "./retry-policy";
import { ensureParticipantCore } from "./service";
import { SettlementSnapshotError, parseSettlementSnapshot } from "./snapshot";
import type { MatchSettlementSnapshot } from "./types";

export interface GuestClaimOptions {
    now?: Date;
    settings?: SystemSettings;
    hooks?: {
        /** Test seam: runs before a seat is read, outside any transaction. */
        beforeSeat?(seatId: number): void | Promise<void>;
        /** Test seam: runs first inside the reward transaction of a seat. */
        transactionStarted?(seatId: number): void | Promise<void>;
    };
}

/**
 * Seats a caller may settle now. Failed seats wait out their back-off so repeated
 * sign-ins cannot burn the attempt budget; first attempts (including seats waiting
 * for verification or a suspension) may run whenever the owner asks.
 */
function runnableNow(now: Date): Prisma.MatchSettlementGuestSeatWhereInput {
    return { OR: [{ attemptCount: 0 }, { availableAt: { lte: now } }] };
}

/** One broken seat never stops the others; it is retried later by the worker. */
async function settleSeatSafely(seatId: number, options: GuestClaimOptions): Promise<GuestSeatSettleResult> {
    try {
        return await settleGuestSeatClaim(seatId, options);
    } catch (error) {
        const now = options.now ?? new Date();
        const lastError = formatSettlementError(error);
        await prisma.matchSettlementGuestSeat
            .updateMany({
                where: { id: seatId, status: "pending" },
                data: { lastError, availableAt: new Date(now.getTime() + GUEST_CLAIM_RECHECK_MS) },
            })
            .catch(() => undefined);
        await reportError({
            service: "hushle-web",
            event: "match_settlement.guest_claim.seat_failed",
            error,
            context: { seatId },
        }).catch(() => undefined);
        return seatResult(seatId, "retry", { error: lastError });
    }
}

function seatResult(
    seatId: number,
    outcome: GuestSeatSettleOutcome,
    extra: Partial<Omit<GuestSeatSettleResult, "seatId" | "outcome">> = {}
): GuestSeatSettleResult {
    return { seatId, outcome, coinEarned: null, matchResultId: null, ...extra };
}

/** Ends a pending claim without a reward; a concurrent finisher keeps its own result. */
async function closeSeat(
    seatId: number,
    status: "rejected" | "expired",
    outcome: GuestSeatSettleOutcome,
    now: Date,
    lastError: string | null = null
): Promise<GuestSeatSettleResult> {
    const closed = await prisma.matchSettlementGuestSeat.updateMany({
        where: { id: seatId, status: "pending" },
        data: { status, outcome, settledAt: now, availableAt: null, lastError },
    });
    // Another run finished the seat first; its own caller reports that result.
    if (closed.count === 0) return seatResult(seatId, "not_pending");
    return seatResult(seatId, outcome, lastError ? { error: lastError } : {});
}

class GuestSeatClosedError extends Error {
    constructor() {
        super("Guest seat closed while its reward was being written");
        this.name = "GuestSeatClosedError";
    }
}

function seatUpdateFor(outcome: ParticipantRewardOutcome, now: Date) {
    if (outcome.kind === "rewarded") {
        return {
            status: "settled" as const,
            outcome: "settled",
            matchResultId: outcome.matchResultId,
            coinEarned: outcome.coinEarned,
            settledAt: now,
            availableAt: null,
            lastError: null,
        };
    }
    if (outcome.kind === "already_settled") {
        // The account already holds a result for this match (e.g. a second guest tab).
        return {
            status: "rejected" as const,
            outcome: "already_recorded",
            matchResultId: outcome.matchResultId,
            settledAt: now,
            availableAt: null,
            lastError: null,
        };
    }
    return {
        status: "rejected" as const,
        outcome: "not_eligible",
        settledAt: now,
        availableAt: null,
        lastError: null,
    };
}

/**
 * Settles one claimed guest seat for its claimant with the regular reward rules.
 * Idempotent and safe to run concurrently: the match_results unique key and the
 * wallet lock decide the single winner; every other run reports "not_pending".
 */
export async function settleGuestSeatClaim(
    seatId: number,
    options: GuestClaimOptions = {}
): Promise<GuestSeatSettleResult> {
    const now = options.now ?? new Date();
    await options.hooks?.beforeSeat?.(seatId);
    const seat = await prisma.matchSettlementGuestSeat.findUnique({
        where: { id: seatId },
        select: {
            id: true,
            status: true,
            guestPlayerId: true,
            claimUserId: true,
            claimedAt: true,
            attemptCount: true,
            settlementId: true,
            settlement: { select: { snapshot: true } },
        },
    });
    if (!seat || seat.status !== "pending") return seatResult(seatId, "not_pending");

    const userId = seat.claimUserId;
    if (userId === null) return closeSeat(seat.id, "rejected", "user_missing", now);
    if (seat.claimedAt && now.getTime() - seat.claimedAt.getTime() > GUEST_CLAIM_PENDING_TTL_MS) {
        return closeSeat(seat.id, "expired", "expired", now);
    }

    const account = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            username: true,
            isSuspended: true,
            suspendedUntil: true,
            accountStatus: true,
            emailVerifiedAt: true,
            emailVerificationRequiredAt: true,
        },
    });
    if (!account) return closeSeat(seat.id, "rejected", "user_missing", now);
    if (isSuspensionActive(account)) {
        if (!account.suspendedUntil) return closeSeat(seat.id, "rejected", "suspended", now);
        // A timed suspension only delays the claim; the pending TTL still bounds the wait.
        await prisma.matchSettlementGuestSeat.updateMany({
            where: { id: seat.id, status: "pending" },
            data: {
                availableAt: new Date(Math.max(account.suspendedUntil.getTime(), now.getTime() + GUEST_CLAIM_RECHECK_MS)),
            },
        });
        return seatResult(seat.id, "suspended_waiting");
    }
    if (!canUseAccountCapability(account, "reward")) {
        // Email verification triggers the claim; this re-check is only the safety net.
        await prisma.matchSettlementGuestSeat.updateMany({
            where: { id: seat.id, status: "pending" },
            data: { availableAt: new Date(now.getTime() + GUEST_CLAIM_RECHECK_MS) },
        });
        return seatResult(seat.id, "awaiting_verification");
    }

    let snapshot: MatchSettlementSnapshot;
    try {
        snapshot = parseSettlementSnapshot(seat.settlement.snapshot);
    } catch (error) {
        if (!(error instanceof SettlementSnapshotError)) throw error;
        return closeSeat(seat.id, "rejected", "invalid_snapshot", now, formatSettlementError(error));
    }
    if (snapshot.participants.some((participant) => participant.userId === userId)) {
        return closeSeat(seat.id, "rejected", "already_participant", now);
    }
    const claimed = toClaimedSnapshot(snapshot, seat.guestPlayerId, { userId, username: account.username });
    if (!claimed) return closeSeat(seat.id, "rejected", "not_eligible", now);

    const settings = options.settings ?? (await getSystemSettings());
    let outcome: ParticipantRewardOutcome;
    let stored: boolean;
    try {
        await ensureParticipantCore(userId);
        ({ outcome, stored } = await prisma.$transaction(async (tx) => {
            await options.hooks?.transactionStarted?.(seat.id);
            const reward = await settleParticipantReward(tx, {
                snapshot: claimed,
                userId,
                settings,
                now,
                ledgerMetadata: { guestClaimSeatId: seat.id },
            });
            const updated = await tx.matchSettlementGuestSeat.updateMany({
                where: { id: seat.id, status: "pending" },
                data: seatUpdateFor(reward, now),
            });
            // The seat closed meanwhile (expired, rejected): never pay for a seat that is not ours.
            if (updated.count === 0 && reward.kind === "rewarded") throw new GuestSeatClosedError();
            return { outcome: reward, stored: updated.count === 1 };
        }));
    } catch (error) {
        if (error instanceof GuestSeatClosedError) return seatResult(seat.id, "not_pending");
        const attempts = seat.attemptCount + 1;
        const lastError = formatSettlementError(error);
        if (attempts >= GUEST_CLAIM_MAX_ATTEMPTS) {
            await prisma.matchSettlementGuestSeat.updateMany({
                where: { id: seat.id, status: "pending" },
                data: { status: "rejected", outcome: "failed", attemptCount: attempts, lastError, availableAt: null, settledAt: now },
            });
            await reportError({
                service: "hushle-web",
                event: "match_settlement.guest_claim.failed",
                error,
                context: { seatId: seat.id, attempts },
            }).catch(() => undefined);
            return seatResult(seat.id, "failed", { error: lastError });
        }
        await prisma.matchSettlementGuestSeat.updateMany({
            where: { id: seat.id, status: "pending" },
            data: {
                attemptCount: attempts,
                lastError,
                availableAt: new Date(now.getTime() + getSettlementRetryDelayMs(attempts)),
            },
        });
        return seatResult(seat.id, "retry", { error: lastError });
    }

    // A concurrent run stored the seat first and reports it; this caller sees it as moved earlier.
    if (!stored) return seatResult(seat.id, "not_pending");

    await publishParticipantSettlementEffects({
        snapshot: claimed,
        settlementId: seat.settlementId,
        userId,
        outcome,
        guestClaimSeatId: seat.id,
    });
    if (outcome.kind === "rewarded") {
        return seatResult(seat.id, "settled", {
            coinEarned: outcome.coinEarned,
            matchResultId: outcome.matchResultId,
        });
    }
    if (outcome.kind === "already_settled") {
        return seatResult(seat.id, "already_recorded", { matchResultId: outcome.matchResultId });
    }
    return seatResult(seat.id, "not_eligible");
}

/**
 * The first account to claim a guest identity owns it for good: a leaked or shared
 * guest token can never split one guest's matches across several accounts.
 */
async function bindGuestIdentity(guestPlayerId: string, userId: number, now: Date): Promise<boolean> {
    await prisma.guestProgress.createMany({
        data: [{ playerId: guestPlayerId, linkedUserId: userId, lastSeenAt: now }],
        skipDuplicates: true,
    });
    // An unlinked row (never claimed, or its account was deleted) goes to this claimant.
    await prisma.guestProgress.updateMany({
        where: { playerId: guestPlayerId, linkedUserId: null },
        data: { linkedUserId: userId, lastSeenAt: now },
    });
    const row = await prisma.guestProgress.findUnique({
        where: { playerId: guestPlayerId },
        select: { linkedUserId: true },
    });
    return row?.linkedUserId === userId;
}

const MAX_SEATS_PER_RUN = 50;

/** Moves every recent match of the guest behind `guestToken` to the account. */
export async function claimGuestMatches(
    input: { userId: number; guestToken: string },
    options: GuestClaimOptions = {}
): Promise<GuestClaimResult> {
    const now = options.now ?? new Date();
    const guestPlayerId = resolveClaimableGuestPlayerId(input.guestToken, now.getTime());
    if (!guestPlayerId) return { status: "invalid_token" };
    if (!(await bindGuestIdentity(guestPlayerId, input.userId, now))) {
        return { status: "linked_elsewhere" };
    }

    const windowStart = new Date(now.getTime() - GUEST_CLAIM_WINDOW_MS - GUEST_CLAIM_TOKEN_GRACE_MS);
    const claimed = await prisma.matchSettlementGuestSeat.updateMany({
        where: { guestPlayerId, status: "unclaimed", matchEndedAt: { gte: windowStart } },
        data: { status: "pending", claimUserId: input.userId, claimedAt: now, availableAt: now },
    });

    const ownSeats = { guestPlayerId, claimUserId: input.userId };
    const pending = await prisma.matchSettlementGuestSeat.findMany({
        where: { ...ownSeats, status: "pending", ...runnableNow(now) },
        orderBy: { id: "asc" },
        take: MAX_SEATS_PER_RUN,
        select: { id: true },
    });
    const seats: GuestSeatSettleResult[] = [];
    for (const seat of pending) {
        seats.push(await settleSeatSafely(seat.id, { ...options, now }));
    }
    const settledHere = seats.filter((seat) => seat.outcome === "settled").map((seat) => seat.seatId);
    const [previouslySettled, stillPending] = await Promise.all([
        prisma.matchSettlementGuestSeat.count({
            where: { ...ownSeats, status: "settled", id: { notIn: settledHere } },
        }),
        prisma.matchSettlementGuestSeat.count({ where: { ...ownSeats, status: "pending" } }),
    ]);
    return { status: "ok", guestPlayerId, newlyClaimed: claimed.count, seats, previouslySettled, stillPending };
}

/** Settles every waiting claim of an account at once, e.g. right after email verification. */
export async function processGuestClaimsForUser(
    userId: number,
    options: GuestClaimOptions = {}
): Promise<GuestSeatSettleResult[]> {
    const pending = await prisma.matchSettlementGuestSeat.findMany({
        where: { claimUserId: userId, status: "pending", ...runnableNow(options.now ?? new Date()) },
        orderBy: { id: "asc" },
        take: MAX_SEATS_PER_RUN,
        select: { id: true },
    });
    const results: GuestSeatSettleResult[] = [];
    for (const seat of pending) {
        results.push(await settleSeatSafely(seat.id, options));
    }
    return results;
}

/** Settles seats a match assigned to their owners when it was recorded. */
export async function settlePendingGuestSeatsOf(
    settlementId: number,
    options: GuestClaimOptions = {}
): Promise<GuestSeatSettleResult[]> {
    const pending = await prisma.matchSettlementGuestSeat.findMany({
        where: { settlementId, status: "pending", ...runnableNow(options.now ?? new Date()) },
        orderBy: { id: "asc" },
        select: { id: true },
    });
    const results: GuestSeatSettleResult[] = [];
    for (const seat of pending) {
        results.push(await settleSeatSafely(seat.id, options));
    }
    return results;
}

export interface GuestClaimSweepResult {
    processed: number;
    settled: number;
    waiting: number;
    closed: number;
}

/** Worker safety net: retries failed seats, re-checks unverified accounts, expires old claims. */
export async function sweepDueGuestSeatClaims(
    options: { now?: Date; limit?: number; settings?: SystemSettings; hooks?: GuestClaimOptions["hooks"] } = {}
): Promise<GuestClaimSweepResult> {
    const now = options.now ?? new Date();
    const due = await prisma.matchSettlementGuestSeat.findMany({
        where: { status: "pending", availableAt: { lte: now } },
        orderBy: [{ availableAt: "asc" }, { id: "asc" }],
        take: options.limit ?? 25,
        select: { id: true },
    });
    const result: GuestClaimSweepResult = { processed: 0, settled: 0, waiting: 0, closed: 0 };
    for (const seat of due) {
        // Each seat takes a fresh clock unless the caller pins one.
        const run = await settleSeatSafely(seat.id, {
            settings: options.settings,
            now: options.now,
            hooks: options.hooks,
        });
        result.processed += 1;
        if (run.outcome === "settled") result.settled += 1;
        else if (isWaitingOutcome(run.outcome)) result.waiting += 1;
        else if (run.outcome !== "not_pending") result.closed += 1;
    }
    return result;
}
