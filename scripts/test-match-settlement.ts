import assert from "node:assert/strict";
import type { RoomMatchSnapshot } from "../apps/web/src/lib/socket/game-socket";
import {
    SettlementSnapshotError,
    createSettlementSnapshot,
    getRegisteredParticipants,
    parseSettlementSnapshot,
    toRewardRoomSnapshot,
} from "../apps/web/src/lib/match-settlement/snapshot";
import {
    MATCH_SETTLEMENT_CLAIM_TTL_MS,
    MATCH_SETTLEMENT_MAX_ATTEMPTS,
    formatSettlementError,
    getSettlementRetryDelayMs,
} from "../apps/web/src/lib/match-settlement/retry-policy";

function endedRoom(overrides: Partial<RoomMatchSnapshot> = {}): RoomMatchSnapshot {
    return {
        odaKodu: "ABC123",
        gameMode: "tabu",
        oyunAktifMi: false,
        skor: { A: 10, B: 7 },
        matchStartedAt: "2026-10-12T10:00:00.123Z",
        matchEndedAt: "2026-10-12T10:20:00.456Z",
        sureSeconds: 1140,
        matchFormat: "skor",
        matchTarget: 10,
        oyuncular: [
            { playerId: "p-host", userId: 11, identityType: "registered", usernameSnapshot: "host", ad: "Host", takim: "A", roleAtStart: "Anlatıcı" },
            { playerId: "p-guest-a", userId: null, identityType: "guest", usernameSnapshot: null, ad: "Misafir A", takim: "A", roleAtStart: "Tahminci" },
            { playerId: "p-reg-b", userId: 12, identityType: "registered", usernameSnapshot: "bob", ad: "Bob", takim: "B", roleAtStart: "Gözetmen" },
            { playerId: "p-guest-b", userId: null, identityType: "guest", usernameSnapshot: null, ad: "Misafir B", takim: "B", roleAtStart: "Oyuncu" },
        ],
        ...overrides,
    };
}

// 1. Ended room -> versioned snapshot with every participant, guests included.
const snapshot = createSettlementSnapshot(endedRoom(), "completed");
assert.equal(snapshot.version, 1);
assert.equal(snapshot.endReason, "completed");
assert.equal(snapshot.roomCode, "ABC123");
assert.equal(snapshot.gameMode, "tabu");
assert.equal(snapshot.matchStartedAt, "2026-10-12T10:00:00.123Z");
assert.equal(snapshot.matchEndedAt, "2026-10-12T10:20:00.456Z");
assert.equal(snapshot.durationSeconds, 1140);
assert.deepEqual(snapshot.score, { A: 10, B: 7 });
assert.equal(snapshot.participants.length, 4);
assert.deepEqual(snapshot.participants[1], {
    playerId: "p-guest-a",
    userId: null,
    identityType: "guest",
    usernameSnapshot: null,
    displayName: "Misafir A",
    team: "A",
    roleAtStart: "Tahminci",
});
assert.equal("oyunAktifMi" in snapshot, false);
assert.doesNotMatch(JSON.stringify(snapshot), /"ip(?:Address)?"\s*:/i, "snapshot must not carry IP fields");
assert.equal(createSettlementSnapshot(endedRoom(), "host_ended").endReason, "host_ended");

// 2. Only finished matches can be snapshotted.
assert.throws(() => createSettlementSnapshot(endedRoom({ oyunAktifMi: true }), "completed"), SettlementSnapshotError);
assert.throws(() => createSettlementSnapshot(endedRoom({ matchStartedAt: null }), "completed"), SettlementSnapshotError);
assert.throws(() => createSettlementSnapshot(endedRoom({ matchEndedAt: null }), "completed"), SettlementSnapshotError);
assert.throws(
    () => createSettlementSnapshot(endedRoom({ matchEndedAt: "2026-10-12T09:00:00.000Z" }), "completed"),
    SettlementSnapshotError,
    "end before start must be rejected"
);

