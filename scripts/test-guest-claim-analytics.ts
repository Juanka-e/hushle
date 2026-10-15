import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resetObservabilityForTests } from "@hushle/platform-observability";
import {
    GUEST_CLAIM_CLOSED_REASONS,
    GUEST_CLAIM_WAITING_REASONS,
    GUEST_SEAT_RETENTION_DAYS,
    buildGuestClaimAnalyticsSummary,
    emptyGuestClaimAnalyticsSummary,
    guestClaimAnalyticsWindow,
    guestClaimSharePercent,
    type GuestClaimAnalyticsCounts,
    type GuestClaimAnalyticsSummary,
    type GuestClaimClosedReason,
    type GuestClaimSeatGroup,
    type GuestClaimWaitingReason,
} from "../apps/web/src/lib/analytics/guest-claim-analytics-rules";
import { getGuestClaimAnalytics } from "../apps/web/src/lib/analytics/guest-claim-analytics";

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = new Date("2026-10-15T12:00:00.000Z");
const WINDOW_7 = guestClaimAnalyticsWindow(7, NOW);

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

function group(
    status: string,
    outcome: string | null,
    seats: number | bigint,
    coinEarned: number | bigint | null = null
): GuestClaimSeatGroup {
    return { status, outcome, seats, coinEarned };
}

function build(
    groups: GuestClaimSeatGroup[],
    extra: Partial<Omit<GuestClaimAnalyticsCounts, "groups">> = {}
): GuestClaimAnalyticsSummary {
    return buildGuestClaimAnalyticsSummary({
        days: 7,
        window: WINDOW_7,
        counts: { groups, settledFromHostEnded: 0, distinctAccounts: 0, ...extra },
    });
}

/** Every bucket adds up: nothing is lost or counted twice. */
function assertConsistent(summary: GuestClaimAnalyticsSummary, label: string): void {
    const waitingTotal = Object.values(summary.waitingByReason).reduce((total, value) => total + value, 0);
    const closedTotal = Object.values(summary.closedByReason).reduce((total, value) => total + value, 0);
    assert.equal(summary.eligible, summary.unclaimed + summary.claimed, `${label}: eligible = unclaimed + claimed`);
    assert.equal(
        summary.claimed,
        summary.settled + summary.waiting + summary.closed + summary.unknownStatus,
        `${label}: claimed = settled + waiting + closed + unknown`
    );
    assert.equal(summary.waiting, waitingTotal, `${label}: waiting reasons add up`);
    assert.equal(summary.closed, closedTotal, `${label}: closed reasons add up`);
    assert.equal(summary.closed, summary.rejected + summary.expired, `${label}: closed = rejected + expired`);
    assert.ok(summary.settledFromHostEnded <= summary.settled, `${label}: host_ended within settled`);
    assert.ok(summary.distinctAccounts <= summary.claimed, `${label}: accounts within claimed`);
    assert.ok(summary.claimRatePercent >= 0 && summary.claimRatePercent <= 100, `${label}: rate in range`);
    for (const value of [
        summary.eligible,
        summary.claimed,
        summary.settled,
        summary.coinGranted,
        summary.waiting,
        summary.closed,
        summary.distinctAccounts,
    ]) {
        assert.ok(Number.isSafeInteger(value) && value >= 0, `${label}: ${value} is a count`);
    }
}

function testZeroData() {
    const summary = build([]);
    assert.deepEqual(summary, {
        days: 7,
        available: true,
        retentionDays: 30,
        windowStart: "2026-10-08T12:00:00.000Z",
        windowEnd: "2026-10-15T12:00:00.000Z",
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
    });
    assertConsistent(summary, "zero");

    // Zero-seat groups and stray account/host_ended counts never invent data.
    const strays = build([group("settled", "settled", 0, 500), group("pending", "retry", 0)], {
        settledFromHostEnded: 4,
        distinctAccounts: 3,
    });
    assert.equal(strays.eligible, 0);
    assert.equal(strays.coinGranted, 0, "coin of an empty group is ignored");
    assert.equal(strays.settledFromHostEnded, 0);
    assert.equal(strays.distinctAccounts, 0);
    assert.equal(strays.claimRatePercent, 0);

    // The unavailable shape is the same zeros, flagged.
    const empty = emptyGuestClaimAnalyticsSummary(30, guestClaimAnalyticsWindow(30, NOW));
    assert.equal(empty.available, false);
    assert.equal(empty.days, 30);
    assert.equal(empty.windowStart, "2026-09-15T12:00:00.000Z");
    assert.deepEqual({ ...empty, available: true, days: 7, windowStart: summary.windowStart }, summary);
    console.log("[analytics] zero data");
}

