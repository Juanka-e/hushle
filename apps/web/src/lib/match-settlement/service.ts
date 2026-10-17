import { randomUUID } from "node:crypto";
import { Prisma } from "@hushle/platform-db";
import { canUseAccountCapability } from "@hushle/platform-auth";
import { reportError } from "@hushle/platform-observability";
import { prisma } from "@/lib/prisma";
import { isSuspensionActive } from "@/lib/moderation/service";
import { getSystemSettings } from "@/lib/system-settings/service";
import type { SystemSettings } from "@/types/system-settings";
import { publishParticipantSettlementEffects } from "./effects";
import { settleParticipantReward } from "./participant-reward";
import {
    MATCH_SETTLEMENT_CLAIM_TTL_MS,
    MATCH_SETTLEMENT_MAX_ATTEMPTS,
    formatSettlementError,
    getSettlementRetryDelayMs,
} from "./retry-policy";
import {
    SettlementSnapshotError,
    getRegisteredParticipants,
    parseSettlementSnapshot,
} from "./snapshot";
import type { MatchSettlementSnapshot } from "./types";

export type SettlementParticipantOutcome =
    | "rewarded"
    | "already_settled"
    | "not_eligible"
    | "skipped_user_missing"
    | "skipped_suspended"
    | "skipped_reward_capability"
    | "failed";

export interface SettlementParticipantResult {
    userId: number;
    outcome: SettlementParticipantOutcome;
    coinEarned: number | null;
    error?: string;
}

export interface SettlementRunResult {
    settlementId: number;
    status: "settled" | "pending" | "dead_letter" | "claimed_elsewhere" | "not_found";
    participants: SettlementParticipantResult[];
}

export interface SettleOptions {
    now?: Date;
    settings?: SystemSettings;
    hooks?: {
        /** Test seam: runs before each registered participant is settled. */
        beforeParticipant?(userId: number): void | Promise<void>;
        /** Test seam: runs first inside each participant transaction. */
        transactionStarted?(userId: number): void | Promise<void>;
    };
}

/** Idempotently stores a finished match; the first record of a match wins. */
export async function recordMatchSettlement(
    snapshot: MatchSettlementSnapshot
): Promise<{ id: number; created: boolean }> {
    const registeredCount = getRegisteredParticipants(snapshot).length;
    const guestCount = snapshot.participants.filter((participant) => participant.userId === null).length;
    const matchStartedAt = new Date(snapshot.matchStartedAt);
    const matchKey = { roomCode: snapshot.roomCode, matchStartedAt };
    // Read first: the read endpoint re-records live rooms, so duplicates are the common case.
    const known = await prisma.matchSettlement.findUnique({
        where: { roomCode_matchStartedAt: matchKey },
        select: { id: true },
    });
    if (known) return { id: known.id, created: false };
    // skipDuplicates (INSERT IGNORE) settles a concurrent race without an error log;
    // the snapshot is already validated, so no column can be silently truncated.
    const inserted = await prisma.matchSettlement.createMany({
        data: [
            {
                roomCode: snapshot.roomCode,
                matchStartedAt,
                matchEndedAt: new Date(snapshot.matchEndedAt),
                endReason: snapshot.endReason,
                snapshotVersion: snapshot.version,
                snapshot: snapshot as unknown as Prisma.InputJsonValue,
                registeredParticipantCount: registeredCount,
                guestParticipantCount: guestCount,
            },
        ],
        skipDuplicates: true,
    });
    const row = await prisma.matchSettlement.findUniqueOrThrow({
        where: { roomCode_matchStartedAt: matchKey },
        select: { id: true },
    });
    return { id: row.id, created: inserted.count === 1 };
}

function claimableWhere(now: Date): Prisma.MatchSettlementWhereInput {
    return {
        OR: [
            { status: "pending", availableAt: { lte: now } },
            { status: "processing", claimExpiresAt: { lte: now } },
        ],
    };
}

/**
 * Creates wallet/profile outside the reward transaction. INSERT IGNORE lets a concurrent
 * settlement of the same user win the race without an error.
 */
async function ensureParticipantCore(userId: number): Promise<void> {
    await prisma.wallet.createMany({ data: [{ userId, coinBalance: 0 }], skipDuplicates: true });
    await prisma.userProfile.createMany({ data: [{ userId }], skipDuplicates: true });
}