// 3. Parse round-trips, including through JSON (the DB stores JSON).
assert.deepEqual(parseSettlementSnapshot(snapshot), snapshot);
assert.deepEqual(parseSettlementSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
assert.deepEqual(
    parseSettlementSnapshot({ ...snapshot, durationSeconds: null }).durationSeconds,
    null
);
assert.equal(parseSettlementSnapshot({ ...snapshot, participants: [] }).participants.length, 0);

// 4. Parse rejects malformed or tampered snapshots.
const invalidSnapshots: Array<[string, unknown]> = [
    ["null", null],
    ["future version", { ...snapshot, version: 2 }],
    ["extra key", { ...snapshot, ip: "203.0.113.5" }],
    ["participant extra key", { ...snapshot, participants: [{ ...snapshot.participants[0], ip: "203.0.113.5" }] }],
    ["zero userId", { ...snapshot, participants: [{ ...snapshot.participants[0], userId: 0 }] }],
    ["negative userId", { ...snapshot, participants: [{ ...snapshot.participants[0], userId: -4 }] }],
    ["float userId", { ...snapshot, participants: [{ ...snapshot.participants[0], userId: 1.5 }] }],
    ["string userId", { ...snapshot, participants: [{ ...snapshot.participants[0], userId: "11" }] }],
    ["registered without userId", { ...snapshot, participants: [{ ...snapshot.participants[0], userId: null }] }],
    ["guest with userId", { ...snapshot, participants: [{ ...snapshot.participants[1], userId: 99 }] }],
    ["bad team", { ...snapshot, participants: [{ ...snapshot.participants[0], team: "C" }] }],
    ["bad role", { ...snapshot, participants: [{ ...snapshot.participants[0], roleAtStart: "Hakem" }] }],
    ["empty playerId", { ...snapshot, participants: [{ ...snapshot.participants[0], playerId: "" }] }],
    ["empty room code", { ...snapshot, roomCode: "" }],
    ["lowercase room code", { ...snapshot, roomCode: "abc123" }],
    ["too many participants", { ...snapshot, participants: Array.from({ length: 41 }, (_, i) => ({ ...snapshot.participants[1], playerId: `g${i}` })) }],
    ["non ISO start", { ...snapshot, matchStartedAt: "yesterday" }],
    ["end before start", { ...snapshot, matchEndedAt: "2026-10-12T09:00:00.000Z" }],
    ["negative score", { ...snapshot, score: { A: -1, B: 0 } }],
    ["float score", { ...snapshot, score: { A: 1.5, B: 0 } }],
    ["negative duration", { ...snapshot, durationSeconds: -3 }],
    ["unknown end reason", { ...snapshot, endReason: "abandoned" }],
    ["unknown format", { ...snapshot, matchFormat: "zaman" }],
    ["unknown game mode", { ...snapshot, gameMode: "pictionary" }],
];
for (const [label, value] of invalidSnapshots) {
    assert.throws(() => parseSettlementSnapshot(value), SettlementSnapshotError, `must reject: ${label}`);
}

// 5. Registered participants: positive integer ids, deduplicated, guests ignored.
const duplicated = parseSettlementSnapshot({
    ...snapshot,
    participants: [
        ...snapshot.participants,
        { ...snapshot.participants[0], playerId: "p-host-second-tab" },
    ],
});
assert.deepEqual(
    getRegisteredParticipants(duplicated).map((participant) => [participant.userId, participant.playerId]),
    [[11, "p-host"], [12, "p-reg-b"]]
);
assert.deepEqual(getRegisteredParticipants({ ...snapshot, participants: [] }), []);

// 6. Reward pipeline input mirrors the live room snapshot shape.
const rewardRoom = toRewardRoomSnapshot(snapshot);
assert.equal(rewardRoom.oyunAktifMi, false);
assert.equal(rewardRoom.odaKodu, "ABC123");
assert.equal(rewardRoom.sureSeconds, 1140);
assert.deepEqual(rewardRoom.oyuncular, endedRoom().oyuncular);

// 7. Retry policy.
assert.equal(MATCH_SETTLEMENT_MAX_ATTEMPTS, 10);
assert.equal(MATCH_SETTLEMENT_CLAIM_TTL_MS, 60_000);
assert.deepEqual(
    [0, -2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 50].map(getSettlementRetryDelayMs),
    [15_000, 15_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 1_800_000, 1_800_000]
);

// 8. Stored error text is one bounded line.
assert.equal(formatSettlementError(new Error("boom")), "Error: boom");
assert.equal(formatSettlementError("plain failure"), "plain failure");
assert.equal(formatSettlementError({ code: "P2002" }), "{\"code\":\"P2002\"}");
assert.equal(formatSettlementError(new TypeError("line one\n  line two")), "TypeError: line one line two");
assert.equal(formatSettlementError(undefined), "Unknown settlement error");
assert.equal(formatSettlementError(new Error("x".repeat(1000))).length, 255);

console.log("match settlement unit checks passed");
