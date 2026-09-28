import assert from "node:assert/strict";
import {
    TABU_DEFAULT_SETTINGS,
    TABU_MODE_ID,
    createInitialTabuState,
    getGameMode,
    normalizeTabuRoomSettings,
    resolveTabuFinish,
    shouldFinishTabuAfterAction,
    shouldFinishTabuBeforeRound,
} from "@hushle/domain-game";

assert.equal(getGameMode(TABU_MODE_ID).id, "tabu");
assert.deepEqual(normalizeTabuRoomSettings({ sure: 10, mod: "tur", deger: 1 }), {
    sure: 30,
    mod: "tur",
    deger: 2,
    wordLocale: "tr",
});
assert.deepEqual(
    normalizeTabuRoomSettings({ sure: 999, mod: "skor", deger: 999 }),
    { sure: 120, mod: "skor", deger: 100, wordLocale: "tr" }
);
assert.equal(normalizeTabuRoomSettings({ wordLocale: "en" }).wordLocale, "en");
assert.equal(normalizeTabuRoomSettings({ wordLocale: "de" }).wordLocale, "tr");

const initialState = createInitialTabuState(TABU_DEFAULT_SETTINGS);
assert.equal(initialState.kalanZaman, 60);
assert.equal(initialState.kalanPasHakki, 3);
assert.equal(initialState.anlatacakTakim, "A");

assert.equal(
    shouldFinishTabuBeforeRound({
        settings: { sure: 60, mod: "tur", deger: 2, wordLocale: "tr" },
        currentRound: 3,
        speakingTeam: "A",
        goldenScoreActive: false,
    }),
    true
);
assert.equal(
    shouldFinishTabuAfterAction({
        settings: { sure: 60, mod: "skor", deger: 10, wordLocale: "tr" },
        score: { A: 10, B: 4 },
        actingTeam: "A",
        action: "dogru",
        goldenScoreActive: false,
    }),
    true
);
assert.deepEqual(
    resolveTabuFinish({
        settings: { sure: 60, mod: "tur", deger: 2, wordLocale: "tr" },
        score: { A: 3, B: 3 },
        goldenScoreActive: false,
    }),
    { kind: "golden-score" }
);
assert.deepEqual(
    resolveTabuFinish({
        settings: { sure: 60, mod: "skor", deger: 10, wordLocale: "tr" },
        score: { A: 10, B: 6 },
        goldenScoreActive: false,
    }),
    { kind: "finished", winner: "A" }
);

console.log("domain game smoke test passed");

// Either starting team must receive exactly the configured number of turns.
for (const startingTeam of ["A", "B"] as const) {
    for (const rounds of [2, 5, 30]) {
        const settings = {
            sure: 60,
            mod: "tur" as const,
            deger: rounds,
            wordLocale: "tr" as const,
        };
        for (let round = 1; round <= rounds; round++) {
            for (const speakingTeam of [startingTeam, startingTeam === "A" ? "B" : "A"] as const) {
                assert.equal(shouldFinishTabuBeforeRound({ settings, currentRound: round, speakingTeam, startingTeam, goldenScoreActive: false }), false);
            }
        }
        assert.equal(shouldFinishTabuBeforeRound({ settings, currentRound: rounds + 1, speakingTeam: startingTeam, startingTeam, goldenScoreActive: false }), true);
        assert.equal(shouldFinishTabuBeforeRound({ settings, currentRound: rounds + 1, speakingTeam: startingTeam, startingTeam, goldenScoreActive: true }), false);
    }
}