function testMixedStatuses() {
    const summary = build(
        [
            group("unclaimed", null, 9),
            group("pending", "awaiting_verification", 3),
            group("pending", "suspended_waiting", 1),
            group("pending", "retry", 2),
            group("pending", null, 1),
            group("settled", "settled", 6, 520),
            group("rejected", "already_participant", 2),
            group("rejected", "already_recorded", 1),
            group("rejected", "not_eligible", 1),
            group("rejected", "suspended", 1),
            group("rejected", "user_missing", 1),
            group("rejected", "invalid_snapshot", 1),
            group("rejected", "failed", 1),
            group("expired", "expired", 2),
        ],
        { settledFromHostEnded: 2, distinctAccounts: 7 }
    );
    assert.deepEqual(summary, {
        days: 7,
        available: true,
        retentionDays: GUEST_SEAT_RETENTION_DAYS,
        windowStart: "2026-10-08T12:00:00.000Z",
        windowEnd: "2026-10-15T12:00:00.000Z",
        eligible: 32,
        unclaimed: 9,
        claimed: 23,
        claimRatePercent: 71.9,
        settled: 6,
        coinGranted: 520,
        settledFromHostEnded: 2,
        waiting: 7,
        waitingByReason: { email_verification: 3, suspension: 1, retry: 2, other: 1 },
        closed: 10,
        rejected: 8,
        expired: 2,
        closedByReason: {
            already_participant: 2,
            already_recorded: 1,
            not_eligible: 1,
            suspended: 1,
            user_missing: 1,
            invalid_snapshot: 1,
            expired: 2,
            failed: 1,
            other: 0,
        },
        unknownStatus: 0,
        distinctAccounts: 7,
    });
    assertConsistent(summary, "mixed");

    // The same status split over several outcome groups adds up; bigint counts from raw SQL work.
    const split = build(
        [
            group("settled", "settled", BigInt(2), BigInt(240)),
            group("settled", null, 1, null),
            group("expired", "expired", BigInt(1)),
            group("rejected", "expired", 1),
        ],
        { settledFromHostEnded: BigInt(1), distinctAccounts: BigInt(2) }
    );
    assert.equal(split.settled, 3);
    assert.equal(split.coinGranted, 240, "null coin sums count as zero");
    assert.equal(split.expired, 1);
    assert.equal(split.rejected, 1);
    assert.equal(split.closedByReason.expired, 2, "closed reasons follow the outcome, whatever the closing status");
    assert.equal(split.settledFromHostEnded, 1);
    assert.equal(split.distinctAccounts, 2);
    assertConsistent(split, "split");
    console.log("[analytics] mixed statuses");
}

function testPercentRounding() {
    const cases: Array<[number, number, number]> = [
        [0, 0, 0],
        [0, 5, 0],
        [5, 0, 0],
        [5, 5, 100],
        [7, 5, 100],
        [1, 3, 33.3],
        [2, 3, 66.7],
        [1, 8, 12.5],
        [1, 6, 16.7],
        [23, 32, 71.9],
        [1, 2_000, 0.1], // 0.05 would round to 0.1 anyway; smaller shares stay visible
        [1, 10_000, 0.1],
        [1_999, 2_000, 99.9],
        [9_999, 10_000, 99.9], // never claims "everyone" while one seat is unclaimed
        [-1, 10, 0],
        [Number.NaN, 10, 0],
        [3, Number.POSITIVE_INFINITY, 0],
    ];
    for (const [part, total, expected] of cases) {
        assert.equal(guestClaimSharePercent(part, total), expected, `${part}/${total}`);
    }
    // The summary uses the same rule.
    assert.equal(build([group("pending", "retry", 1), group("unclaimed", null, 9_999)]).claimRatePercent, 0.1);
    assert.equal(build([group("settled", "settled", 9_999), group("unclaimed", null, 1)]).claimRatePercent, 99.9);
    assert.equal(build([group("settled", "settled", 4)]).claimRatePercent, 100);
    assert.equal(build([group("unclaimed", null, 4)]).claimRatePercent, 0);
    console.log("[analytics] percentage rounding");
}

