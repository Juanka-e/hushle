import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/web/src/lib/prisma";
import { closeRedisClient } from "@hushle/platform-cache";
import { getSystemSettings } from "../apps/web/src/lib/system-settings/service";
import type { SystemSettings } from "../apps/web/src/types/system-settings";
import { evaluateMatchRewardEligibility } from "../apps/web/src/lib/economy/reward-eligibility";
import {
    getRegisteredParticipants,
    parseSettlementSnapshot,
    toRewardRoomSnapshot,
} from "../apps/web/src/lib/match-settlement/snapshot";
import type {
    MatchEndReason,
    MatchSettlementParticipant,
    MatchSettlementSnapshot,
} from "../apps/web/src/lib/match-settlement/types";
import {
    findParticipantSettlement,
    getMatchSettlementHealth,
    purgeSettledMatchSettlements,
    recordMatchSettlement,
    settleMatchSettlement,
    sweepDueMatchSettlements,
} from "../apps/web/src/lib/match-settlement/service";
import { MATCH_SETTLEMENT_MAX_ATTEMPTS } from "../apps/web/src/lib/match-settlement/retry-policy";

const ROOM_PREFIX = "ST";
const createdUserIds: number[] = [];

function roomCode(): string {
    return `${ROOM_PREFIX}${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

async function createUser(
    label: string,
    options: {
        wallet?: boolean;
        isSuspended?: boolean;
        suspendedUntil?: Date | null;
        emailRestricted?: boolean;
    } = {}
): Promise<number> {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const user = await prisma.user.create({
        data: {
            username: `settle_${label}_${suffix}`.slice(0, 40),
            password: "integration-test-only",
            isSuspended: options.isSuspended ?? false,
            suspendedUntil: options.suspendedUntil ?? null,
            ...(options.emailRestricted
                ? {
                      accountStatus: "pending_email_verification" as const,
                      emailVerificationRequiredAt: new Date(),
                      emailVerifiedAt: null,
                  }
                : {}),
            ...(options.wallet === false ? {} : { wallet: { create: { coinBalance: 0 } } }),
        },
        select: { id: true },
    });
    createdUserIds.push(user.id);
    return user.id;
}

function registered(userId: number, team: "A" | "B", role = "Oyuncu"): MatchSettlementParticipant {
    return {
        playerId: `player-${userId}`,
        userId,
        identityType: "registered",
        usernameSnapshot: `user${userId}`,
        displayName: `User ${userId}`,
        team,
        roleAtStart: role as MatchSettlementParticipant["roleAtStart"],
    };
}

function guest(id: string, team: "A" | "B"): MatchSettlementParticipant {
    return {
        playerId: `guest-${id}`,
        userId: null,
        identityType: "guest",
        usernameSnapshot: null,
        displayName: `Misafir ${id}`,
        team,
        roleAtStart: "Tahminci",
    };
}

let startOffsetMs = 0;
function buildSnapshot(input: {
    participants: MatchSettlementParticipant[];
    score?: { A: number; B: number };
    endReason?: MatchEndReason;
    code?: string;
    endedAt?: Date;
}): MatchSettlementSnapshot {
    startOffsetMs += 1_000;
    const endedAt = input.endedAt ?? new Date(Date.now() - 5_000);
    const startedAt = new Date(endedAt.getTime() - 600_000 - startOffsetMs);
    return parseSettlementSnapshot({
        version: 1,
        endReason: input.endReason ?? "completed",
        roomCode: input.code ?? roomCode(),
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

async function rowOf(id: number) {
    return prisma.matchSettlement.findUniqueOrThrow({ where: { id } });
}

async function cleanup(): Promise<void> {
    await prisma.matchSettlement.deleteMany({ where: { roomCode: { startsWith: ROOM_PREFIX } } });
    if (createdUserIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
}

async function run(): Promise<void> {
    assert.equal(
        process.env.MATCH_SETTLEMENT_INTEGRATION_TEST,
        "true",
        "MATCH_SETTLEMENT_INTEGRATION_TEST=true is required"
    );
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/, "requires a tabu_test database");

    await cleanup();
    const settings = baseSettings(await getSystemSettings());
    const now = () => new Date();

    try {
        // 1. Happy path: 2 registered + 2 guests, team A wins. Guests stay only in the snapshot.
        {
            const alice = await createUser("alice");
            const bob = await createUser("bob");
            const snapshot = buildSnapshot({
                participants: [registered(alice, "A", "Anlatıcı"), guest("a", "A"), registered(bob, "B"), guest("b", "B")],
            });
            const recorded = await recordMatchSettlement(snapshot);
            assert.equal(recorded.created, true);
            const row = await rowOf(recorded.id);
            assert.equal(row.status, "pending");
            assert.equal(row.registeredParticipantCount, 2);
            assert.equal(row.guestParticipantCount, 2);
            assert.equal(row.endReason, "completed");
            assert.deepEqual(parseSettlementSnapshot(row.snapshot), snapshot);

            const result = await settleMatchSettlement(recorded.id, { settings });
            assert.equal(result.status, "settled");
            assert.deepEqual(
                result.participants.map((entry) => [entry.userId, entry.outcome, entry.coinEarned]),
                [[alice, "rewarded", 120], [bob, "rewarded", 40]]
            );
            const aliceResult = await resultFor(snapshot, alice);
            const bobResult = await resultFor(snapshot, bob);
            assert.ok(aliceResult && bobResult);
            assert.equal(aliceResult.won, true);
            assert.equal(bobResult.won, false);
            assert.equal(aliceResult.coinEarned, 120);
            assert.equal(aliceResult.endReason, "completed");
            assert.equal(aliceResult.matchDurationSeconds, 600);
            assert.equal(aliceResult.lineupPlayerCount, 4);
            assert.equal(aliceResult.lineupGuestCount, 2);
            assert.equal(aliceResult.team, "A");
            assert.equal(await balance(alice), 120);
            assert.equal(await balance(bob), 40);
            const ledger = await prisma.walletLedgerEntry.findMany({
                where: { idempotencyKey: { in: [`match_result:${aliceResult.id}:reward`, `match_result:${bobResult.id}:reward`] } },
            });
            assert.equal(ledger.length, 2);
            const settledRow = await rowOf(recorded.id);
            assert.equal(settledRow.status, "settled");
            assert.ok(settledRow.settledAt);
            assert.equal(settledRow.claimToken, null);
            assert.equal(settledRow.attemptCount, 1);
            assert.equal(await prisma.matchResult.count({ where: { roomCode: snapshot.roomCode } }), 2, "guests get no match_results rows");
            console.log("[settlement] 1 happy path ok");

            // 2. Recording the same match again returns the same row.
            const again = await recordMatchSettlement({ ...snapshot, endReason: "host_ended" });
            assert.deepEqual(again, { id: recorded.id, created: false });
            assert.equal((await rowOf(recorded.id)).endReason, "completed", "first record wins");
            const racer = await createUser("racer");
            const racing = buildSnapshot({ participants: [registered(racer, "A"), guest("race", "B")] });
            const raced = await Promise.all([recordMatchSettlement(racing), recordMatchSettlement(racing), recordMatchSettlement(racing)]);
            assert.equal(new Set(raced.map((entry) => entry.id)).size, 1, "concurrent records share one row");
            assert.equal(raced.filter((entry) => entry.created).length, 1);
            await settleMatchSettlement(raced[0].id, { settings });

            // 3. Settling a settled row is a no-op.
            const rerun = await settleMatchSettlement(recorded.id, { settings });
            assert.equal(rerun.status, "settled");
            assert.deepEqual(rerun.participants, []);
            assert.equal(await balance(alice), 120);
            assert.equal(await prisma.matchResult.count({ where: { roomCode: snapshot.roomCode } }), 2);
            assert.equal((await settleMatchSettlement(2_000_000_000, { settings })).status, "not_found");
            console.log("[settlement] 2-3 idempotent record/settle ok");

            // 21. Participant lookup for the read endpoint.
            const found = await findParticipantSettlement(snapshot.roomCode, alice);
            assert.equal(found?.id, recorded.id);
            assert.equal(await findParticipantSettlement(snapshot.roomCode, 2_000_000_000), null);
        }

        // 4. Concurrent settlement of the same row pays each user once.
        {
            const carol = await createUser("carol");
            const dave = await createUser("dave");
            const snapshot = buildSnapshot({ participants: [registered(carol, "A"), registered(dave, "B")] });
            const { id } = await recordMatchSettlement(snapshot);
            const runs = await Promise.all([
                settleMatchSettlement(id, { settings }),
                settleMatchSettlement(id, { settings }),
                settleMatchSettlement(id, { settings }),
            ]);
            const winners = runs.filter((entry) => entry.participants.length > 0);
            assert.equal(winners.length, 1, "exactly one run may process the row");
            assert.ok(runs.every((entry) => ["settled", "claimed_elsewhere"].includes(entry.status)));
            assert.equal(await balance(carol), 120);
            assert.equal(await balance(dave), 40);
            assert.equal(await prisma.matchResult.count({ where: { roomCode: snapshot.roomCode } }), 2);
            console.log("[settlement] 4 concurrent claim ok");
        }

        // 5. A row already written by the legacy endpoint is not paid twice.
        {
            const erin = await createUser("erin");
            const frank = await createUser("frank");
            const snapshot = buildSnapshot({ participants: [registered(erin, "A"), registered(frank, "B")] });
            await prisma.matchResult.create({
                data: {
                    roomCode: snapshot.roomCode,
                    matchStartedAt: new Date(snapshot.matchStartedAt),
                    userId: erin,
                    playerId: `player-${erin}`,
                    team: "A",
                    won: true,
                    scoreA: 10,
                    scoreB: 6,
                    coinEarned: 120,
                },
            });
            await prisma.wallet.update({ where: { userId: erin }, data: { coinBalance: 120 } });
            const { id } = await recordMatchSettlement(snapshot);
            const result = await settleMatchSettlement(id, { settings });
            assert.equal(result.status, "settled");
            assert.deepEqual(
                result.participants.map((entry) => [entry.userId, entry.outcome]),
                [[erin, "already_settled"], [frank, "rewarded"]]
            );
            assert.equal(await balance(erin), 120);
            assert.equal(await balance(frank), 40);
            console.log("[settlement] 5 legacy row ok");
        }

        // 6. Draw pays the draw reward and nobody wins.
        {
            const gina = await createUser("gina");
            const hank = await createUser("hank");
            const snapshot = buildSnapshot({ participants: [registered(gina, "A"), registered(hank, "B")], score: { A: 7, B: 7 } });
            const { id } = await recordMatchSettlement(snapshot);
            await settleMatchSettlement(id, { settings });
            assert.equal((await resultFor(snapshot, gina))?.won, false);
            assert.equal((await resultFor(snapshot, hank))?.won, false);
            assert.equal(await balance(gina), 60);
            assert.equal(await balance(hank), 60);
            console.log("[settlement] 6 draw ok");
        }

        // 7. Host-ended matches are recorded without coins or wins.
        {
            const ivan = await createUser("ivan");
            const jane = await createUser("jane");
            const snapshot = buildSnapshot({ participants: [registered(ivan, "A"), registered(jane, "B")], endReason: "host_ended" });
            const { id } = await recordMatchSettlement(snapshot);
            assert.equal((await rowOf(id)).endReason, "host_ended");
            const result = await settleMatchSettlement(id, { settings });
            assert.equal(result.status, "settled");
            const ivanResult = await resultFor(snapshot, ivan);
            assert.ok(ivanResult);
            assert.equal(ivanResult.coinEarned, 0);
            assert.equal(ivanResult.won, false, "leading team does not get a win");
            assert.equal(ivanResult.endReason, "host_ended");
            assert.equal(await balance(ivan), 0);
            assert.equal(await prisma.walletLedgerEntry.count({ where: { idempotencyKey: `match_result:${ivanResult.id}:reward` } }), 0);
            console.log("[settlement] 7 host ended ok");
        }

        // 8-10. Account rules: missing, suspended, unverified accounts are skipped; others are paid.
        {
            const ghost = await createUser("ghost");
            const suspended = await createUser("susp", { isSuspended: true, suspendedUntil: new Date(Date.now() + 86_400_000) });
            const permanent = await createUser("perm", { isSuspended: true, suspendedUntil: null });
            const expired = await createUser("expired", { isSuspended: true, suspendedUntil: new Date(Date.now() - 60_000) });
            const unverified = await createUser("unver", { emailRestricted: true });
            const fine = await createUser("fine");
            const snapshot = buildSnapshot({
                participants: [
                    registered(ghost, "A"),
                    registered(suspended, "A"),
                    registered(permanent, "A"),
                    registered(expired, "B"),
                    registered(unverified, "B"),
                    registered(fine, "B"),
                ],
            });
            const { id } = await recordMatchSettlement(snapshot);
            await prisma.user.delete({ where: { id: ghost } });
            const result = await settleMatchSettlement(id, { settings });
            assert.equal(result.status, "settled", "skips are terminal, not retried");
            assert.deepEqual(
                result.participants.map((entry) => [entry.userId, entry.outcome]),
                [
                    [ghost, "skipped_user_missing"],
                    [suspended, "skipped_suspended"],
                    [permanent, "skipped_suspended"],
                    [expired, "rewarded"],
                    [unverified, "skipped_reward_capability"],
                    [fine, "rewarded"],
                ]
            );
            assert.equal(await balance(suspended), 0);
            assert.equal(await balance(unverified), 0);
            assert.equal(await balance(expired), 40);
            assert.equal(await resultFor(snapshot, suspended), null);
            console.log("[settlement] 8-10 account rules ok");
        }

        // 11. One participant fails transiently: others are paid, the row waits, then completes.
        {
            const kim = await createUser("kim");
            const leo = await createUser("leo");
            const snapshot = buildSnapshot({ participants: [registered(kim, "A"), registered(leo, "B")] });
            const { id } = await recordMatchSettlement(snapshot);
            const t0 = now();
            let failures = 0;
            const first = await settleMatchSettlement(id, {
                settings,
                now: t0,
                hooks: {
                    beforeParticipant(userId) {
                        if (userId === leo && failures === 0) {
                            failures += 1;
                            throw new Error("simulated deadlock\nsecond line");
                        }
                    },
                },
            });
            assert.equal(first.status, "pending");
            assert.deepEqual(first.participants.map((entry) => [entry.userId, entry.outcome]), [[kim, "rewarded"], [leo, "failed"]]);
            const waiting = await rowOf(id);
            assert.equal(waiting.status, "pending");
            assert.equal(waiting.attemptCount, 1);
            assert.equal(waiting.lastError, "Error: simulated deadlock second line");
            assert.equal(waiting.availableAt.getTime(), t0.getTime() + 15_000);
            assert.equal(waiting.claimToken, null);

            const early = await settleMatchSettlement(id, { settings, now: new Date(t0.getTime() + 5_000) });
            assert.equal(early.status, "pending", "not claimable before backoff ends");
            assert.deepEqual(early.participants, []);

            const later = await settleMatchSettlement(id, { settings, now: new Date(t0.getTime() + 16_000) });
            assert.equal(later.status, "settled");
            assert.deepEqual(later.participants.map((entry) => [entry.userId, entry.outcome]), [[kim, "already_settled"], [leo, "rewarded"]]);
            assert.equal(await balance(kim), 120, "first participant not paid twice");
            assert.equal(await balance(leo), 40);
            const done = await rowOf(id);
            assert.equal(done.attemptCount, 2);
            assert.equal(done.lastError, null);
            console.log("[settlement] 11 partial failure + retry ok");
        }

        // 12. A permanently failing participant ends in dead_letter; the sweeper leaves it alone.
        {
            const mia = await createUser("mia");
            const snapshot = buildSnapshot({ participants: [registered(mia, "A"), guest("x", "B")] });
            const { id } = await recordMatchSettlement(snapshot);
            let clock = now().getTime();
            let last = await settleMatchSettlement(id, { settings, now: new Date(clock), hooks: { beforeParticipant() { throw new Error("always"); } } });
            for (let attempt = 2; attempt <= MATCH_SETTLEMENT_MAX_ATTEMPTS; attempt += 1) {
                clock += 60 * 60_000;
                last = await settleMatchSettlement(id, { settings, now: new Date(clock), hooks: { beforeParticipant() { throw new Error("always"); } } });
            }
            assert.equal(last.status, "dead_letter");
            const dead = await rowOf(id);
            assert.equal(dead.status, "dead_letter");
            assert.equal(dead.attemptCount, MATCH_SETTLEMENT_MAX_ATTEMPTS);
            assert.equal(dead.lastError, "Error: always");
            await sweepDueMatchSettlements({ settings, now: new Date(clock + 24 * 60 * 60_000) });
            assert.equal((await rowOf(id)).attemptCount, MATCH_SETTLEMENT_MAX_ATTEMPTS, "sweeper skips dead letters");
            assert.equal(await balance(mia), 0);
            console.log("[settlement] 12 dead letter ok");
        }

        // 13. Crash recovery: an expired processing claim is swept; a live claim is not.
        {
            const nina = await createUser("nina");
            const oscar = await createUser("oscar");
            const crashed = buildSnapshot({ participants: [registered(nina, "A")] });
            const live = buildSnapshot({ participants: [registered(oscar, "A")] });
            const crashedRow = await recordMatchSettlement(crashed);
            const liveRow = await recordMatchSettlement(live);
            const t0 = now();
            await prisma.matchSettlement.update({
                where: { id: crashedRow.id },
                data: { status: "processing", claimToken: randomUUID(), claimExpiresAt: new Date(t0.getTime() - 1_000), attemptCount: 1 },
            });
            await prisma.matchSettlement.update({
                where: { id: liveRow.id },
                data: { status: "processing", claimToken: randomUUID(), claimExpiresAt: new Date(t0.getTime() + 60_000), attemptCount: 1 },
            });
            const sweep = await sweepDueMatchSettlements({ settings, now: t0 });
            assert.ok(sweep.processed >= 1);
            assert.equal((await rowOf(crashedRow.id)).status, "settled");
            assert.equal((await rowOf(liveRow.id)).status, "processing");
            assert.equal(await balance(nina), 120);
            assert.equal(await balance(oscar), 0);
            assert.equal((await settleMatchSettlement(liveRow.id, { settings, now: t0 })).status, "claimed_elsewhere");
            console.log("[settlement] 13 crash recovery ok");
        }

        // 14. A corrupt snapshot is dead-lettered immediately instead of looping.
        {
            const code = roomCode();
            const row = await prisma.matchSettlement.create({
                data: {
                    roomCode: code,
                    matchStartedAt: new Date(Date.now() - 600_000),
                    matchEndedAt: new Date(),
                    snapshot: { version: 1, roomCode: code, injected: true },
                },
            });
            const result = await settleMatchSettlement(row.id, { settings });
            assert.equal(result.status, "dead_letter");
            const dead = await rowOf(row.id);
            assert.equal(dead.status, "dead_letter");
            assert.match(dead.lastError ?? "", /Invalid match settlement snapshot/);
            console.log("[settlement] 14 corrupt snapshot ok");
        }

        // 15. Repeated-group guard still reduces rewards and forces a detailed audit.
        {
            const pia = await createUser("pia");
            const quinn = await createUser("quinn");
            const participants = [registered(pia, "A"), registered(quinn, "B")];
            const probe = buildSnapshot({ participants });
            const evaluation = evaluateMatchRewardEligibility({
                userId: pia,
                room: toRewardRoomSnapshot(probe),
                existingMatchResult: null,
                settings,
                now: new Date(),
            });
            assert.equal(evaluation.decision, "allow_full");
            const lineupKey = evaluation.decision === "allow_full" ? evaluation.lineupKey : null;
            for (let index = 0; index < 2; index += 1) {
                await prisma.matchResult.create({
                    data: {
                        roomCode: roomCode(),
                        matchStartedAt: new Date(Date.now() - (index + 2) * 3_600_000),
                        userId: pia,
                        playerId: `player-${pia}`,
                        won: true,
                        scoreA: 1,
                        scoreB: 0,
                        coinEarned: 0,
                        lineupKey,
                    },
                });
            }
            const guarded = structuredClone(settings);
            guarded.economy.repeatedGroupEnabled = true;
            guarded.economy.repeatedGroupThreshold = 2;
            guarded.economy.repeatedGroupWindowHours = 12;
            guarded.economy.repeatedGroupMinMultiplier = 0.5;
            const { id } = await recordMatchSettlement(probe);
            await settleMatchSettlement(id, { settings: guarded });
            const piaResult = await resultFor(probe, pia);
            assert.equal(piaResult?.coinEarned, 90, "third repeat with threshold 2 and min 0.5 pays 75%");
            assert.equal(await balance(pia), 90);
            const audit = await prisma.auditLog.findFirst({
                where: { action: "game.match.finalize", resourceType: "match_result", resourceId: String(piaResult?.id) },
            });
            assert.ok(audit, "guard trigger requires a detailed audit");
            assert.equal(audit.actorUserId, pia);
            assert.equal(audit.actorRole, "system");
            const metadata = audit.metadata as Record<string, unknown>;
            assert.equal(metadata.repeatedGroupTriggered, true);
            assert.equal(metadata.endReason, "completed");
            assert.equal(metadata.settlementId, id);
            assert.equal(metadata.coinEarned, 90);
            console.log("[settlement] 15 repeated group guard ok");
        }

        // 22. Two matches of the same user settled at the same moment must still respect the
        // rolling cap: the wallet lock has to come before any read of the earning window.
        {
            const zoe = await createUser("zoe");
            const capped = structuredClone(settings);
            capped.economy.matchRewardGuardEnabled = true;
            capped.economy.matchRewardWindowHours = 24;
            capped.economy.matchRewardSoftCapCoin = 120;
            capped.economy.matchRewardHardCapCoin = 120;
            const first = buildSnapshot({ participants: [registered(zoe, "A"), guest("z1", "B")] });
            const second = buildSnapshot({ participants: [registered(zoe, "A"), guest("z2", "B")] });
            const ids = [(await recordMatchSettlement(first)).id, (await recordMatchSettlement(second)).id];
            let started = 0;
            let releaseBarrier: () => void = () => undefined;
            const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
            const hooks = {
                async transactionStarted() {
                    started += 1;
                    if (started === 2) releaseBarrier();
                    await barrier;
                },
            };
            await Promise.all(ids.map((id) => settleMatchSettlement(id, { settings: capped, hooks })));
            const firstResult = await resultFor(first, zoe);
            const secondResult = await resultFor(second, zoe);
            assert.ok(firstResult && secondResult);
            assert.equal(firstResult.coinEarned + secondResult.coinEarned, 120, "concurrent settlements must not bypass the hard cap");
            assert.equal(await balance(zoe), 120);
            console.log("[settlement] 22 concurrent cap ok");
        }

        // 16. Safety ceiling at the hard cap still writes the match with zero coins.
        {
            const rosa = await createUser("rosa");
            await prisma.matchResult.create({
                data: {
                    roomCode: roomCode(),
                    matchStartedAt: new Date(Date.now() - 3_600_000),
                    userId: rosa,
                    playerId: `player-${rosa}`,
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
            const snapshot = buildSnapshot({ participants: [registered(rosa, "A"), guest("r", "B")] });
            const { id } = await recordMatchSettlement(snapshot);
            await settleMatchSettlement(id, { settings: capped });
            const rosaResult = await resultFor(snapshot, rosa);
            assert.ok(rosaResult);
            assert.equal(rosaResult.coinEarned, 0);
            assert.equal(await balance(rosa), 0);
            console.log("[settlement] 16 safety ceiling ok");
        }

        // 17. Missing wallet and profile are created on settlement.
        {
            const sam = await createUser("sam", { wallet: false });
            const snapshot = buildSnapshot({ participants: [registered(sam, "A"), guest("s1", "A"), guest("s2", "B"), guest("s3", "B")] });
            const { id } = await recordMatchSettlement(snapshot);
            await settleMatchSettlement(id, { settings });
            assert.equal(await balance(sam), 120);
            assert.ok(await prisma.userProfile.findUnique({ where: { userId: sam } }));
            // 18. Single registered player among guests always gets a detailed audit row.
            const samResult = await resultFor(snapshot, sam);
            const audit = await prisma.auditLog.findFirst({
                where: { action: "game.match.finalize", resourceId: String(samResult?.id) },
            });
            assert.ok(audit);
            const metadata = audit.metadata as Record<string, unknown>;
            assert.deepEqual(metadata.reviewFlags, ["single_authenticated_player_room", "guest_majority_room"]);
            assert.equal(metadata.roomCode, snapshot.roomCode);
            assert.equal(metadata.guestPlayers, 3);
            assert.equal(audit.ipAddress, null, "server settlement stores no IP");
            console.log("[settlement] 17-18 wallet creation + audit ok");
        }

        // Weekend boost follows the match end time, not the processing time: two matches
        // settled in the same run differ only by when they ended.
        {
            const tess = await createUser("tess");
            const walt = await createUser("walt");
            const boosted = structuredClone(settings);
            boosted.economy.weekendCoinMultiplierEnabled = true;
            boosted.economy.weekendCoinMultiplier = 2;
            const saturday = buildSnapshot({
                participants: [registered(tess, "A"), guest("t", "B")],
                endedAt: new Date("2026-10-10T09:00:00.000Z"),
            });
            const wednesday = buildSnapshot({
                participants: [registered(walt, "A"), guest("w", "B")],
                endedAt: new Date("2026-10-07T09:00:00.000Z"),
            });
            const processingTime = new Date(Date.now() + 1_000);
            await settleMatchSettlement((await recordMatchSettlement(saturday)).id, { settings: boosted, now: processingTime });
            await settleMatchSettlement((await recordMatchSettlement(wednesday)).id, { settings: boosted, now: processingTime });
            assert.equal((await resultFor(saturday, tess))?.coinEarned, 240);
            assert.equal((await resultFor(wednesday, walt))?.coinEarned, 120);
            console.log("[settlement] weekend clock ok");
        }

        // All-guest match settles with no rows.
        {
            const snapshot = buildSnapshot({ participants: [guest("g1", "A"), guest("g2", "A"), guest("g3", "B"), guest("g4", "B")] });
            const { id } = await recordMatchSettlement(snapshot);
            const result = await settleMatchSettlement(id, { settings });
            assert.equal(result.status, "settled");
            assert.deepEqual(result.participants, []);
            assert.equal((await rowOf(id)).guestParticipantCount, 4);
            console.log("[settlement] all guest ok");
        }

        // 19. Purge removes only settled rows past the retention window, in batches.
        {
            const base = now();
            const day = 86_400_000;
            const make = async (status: "settled" | "pending" | "dead_letter", settledDaysAgo: number | null) => {
                const code = roomCode();
                const row = await prisma.matchSettlement.create({
                    data: {
                        roomCode: code,
                        matchStartedAt: new Date(base.getTime() - 40 * day),
                        matchEndedAt: new Date(base.getTime() - 40 * day + 600_000),
                        snapshot: {},
                        status,
                        settledAt: settledDaysAgo === null ? null : new Date(base.getTime() - settledDaysAgo * day),
                    },
                });
                return row.id;
            };
            const old1 = await make("settled", 31);
            const old2 = await make("settled", 45);
            const old3 = await make("settled", 60);
            const recent = await make("settled", 29);
            const oldPending = await make("pending", null);
            const oldDead = await make("dead_letter", null);
            const firstBatch = await purgeSettledMatchSettlements({ now: base, olderThanDays: 30, limit: 2 });
            assert.equal(firstBatch, 2);
            const secondBatch = await purgeSettledMatchSettlements({ now: base, olderThanDays: 30, limit: 2 });
            assert.ok(secondBatch >= 1);
            const remaining = await prisma.matchSettlement.findMany({
                where: { id: { in: [old1, old2, old3, recent, oldPending, oldDead] } },
                select: { id: true },
            });
            assert.deepEqual(remaining.map((row) => row.id).sort((a, b) => a - b), [recent, oldPending, oldDead].sort((a, b) => a - b));
            console.log("[settlement] 19 purge ok");
        }

        // 20. Health counts move with row states.
        {
            const before = await getMatchSettlementHealth();
            const uma = await createUser("uma");
            const snapshot = buildSnapshot({ participants: [registered(uma, "A")] });
            const { id } = await recordMatchSettlement(snapshot);
            const pendingHealth = await getMatchSettlementHealth();
            assert.equal(pendingHealth.pending, before.pending + 1);
            await prisma.matchSettlement.update({ where: { id }, data: { status: "dead_letter" } });
            const deadHealth = await getMatchSettlementHealth();
            assert.equal(deadHealth.pending, before.pending);
            assert.equal(deadHealth.deadLetter, before.deadLetter + 1);
            console.log("[settlement] 20 health ok");
        }

        // Registered participant extraction ignores a second tab of the same user.
        {
            const vera = await createUser("vera");
            const snapshot = buildSnapshot({
                participants: [registered(vera, "A"), { ...registered(vera, "A"), playerId: "second-tab" }, guest("v", "B")],
            });
            assert.equal(getRegisteredParticipants(snapshot).length, 1);
            const { id } = await recordMatchSettlement(snapshot);
            const result = await settleMatchSettlement(id, { settings });
            assert.equal(result.participants.length, 1);
            assert.equal(await balance(vera), 120);
            assert.equal((await rowOf(id)).registeredParticipantCount, 1);
            console.log("[settlement] duplicate tab ok");
        }

        console.log("match settlement integration checks passed");
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
