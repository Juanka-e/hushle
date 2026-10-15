import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/web/src/lib/prisma";
import { closeRedisClient } from "@hushle/platform-cache";
import { resetObservabilityForTests } from "@hushle/platform-observability";
import { createGuestIdentityToken } from "../apps/web/src/lib/security/player-identity";
import { parseSettlementSnapshot } from "../apps/web/src/lib/match-settlement/snapshot";
import { recordMatchSettlement } from "../apps/web/src/lib/match-settlement/service";
import { claimGuestMatches } from "../apps/web/src/lib/match-settlement/guest-claim";
import {
    getGuestClaimAnalytics,
    loadGuestClaimAnalyticsCounts,
} from "../apps/web/src/lib/analytics/guest-claim-analytics";
import type {
    GuestClaimAnalyticsSummary,
    GuestClaimClosedReason,
    GuestClaimWaitingReason,
} from "../apps/web/src/lib/analytics/guest-claim-analytics-rules";

// Rows live in a far-future era so the windows below see only this test's seats, even while
// other suites write real-time seats to tabu_test. Pending seats wait until that era too, so
// no real-time worker sweep ever picks them up.
const ERA_START = new Date("2087-01-01T00:00:00.000Z");
const NOW = new Date("2087-03-15T12:00:00.000Z");
// Real room codes are 6 characters; these are 12, so the prefix never matches a real room.
const ROOM_PREFIX = "LBX";
const MS = 1;
const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

const createdUserIds: number[] = [];
const createdGuestIds: string[] = [];

function roomCode(): string {
    return `${ROOM_PREFIX}${randomUUID().replaceAll("-", "").slice(0, 9).toUpperCase()}`;
}

async function createUser(label: string, options: { unverified?: boolean } = {}): Promise<number> {
    const username = `lab_${label}_${randomUUID().replaceAll("-", "").slice(0, 10)}`.slice(0, 40);
    const user = await prisma.user.create({
        data: {
            username,
            password: "integration-test-only",
            ...(options.unverified
                ? {
                      accountStatus: "pending_email_verification" as const,
                      emailVerificationRequiredAt: new Date(),
                      emailVerifiedAt: null,
                  }
                : {}),
        },
        select: { id: true },
    });
    createdUserIds.push(user.id);
    return user.id;
}

interface SeatInput {
    endedAt: Date;
    status: "unclaimed" | "pending" | "settled" | "rejected" | "expired";
    outcome?: string | null;
    coin?: number | null;
    claimUserId?: number | null;
    endReason?: "completed" | "host_ended";
}

/** One settled match with one guest seat, written directly; the analytics only read rows. */
async function seat(input: SeatInput): Promise<void> {
    const guestPlayerId = `guest:${randomUUID()}`;
    const claimed = input.status !== "unclaimed";
    await prisma.matchSettlement.create({
        data: {
            roomCode: roomCode(),
            matchStartedAt: new Date(input.endedAt.getTime() - 10 * 60_000),
            matchEndedAt: input.endedAt,
            endReason: input.endReason ?? "completed",
            snapshot: { analyticsFixture: true },
            guestParticipantCount: 1,
            status: "settled",
            settledAt: NOW,
            availableAt: NOW,
            guestSeats: {
                create: [
                    {
                        guestPlayerId,
                        matchEndedAt: input.endedAt,
                        status: input.status,
                        outcome: input.outcome ?? (input.status === "settled" ? "settled" : null),
                        claimUserId: claimed ? (input.claimUserId ?? null) : null,
                        claimedAt: claimed ? NOW : null,
                        availableAt: input.status === "pending" ? new Date(NOW.getTime() + DAY) : null,
                        attemptCount: input.outcome === "retry" ? 1 : 0,
                        lastError: input.outcome === "retry" ? "fixture: wallet busy" : null,
                        coinEarned: input.status === "settled" ? (input.coin ?? 0) : null,
                        settledAt: input.status === "pending" || input.status === "unclaimed" ? null : NOW,
                    },
                ],
            },
        },
    });
}

