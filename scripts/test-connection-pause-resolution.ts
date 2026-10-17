import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    CONNECTION_PAUSE_RESOLVE_ACTIONS,
    CONNECTION_PAUSE_RESOLVE_EVENT,
} from "../apps/web/src/lib/socket/connection-pause-contract";

const source = readFileSync("apps/web/src/lib/socket/game-socket.ts", "utf8").replace(/\r\n/g, "\n");

function body(name: string, nextMarker: string): string {
    const start = source.indexOf(name);
    assert.ok(start >= 0, `${name} not found`);
    const end = source.indexOf(nextMarker, start + name.length);
    assert.ok(end > start, `${nextMarker} not found after ${name}`);
    return source.slice(start, end);
}

assert.equal(CONNECTION_PAUSE_RESOLVE_EVENT, "connection_pause:resolve");
assert.deepEqual([...CONNECTION_PAUSE_RESOLVE_ACTIONS], ["continue_without_missing", "end_match"]);

// Handler: strict payload, burst limit, room lock, permission, fresh missing list, grace, feasibility.
const handler = body("socket.on(CONNECTION_PAUSE_RESOLVE_EVENT", "// ── Word Action ──");
assert.match(handler, /z\s*\.object\(\{ action: z\.enum\(CONNECTION_PAUSE_RESOLVE_ACTIONS\) \}\)\s*\.strict\(\)/);
assert.match(handler, /consumeSocketActionBurstLimit\(socket\.id, "connection-pause-resolve"\)/);
assert.match(handler, /runWithRoomActionLock\(room\.odaKodu, "connection-pause-resolve"/);
const order = [
    "canResolveConnectionPause(room, actor)",
    "pause.missingPlayerIds = getConnectionContinuity(room).missingPlayerIds;",
    "getConnectionPauseResolutionWindow(",
    'parsed.data.action === "end_match"',
    "evaluateContinueWithoutMissing(",
    "continueWithoutMissing(room, pause.missingPlayerIds);",
].map((marker) => {
    const index = handler.indexOf(marker);
    assert.ok(index >= 0, `missing ${marker}`);
    return index;
});
assert.deepEqual([...order].sort((a, b) => a - b), order, "checks must run in the documented order");
assert.match(handler, /graceMs: CONNECTION_PAUSE_GRACE_MS/);

// Permission: host, or an online active participant while the host is offline.
const permission = body("function canResolveConnectionPause(", "function endMatchByHost(");
assert.match(permission, /if \(!actor\.online\) return false;/);
assert.match(permission, /actor\.playerId === room\.creatorPlayerId\) return true;/);
assert.match(permission, /if \(host\?\.online\) return false;/);
assert.match(permission, /actor\.rol !== "İzleyici"/);
assert.match(permission, /departedPlayerIds/);
assert.match(permission, /matchParticipants\.some/);

// Ending early: host_ended result, pause closed, no word stats, settlement enqueued.
const endMatch = body("function endMatchByHost(", "function restartTransitionForSpeakingTeam(");
assert.match(endMatch, /clearConnectionPause\(room, "ended_by_host"\)/);
assert.match(endMatch, /setRoomPaused\(room, false\)/);
assert.match(endMatch, /room\.activeWordAnalytics = null;/);
assert.match(endMatch, /room\.matchEndReason = "host_ended";/);
assert.match(endMatch, /endReason: "host_ended"/);
assert.match(endMatch, /kazananTakim: resolveMatchWinner\(room\.oyunDurumu\.skor\)/);
assert.match(endMatch, /enqueueMatchSettlement\(settlementRoom, "host_ended"\)/);

