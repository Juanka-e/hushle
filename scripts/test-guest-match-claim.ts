import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createGuestIdentityToken } from "../apps/web/src/lib/security/player-identity";
import { evaluateMatchRewardEligibility } from "../apps/web/src/lib/economy/reward-eligibility";
import {
    GUEST_CLAIM_TOKEN_GRACE_MS,
    GUEST_CLAIM_WINDOW_MS,
    getClaimableGuestSeats,
    isServerIssuedGuestPlayerId,
    isWaitingOutcome,
    resolveClaimableGuestPlayerId,
    summarizeGuestClaim,
    toClaimedSnapshot,
    type GuestSeatSettleResult,
} from "../apps/web/src/lib/match-settlement/guest-claim-rules";
import {
    parseSettlementSnapshot,
    toRewardRoomSnapshot,
} from "../apps/web/src/lib/match-settlement/snapshot";
import type {
    MatchSettlementParticipant,
    MatchSettlementSnapshot,
} from "../apps/web/src/lib/match-settlement/types";
import {
    clearPendingGuestClaim,
    readPendingGuestClaim,
    stashGuestClaimToken,
} from "../apps/web/src/lib/client/guest-claim-storage";
import { translate } from "../apps/web/src/lib/i18n/dictionaries";
import type { SystemSettings } from "../apps/web/src/types/system-settings";

const GUEST_A = "guest:6b0d7c1e-4f7a-4b8e-9a51-2f9a1c0d3e11";
const GUEST_B = "guest:0f3c2d1b-8e7a-4c6b-9d5e-1a2b3c4d5e6f";
const GUEST_SPECTATOR = "guest:9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

function participant(overrides: Partial<MatchSettlementParticipant>): MatchSettlementParticipant {
    return {
        playerId: "user:11",
        userId: 11,
        identityType: "registered",
        usernameSnapshot: "host",
        displayName: "Host",
        team: "A",
        roleAtStart: "Anlatıcı",
        ...overrides,
    };
}

function guestSeat(playerId: string, team: "A" | "B" | null, role: MatchSettlementParticipant["roleAtStart"] = "Tahminci") {
    return participant({
        playerId,
        userId: null,
        identityType: "guest",
        usernameSnapshot: null,
        displayName: `Misafir ${playerId.slice(-4)}`,
        team,
        roleAtStart: role,
    });
}

function snapshot(participants: MatchSettlementParticipant[], overrides: Partial<MatchSettlementSnapshot> = {}) {
    return parseSettlementSnapshot({
        version: 1,
        endReason: "completed",
        roomCode: "ROOM42",
        gameMode: "tabu",
        matchStartedAt: "2026-10-13T10:00:00.000Z",
        matchEndedAt: "2026-10-13T10:15:00.000Z",
        durationSeconds: 900,
        matchFormat: "skor",
        matchTarget: 10,
        score: { A: 10, B: 6 },
        participants,
        ...overrides,
    });
}

const match = snapshot([
    participant({}),
    guestSeat(GUEST_A, "A"),
    participant({ playerId: "user:12", userId: 12, usernameSnapshot: "bob", displayName: "Bob", team: "B", roleAtStart: "Gözetmen" }),
    guestSeat(GUEST_B, "B", "Oyuncu"),
    guestSeat(GUEST_SPECTATOR, null, "İzleyici"),
    // Hand-written ids never come from the server and cannot be claimed.
    guestSeat("guest-legacy-format", "B"),
    guestSeat(`guest:${"x".repeat(80)}`, "B"),
]);

