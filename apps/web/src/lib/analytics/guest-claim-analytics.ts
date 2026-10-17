import { Prisma } from "@hushle/platform-db";
import { reportError } from "@hushle/platform-observability";
import { prisma } from "@/lib/prisma";
import {
    buildGuestClaimAnalyticsSummary,
    emptyGuestClaimAnalyticsSummary,
    guestClaimAnalyticsWindow,
    type GuestClaimAnalyticsCounts,
    type GuestClaimAnalyticsDays,
    type GuestClaimAnalyticsSummary,
    type GuestClaimAnalyticsWindow,
} from "./guest-claim-analytics-rules";

export type GuestClaimAnalyticsLoader = (
    window: GuestClaimAnalyticsWindow
) => Promise<GuestClaimAnalyticsCounts>;

/**
 * Three aggregate queries in one REPEATABLE READ transaction, so every number comes from
 * the same InnoDB snapshot. Only grouped counts and sums leave the database; no seat row
 * is loaded. match_ended_at has no index of its own: the table only ever holds about 30
 * days of seats, so the 30-day view reads all of it anyway.
 */
export async function loadGuestClaimAnalyticsCounts(
    window: GuestClaimAnalyticsWindow
): Promise<GuestClaimAnalyticsCounts> {
    const inWindow = {
        matchEndedAt: { gte: window.start, lte: window.end },
    } satisfies Prisma.MatchSettlementGuestSeatWhereInput;

    const { groups, settledFromHostEnded, accounts } = await prisma.$transaction(async (tx) => {
        const grouped = await tx.matchSettlementGuestSeat.groupBy({
            by: ["status", "outcome"],
            where: inWindow,
            orderBy: [{ status: "asc" }, { outcome: "asc" }],
            _count: { _all: true },
            _sum: { coinEarned: true },
        });
        const hostEnded = await tx.matchSettlementGuestSeat.count({
            where: { ...inWindow, status: "settled", settlement: { endReason: "host_ended" } },
        });
        const distinct = await tx.$queryRaw<Array<{ accounts: bigint | number | null }>>(Prisma.sql`
            SELECT COUNT(DISTINCT claim_user_id) AS accounts
            FROM match_settlement_guest_seats
            WHERE match_ended_at >= ${window.start}
              AND match_ended_at <= ${window.end}
              AND status <> 'unclaimed'
              AND claim_user_id IS NOT NULL
        `);
        return { groups: grouped, settledFromHostEnded: hostEnded, accounts: distinct };
    }, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        // A full 30-day scan on a busy table may outlast the 5 s default.
        timeout: 15_000,
    });

    return {
        groups: groups.map((group) => ({
            status: group.status,
            outcome: group.outcome,
            seats: group._count._all,
            coinEarned: group._sum.coinEarned,
        })),
        settledFromHostEnded,
        distinctAccounts: accounts[0]?.accounts ?? 0,
    };
}

/**
 * Guest claim numbers for Admin Lab. A database failure is reported and returns an
 * empty summary with `available: false`, like the Redis-backed pause counters.
 */
export async function getGuestClaimAnalytics(
    input: { days: GuestClaimAnalyticsDays; now?: Date },
    options: { load?: GuestClaimAnalyticsLoader } = {}
): Promise<GuestClaimAnalyticsSummary> {
    const days: GuestClaimAnalyticsDays = input.days === 30 ? 30 : 7;
    const window = guestClaimAnalyticsWindow(days, input.now ?? new Date());
    try {
        const counts = await (options.load ?? loadGuestClaimAnalyticsCounts)(window);
        return buildGuestClaimAnalyticsSummary({ days, window, counts });
    } catch (error) {
        await reportError({
            service: "hushle-web",
            event: "admin.lab.guest_claims.read_failed",
            error,
            context: { days },
        }).catch(() => undefined);
        return emptyGuestClaimAnalyticsSummary(days, window);
    }
}
