import type { GuestSeatSettleOutcome } from "@/lib/match-settlement/guest-claim-rules";

/**
 * Aggregate-only view of guest match claims for Admin Lab. The input is grouped counts
 * from match_settlement_guest_seats; nothing here identifies a player, an account or a room.
 *
 * Window: seats whose match ended in [now - days × 24h, now]. Every number describes that
 * cohort of seats in its current state, so a seat from a match 6 days ago that was claimed
 * yesterday counts as claimed in both the 7 and the 30 day view.
 */

export type GuestClaimAnalyticsDays = 7 | 30;

/**
 * Seat rows are deleted together with their match settlement 30 days after it settles
 * (purgeSettledMatchSettlements), so 30 days is the longest window the table can answer.
 */
export const GUEST_SEAT_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1_000;

export type GuestClaimWaitingReason = "email_verification" | "suspension" | "retry" | "other";

export type GuestClaimClosedReason =
    | "already_participant"
    | "already_recorded"
    | "not_eligible"
    | "suspended"
    | "user_missing"
    | "invalid_snapshot"
    | "expired"
    | "failed"
    | "other";

export const GUEST_CLAIM_WAITING_REASONS: readonly GuestClaimWaitingReason[] = [
    "email_verification",
    "suspension",
    "retry",
    "other",
];

export const GUEST_CLAIM_CLOSED_REASONS: readonly GuestClaimClosedReason[] = [
    "already_participant",
    "already_recorded",
    "not_eligible",
    "suspended",
    "user_missing",
    "invalid_snapshot",
    "expired",
    "failed",
    "other",
];

// A pending seat stores why it waits in `outcome` (see settleGuestSeatClaim). A seat that
// was just claimed and not processed yet has no outcome and lands in "other".
const WAITING_REASON_BY_OUTCOME = {
    awaiting_verification: "email_verification",
    suspended_waiting: "suspension",
    retry: "retry",
} satisfies Partial<Record<GuestSeatSettleOutcome, GuestClaimWaitingReason>>;

const CLOSED_REASON_BY_OUTCOME = {
    already_participant: "already_participant",
    already_recorded: "already_recorded",
    not_eligible: "not_eligible",
    suspended: "suspended",
    user_missing: "user_missing",
    invalid_snapshot: "invalid_snapshot",
    expired: "expired",
    failed: "failed",
} satisfies Partial<Record<GuestSeatSettleOutcome, GuestClaimClosedReason>>;

/** One row of `groupBy(status, outcome)` over the window. */
export interface GuestClaimSeatGroup {
    status: string;
    outcome: string | null;
    seats: number | bigint;
    /** Sum of coin_earned for the group; null when every row is null. */
    coinEarned: number | bigint | null;
}

export interface GuestClaimAnalyticsCounts {
    groups: readonly GuestClaimSeatGroup[];
    /** Settled seats whose match the host ended early (`host_ended`, no coin by policy). */
    settledFromHostEnded: number | bigint;
    /** Distinct accounts behind the claimed seats; deleted accounts are not counted. */
    distinctAccounts: number | bigint;
}

export interface GuestClaimAnalyticsWindow {
    start: Date;
    end: Date;
}

export interface GuestClaimAnalyticsSummary {
    days: GuestClaimAnalyticsDays;
    available: boolean;
    retentionDays: number;
    windowStart: string;
    windowEnd: string;
    /** Every recorded seat: guests who played (not watched) a finished match. */
    eligible: number;
    unclaimed: number;
    /** Seats in any status other than unclaimed. */
    claimed: number;
    /** claimed / eligible in percent, one decimal; 0 when nothing was recorded. */
    claimRatePercent: number;
    settled: number;
    coinGranted: number;
    settledFromHostEnded: number;
    waiting: number;
    waitingByReason: Record<GuestClaimWaitingReason, number>;
    /** Rejected plus expired: the claim ended without moving the match. */
    closed: number;
    rejected: number;
    expired: number;
    closedByReason: Record<GuestClaimClosedReason, number>;
    /** Claimed seats in a status this build does not know (a newer deploy wrote them). */
    unknownStatus: number;
    distinctAccounts: number;
}