async function describeUnclaimed(id: number): Promise<SettlementRunResult> {
    const row = await prisma.matchSettlement.findUnique({ where: { id }, select: { status: true } });
    if (!row) return { settlementId: id, status: "not_found", participants: [] };
    const status = row.status === "processing" ? "claimed_elsewhere" : row.status;
    return { settlementId: id, status, participants: [] };
}

async function settleOneParticipant(
    settlementId: number,
    snapshot: MatchSettlementSnapshot,
    userId: number,
    settings: SystemSettings,
    now: Date,
    options: SettleOptions
): Promise<SettlementParticipantResult> {
    await options.hooks?.beforeParticipant?.(userId);

    const account = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            isSuspended: true,
            suspendedUntil: true,
            accountStatus: true,
            emailVerifiedAt: true,
            emailVerificationRequiredAt: true,
        },
    });
    if (!account) return { userId, outcome: "skipped_user_missing", coinEarned: null };
    if (isSuspensionActive(account)) return { userId, outcome: "skipped_suspended", coinEarned: null };
    if (!canUseAccountCapability(account, "reward")) {
        return { userId, outcome: "skipped_reward_capability", coinEarned: null };
    }

    await ensureParticipantCore(userId);
    const outcome = await prisma.$transaction(async (tx) => {
        await options.hooks?.transactionStarted?.(userId);
        return settleParticipantReward(tx, { snapshot, userId, settings, now });
    });
    await publishParticipantSettlementEffects({ snapshot, settlementId, userId, outcome });

    if (outcome.kind === "not_eligible") {
        return { userId, outcome: "not_eligible", coinEarned: null };
    }
    return { userId, outcome: outcome.kind, coinEarned: outcome.coinEarned };
}

/**
 * Claims a settlement and settles every registered participant. Safe to call
 * from several places at once: only the claim holder processes the row.
 */
export async function settleMatchSettlement(
    id: number,
    options: SettleOptions = {}
): Promise<SettlementRunResult> {
    const now = options.now ?? new Date();
    const claimToken = randomUUID();
    const claimed = await prisma.matchSettlement.updateMany({
        where: { id, ...claimableWhere(now) },
        data: {
            status: "processing",
            claimToken,
            claimExpiresAt: new Date(now.getTime() + MATCH_SETTLEMENT_CLAIM_TTL_MS),
            attemptCount: { increment: 1 },
            lastAttemptAt: now,
        },
    });
    if (claimed.count === 0) return describeUnclaimed(id);

    const row = await prisma.matchSettlement.findUniqueOrThrow({
        where: { id },
        select: { snapshot: true, attemptCount: true },
    });
    const ownClaim = { id, claimToken, status: "processing" as const };

    let snapshot: MatchSettlementSnapshot;
    try {
        snapshot = parseSettlementSnapshot(row.snapshot);
    } catch (error) {
        const lastError = formatSettlementError(error);
        await prisma.matchSettlement.updateMany({
            where: ownClaim,
            data: { status: "dead_letter", lastError, claimToken: null, claimExpiresAt: null },
        });
        await reportError({
            service: "hushle-web",
            event: "match_settlement.dead_letter",
            error,
            context: { settlementId: id, reason: "invalid_snapshot" },
        }).catch(() => undefined);
        return { settlementId: id, status: "dead_letter", participants: [] };
    }

    const settings = options.settings ?? (await getSystemSettings());
    const participants: SettlementParticipantResult[] = [];
    let lastFailure: unknown = null;
    for (const participant of getRegisteredParticipants(snapshot)) {
        try {
            participants.push(
                await settleOneParticipant(id, snapshot, participant.userId, settings, now, options)
            );
        } catch (error) {
            lastFailure = error;
            participants.push({
                userId: participant.userId,
                outcome: "failed",
                coinEarned: null,
                error: formatSettlementError(error),
            });
        }
    }

    if (lastFailure === null) {
        await prisma.matchSettlement.updateMany({
            where: ownClaim,
            data: { status: "settled", settledAt: now, lastError: null, claimToken: null, claimExpiresAt: null },
        });
        return { settlementId: id, status: "settled", participants };
    }

    const lastError = formatSettlementError(lastFailure);
    if (row.attemptCount >= MATCH_SETTLEMENT_MAX_ATTEMPTS) {
        await prisma.matchSettlement.updateMany({
            where: ownClaim,
            data: { status: "dead_letter", lastError, claimToken: null, claimExpiresAt: null },
        });
        await reportError({
            service: "hushle-web",
            event: "match_settlement.dead_letter",
            error: lastFailure,
            context: { settlementId: id, attempts: row.attemptCount },
        }).catch(() => undefined);
        return { settlementId: id, status: "dead_letter", participants };
    }

    await prisma.matchSettlement.updateMany({
        where: ownClaim,
        data: {
            status: "pending",
            lastError,
            availableAt: new Date(now.getTime() + getSettlementRetryDelayMs(row.attemptCount)),
            claimToken: null,
            claimExpiresAt: null,
        },
    });
    return { settlementId: id, status: "pending", participants };
}