// Seats: only server-issued, non-spectator guests; duplicates collapse.
{
    assert.deepEqual(getClaimableGuestSeats(match), [GUEST_A, GUEST_B]);
    const duplicated = snapshot([guestSeat(GUEST_A, "A"), guestSeat(GUEST_A, "A")]);
    assert.deepEqual(getClaimableGuestSeats(duplicated), [GUEST_A]);
    assert.deepEqual(getClaimableGuestSeats(snapshot([participant({})])), []);
    assert.equal(isServerIssuedGuestPlayerId("guest:"), false);
    assert.equal(isServerIssuedGuestPlayerId("user:5"), false);
    assert.equal(isServerIssuedGuestPlayerId(GUEST_A), true);
    console.log("guest seats: spectators, registered and foreign ids are never claimable");
}

// Claimed snapshot: the seat becomes the account, everything else stays as played.
{
    const claimed = toClaimedSnapshot(match, GUEST_A, { userId: 77, username: "  newbie  " });
    assert.ok(claimed);
    const seat = claimed.participants[1];
    assert.equal(seat.userId, 77);
    assert.equal(seat.playerId, "user:77");
    assert.equal(seat.identityType, "registered");
    assert.equal(seat.usernameSnapshot, "newbie");
    assert.equal(seat.team, "A");
    assert.equal(seat.roleAtStart, "Tahminci");
    assert.equal(seat.displayName, match.participants[1].displayName);
    assert.deepEqual(claimed.participants.filter((_, index) => index !== 1), match.participants.filter((_, index) => index !== 1));
    assert.equal(match.participants[1].userId, null, "the stored snapshot is never mutated");
    // The claimed snapshot is still a valid settlement snapshot.
    assert.deepEqual(parseSettlementSnapshot(claimed), claimed);

    assert.equal(toClaimedSnapshot(match, GUEST_A, { userId: 12, username: "bob" }), null, "a participant cannot claim a second seat");
    assert.equal(toClaimedSnapshot(match, "guest:missing-seat-0000", { userId: 77, username: null }), null);
    assert.equal(toClaimedSnapshot(match, "user:11", { userId: 77, username: null }), null, "registered seats are not claimable");
    const blankName = toClaimedSnapshot(match, GUEST_B, { userId: 78, username: "   " });
    assert.equal(blankName?.participants[3].usernameSnapshot, null);
    console.log("claimed snapshot: seat converted, rest of the match untouched");
}

// Reward rules see the claimant exactly like a player who joined signed in.
{
    const settings = {
        economy: {
            winRewardCoin: 120,
            lossRewardCoin: 40,
            drawRewardCoin: 60,
            matchCoinMultiplier: 1,
            weekendCoinMultiplierEnabled: false,
            weekendCoinMultiplier: 1,
        },
    } as unknown as SystemSettings;
    const evaluate = (source: MatchSettlementSnapshot, userId: number) =>
        evaluateMatchRewardEligibility({
            userId,
            room: toRewardRoomSnapshot(source),
            existingMatchResult: null,
            settings,
            now: new Date(source.matchEndedAt),
        });

    const winner = evaluate(toClaimedSnapshot(match, GUEST_A, { userId: 77, username: "w" })!, 77);
    assert.equal(winner.decision, "allow_full");
    if (winner.decision !== "allow_full") throw new Error("unreachable");
    assert.equal(winner.won, true);
    assert.equal(winner.baseRewardCoin, 120);
    assert.equal(winner.participantPlayerId, "user:77");
    assert.equal(winner.roomMetrics.authenticatedPlayers, 3);

    const loser = evaluate(toClaimedSnapshot(match, GUEST_B, { userId: 78, username: "l" })!, 78);
    assert.equal(loser.decision, "allow_full");
    if (loser.decision !== "allow_full") throw new Error("unreachable");
    assert.equal(loser.won, false);
    assert.equal(loser.baseRewardCoin, 40);

    // The same group signed in from the start produces the same lineup key, so the
    // repeated-group rule counts claimed and regular matches together.
    const signedIn = snapshot(match.participants.map((entry) =>
        entry.playerId === GUEST_A ? { ...entry, playerId: "user:77", userId: 77, identityType: "registered" as const, usernameSnapshot: "w" } : entry
    ));
    const signedInEvaluation = evaluate(signedIn, 77);
    assert.equal(signedInEvaluation.decision, "allow_full");
    if (signedInEvaluation.decision !== "allow_full") throw new Error("unreachable");
    assert.equal(winner.lineupKey, signedInEvaluation.lineupKey);
    console.log("reward rules: claimed seat wins, loses and groups like a signed-in seat");
}