function testUnknownValues() {
    const summary = build(
        [
            group("pending", "waiting_for_parent_consent", 2), // a future waiting reason
            group("pending", "constructor", 1), // prototype keys never resolve to a bucket
            group("pending", "__proto__", 1),
            group("pending", "", 1),
            group("rejected", "region_blocked", 3), // a future closing reason
            group("rejected", null, 1),
            group("expired", "toString", 1),
            group("archived", "settled", 4), // a status a newer deploy may add
            group("settled", "unexpected", 1, 60),
        ],
        { distinctAccounts: 3 }
    );
    assert.deepEqual(summary.waitingByReason, { ...ZERO_WAITING, other: 5 });
    assert.deepEqual(summary.closedByReason, { ...ZERO_CLOSED, other: 5 });
    assert.equal(summary.unknownStatus, 4);
    assert.equal(summary.settled, 1, "settled counts by status, whatever its outcome");
    assert.equal(summary.coinGranted, 60);
    assert.equal(summary.eligible, 15);
    assert.equal(summary.claimed, 15, "unknown statuses are not unclaimed");
    assertConsistent(summary, "unknown");
    // Prototype keys used as labels never become buckets.
    assert.deepEqual(Object.keys(summary.waitingByReason), [...GUEST_CLAIM_WAITING_REASONS]);
    assert.deepEqual(Object.keys(summary.closedByReason), [...GUEST_CLAIM_CLOSED_REASONS]);
    console.log("[analytics] unknown outcomes and statuses bucket safely");
}

function testOddInput() {
    const summary = build(
        [
            group("unclaimed", null, -4),
            group("unclaimed", null, Number.NaN),
            group("unclaimed", null, 2.9),
            group("settled", "settled", 3, -50),
            group("settled", "settled", 1, Number.POSITIVE_INFINITY),
            group("pending", "retry", Number.POSITIVE_INFINITY),
        ],
        { settledFromHostEnded: 99, distinctAccounts: -2 }
    );
    assert.equal(summary.unclaimed, 2, "negative and NaN counts are dropped, fractions floored");
    assert.equal(summary.settled, 4);
    assert.equal(summary.coinGranted, 0, "negative or non-finite coin sums never leak");
    assert.equal(summary.waiting, 0, "infinite counts are dropped");
    assert.equal(summary.settledFromHostEnded, 4, "capped at settled");
    assert.equal(summary.distinctAccounts, 0);
    assertConsistent(summary, "odd");

    // Accounts can never exceed claimed seats (deleted accounts drop out, never added).
    assert.equal(build([group("settled", "settled", 2)], { distinctAccounts: 5 }).distinctAccounts, 2);
    console.log("[analytics] odd input is clamped");
}

function testWindow() {
    const seven = guestClaimAnalyticsWindow(7, NOW);
    assert.equal(seven.end.getTime(), NOW.getTime());
    assert.equal(seven.start.getTime(), NOW.getTime() - 7 * DAY_MS);
    const thirty = guestClaimAnalyticsWindow(30, NOW);
    assert.equal(thirty.start.getTime(), NOW.getTime() - 30 * DAY_MS);
    assert.equal(
        NOW.getTime() - thirty.start.getTime(),
        GUEST_SEAT_RETENTION_DAYS * DAY_MS,
        "the longest window equals the seat retention"
    );
    const coerced = guestClaimAnalyticsWindow(14 as unknown as 7, NOW);
    assert.equal(coerced.start.getTime(), NOW.getTime() - 7 * DAY_MS, "unknown spans fall back to 7 days");
    const before = Date.now();
    const invalid = guestClaimAnalyticsWindow(7, new Date("not a date"));
    assert.ok(invalid.end.getTime() >= before && invalid.end.getTime() <= Date.now(), "an invalid clock falls back to now");
    assert.equal(invalid.end.getTime() - invalid.start.getTime(), 7 * DAY_MS);
    console.log("[analytics] rolling window by match end");
}

