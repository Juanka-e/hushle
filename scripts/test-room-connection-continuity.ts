import assert from "node:assert/strict";
import {
    calculateActiveMatchDurationSeconds,
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

console.log("room connection continuity checks passed");