// Guest tokens: signature, expiry and the claim grace period.
{
    const guestId = GUEST_A.slice("guest:".length);
    const issuedAt = Date.parse("2026-10-13T08:00:00.000Z");
    const token = createGuestIdentityToken(guestId, issuedAt);
    assert.equal(resolveClaimableGuestPlayerId(token, issuedAt + 60_000), GUEST_A);
    const expiry = issuedAt + GUEST_CLAIM_WINDOW_MS;
    assert.equal(resolveClaimableGuestPlayerId(token, expiry + GUEST_CLAIM_TOKEN_GRACE_MS - 1_000), GUEST_A, "grace after expiry");
    assert.equal(resolveClaimableGuestPlayerId(token, expiry + GUEST_CLAIM_TOKEN_GRACE_MS + 1_000), null, "past the grace");

    const [payload, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ guestId: "attacker-chosen-id", exp: expiry })).toString("base64url");
    assert.equal(resolveClaimableGuestPlayerId(`${forgedPayload}.${signature}`, issuedAt), null, "payload swap");
    assert.equal(resolveClaimableGuestPlayerId(`${payload}.${signature.slice(0, -2)}AA`, issuedAt), null, "bad signature");
    assert.equal(resolveClaimableGuestPlayerId("", issuedAt), null);
    assert.equal(resolveClaimableGuestPlayerId("no-dot", issuedAt), null);
    assert.equal(resolveClaimableGuestPlayerId("a.b.c", issuedAt), null);
    const longId = createGuestIdentityToken("y".repeat(90), issuedAt);
    assert.equal(resolveClaimableGuestPlayerId(longId, issuedAt), null, "ids beyond guest_progress width");
    console.log("guest tokens: forged, malformed and stale tokens never resolve");
}

// Claim summary shown to the player.
{
    const seat = (outcome: GuestSeatSettleResult["outcome"], coinEarned: number | null = null): GuestSeatSettleResult => ({
        seatId: Math.floor(Math.random() * 1e6),
        outcome,
        coinEarned,
        matchResultId: null,
    });
    assert.deepEqual(summarizeGuestClaim({ status: "invalid_token" }), {
        status: "invalid_token", matches: 0, settledNow: 0, coinEarnedNow: 0, awaitingVerification: 0, alreadyMoved: 0,
    });
    assert.equal(summarizeGuestClaim({ status: "linked_elsewhere" }).status, "linked_elsewhere");
    const summary = summarizeGuestClaim({
        status: "ok",
        guestPlayerId: GUEST_A,
        newlyClaimed: 4,
        previouslySettled: 2,
        // The awaiting and retry seats above are the two still attached.
        stillPending: 2,
        seats: [
            seat("settled", 120),
            seat("settled", 0),
            seat("awaiting_verification"),
            seat("retry"),
            seat("already_participant"),
            seat("already_recorded"),
        ],
    });
    assert.deepEqual(summary, {
        status: "ok",
        matches: 6,
        settledNow: 2,
        coinEarnedNow: 120,
        awaitingVerification: 1,
        alreadyMoved: 2,
    });
    assert.deepEqual(
        (["settled", "awaiting_verification", "suspended_waiting", "retry", "failed", "expired", "not_pending"] as const).map(isWaitingOutcome),
        [false, true, true, true, false, false, false]
    );
    console.log("claim summary: counts settled, waiting and earlier moves");
}

