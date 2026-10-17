import assert from "node:assert/strict";
import {
    CONNECTION_PAUSE_GRACE_MS,
    EMPTY_LOBBY_GRACE_MS,
    calculateActiveMatchDurationSeconds,
    classifyConnectionPauseTrigger,
    evaluateContinueWithoutMissing,
    getConnectionPauseResolutionWindow,
    resolveAbandonedRoomTtlMs,
    resolveConnectionContinuity,
} from "../apps/web/src/lib/socket/room-connection-continuity";

function player(playerId: string, team: "A" | "B", online = true) {
    return { playerId, team, online, spectator: false };
}

const twoVsTwo = [player("a1", "A"), player("a2", "A"), player("b1", "B"), player("b2", "B")];
assert.equal(resolveConnectionContinuity({ active: true, players: twoVsTwo, narratorPlayerId: "a1", inspectorPlayerId: "b1" }).canContinue, true);

const disconnectedTwoVsTwo = twoVsTwo.map((entry) =>
    entry.playerId === "a2" ? { ...entry, online: false } : entry
);
assert.deepEqual(
    resolveConnectionContinuity({ active: true, players: disconnectedTwoVsTwo, narratorPlayerId: "a1", inspectorPlayerId: "b1" }),
    { canContinue: false, missingPlayerIds: ["a2"] }
);

const fiveVsFive = [
    ...Array.from({ length: 5 }, (_, index) => player(`a${index + 1}`, "A")),
    ...Array.from({ length: 5 }, (_, index) => player(`b${index + 1}`, "B")),
];
const ordinaryDisconnect = fiveVsFive.map((entry) =>
    entry.playerId === "a5" ? { ...entry, online: false } : entry
);
assert.equal(resolveConnectionContinuity({ active: true, players: ordinaryDisconnect, narratorPlayerId: "a1", inspectorPlayerId: "b1" }).canContinue, true);

const narratorDisconnect = fiveVsFive.map((entry) =>
    entry.playerId === "a1" ? { ...entry, online: false } : entry
);
assert.deepEqual(
    resolveConnectionContinuity({ active: true, players: narratorDisconnect, narratorPlayerId: "a1", inspectorPlayerId: "b1" }),
    { canContinue: false, missingPlayerIds: ["a1"] }
);

const spectatorDisconnect = [
    ...fiveVsFive,
    { playerId: "spectator", team: null, online: false, spectator: true },
];
assert.equal(resolveConnectionContinuity({ active: true, players: spectatorDisconnect, narratorPlayerId: "a1", inspectorPlayerId: "b1" }).canContinue, true);

assert.equal(
    calculateActiveMatchDurationSeconds({
        startedAt: 1_000,
        endedAt: 11_000,
        now: 20_000,
        pausedDurationMs: 4_000,
        pauseStartedAt: null,
    }),
    6,
    "completed match duration must exclude accumulated pauses"
);

assert.equal(
    calculateActiveMatchDurationSeconds({
        startedAt: 1_000,
        endedAt: null,
        now: 11_000,
        pausedDurationMs: 2_000,
        pauseStartedAt: 8_000,
    }),
    5,
    "live match duration must exclude the currently open pause"
);

// Only an interrupted match is worth keeping; empty lobbies must free their slot quickly.
assert.equal(resolveAbandonedRoomTtlMs({ matchActive: true, abandonedMatchTtlMs: 1_800_000 }), 1_800_000);
assert.equal(resolveAbandonedRoomTtlMs({ matchActive: false, abandonedMatchTtlMs: 1_800_000 }), EMPTY_LOBBY_GRACE_MS);
assert.equal(EMPTY_LOBBY_GRACE_MS, 15_000);

// Pause resolution: the host may decide only after the grace period.
assert.equal(CONNECTION_PAUSE_GRACE_MS, 60_000);
assert.deepEqual(getConnectionPauseResolutionWindow({ startedAt: 1_000, now: 1_000 }), { available: false, secondsRemaining: 60 });
assert.deepEqual(getConnectionPauseResolutionWindow({ startedAt: 1_000, now: 1_500 }), { available: false, secondsRemaining: 60 }, "partial seconds round up");
assert.deepEqual(getConnectionPauseResolutionWindow({ startedAt: 1_000, now: 60_999 }), { available: false, secondsRemaining: 1 });
assert.deepEqual(getConnectionPauseResolutionWindow({ startedAt: 1_000, now: 61_000 }), { available: true, secondsRemaining: 0 });
assert.deepEqual(getConnectionPauseResolutionWindow({ startedAt: 1_000, now: 500_000 }), { available: true, secondsRemaining: 0 });
assert.deepEqual(getConnectionPauseResolutionWindow({ startedAt: 10_000, now: 5_000 }), { available: false, secondsRemaining: 60 }, "clock skew never shortens the grace");

// Continue without missing players only when every team keeps two online players.
const threeVsThree = [
    player("a1", "A"), player("a2", "A"), player("a3", "A", false),
    player("b1", "B"), player("b2", "B"), player("b3", "B"),
];
assert.deepEqual(evaluateContinueWithoutMissing({ players: threeVsThree, missingPlayerIds: ["a3"] }), { allowed: true });
assert.deepEqual(
    evaluateContinueWithoutMissing({ players: twoVsTwo.map((entry) => entry.playerId === "a2" ? { ...entry, online: false } : entry), missingPlayerIds: ["a2"] }),
    { allowed: false, reason: "team_below_minimum" }
);
assert.deepEqual(
    evaluateContinueWithoutMissing({ players: threeVsThree.map((entry) => entry.playerId === "b3" ? { ...entry, online: false } : entry), missingPlayerIds: ["a3", "b3"] }),
    { allowed: true },
    "one missing player per team of three still leaves two"
);
assert.deepEqual(
    evaluateContinueWithoutMissing({ players: [...threeVsThree, { playerId: "s1", team: "A", online: true, spectator: true }], missingPlayerIds: ["a3", "a2"] }),
    { allowed: false, reason: "team_below_minimum" },
    "spectators never count toward a team"
);
assert.deepEqual(evaluateContinueWithoutMissing({ players: threeVsThree, missingPlayerIds: [] }), { allowed: false, reason: "nothing_missing" });

// The trigger is the most critical missing role.
assert.equal(classifyConnectionPauseTrigger({ missingPlayerIds: ["a1", "b1"], narratorPlayerId: "a1", inspectorPlayerId: "b1" }), "narrator");
assert.equal(classifyConnectionPauseTrigger({ missingPlayerIds: ["b1"], narratorPlayerId: "a1", inspectorPlayerId: "b1" }), "inspector");
assert.equal(classifyConnectionPauseTrigger({ missingPlayerIds: ["a2"], narratorPlayerId: "a1", inspectorPlayerId: "b1" }), "team_below_minimum");
assert.equal(classifyConnectionPauseTrigger({ missingPlayerIds: ["a2"], narratorPlayerId: null, inspectorPlayerId: null }), "team_below_minimum");

console.log("room connection continuity checks passed");