export async function findDueMatchSettlementIds(input: { now: Date; limit: number }): Promise<number[]> {
    const rows = await prisma.matchSettlement.findMany({
        where: claimableWhere(input.now),
        orderBy: [{ availableAt: "asc" }, { id: "asc" }],
        take: input.limit,
        select: { id: true },
    });
    return rows.map((row) => row.id);
}

export interface SweepResult {
    processed: number;
    settled: number;
    pending: number;
    deadLetter: number;
    claimedElsewhere: number;
}

export async function sweepDueMatchSettlements(
    options: { now?: Date; limit?: number; settings?: SystemSettings } = {}
): Promise<SweepResult> {
    const now = options.now ?? new Date();
    const ids = await findDueMatchSettlementIds({ now, limit: options.limit ?? 25 });
    const result: SweepResult = { processed: 0, settled: 0, pending: 0, deadLetter: 0, claimedElsewhere: 0 };
    for (const id of ids) {
        // Each row takes a fresh clock so a long batch never writes an already-expired claim.
        const run = await settleMatchSettlement(id, { settings: options.settings });
        result.processed += 1;
        if (run.status === "settled") result.settled += 1;
        else if (run.status === "pending") result.pending += 1;
        else if (run.status === "dead_letter") result.deadLetter += 1;
        else if (run.status === "claimed_elsewhere") result.claimedElsewhere += 1;
    }
    return result;
}

/** Deletes settled rows past retention in bounded batches; never touches unsettled rows. */
export async function purgeSettledMatchSettlements(
    options: { now?: Date; olderThanDays?: number; limit?: number } = {}
): Promise<number> {
    const now = options.now ?? new Date();
    const cutoff = new Date(now.getTime() - (options.olderThanDays ?? 30) * 86_400_000);
    const rows = await prisma.matchSettlement.findMany({
        where: { status: "settled", settledAt: { lt: cutoff } },
        orderBy: { settledAt: "asc" },
        take: options.limit ?? 500,
        select: { id: true },
    });
    if (rows.length === 0) return 0;
    const deleted = await prisma.matchSettlement.deleteMany({
        where: { id: { in: rows.map((row) => row.id) }, status: "settled" },
    });
    return deleted.count;
}

export async function getMatchSettlementHealth(): Promise<{
    pending: number;
    processing: number;
    deadLetter: number;
}> {
    const grouped = await prisma.matchSettlement.groupBy({
        by: ["status"],
        where: { status: { in: ["pending", "processing", "dead_letter"] } },
        _count: { _all: true },
    });
    const count = (status: string) =>
        grouped.find((entry) => entry.status === status)?._count._all ?? 0;
    return {
        pending: count("pending"),
        processing: count("processing"),
        deadLetter: count("dead_letter"),
    };
}

export interface ParticipantSettlement {
    id: number;
    status: "pending" | "processing" | "settled" | "dead_letter";
    snapshot: MatchSettlementSnapshot;
}

/** Latest settlement of a room that includes the user, for the read endpoint. */
export async function findParticipantSettlement(
    roomCode: string,
    userId: number
): Promise<ParticipantSettlement | null> {
    const rows = await prisma.matchSettlement.findMany({
        where: { roomCode },
        orderBy: { matchStartedAt: "desc" },
        take: 10,
        select: { id: true, status: true, snapshot: true },
    });
    for (const row of rows) {
        let snapshot: MatchSettlementSnapshot;
        try {
            snapshot = parseSettlementSnapshot(row.snapshot);
        } catch (error) {
            if (error instanceof SettlementSnapshotError) continue;
            throw error;
        }
        if (snapshot.participants.some((participant) => participant.userId === userId)) {
            return { id: row.id, status: row.status, snapshot };
        }
    }
    return null;
}
