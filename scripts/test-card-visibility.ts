import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldPlayerSeeCard } from "../apps/web/src/lib/socket/card-visibility";

// Who may see the active card: the narrator, the inspector, and the opposing team. Never a
// spectator (İzleyici), whatever team value the row still carries.

const narrator = { playerId: "n", takim: "A" as const };
const inspector = { playerId: "g" };

const cases: Array<[string, Parameters<typeof shouldPlayerSeeCard>[0], boolean]> = [
    ["narrator", { playerId: "n", takim: "A", rol: "Anlatıcı" }, true],
    ["inspector", { playerId: "g", takim: "B", rol: "Gözetmen" }, true],
    ["opposing guesser", { playerId: "x", takim: "B", rol: "Tahminci" }, true],
    ["opposing player (generic role)", { playerId: "x", takim: "B", rol: "Oyuncu" }, true],
    ["same-team guesser", { playerId: "y", takim: "A", rol: "Tahminci" }, false],
    ["spectator without a team", { playerId: "s", takim: null, rol: "İzleyici" }, false],
    ["spectator who kept the opposing team", { playerId: "s2", takim: "B", rol: "İzleyici" }, false],
    ["player without a team", { playerId: "p", takim: null, rol: "Oyuncu" }, false],
];
for (const [name, player, expected] of cases) {
    assert.equal(shouldPlayerSeeCard(player, narrator, inspector), expected, name);
}
assert.equal(shouldPlayerSeeCard({ playerId: "x", takim: "B", rol: "Tahminci" }, narrator, null), true, "no inspector yet");

// The socket layer must use the one rule in both places that hand out cards.
const socketSource = readFileSync("apps/web/src/lib/socket/game-socket.ts", "utf8");
const fanOutStart = socketSource.indexOf("// Send card to opponent team");
assert.ok(fanOutStart >= 0, "card fan-out comment must exist");
const fanOut = socketSource.slice(fanOutStart, fanOutStart + 600);
assert.match(fanOut, /shouldPlayerSeeCard\(/, "kartGuncelle fan-out must go through shouldPlayerSeeCard");
assert.doesNotMatch(fanOut, /playerItem\.takim !== narrator\.takim/, "the old team-only comparison must be gone");
const turnInfoStart = socketSource.indexOf("function emitTurnInfoForPlayer");
const turnInfo = socketSource.slice(turnInfoStart, turnInfoStart + 1500);
assert.match(turnInfo, /shouldPlayerSeeCard\(/, "yeniTurBilgisi must use the same rule");

console.log("card visibility rule checks passed (9 cases + 2 call sites)");