async function testServiceWithLoader() {
    const windows: Array<{ start: Date; end: Date }> = [];
    const summary = await getGuestClaimAnalytics(
        { days: 30, now: NOW },
        {
            load: async (window) => {
                windows.push(window);
                return {
                    groups: [group("unclaimed", null, 3), group("settled", "settled", 1, 120)],
                    settledFromHostEnded: 0,
                    distinctAccounts: 1,
                };
            },
        }
    );
    assert.equal(windows.length, 1);
    assert.equal(windows[0].start.toISOString(), "2026-09-15T12:00:00.000Z");
    assert.equal(windows[0].end.toISOString(), NOW.toISOString());
    assert.equal(summary.available, true);
    assert.equal(summary.days, 30);
    assert.equal(summary.eligible, 4);
    assert.equal(summary.claimRatePercent, 25);
    assert.equal(summary.coinGranted, 120);

    const coerced = await getGuestClaimAnalytics(
        { days: 90 as unknown as 30, now: NOW },
        { load: async () => ({ groups: [], settledFromHostEnded: 0, distinctAccounts: 0 }) }
    );
    assert.equal(coerced.days, 7, "out-of-contract windows fall back to 7");

    // A database failure is reported once and returns flagged zeros; it never throws.
    const lines: string[] = [];
    resetObservabilityForTests({ sink: (_level, line) => lines.push(line) });
    const failed = await getGuestClaimAnalytics(
        { days: 7, now: NOW },
        {
            load: async () => {
                throw new Error("Can't reach database server at `mysql:3306`");
            },
        }
    );
    resetObservabilityForTests();
    assert.equal(failed.available, false);
    assert.equal(failed.eligible, 0);
    assert.deepEqual(failed.waitingByReason, ZERO_WAITING);
    assert.equal(failed.windowStart, "2026-10-08T12:00:00.000Z");
    assert.equal(lines.length, 1);
    const event = JSON.parse(lines[0]) as { level: string; event: string; context?: Record<string, unknown> };
    assert.equal(event.level, "error");
    assert.equal(event.event, "admin.lab.guest_claims.read_failed");
    assert.deepEqual(event.context, { days: 7 });

    // A loader that rejects with a non-Error value is handled the same way.
    resetObservabilityForTests({ sink: () => undefined });
    const odd = await getGuestClaimAnalytics(
        { days: 7, now: NOW },
        { load: () => Promise.reject("socket closed") }
    );
    resetObservabilityForTests();
    assert.equal(odd.available, false);
    console.log("[analytics] service shapes loader output and survives database errors");
}

/**
 * Every outcome guest-claim.ts writes lands in a named bucket, so a new outcome added
 * there without updating the Lab mapping fails here instead of hiding under "other".
 */
