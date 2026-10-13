import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/web/src/lib/prisma";
import { closeRedisClient } from "@hushle/platform-cache";
import { getSystemSettings } from "../apps/web/src/lib/system-settings/service";
import type { SystemSettings } from "../apps/web/src/types/system-settings";
import { createGuestIdentityToken } from "../apps/web/src/lib/security/player-identity";
import { parseSettlementSnapshot } from "../apps/web/src/lib/match-settlement/snapshot";
import type {
    MatchEndReason,
    MatchSettlementParticipant,
    MatchSettlementSnapshot,
} from "../apps/web/src/lib/match-settlement/types";
import {
    purgeSettledMatchSettlements,
    recordMatchSettlement,
    settleMatchSettlement,
} from "../apps/web/src/lib/match-settlement/service";
import {
    claimGuestMatches,
    processGuestClaimsForUser,
    settleGuestSeatClaim,
    sweepDueGuestSeatClaims,
} from "../apps/web/src/lib/match-settlement/guest-claim";
import {
    GUEST_CLAIM_MAX_ATTEMPTS,
    GUEST_CLAIM_PENDING_TTL_MS,
    GUEST_CLAIM_RECHECK_MS,
    summarizeGuestClaim,
    type GuestClaimSummary,
} from "../apps/web/src/lib/match-settlement/guest-claim-rules";

const ROOM_PREFIX = "GC";
const createdUserIds: number[] = [];
const createdGuestIds: string[] = [];
const HOUR = 60 * 60 * 1000;