// Client copy of the token: survives sign-in, expires, tolerates blocked storage.
{
    const store = new Map<string, string>();
    const storage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
    };
    const now = Date.parse("2026-10-13T12:00:00.000Z");
    assert.equal(stashGuestClaimToken(storage, now), false, "no guest token, nothing to keep");
    store.set("tabu_guestToken", "guest-token-value-123456");
    assert.equal(stashGuestClaimToken(storage, now), true);
    // Joining a room signed in drops the guest token; the claim copy must survive it.
    store.delete("tabu_guestToken");
    assert.equal(readPendingGuestClaim(storage, now + 60_000), "guest-token-value-123456");
    assert.equal(readPendingGuestClaim(storage, now + 90 * 60 * 1000), "guest-token-value-123456", "survives a slow sign-up");
    assert.equal(readPendingGuestClaim(storage, now + 3 * 60 * 60 * 1000), null, "abandoned copy expires after two hours");
    assert.equal(store.has("tabu_pendingGuestClaim"), false, "and is removed");

    store.set("tabu_pendingGuestClaim", "{not json");
    assert.equal(readPendingGuestClaim(storage, now), null);
    assert.equal(store.has("tabu_pendingGuestClaim"), false, "corrupt copy is removed");
    store.set("tabu_pendingGuestClaim", JSON.stringify({ token: 42, savedAt: now }));
    assert.equal(readPendingGuestClaim(storage, now), null);

    store.set("tabu_pendingGuestClaim", JSON.stringify({ token: "t", savedAt: now }));
    clearPendingGuestClaim(storage);
    assert.equal(store.size, 0);

    const blocked = {
        getItem: () => { throw new Error("SecurityError"); },
        setItem: () => { throw new Error("SecurityError"); },
        removeItem: () => { throw new Error("SecurityError"); },
    };
    assert.equal(stashGuestClaimToken(blocked, now), false);
    assert.equal(readPendingGuestClaim(blocked, now), null);
    assert.doesNotThrow(() => clearPendingGuestClaim(blocked));
    assert.equal(readPendingGuestClaim(null, now), null);
    console.log("client storage: copy survives sign-in, expires and never throws");
}

// Copy exists in both languages with the placeholders the toasts fill in.
{
    for (const locale of ["tr", "en"] as const) {
        for (const key of [
            "gameOver.guestClaimTitle",
            "gameOver.guestClaimBody",
            "gameOver.guestClaimBodyNoCoin",
            "gameOver.guestClaimRegister",
            "gameOver.guestClaimLogin",
            "guestClaim.settled",
            "guestClaim.awaitingVerification",
            "guestClaim.linkedElsewhere",
            "guestClaim.expired",
        ] as const) {
            const text = translate(locale, key);
            assert.ok(text && text !== key, `${locale}:${key}`);
        }
        const toast = translate(locale, "guestClaim.settledWithCoin", { count: 2, coin: 160 });
        assert.match(toast, /2/);
        assert.match(toast, /160/);
        assert.doesNotMatch(toast, /[{}]/);
    }
    console.log("copy: Turkish and English strings present");
}