function toCount(value: number | bigint | null | undefined): number {
    const parsed = typeof value === "bigint" ? Number(value) : value;
    if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(parsed));
}

function lookup<T extends string>(table: Record<string, T>, key: string | null): T | null {
    // Own keys only: "constructor" or "__proto__" must never resolve to a bucket.
    return key !== null && Object.hasOwn(table, key) ? table[key] : null;
}

function zeroRecord<K extends string>(keys: readonly K[]): Record<K, number> {
    return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

/**
 * Percent with one decimal. A non-zero share never shows as 0 and an incomplete one never
 * shows as 100, so "everyone claimed" and "nobody claimed" are always literally true.
 */
export function guestClaimSharePercent(part: number, total: number): number {
    if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0 || part <= 0) return 0;
    if (part >= total) return 100;
    const rounded = Math.round((part / total) * 1_000) / 10;
    return Math.min(99.9, Math.max(0.1, rounded));
}

export function guestClaimAnalyticsWindow(
    days: GuestClaimAnalyticsDays,
    now: Date
): GuestClaimAnalyticsWindow {
    const span: GuestClaimAnalyticsDays = days === 30 ? 30 : 7;
    const end = Number.isFinite(now.getTime()) ? now : new Date();
    return { start: new Date(end.getTime() - span * DAY_MS), end };
}

export function emptyGuestClaimAnalyticsSummary(
    days: GuestClaimAnalyticsDays,
    window: GuestClaimAnalyticsWindow
): GuestClaimAnalyticsSummary {
    return {
        days: days === 30 ? 30 : 7,
        available: false,
        retentionDays: GUEST_SEAT_RETENTION_DAYS,
        windowStart: window.start.toISOString(),
        windowEnd: window.end.toISOString(),
        eligible: 0,
        unclaimed: 0,
        claimed: 0,
        claimRatePercent: 0,
        settled: 0,
        coinGranted: 0,
        settledFromHostEnded: 0,
        waiting: 0,
        waitingByReason: zeroRecord(GUEST_CLAIM_WAITING_REASONS),
        closed: 0,
        rejected: 0,
        expired: 0,
        closedByReason: zeroRecord(GUEST_CLAIM_CLOSED_REASONS),
        unknownStatus: 0,
        distinctAccounts: 0,
    };
}

/** Shapes grouped seat counts into the Lab summary. Pure; never throws on odd input. */
export function buildGuestClaimAnalyticsSummary(input: {
    days: GuestClaimAnalyticsDays;
    window: GuestClaimAnalyticsWindow;
    counts: GuestClaimAnalyticsCounts;
}): GuestClaimAnalyticsSummary {
    const summary = emptyGuestClaimAnalyticsSummary(input.days, input.window);
    summary.available = true;

    for (const group of input.counts.groups) {
        const seats = toCount(group.seats);
        if (seats === 0) continue;
        summary.eligible += seats;
        switch (group.status) {
            case "unclaimed":
                summary.unclaimed += seats;
                break;
            case "settled":
                summary.settled += seats;
                summary.coinGranted += toCount(group.coinEarned);
                break;
            case "pending": {
                summary.waiting += seats;
                const reason = lookup<GuestClaimWaitingReason>(WAITING_REASON_BY_OUTCOME, group.outcome) ?? "other";
                summary.waitingByReason[reason] += seats;
                break;
            }
            case "rejected":
            case "expired": {
                if (group.status === "rejected") summary.rejected += seats;
                else summary.expired += seats;
                summary.closed += seats;
                const reason = lookup<GuestClaimClosedReason>(CLOSED_REASON_BY_OUTCOME, group.outcome) ?? "other";
                summary.closedByReason[reason] += seats;
                break;
            }
            default:
                summary.unknownStatus += seats;
        }
    }

    summary.claimed = summary.eligible - summary.unclaimed;
    summary.claimRatePercent = guestClaimSharePercent(summary.claimed, summary.eligible);
    // The queries share one snapshot; the caps only guard against a caller that mixes reads.
    summary.settledFromHostEnded = Math.min(toCount(input.counts.settledFromHostEnded), summary.settled);
    summary.distinctAccounts = Math.min(toCount(input.counts.distinctAccounts), summary.claimed);
    return summary;
}