// Continuing: departed players become spectators; narrator/inspector handling per phase.
const continueBody = body("function continueWithoutMissing(", "function buildPublicGameState(");
assert.match(continueBody, /player\.rol = "İzleyici";\s*player\.takim = null;/);
assert.match(continueBody, /clearConnectionPause\(room, "continued_without_missing"\)/);
assert.match(continueBody, /broadcastLobby\(room\)/);
assert.match(continueBody, /if \(room\.oyunDurumu\.gecisEkraninda\) \{[\s\S]*restartTransitionForSpeakingTeam\(room\)/);
assert.match(continueBody, /consumeActiveWordAnalytics\(room, "timeout"\);\s*void startNewRound\(room\.odaKodu\);/);
assert.match(continueBody, /if \(inspectorLeft\) replaceMissingInspector\(room\);\s*startTimer\(room\.odaKodu\);/);

const restart = body("function restartTransitionForSpeakingTeam(", "function replaceMissingInspector(");
assert.match(restart, /room\.oyunDurumu\.mevcutTur -= 1;/);
// The transition timeout path for an offline narrator uses the same round-safe restart.
assert.match(source, /startTurn\(roomCode, currentRoom, narrator, inspector, narratorCardThemes\);\s*\} else \{\s*restartTransitionForSpeakingTeam\(currentRoom\);/);

// Continuity ignores departed participants.
const continuityPlayers = body("function getContinuityPlayers(", "function getCriticalRolePlayerIds(");
assert.match(continuityPlayers, /spectator: departed\.has\(participant\.playerId\)/);

// Public summary carries the new contract fields.
const publicPause = body("function getPublicConnectionPause(", "function setRoomPaused(");
for (const field of ["missingPlayers", "resolutionAvailableInSeconds", "canContinueWithoutMissing", "waitingForPlayers"]) {
    assert.match(publicPause, new RegExp(`${field}:`));
}

// Telemetry: start once per pause; every resolution path records its outcome.
const sync = body("function synchronizeConnectionPause(", "function scheduleConnectionPauseGraceUpdate(");
assert.match(sync, /if \(isNewPause\) \{\s*void recordConnectionPauseStarted\(/);
assert.match(sync, /scheduleConnectionPauseGraceUpdate\(room\);/);
// A disconnect after everyone returned (pause not yet resumed) is a new episode: fresh grace,
// a new start event, and the healed episode is closed as resumed_after_reconnect.
assert.match(sync, /const isNewPause = !previous \|\| \(previous\.missingPlayerIds\.length === 0 && missing\.length > 0\);/);
assert.match(sync, /startedAt: isNewPause \? now : previous!\.startedAt,/);
assert.match(sync, /if \(previous && isNewPause\) \{\s*void recordConnectionPauseResolved\(\{[\s\S]*?outcome: "resumed_after_reconnect"/);
assert.match(source, /const endedAt = outcome === "resumed_after_reconnect" \? pause\.recoveredAt \?\? now : now;/);
assert.match(handler, /if \(getRoom\(room\.odaKodu\) !== room\) return;/);
assert.match(source, /clearConnectionPause\(room, "resumed_after_reconnect"\)/);
assert.match(source, /if \(room\.connectionPause\) clearConnectionPause\(room, "reset_by_host"\);\s*resetGame\(room, settings\.capacity\);/);
assert.match(body("function destroyRoom(", "function syncRegisteredUserRoomIndex("), /clearConnectionPause\(abandonedRoom, "abandoned"\)/);
assert.doesNotMatch(source, /room\.connectionPause = null;\n(?![\s\S]{0,40}outcome)/, "pauses are cleared only through clearConnectionPause");

// Lifecycle resets.
assert.match(source, /matchEndReason: null,\s*departedPlayerIds: \[\],/);
assert.equal((source.match(/room\.departedPlayerIds = \[\];/g) ?? []).length, 2, "start and reset clear departed players");
assert.match(source, /endReason: "completed",/);

// Grace is configurable within bounds for operators and tests.
assert.match(source, /configuredConnectionPauseGraceSeconds >= 5 &&\s*configuredConnectionPauseGraceSeconds <= 600/);

console.log("connection pause resolution contract checks passed");