// Wiring: every entry point reaches the claim service exactly where it should.
{
    const read = (path: string) => readFileSync(path, "utf8");
    const service = read("apps/web/src/lib/match-settlement/service.ts");
    const recordBody = service.slice(service.indexOf("export async function recordMatchSettlement"), service.indexOf("function claimableWhere"));
    assert.match(recordBody, /prisma\.\$transaction\(async \(tx\) =>/, "seats commit with the match");
    assert.match(recordBody, /tx\.matchSettlementGuestSeat\.createMany/);
    assert.match(recordBody, /if \(created && guestSeats\.length > 0\)/, "only the first record writes seats");

    const runtime = read("apps/web/src/lib/match-settlement/runtime.ts");
    assert.match(runtime, /await sweepDueMatchSettlements\(\);\s+await sweepDueGuestSeatClaims\(\);/);
    assert.match(runtime, /await settleMatchSettlement\(id\);\s+await settlePendingGuestSeatsOf\(id\);/, "owned seats settle right after recording");
    assert.match(recordBody, /tx\.guestProgress\.findMany\(\{\s+where: \{ playerId: \{ in: guestSeats \}, linkedUserId: \{ not: null \} \}/);

    const register = read("apps/web/src/app/api/auth/register/route.ts");
    assert.match(register, /guestToken: z\.string\(\)[^\n]*\.catch\(null\)/, "a bad guest token never blocks sign-up");
    assert.ok(
        register.indexOf("claimGuestMatchesOnSignup(user.id, guestToken)") > register.indexOf("const user = await prisma.$transaction"),
        "claim runs after the account exists"
    );
    assert.match(register, /\.\.\.\(guestClaim \? \{ guestClaim \} : \{\}\)/);

    const confirm = read("apps/web/src/app/api/auth/email-verification/confirm/route.ts");
    assert.ok(confirm.indexOf("processGuestClaimsForUser(result.userId)") > confirm.indexOf("if (!result.ok)"), "only verified accounts settle");

    const route = read("apps/web/src/app/api/game/match/guest-claims/route.ts");
    assert.ok(route.indexOf("await getSessionUser()") < route.indexOf("await consumeDistributedRequestRateLimit("), "auth before work");
    assert.doesNotMatch(route, /enforceAccountCapability/, "unverified accounts may attach claims");
    assert.match(route, /key: `user:\$\{sessionUser\.id\}`,/, "rate limit follows the account, not the address");

    const layout = read("apps/web/src/app/layout.tsx");
    assert.match(layout, /<GuestClaimFinalizer \/>/);
    assert.ok(layout.indexOf("<GuestClaimFinalizer />") > layout.indexOf("<AuthProvider>"));
    assert.ok(layout.indexOf("<GuestClaimFinalizer />") > layout.indexOf("<I18nProvider"));

    const room = read("apps/web/src/app/room/[code]/page.tsx");
    assert.match(room, /myPlayerId\.startsWith\("guest:"\) && currentPlayer\?\.takim && currentPlayer\.rol !== "İzleyici"/);

    const gameOver = read("apps/web/src/app/room/[code]/_components/game-over-screen.tsx");
    assert.match(gameOver, /stashGuestClaimToken\(\);\s+router\.push\(path\);/, "token is kept before leaving the room");
    assert.match(gameOver, /\/login\?callbackUrl=\$\{encodeURIComponent\(`\/room\/\$\{guestClaimRoomCode\}`\)\}/);
    assert.match(gameOver, /endedByHost \? t\("gameOver\.guestClaimBodyNoCoin"\) : t\("gameOver\.guestClaimBody"\)/);

    const registerPage = read("apps/web/src/app/register/page.tsx");
    assert.match(registerPage, /\.\.\.\(guestToken \? \{ guestToken \} : \{\}\)/);
    assert.match(registerPage, /const guestClaim = res\.ok \? data\.guestClaim : undefined;/);
    assert.match(registerPage, /if \(guestClaim\) clearPendingGuestClaim\(\);/);
    assert.ok(
        registerPage.indexOf("if (guestClaim) announceGuestClaim(guestClaim, t);") >
            registerPage.indexOf('toast.success(t("auth.registrationComplete"));'),
        "the claim toast stacks above the sign-up toast"
    );

    const schema = read("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model MatchSettlementGuestSeat {"));
    assert.match(model, /@@unique\(\[settlementId, guestPlayerId\]\)/);
    assert.match(model, /onDelete: Cascade\)/);
    assert.match(model, /claimUser\s+User\?\s+@relation\(fields: \[claimUserId\], references: \[id\], onDelete: SetNull\)/);
    console.log("wiring: record, worker, sign-up, verification, API, layout and room are connected");
}

console.log("guest match claim unit checks passed");