async function cleanup(): Promise<void> {
    await prisma.matchSettlement.deleteMany({
        where: { roomCode: { startsWith: ROOM_PREFIX }, matchEndedAt: { gte: ERA_START } },
    });
    if (createdGuestIds.length > 0) {
        await prisma.guestProgress.deleteMany({ where: { playerId: { in: createdGuestIds } } });
    }
    if (createdUserIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
}

const ZERO_WAITING: Record<GuestClaimWaitingReason, number> = {
    email_verification: 0,
    suspension: 0,
    retry: 0,
    other: 0,
};
const ZERO_CLOSED: Record<GuestClaimClosedReason, number> = {
    already_participant: 0,
    already_recorded: 0,
    not_eligible: 0,
    suspended: 0,
    user_missing: 0,
    invalid_snapshot: 0,
    expired: 0,
    failed: 0,
    other: 0,
};

function expected(
    days: 7 | 30,
    now: Date,
    values: Omit<GuestClaimAnalyticsSummary, "days" | "available" | "retentionDays" | "windowStart" | "windowEnd">
): GuestClaimAnalyticsSummary {
    return {
        days,
        available: true,
        retentionDays: 30,
        windowStart: new Date(now.getTime() - days * DAY).toISOString(),
        windowEnd: now.toISOString(),
        ...values,
    };
}

async function run(): Promise<void> {
    assert.equal(
        process.env.GUEST_CLAIM_ANALYTICS_INTEGRATION_TEST,
        "true",
        "GUEST_CLAIM_ANALYTICS_INTEGRATION_TEST=true is required"
    );
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/, "requires a tabu_test database");

    await cleanup();
    try {
        // 1. Empty window: zeros, no division by zero, and the real queries run.
        {
            for (const days of [7, 30] as const) {
                const summary = await getGuestClaimAnalytics({ days, now: NOW });
                assert.deepEqual(
                    summary,
                    expected(days, NOW, {
                        eligible: 0,
                        unclaimed: 0,
                        claimed: 0,
                        claimRatePercent: 0,
                        settled: 0,
                        coinGranted: 0,
                        settledFromHostEnded: 0,
                        waiting: 0,
                        waitingByReason: ZERO_WAITING,
                        closed: 0,
                        rejected: 0,
                        expired: 0,
                        closedByReason: ZERO_CLOSED,
                        unknownStatus: 0,
                        distinctAccounts: 0,
                    }),
                    `empty ${days}-day window`
                );
            }
            console.log("[lab] 1 empty window returns zeros");
        }

        const userA = await createUser("a");
        const userB = await createUser("b");
        const userC = await createUser("c");
        const userD = await createUser("d");
        const ago = (ms: number) => new Date(NOW.getTime() - ms);

        // Inside the 7-day window (both bounds inclusive).
        await seat({ endedAt: ago(7 * DAY), status: "unclaimed" });
        await seat({ endedAt: NOW, status: "unclaimed" });
        await seat({ endedAt: ago(6 * DAY), status: "unclaimed" });
        await seat({ endedAt: ago(6 * DAY), status: "unclaimed" });
        await seat({ endedAt: ago(1 * HOUR), status: "pending", outcome: "awaiting_verification", claimUserId: userA });
        await seat({ endedAt: ago(2 * HOUR), status: "pending", outcome: "suspended_waiting", claimUserId: userB });
        await seat({ endedAt: ago(3 * HOUR), status: "pending", outcome: "retry", claimUserId: userA });
        await seat({ endedAt: ago(4 * HOUR), status: "pending", outcome: null, claimUserId: userC });
        await seat({ endedAt: ago(1 * DAY), status: "settled", coin: 120, claimUserId: userA });
        await seat({ endedAt: ago(2 * DAY), status: "settled", coin: 40, claimUserId: userB });
        await seat({ endedAt: ago(3 * DAY), status: "settled", coin: 0, claimUserId: userC, endReason: "host_ended" });
        await seat({ endedAt: ago(4 * DAY), status: "rejected", outcome: "already_participant", claimUserId: userA });
        await seat({ endedAt: ago(5 * DAY), status: "expired", outcome: "expired", claimUserId: userB });
        await seat({ endedAt: ago(6 * DAY), status: "rejected", outcome: "failed", claimUserId: userC });
        await seat({ endedAt: ago(6 * DAY), status: "rejected", outcome: "user_missing", claimUserId: null });
        // A rejected seat of a host_ended match is not a settled host_ended seat.
        await seat({ endedAt: ago(5 * DAY), status: "rejected", outcome: "not_eligible", claimUserId: userB, endReason: "host_ended" });

        // Inside 30 days only.
        await seat({ endedAt: ago(7 * DAY + MS), status: "unclaimed" });
        await seat({ endedAt: ago(8 * DAY), status: "settled", coin: 120, claimUserId: userD });
        await seat({ endedAt: ago(10 * DAY), status: "settled", coin: 0, claimUserId: userD, endReason: "host_ended" });
        await seat({ endedAt: ago(15 * DAY), status: "rejected", outcome: "not_eligible", claimUserId: userA });
        await seat({ endedAt: ago(20 * DAY), status: "rejected", outcome: "already_recorded", claimUserId: userB });
        // An outcome a newer deploy might write.
        await seat({ endedAt: ago(29 * DAY), status: "pending", outcome: "waiting_for_parent_consent", claimUserId: userC });
        await seat({ endedAt: ago(30 * DAY), status: "unclaimed" });

        // Outside both windows: older than 30 days, or ended after "now".
        await seat({ endedAt: ago(30 * DAY + MS), status: "settled", coin: 999, claimUserId: userA });
        await seat({ endedAt: ago(45 * DAY), status: "rejected", outcome: "already_participant", claimUserId: userD });
        await seat({ endedAt: new Date(NOW.getTime() + MS), status: "settled", coin: 777, claimUserId: userB });
        await seat({ endedAt: new Date(NOW.getTime() + DAY), status: "unclaimed" });

        // 2. Seven days: exact numbers, boundary rows in, everything else out.
        {
            const summary = await getGuestClaimAnalytics({ days: 7, now: NOW });
            assert.deepEqual(
                summary,
                expected(7, NOW, {
                    eligible: 16,
                    unclaimed: 4,
                    claimed: 12,
                    claimRatePercent: 75,
                    settled: 3,
                    coinGranted: 160,
                    settledFromHostEnded: 1,
                    waiting: 4,
                    waitingByReason: { email_verification: 1, suspension: 1, retry: 1, other: 1 },
                    closed: 5,
                    rejected: 4,
                    expired: 1,
                    closedByReason: { ...ZERO_CLOSED, already_participant: 1, not_eligible: 1, expired: 1, failed: 1, user_missing: 1 },
                    unknownStatus: 0,
                    distinctAccounts: 3,
                })
            );
            console.log("[lab] 2 seven-day window matches the seeded seats");
        }

        // 3. Thirty days: adds the 8-30 day seats and the fourth account.
        {
            const summary = await getGuestClaimAnalytics({ days: 30, now: NOW });
            assert.deepEqual(
                summary,
                expected(30, NOW, {
                    eligible: 23,
                    unclaimed: 6,
                    claimed: 17,
                    claimRatePercent: 73.9,
                    settled: 5,
                    coinGranted: 280,
                    settledFromHostEnded: 2,
                    waiting: 5,
                    waitingByReason: { email_verification: 1, suspension: 1, retry: 1, other: 2 },
                    closed: 7,
                    rejected: 6,
                    expired: 1,
                    closedByReason: {
                        ...ZERO_CLOSED,
                        already_participant: 1,
                        already_recorded: 1,
                        not_eligible: 2,
                        expired: 1,
                        failed: 1,
                        user_missing: 1,
                    },
                    unknownStatus: 0,
                    distinctAccounts: 4,
                })
            );
            console.log("[lab] 3 thirty-day window matches the seeded seats");
        }

        // 4. Moving "now" by one millisecond moves exactly the boundary rows.
        {
            const later = new Date(NOW.getTime() + MS);
            const seven = await getGuestClaimAnalytics({ days: 7, now: later });
            // Out: the unclaimed seat at exactly now - 7d. In: the settled seat at now + 1ms.
            assert.equal(seven.eligible, 16);
            assert.equal(seven.unclaimed, 3);
            assert.equal(seven.settled, 4);
            assert.equal(seven.coinGranted, 160 + 777);
            const thirty = await getGuestClaimAnalytics({ days: 30, now: later });
            // Out: the unclaimed seat at exactly now - 30d. In: the same settled seat.
            assert.equal(thirty.eligible, 23);
            assert.equal(thirty.unclaimed, 5);
            assert.equal(thirty.coinGranted, 280 + 777);
            const earlier = await getGuestClaimAnalytics({ days: 30, now: new Date(NOW.getTime() - MS) });
            // In: the settled seat at now - 30d - 1ms (999 coin). Out: the unclaimed seat at now.
            assert.equal(earlier.coinGranted, 280 + 999);
            assert.equal(earlier.unclaimed, 5);
            console.log("[lab] 4 window bounds are inclusive and follow match end time");
        }

        // 5. The loader returns aggregates only: one group per (status, outcome).
        {
            const counts = await loadGuestClaimAnalyticsCounts({ start: new Date(NOW.getTime() - 30 * DAY), end: NOW });
            const keys = counts.groups.map((group) => `${group.status}:${group.outcome ?? "null"}`);
            assert.equal(new Set(keys).size, keys.length, "groups are unique");
            assert.equal(
                counts.groups.reduce((total, group) => total + Number(group.seats), 0),
                23,
                "groups cover every seat in the window"
            );
            assert.ok(counts.groups.length <= 16, "a handful of groups, never one row per seat");
            assert.equal(Number(counts.distinctAccounts), 4);
            assert.equal(Number(counts.settledFromHostEnded), 2);
            console.log("[lab] 5 the database returns grouped counts only");
        }

        // 6. A deleted account frees its seats from the account count; seats stay counted.
        {
            await prisma.user.delete({ where: { id: userD } });
            createdUserIds.splice(createdUserIds.indexOf(userD), 1);
            const summary = await getGuestClaimAnalytics({ days: 30, now: NOW });
            assert.equal(summary.distinctAccounts, 3, "the deleted account is not counted");
            assert.equal(summary.settled, 5, "its settled seats are still counted");
            assert.equal(summary.claimed, 17);
            console.log("[lab] 6 deleted accounts drop out of the account count only");
        }

        // 7. A real claim stores the waiting reason the Lab groups by.
        {
            const guestId = randomUUID();
            const guestPlayerId = `guest:${guestId}`;
            const hostPlayerId = `guest:${randomUUID()}`;
            createdGuestIds.push(guestPlayerId, hostPlayerId);
            const endedAt = new Date(NOW.getTime() - 2 * HOUR);
            const snapshot = parseSettlementSnapshot({
                version: 1,
                endReason: "completed",
                roomCode: roomCode(),
                gameMode: "tabu",
                matchStartedAt: new Date(endedAt.getTime() - 600_000).toISOString(),
                matchEndedAt: endedAt.toISOString(),
                durationSeconds: 600,
                matchFormat: "skor",
                matchTarget: 10,
                score: { A: 10, B: 6 },
                participants: [
                    {
                        // A guest host keeps the match reward-free even if a sweep settles it.
                        playerId: hostPlayerId,
                        userId: null,
                        identityType: "guest",
                        usernameSnapshot: null,
                        displayName: "Misafir host",
                        team: "B",
                        roleAtStart: "Anlatıcı",
                    },
                    {
                        playerId: guestPlayerId,
                        userId: null,
                        identityType: "guest",
                        usernameSnapshot: null,
                        displayName: "Misafir",
                        team: "A",
                        roleAtStart: "Tahminci",
                    },
                ],
            });
            const record = await recordMatchSettlement(snapshot);
            // Keep real-time settlement sweeps away from this far-future match.
            await prisma.matchSettlement.update({
                where: { id: record.id },
                data: { status: "settled", settledAt: NOW },
            });
            const claimant = await createUser("claimant", { unverified: true });
            const before = await getGuestClaimAnalytics({ days: 7, now: NOW });
            const result = await claimGuestMatches(
                { userId: claimant, guestToken: createGuestIdentityToken(guestId, NOW.getTime() - 3 * HOUR) },
                { now: NOW }
            );
            assert.equal(result.status, "ok");
            const stored = await prisma.matchSettlementGuestSeat.findUniqueOrThrow({
                where: { settlementId_guestPlayerId: { settlementId: record.id, guestPlayerId } },
                select: { status: true, outcome: true },
            });
            assert.deepEqual(stored, { status: "pending", outcome: "awaiting_verification" });
            const after = await getGuestClaimAnalytics({ days: 7, now: NOW });
            assert.equal(after.eligible, before.eligible + 2, "both playing guests are offered the claim");
            assert.equal(after.unclaimed, before.unclaimed + 1);
            assert.equal(after.claimed, before.claimed + 1);
            assert.equal(after.waitingByReason.email_verification, before.waitingByReason.email_verification + 1);
            assert.equal(after.waitingByReason.other, before.waitingByReason.other);
            assert.equal(after.distinctAccounts, before.distinctAccounts + 1);
            console.log("[lab] 7 a real unverified claim shows up as waiting for email verification");
        }

        // 8. A real database error yields the unavailable state instead of a crash.
        {
            const lines: string[] = [];
            resetObservabilityForTests({ sink: (_level, line) => lines.push(line) });
            const failed = await getGuestClaimAnalytics(
                { days: 7, now: NOW },
                {
                    load: async () => {
                        await prisma.$queryRaw`SELECT * FROM guest_claim_lab_table_that_does_not_exist`;
                        throw new Error("unreachable");
                    },
                }
            );
            resetObservabilityForTests();
            assert.equal(failed.available, false);
            assert.equal(failed.eligible, 0);
            assert.equal(lines.length, 1);
            assert.match(lines[0], /admin\.lab\.guest_claims\.read_failed/);
            console.log("[lab] 8 database errors return the unavailable state");
        }

        console.log("guest claim analytics integration checks passed");
    } finally {
        await cleanup();
        await prisma.$disconnect();
        await closeRedisClient();
    }
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