function roomCode(): string {
    return `${ROOM_PREFIX}${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

async function createUser(
    label: string,
    options: { unverified?: boolean; wallet?: boolean } = {}
): Promise<{ id: number; username: string }> {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const username = `claim_${label}_${suffix}`.slice(0, 40);
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
            ...(options.wallet === false ? {} : { wallet: { create: { coinBalance: 0 } } }),
        },
        select: { id: true, username: true },
    });
    createdUserIds.push(user.id);
    return user;
}

interface Guest {
    playerId: string;
    token: string;
}

function newGuest(issuedAt = Date.now()): Guest {
    const guestId = randomUUID();
    const playerId = `guest:${guestId}`;
    createdGuestIds.push(playerId);
    return { playerId, token: createGuestIdentityToken(guestId, issuedAt) };
}

function guestSeat(guest: Guest, team: "A" | "B" | null, role: MatchSettlementParticipant["roleAtStart"] = "Tahminci"): MatchSettlementParticipant {
    return {
        playerId: guest.playerId,
        userId: null,
        identityType: "guest",
        usernameSnapshot: null,
        displayName: `Misafir ${guest.playerId.slice(-4)}`,
        team,
        roleAtStart: role,
    };
}

function registeredSeat(userId: number, team: "A" | "B", role: MatchSettlementParticipant["roleAtStart"] = "Anlatıcı"): MatchSettlementParticipant {
    return {
        playerId: `user:${userId}`,
        userId,
        identityType: "registered",
        usernameSnapshot: `user${userId}`,
        displayName: `User ${userId}`,
        team,
        roleAtStart: role,
    };
}

let startOffsetMs = 0;
function buildSnapshot(input: {
    participants: MatchSettlementParticipant[];
    score?: { A: number; B: number };
    endReason?: MatchEndReason;
    endedAt?: Date;
}): MatchSettlementSnapshot {
    startOffsetMs += 1_000;
    const endedAt = input.endedAt ?? new Date(Date.now() - 5_000);
    const startedAt = new Date(endedAt.getTime() - 600_000 - startOffsetMs);
    return parseSettlementSnapshot({
        version: 1,
        endReason: input.endReason ?? "completed",
        roomCode: roomCode(),
        gameMode: "tabu",
        matchStartedAt: startedAt.toISOString(),
        matchEndedAt: endedAt.toISOString(),
        durationSeconds: 600,
        matchFormat: "skor",
        matchTarget: 10,
        score: input.score ?? { A: 10, B: 6 },
        participants: input.participants,
    });
}

function baseSettings(source: SystemSettings): SystemSettings {
    const settings = structuredClone(source);
    settings.economy = {
        ...settings.economy,
        winRewardCoin: 120,
        lossRewardCoin: 40,
        drawRewardCoin: 60,
        matchCoinMultiplier: 1,
        weekendCoinMultiplierEnabled: false,
        weekendCoinMultiplier: 1,
        matchRewardGuardEnabled: false,
        repeatedGroupEnabled: false,
    };
    return settings;
}

async function balance(userId: number): Promise<number> {
    const wallet = await prisma.wallet.findUnique({ where: { userId }, select: { coinBalance: true } });
    return Number(wallet?.coinBalance ?? 0);
}

async function resultFor(snapshot: MatchSettlementSnapshot, userId: number) {
    return prisma.matchResult.findUnique({
        where: {
            roomCode_userId_matchStartedAt: {
                roomCode: snapshot.roomCode,
                userId,
                matchStartedAt: new Date(snapshot.matchStartedAt),
            },
        },
    });
}

async function seatOf(settlementId: number, guest: Guest) {
    return prisma.matchSettlementGuestSeat.findUniqueOrThrow({
        where: { settlementId_guestPlayerId: { settlementId, guestPlayerId: guest.playerId } },
    });
}

async function cleanup(): Promise<void> {
    await prisma.matchSettlement.deleteMany({ where: { roomCode: { startsWith: ROOM_PREFIX } } });
    if (createdGuestIds.length > 0) {
        await prisma.guestProgress.deleteMany({ where: { playerId: { in: createdGuestIds } } });
    }
    if (createdUserIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
        await prisma.matchResult.deleteMany({ where: { userId: { in: createdUserIds } } });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
}

async function run(): Promise<void> {
    assert.equal(
        process.env.GUEST_MATCH_CLAIM_INTEGRATION_TEST,
        "true",
        "GUEST_MATCH_CLAIM_INTEGRATION_TEST=true is required"
    );
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/, "requires a tabu_test database");

    await cleanup();
    const settings = baseSettings(await getSystemSettings());
    const claim = async (userId: number, guest: Guest | string, options: Parameters<typeof claimGuestMatches>[1] = {}) =>
        summarizeGuestClaim(
            await claimGuestMatches(
                { userId, guestToken: typeof guest === "string" ? guest : guest.token },
                { settings, ...options }
            )
        );
    const okSummary = (overrides: Partial<GuestClaimSummary>): GuestClaimSummary => ({
        status: "ok",
        matches: 0,
        settledNow: 0,
        coinEarnedNow: 0,
        awaitingVerification: 0,
        alreadyMoved: 0,
        ...overrides,
    });

    try {
        // 1. Recording a match writes one unclaimed seat per playing, server-issued guest.
        const host = await createUser("host");
        const winnerGuest = newGuest();
        const loserGuest = newGuest();
        const spectatorGuest = newGuest();
        const main = buildSnapshot({
            participants: [
                registeredSeat(host.id, "A"),
                guestSeat(winnerGuest, "A"),
                guestSeat(loserGuest, "B", "Oyuncu"),
                guestSeat(spectatorGuest, null, "İzleyici"),
                { ...guestSeat(newGuest(), "B"), playerId: "guest-legacy" },
            ],
        });
        const mainRecord = await recordMatchSettlement(main);
        assert.equal(mainRecord.created, true);
        {
            const seats = await prisma.matchSettlementGuestSeat.findMany({ where: { settlementId: mainRecord.id }, orderBy: { id: "asc" } });
            assert.deepEqual(seats.map((seat) => seat.guestPlayerId).sort(), [winnerGuest.playerId, loserGuest.playerId].sort());
            for (const seat of seats) {
                assert.equal(seat.status, "unclaimed");
                assert.equal(seat.claimUserId, null);
                assert.equal(seat.matchEndedAt.toISOString(), main.matchEndedAt);
            }
            const again = await recordMatchSettlement(main);
            assert.equal(again.created, false);
            assert.equal(await prisma.matchSettlementGuestSeat.count({ where: { settlementId: mainRecord.id } }), 2);
            const concurrent = buildSnapshot({ participants: [registeredSeat(host.id, "A"), guestSeat(newGuest(), "B")] });
            const records = await Promise.all([1, 2, 3, 4].map(() => recordMatchSettlement(concurrent)));
            assert.equal(records.filter((entry) => entry.created).length, 1);
            assert.equal(new Set(records.map((entry) => entry.id)).size, 1);
            assert.equal(await prisma.matchSettlementGuestSeat.count({ where: { settlementId: records[0].id } }), 1);
            console.log("[claim] 1 seats recorded once, spectators and foreign ids skipped");
        }

        // 2. Happy path: the winning guest signs up and the match moves with its coins.
        const winner = await createUser("winner");
        {
            const summary = await claim(winner.id, winnerGuest);
            assert.deepEqual(summary, okSummary({ matches: 1, settledNow: 1, coinEarnedNow: 120 }));
            const row = await resultFor(main, winner.id);
            assert.ok(row);
            assert.equal(row.won, true);
            assert.equal(row.team, "A");
            assert.equal(row.coinEarned, 120);
            assert.equal(row.playerId, `user:${winner.id}`);
            assert.equal(row.endReason, "completed");
            assert.equal(row.lineupPlayerCount, 5);
            assert.equal(row.lineupAuthenticatedCount, 2);
            assert.equal(row.lineupGuestCount, 3);
            assert.equal(await balance(winner.id), 120);
            const seat = await seatOf(mainRecord.id, winnerGuest);
            assert.equal(seat.status, "settled");
            assert.equal(seat.outcome, "settled");
            assert.equal(seat.claimUserId, winner.id);
            assert.equal(seat.coinEarned, 120);
            assert.equal(seat.matchResultId, row.id);
            const ledger = await prisma.walletLedgerEntry.findUniqueOrThrow({ where: { idempotencyKey: `match_result:${row.id}:reward` } });
            assert.equal((ledger.metadata as Record<string, unknown>).guestClaimSeatId, seat.id);
            const link = await prisma.guestProgress.findUniqueOrThrow({ where: { playerId: winnerGuest.playerId } });
            assert.equal(link.linkedUserId, winner.id);
            const audit = await prisma.auditLog.findFirst({
                where: { actorUserId: winner.id, action: "game.match.finalize", resourceId: String(row.id) },
            });
            assert.ok(audit, "claimed matches always keep a full audit row");
            assert.equal((audit.metadata as Record<string, unknown>).guestClaimSeatId, seat.id);

            // The registered host settles independently and is not affected by the claim.
            const hostRun = await settleMatchSettlement(mainRecord.id, { settings });
            assert.equal(hostRun.status, "settled");
            assert.deepEqual(hostRun.participants.map((entry) => [entry.userId, entry.coinEarned]), [[host.id, 120]]);
            assert.equal((await seatOf(mainRecord.id, loserGuest)).status, "unclaimed", "other guests keep their seat");
            console.log("[claim] 2 winning guest moved with 120 coins, ledger and audit tagged");
        }

        // 3. Claiming again is a no-op that reports the earlier move.
        {
            const summary = await claim(winner.id, winnerGuest);
            assert.deepEqual(summary, okSummary({ matches: 1, alreadyMoved: 1 }));
            assert.equal(await balance(winner.id), 120);
            assert.equal(await prisma.matchResult.count({ where: { userId: winner.id } }), 1);
            console.log("[claim] 3 repeated claim pays nothing");
        }

        // 4. Losing seat, draw and early-ended matches follow the regular rules.
        {
            const loser = await createUser("loser");
            assert.deepEqual(await claim(loser.id, loserGuest), okSummary({ matches: 1, settledNow: 1, coinEarnedNow: 40 }));
            const loserRow = await resultFor(main, loser.id);
            assert.equal(loserRow?.won, false);
            assert.equal(loserRow?.team, "B");

            const drawGuest = newGuest();
            const draw = buildSnapshot({ participants: [registeredSeat(host.id, "A"), guestSeat(drawGuest, "B")], score: { A: 7, B: 7 } });
            await recordMatchSettlement(draw);
            const drawUser = await createUser("draw");
            assert.deepEqual(await claim(drawUser.id, drawGuest), okSummary({ matches: 1, settledNow: 1, coinEarnedNow: 60 }));

            const earlyGuest = newGuest();
            const early = buildSnapshot({
                participants: [registeredSeat(host.id, "A"), guestSeat(earlyGuest, "B")],
                score: { A: 2, B: 5 },
                endReason: "host_ended",
            });
            const earlyRecord = await recordMatchSettlement(early);
            const earlyUser = await createUser("early");
            assert.deepEqual(await claim(earlyUser.id, earlyGuest), okSummary({ matches: 1, settledNow: 1, coinEarnedNow: 0 }));
            const earlyRow = await resultFor(early, earlyUser.id);
            assert.ok(earlyRow, "early-ended matches still reach the history");
            assert.equal(earlyRow.endReason, "host_ended");
            assert.equal(earlyRow.won, false);
            assert.equal(earlyRow.coinEarned, 0);
            assert.equal(await balance(earlyUser.id), 0);
            assert.equal(await prisma.walletLedgerEntry.count({ where: { idempotencyKey: `match_result:${earlyRow.id}:reward` } }), 0);
            assert.equal((await seatOf(earlyRecord.id, earlyGuest)).coinEarned, 0);
            console.log("[claim] 4 loss 40, draw 60, early end history only");
        }

        // 5. The same account claiming from five tabs at once is paid exactly once.
        {
            const guest = newGuest();
            const snapshot = buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")] });
            await recordMatchSettlement(snapshot);
            const user = await createUser("tabs");
            const summaries = await Promise.all([1, 2, 3, 4, 5].map(() => claim(user.id, guest)));
            assert.ok(summaries.every((summary) => summary.status === "ok"));
            assert.equal(summaries.reduce((total, summary) => total + summary.settledNow, 0), 1);
            assert.equal(summaries.reduce((total, summary) => total + summary.coinEarnedNow, 0), 120);
            assert.equal(await prisma.matchResult.count({ where: { userId: user.id } }), 1);
            assert.equal(await balance(user.id), 120);
            console.log("[claim] 5 five concurrent claims settle once");
        }

        // 6. Two accounts racing for one guest: exactly one wins, the other is refused.
        {
            const guest = newGuest();
            const snapshot = buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")] });
            await recordMatchSettlement(snapshot);
            const first = await createUser("raceA");
            const second = await createUser("raceB");
            const [a, b] = await Promise.all([claim(first.id, guest), claim(second.id, guest)]);
            const statuses = [a.status, b.status].sort();
            assert.deepEqual(statuses, ["linked_elsewhere", "ok"]);
            const owner = a.status === "ok" ? first : second;
            const other = owner === first ? second : first;
            assert.equal(await balance(owner.id), 120);
            assert.equal(await balance(other.id), 0);
            assert.equal(await resultFor(snapshot, other.id), null);
            assert.equal((await prisma.guestProgress.findUniqueOrThrow({ where: { playerId: guest.playerId } })).linkedUserId, owner.id);
            console.log("[claim] 6 racing accounts: one owner, no split payout");
        }

        // 7. A linked guest stays with its account for later matches too.
        {
            const guest = newGuest();
            const owner = await createUser("owner");
            const intruder = await createUser("intruder");
            await recordMatchSettlement(buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")] }));
            assert.equal((await claim(owner.id, guest)).settledNow, 1);
            const later = buildSnapshot({ participants: [registeredSeat(host.id, "A"), guestSeat(guest, "B")] });
            const laterRecord = await recordMatchSettlement(later);
            assert.deepEqual(await claim(intruder.id, guest), okSummary({ status: "linked_elsewhere" }));
            assert.equal((await seatOf(laterRecord.id, guest)).status, "unclaimed", "a refused claim touches nothing");
            assert.deepEqual(await claim(owner.id, guest), okSummary({ matches: 2, settledNow: 1, coinEarnedNow: 40, alreadyMoved: 1 }));
            assert.equal(await balance(owner.id), 160);
            console.log("[claim] 7 linked guest refuses other accounts, owner collects later matches");
        }

        // 8. A player who was already in the match (second tab as guest) gains nothing.
        {
            const player = await createUser("twotabs");
            const guest = newGuest();
            const snapshot = buildSnapshot({ participants: [registeredSeat(player.id, "A"), guestSeat(guest, "B")] });
            const record = await recordMatchSettlement(snapshot);
            await settleMatchSettlement(record.id, { settings });
            assert.equal(await balance(player.id), 120);
            assert.deepEqual(await claim(player.id, guest), okSummary({}));
            const seat = await seatOf(record.id, guest);
            assert.equal(seat.status, "rejected");
            assert.equal(seat.outcome, "already_participant");
            assert.equal(await balance(player.id), 120);
            const row = await resultFor(snapshot, player.id);
            assert.equal(row?.team, "A", "the registered seat keeps its own result");
            console.log("[claim] 8 participant cannot add a second seat");
        }

        // 9. Two guest tabs of one person in the same match pay once.
        {
            const firstTab = newGuest();
            const secondTab = newGuest();
            const snapshot = buildSnapshot({
                participants: [registeredSeat(host.id, "B"), guestSeat(firstTab, "A"), guestSeat(secondTab, "A", "Oyuncu")],
            });
            const record = await recordMatchSettlement(snapshot);
            const user = await createUser("doubleguest");
            assert.equal((await claim(user.id, firstTab)).settledNow, 1);
            assert.deepEqual(await claim(user.id, secondTab), okSummary({}));
            const seat = await seatOf(record.id, secondTab);
            assert.equal(seat.status, "rejected");
            assert.equal(seat.outcome, "already_recorded");
            assert.equal(await balance(user.id), 120);
            assert.equal(await prisma.matchResult.count({ where: { userId: user.id } }), 1);
            console.log("[claim] 9 two guest tabs of one person pay once");
        }

        // 10. Spectators and guests without matches have nothing to claim.
        {
            const user = await createUser("spectator");
            assert.deepEqual(await claim(user.id, spectatorGuest), okSummary({}));
            assert.equal(await prisma.matchResult.count({ where: { userId: user.id } }), 0);
            const idle = await createUser("idle");
            assert.deepEqual(await claim(idle.id, newGuest()), okSummary({}));
            console.log("[claim] 10 spectator and idle guests claim nothing");
        }

        // 11. Window and token lifetime: old matches stay put; stale or forged tokens are refused.
        {
            const guest = newGuest();
            const old = buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")], endedAt: new Date(Date.now() - 26 * HOUR) });
            const oldRecord = await recordMatchSettlement(old);
            const edge = buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")], endedAt: new Date(Date.now() - 24.5 * HOUR) });
            const edgeRecord = await recordMatchSettlement(edge);
            const user = await createUser("window");
            assert.deepEqual(await claim(user.id, guest), okSummary({ matches: 1, settledNow: 1, coinEarnedNow: 120 }));
            assert.equal((await seatOf(oldRecord.id, guest)).status, "unclaimed");
            assert.equal((await seatOf(edgeRecord.id, guest)).status, "settled");

            const graceGuestId = randomUUID();
            createdGuestIds.push(`guest:${graceGuestId}`);
            const inGrace = createGuestIdentityToken(graceGuestId, Date.now() - 24.5 * HOUR);
            assert.equal((await claim(user.id, inGrace)).status, "ok", "expired within the one-hour grace");
            const staleGuestId = randomUUID();
            createdGuestIds.push(`guest:${staleGuestId}`);
            const stale = createGuestIdentityToken(staleGuestId, Date.now() - 25.5 * HOUR);
            assert.deepEqual(await claim(user.id, stale), okSummary({ status: "invalid_token" }));
            const [payload, signature] = guest.token.split(".");
            const forged = `${Buffer.from(JSON.stringify({ guestId: randomUUID(), exp: Date.now() + HOUR })).toString("base64url")}.${signature}`;
            assert.equal((await claim(user.id, forged)).status, "invalid_token");
            const tampered = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
            assert.equal((await claim(user.id, `${payload}.${tampered}`)).status, "invalid_token");
            assert.equal((await claim(user.id, "not-a-token")).status, "invalid_token");
            assert.equal(await prisma.guestProgress.count({ where: { playerId: `guest:${staleGuestId}` } }), 0, "refused tokens bind nothing");
            console.log("[claim] 11 24h window, one-hour grace, forged tokens refused");
        }

        // 12. Unverified accounts keep the claim and settle right after verification.
        {
            const guest = newGuest();
            const snapshot = buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")] });
            const record = await recordMatchSettlement(snapshot);
            const user = await createUser("unverified", { unverified: true });
            const before = Date.now();
            assert.deepEqual(await claim(user.id, guest), okSummary({ matches: 1, awaitingVerification: 1 }));
            const waiting = await seatOf(record.id, guest);
            assert.equal(waiting.status, "pending");
            assert.equal(waiting.claimUserId, user.id);
            assert.ok(waiting.availableAt && waiting.availableAt.getTime() >= before + GUEST_CLAIM_RECHECK_MS - 5_000);
            assert.equal(await resultFor(snapshot, user.id), null, "no history or coins before verification");
            assert.equal(await balance(user.id), 0);
            // The worker does not touch it before the re-check time.
            await sweepDueGuestSeatClaims({ settings });
            assert.equal((await seatOf(record.id, guest)).status, "pending");

            await prisma.user.update({
                where: { id: user.id },
                data: { emailVerifiedAt: new Date(), accountStatus: "active" },
            });
            const processed = await processGuestClaimsForUser(user.id, { settings });
            assert.deepEqual(processed.map((entry) => [entry.outcome, entry.coinEarned]), [["settled", 120]]);
            assert.equal(await balance(user.id), 120);
            assert.equal((await processGuestClaimsForUser(user.id, { settings })).length, 0, "nothing left to settle");
            console.log("[claim] 12 unverified claim waits, verification settles it");
        }

        // 13. Verified elsewhere (Google link, email change): the worker settles at the re-check.
        {
            const guest = newGuest();
            const record = await recordMatchSettlement(buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")] }));
            const user = await createUser("oauth", { unverified: true });
            await claim(user.id, guest);
            await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), accountStatus: "active" } });
            const sweep = await sweepDueGuestSeatClaims({ settings, now: new Date(Date.now() + GUEST_CLAIM_RECHECK_MS + 60_000) });
            assert.ok(sweep.settled >= 1);
            assert.equal((await seatOf(record.id, guest)).status, "settled");
            assert.equal(await balance(user.id), 120);
            console.log("[claim] 13 worker settles once the account can earn");
        }

        // 14. Accounts that never verify: the claim expires after a week.
        {
            const guest = newGuest();
            const record = await recordMatchSettlement(buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")] }));
            const user = await createUser("neververify", { unverified: true });
            await claim(user.id, guest);
            const claimedAt = (await seatOf(record.id, guest)).claimedAt!;
            await prisma.matchSettlementGuestSeat.update({
                where: { id: (await seatOf(record.id, guest)).id },
                data: { availableAt: new Date(claimedAt.getTime() + GUEST_CLAIM_PENDING_TTL_MS) },
            });
            await sweepDueGuestSeatClaims({ settings, now: new Date(claimedAt.getTime() + GUEST_CLAIM_PENDING_TTL_MS + 60_000) });
            const seat = await seatOf(record.id, guest);
            assert.equal(seat.status, "expired");
            assert.equal(await resultFor(await snapshotOf(record.id), user.id), null);
            console.log("[claim] 14 unverified claim expires after a week");
        }

        // 15. Suspended or deleted claimants never get paid.
        {
            const guest = newGuest();
            const record = await recordMatchSettlement(buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")] }));
            const user = await createUser("suspended", { unverified: true });
            await claim(user.id, guest);
            await prisma.user.update({
                where: { id: user.id },
                data: { emailVerifiedAt: new Date(), accountStatus: "active", isSuspended: true, suspendedUntil: null },
            });
            const [result] = await processGuestClaimsForUser(user.id, { settings });
            assert.equal(result.outcome, "suspended");
            assert.equal((await seatOf(record.id, guest)).status, "rejected");
            assert.equal(await balance(user.id), 0);

            const goneGuest = newGuest();
            const goneRecord = await recordMatchSettlement(buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(goneGuest, "A")] }));
            const gone = await createUser("deleted", { unverified: true });
            await claim(gone.id, goneGuest);
            await prisma.user.delete({ where: { id: gone.id } });
            const orphan = await seatOf(goneRecord.id, goneGuest);
            assert.equal(orphan.claimUserId, null);
            assert.equal(orphan.status, "pending");
            await sweepDueGuestSeatClaims({ settings, now: new Date(Date.now() + GUEST_CLAIM_RECHECK_MS + 60_000) });
            const closed = await seatOf(goneRecord.id, goneGuest);
            assert.equal(closed.status, "rejected");
            assert.equal(closed.outcome, "user_missing");
            const link = await prisma.guestProgress.findUniqueOrThrow({ where: { playerId: goneGuest.playerId } });
            assert.equal(link.linkedUserId, null, "a deleted account releases the guest identity");
            const heir = await createUser("heir");
            assert.equal((await claim(heir.id, goneGuest)).status, "ok");
            console.log("[claim] 15 suspended and deleted claimants are closed without coins");
        }

        // 16. A corrupt stored match is closed with the reason, never retried forever.
        {
            const guest = newGuest();
            const record = await recordMatchSettlement(buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")] }));
            await prisma.matchSettlement.update({ where: { id: record.id }, data: { snapshot: { version: 99 } } });
            const user = await createUser("corrupt");
            assert.deepEqual(await claim(user.id, guest), okSummary({}));
            const seat = await seatOf(record.id, guest);
            assert.equal(seat.status, "rejected");
            assert.equal(seat.outcome, "invalid_snapshot");
            assert.match(seat.lastError ?? "", /snapshot/i);
            console.log("[claim] 16 corrupt snapshot closes the seat");
        }

        // 17. A failure inside the reward transaction rolls back and is retried by the worker.
        {
            const guest = newGuest();
            const snapshot = buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")] });
            const record = await recordMatchSettlement(snapshot);
            const user = await createUser("flaky");
            let failures = 1;
            const hooks = {
                transactionStarted() {
                    if (failures > 0) {
                        failures -= 1;
                        throw new Error("simulated deadlock");
                    }
                },
            };
            assert.deepEqual(await claim(user.id, guest, { hooks }), okSummary({ matches: 1 }));
            const waiting = await seatOf(record.id, guest);
            assert.equal(waiting.status, "pending");
            assert.equal(waiting.attemptCount, 1);
            assert.match(waiting.lastError ?? "", /simulated deadlock/);
            assert.equal(await resultFor(snapshot, user.id), null);
            assert.equal(await balance(user.id), 0, "the failed attempt left no coins behind");
            await sweepDueGuestSeatClaims({ settings, now: new Date(waiting.availableAt!.getTime() + 1_000) });
            assert.equal((await seatOf(record.id, guest)).status, "settled");
            assert.equal(await balance(user.id), 120);

            const doomedGuest = newGuest();
            const doomedRecord = await recordMatchSettlement(buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(doomedGuest, "A")] }));
            const doomedUser = await createUser("doomed", { unverified: true });
            await claim(doomedUser.id, doomedGuest);
            const doomedSeat = await seatOf(doomedRecord.id, doomedGuest);
            await prisma.matchSettlementGuestSeat.update({ where: { id: doomedSeat.id }, data: { attemptCount: GUEST_CLAIM_MAX_ATTEMPTS - 1 } });
            await prisma.user.update({ where: { id: doomedUser.id }, data: { emailVerifiedAt: new Date(), accountStatus: "active" } });
            const [doomed] = await processGuestClaimsForUser(doomedUser.id, {
                settings,
                hooks: { transactionStarted() { throw new Error("permanent failure"); } },
            });
            assert.equal(doomed.outcome, "failed");
            const failed = await seatOf(doomedRecord.id, doomedGuest);
            assert.equal(failed.status, "rejected");
            assert.equal(failed.outcome, "failed");
            assert.equal(failed.attemptCount, GUEST_CLAIM_MAX_ATTEMPTS);
            console.log("[claim] 17 transient failure retried, permanent failure closed");
        }

        // 18. Claim and worker on the same seat at the same moment: one payout.
        {
            const guest = newGuest();
            const snapshot = buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")] });
            const record = await recordMatchSettlement(snapshot);
            const user = await createUser("parallel", { unverified: true });
            await claim(user.id, guest);
            await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), accountStatus: "active" } });
            const seatId = (await seatOf(record.id, guest)).id;
            let started = 0;
            let release: () => void = () => undefined;
            const barrier = new Promise<void>((resolve) => { release = resolve; });
            const hooks = {
                async transactionStarted() {
                    started += 1;
                    if (started === 2) release();
                    await Promise.race([barrier, new Promise((resolve) => setTimeout(resolve, 2_000))]);
                },
            };
            const runs = await Promise.all([
                settleGuestSeatClaim(seatId, { settings, hooks }),
                processGuestClaimsForUser(user.id, { settings, hooks }).then((entries) => entries[0]),
            ]);
            assert.deepEqual(runs.map((entry) => entry.outcome).sort(), ["not_pending", "settled"]);
            assert.equal(await balance(user.id), 120);
            assert.equal(await prisma.matchResult.count({ where: { userId: user.id } }), 1);
            console.log("[claim] 18 claim and worker racing on one seat pay once");
        }

        // 19. The rolling coin ceiling applies to claimed matches as well.
        {
            const guest = newGuest();
            const snapshot = buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")] });
            await recordMatchSettlement(snapshot);
            const user = await createUser("capped");
            await prisma.matchResult.create({
                data: {
                    roomCode: roomCode(),
                    matchStartedAt: new Date(Date.now() - HOUR),
                    userId: user.id,
                    playerId: `user:${user.id}`,
                    won: true,
                    scoreA: 1,
                    scoreB: 0,
                    coinEarned: 500,
                },
            });
            const capped = structuredClone(settings);
            capped.economy.matchRewardGuardEnabled = true;
            capped.economy.matchRewardWindowHours = 24;
            capped.economy.matchRewardSoftCapCoin = 100;
            capped.economy.matchRewardHardCapCoin = 200;
            const summary = summarizeGuestClaim(await claimGuestMatches({ userId: user.id, guestToken: guest.token }, { settings: capped }));
            assert.deepEqual(summary, okSummary({ matches: 1, settledNow: 1, coinEarnedNow: 0 }));
            const row = await resultFor(snapshot, user.id);
            assert.equal(row?.coinEarned, 0, "history kept, ceiling blocks the coins");
            console.log("[claim] 19 coin ceiling applies to claims");
        }

        // 20. Purging a settled match removes its guest seats with it.
        {
            const guest = newGuest();
            const record = await recordMatchSettlement(buildSnapshot({ participants: [registeredSeat(host.id, "B"), guestSeat(guest, "A")] }));
            await settleMatchSettlement(record.id, { settings });
            await prisma.matchSettlement.update({ where: { id: record.id }, data: { settledAt: new Date(Date.now() - 40 * 24 * HOUR) } });
            const purged = await purgeSettledMatchSettlements({ olderThanDays: 30 });
            assert.ok(purged >= 1);
            assert.equal(await prisma.matchSettlementGuestSeat.count({ where: { settlementId: record.id } }), 0);
            console.log("[claim] 20 seats follow their settlement's retention");
        }

        console.log("guest match claim integration checks passed");
    } finally {
        await cleanup();
        await prisma.$disconnect();
        await closeRedisClient();
    }
}

async function snapshotOf(settlementId: number): Promise<MatchSettlementSnapshot> {
    const row = await prisma.matchSettlement.findUniqueOrThrow({ where: { id: settlementId }, select: { snapshot: true } });
    return parseSettlementSnapshot(row.snapshot);
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