function testOutcomeDrift() {
    const claimSource = readFileSync("apps/web/src/lib/match-settlement/guest-claim.ts", "utf8");
    const closing = new Set<string>();
    for (const match of claimSource.matchAll(/closeSeat\(seat\.id, "(rejected|expired)", "([a-z_]+)"/g)) {
        closing.add(`${match[1]}:${match[2]}`);
    }
    for (const match of claimSource.matchAll(/status: "([a-z_]+)"(?: as const)?,\s*outcome: "([a-z_]+)"/g)) {
        closing.add(`${match[1]}:${match[2]}`);
    }
    const written = new Set([...claimSource.matchAll(/outcome: "([a-z_]+)"/g)].map((match) => match[1]));
    const pairedOutcomes = new Set([...closing].map((pair) => pair.split(":")[1]));
    const waiting = [...written].filter((outcome) => !pairedOutcomes.has(outcome));

    assert.deepEqual(
        [...closing].sort(),
        [
            "expired:expired",
            "rejected:already_participant",
            "rejected:already_recorded",
            "rejected:failed",
            "rejected:invalid_snapshot",
            "rejected:not_eligible",
            "rejected:suspended",
            "rejected:user_missing",
            "settled:settled",
        ],
        "outcomes that close a seat"
    );
    assert.deepEqual(waiting.sort(), ["awaiting_verification", "retry", "suspended_waiting"], "outcomes a pending seat waits with");

    for (const pair of closing) {
        const [status, outcome] = pair.split(":");
        const summary = build([group(status, outcome, 1)]);
        assert.equal(summary.unknownStatus, 0, pair);
        assert.equal(summary.closedByReason.other, 0, `${pair} has its own closed bucket`);
    }
    const expectedReason: Record<string, GuestClaimWaitingReason> = {
        awaiting_verification: "email_verification",
        suspended_waiting: "suspension",
        retry: "retry",
    };
    for (const outcome of waiting) {
        const summary = build([group("pending", outcome, 1)]);
        assert.equal(summary.waitingByReason[expectedReason[outcome]], 1, `${outcome} is grouped as ${expectedReason[outcome]}`);
    }
    // Each waiting write sits next to its reason, inside a pending-only update.
    assert.match(claimSource, /data: \{ outcome: "retry", lastError, availableAt: new Date\(now\.getTime\(\) \+ GUEST_CLAIM_RECHECK_MS\) \}/);
    assert.match(claimSource, /data: \{\s+outcome: "suspended_waiting",\s+availableAt: new Date\(Math\.max\(account\.suspendedUntil\.getTime\(\)/);
    assert.match(claimSource, /data: \{ outcome: "awaiting_verification", availableAt: new Date\(now\.getTime\(\) \+ GUEST_CLAIM_RECHECK_MS\) \}/);
    assert.match(claimSource, /data: \{\s+outcome: "retry",\s+attemptCount: attempts,/);
    assert.deepEqual([...GUEST_CLAIM_WAITING_REASONS], ["email_verification", "suspension", "retry", "other"]);
    assert.equal(GUEST_CLAIM_CLOSED_REASONS.at(-1), "other");
    console.log("[analytics] every written outcome has a bucket");
}

function testStaticContracts() {
    const rulesSource = readFileSync("apps/web/src/lib/analytics/guest-claim-analytics-rules.ts", "utf8");
    const serviceSource = readFileSync("apps/web/src/lib/analytics/guest-claim-analytics.ts", "utf8");
    for (const [name, source] of [
        ["rules", rulesSource],
        ["service", serviceSource],
    ] as const) {
        assert.doesNotMatch(
            source,
            /\b(username|usernameSnapshot|displayName|email|guestPlayerId|guest_player_id|roomCode|room_code|ipAddress|matchResultId)\b/,
            `${name} must not read personal or room identifiers`
        );
    }
    assert.doesNotMatch(rulesSource, /from "@\/lib\/prisma"|@hushle\/platform-db/, "the shaping module stays pure");
    assert.match(rulesSource, /^import type \{ GuestSeatSettleOutcome \}/m, "only types from the claim rules");

    // Aggregates only: no row is loaded into memory.
    assert.doesNotMatch(serviceSource, /\.findMany\(|\.findFirst\(|\.findUnique\(/);
    assert.match(serviceSource, /groupBy\(\{\s+by: \["status", "outcome"\],/);
    assert.match(serviceSource, /_count: \{ _all: true \},\s+_sum: \{ coinEarned: true \},/);
    assert.match(serviceSource, /matchEndedAt: \{ gte: window\.start, lte: window\.end \}/);
    assert.match(serviceSource, /status: "settled", settlement: \{ endReason: "host_ended" \}/);
    assert.match(serviceSource, /SELECT COUNT\(DISTINCT claim_user_id\) AS accounts/);
    assert.match(serviceSource, /WHERE match_ended_at >= \$\{window\.start\}\s+AND match_ended_at <= \$\{window\.end\}/);
    assert.match(serviceSource, /prisma\.\$transaction\(async \(tx\) =>/, "one snapshot for all numbers");
    assert.match(serviceSource, /isolationLevel: Prisma\.TransactionIsolationLevel\.RepeatableRead,/);
    assert.doesNotMatch(serviceSource, /\$queryRawUnsafe|\$executeRaw/);

    // Retention stays in sync with the settlement purge.
    const settlementService = readFileSync("apps/web/src/lib/match-settlement/service.ts", "utf8");
    assert.match(settlementService, /\(options\.olderThanDays \?\? 30\) \* 86_400_000/);
    assert.equal(GUEST_SEAT_RETENTION_DAYS, 30);

    const routeSource = readFileSync("apps/web/src/app/api/admin/lab/guest-claims/route.ts", "utf8");
    assert.match(routeSource, /export async function GET\(/);
    assert.match(routeSource, /const adminSession = await requireAdminSession\(\);/);
    assert.match(routeSource, /if \(adminSession instanceof NextResponse\) return adminSession;/);
    assert.match(routeSource, /bucket: "admin-lab-guest-claims-read",/);
    assert.match(routeSource, /key: `admin:\$\{adminSession\.id\}`/);
    assert.match(routeSource, /if \(value === null \|\| value === "7"\) return 7;/);
    assert.match(routeSource, /if \(value === "30"\) return 30;/);
    assert.match(routeSource, /if \(days === null\) \{[\s\S]*?status: 400/);
    assert.match(routeSource, /status: 429/);
    assert.equal(routeSource.match(/"Cache-Control": "no-store"/g)?.length, 3, "no response is cached");
    assert.ok(
        routeSource.indexOf("requireAdminSession()") < routeSource.indexOf("consumeRequestRateLimit({")
            && routeSource.indexOf("consumeRequestRateLimit({") < routeSource.indexOf("getGuestClaimAnalytics({"),
        "auth, then rate limit, then the database"
    );
    // Same contract as the pause endpoint, apart from names.
    const pauseRoute = readFileSync("apps/web/src/app/api/admin/lab/connection-pauses/route.ts", "utf8");
    const normalize = (source: string) =>
        source
            .replace(/getConnectionPauseAnalytics|getGuestClaimAnalytics/g, "getAnalytics")
            .replace(/@\/lib\/analytics\/(connection-pause|guest-claim)-analytics/g, "@/lib/analytics/x")
            .replace(/admin-lab-(connection-pauses|guest-claims)-read/g, "bucket")
            .replace(/\r\n/g, "\n");
    assert.equal(normalize(routeSource), normalize(pauseRoute), "the guest claim route mirrors the pause route");

    const cardSource = readFileSync("apps/web/src/components/admin/lab/guest-claim-card.tsx", "utf8");
    assert.match(cardSource, /^"use client";/);
    assert.match(cardSource, /Misafir maç aktarımı/);
    assert.match(cardSource, /\/api\/admin\/lab\/guest-claims\?days=\$\{range\}/);
    assert.match(cardSource, /<LabRangeActions/);
    assert.match(cardSource, /Veritabanından okunamadı/);
    assert.match(cardSource, /Koltuk verisi \{GUEST_SEAT_RETENTION_DAYS\} gün tutulur/);
    assert.match(cardSource, /data-testid="guest-claim-lab"/);
    assert.doesNotMatch(cardSource, /\b(claimUserId|guestPlayerId|username|email)\b/i, "the card never shows identities");

    const partsSource = readFileSync("apps/web/src/components/admin/lab/lab-card-parts.tsx", "utf8");
    assert.match(partsSource, /aria-pressed=\{active\}/);
    assert.match(partsSource, /aria-label=\{label\}/);
    assert.match(partsSource, /@max-xl\/card-header:col-start-1/, "the toggle wraps under the title on narrow cards");

    const pageSource = readFileSync("apps/web/src/app/admin/(dashboard)/lab/page.tsx", "utf8");
    assert.ok(
        pageSource.indexOf("<ConnectionPauseCard />") < pageSource.indexOf("<GuestClaimCard />"),
        "the guest claim section follows the pause section"
    );
    console.log("[analytics] route, service, card and page contracts");
}

async function run() {
    testZeroData();
    testMixedStatuses();
    testPercentRounding();
    testUnknownValues();
    testOddInput();
    testWindow();
    await testServiceWithLoader();
    testOutcomeDrift();
    testStaticContracts();
    console.log("Guest claim analytics checks passed.");
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
