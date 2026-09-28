import assert from "node:assert/strict";
import {
    canUseTabuAction,
    getActiveNarratorTeam,
    isCardViewerRole,
    ROOM_ROLE_GUESSER,
    ROOM_ROLE_INSPECTOR,
    ROOM_ROLE_NARRATOR,
    ROOM_ROLE_SPECTATOR,
    shouldShowGuessPanel,
} from "../apps/web/src/lib/game/room-display";

assert.equal(isCardViewerRole(ROOM_ROLE_NARRATOR), true);
assert.equal(isCardViewerRole(ROOM_ROLE_INSPECTOR), true);
assert.equal(isCardViewerRole(ROOM_ROLE_GUESSER), false);

assert.equal(shouldShowGuessPanel(ROOM_ROLE_GUESSER), true);
assert.equal(shouldShowGuessPanel(ROOM_ROLE_SPECTATOR), true);
assert.equal(shouldShowGuessPanel(ROOM_ROLE_NARRATOR), false);

assert.equal(canUseTabuAction(ROOM_ROLE_NARRATOR, false), true);
assert.equal(canUseTabuAction(ROOM_ROLE_INSPECTOR, true), true);
assert.equal(canUseTabuAction(ROOM_ROLE_INSPECTOR, false), false);
assert.equal(canUseTabuAction(ROOM_ROLE_GUESSER, false), false);

assert.equal(
    getActiveNarratorTeam({
        oyunAktifMi: true,
        oyunDurduruldu: false,
        gecisEkraninda: false,
        mevcutTur: 1,
        toplamTur: 3,
        kalanZaman: 40,
        kalanPasHakki: 2,
        skor: { A: 0, B: 0 },
        anlatacakTakim: "B",
        anlatici: {
            ad: "Erdal",
            takim: "A",
        },
        gozetmen: null,
        altinSkorAktif: false,
    }),
    "A"
);

assert.equal(
    getActiveNarratorTeam({
        oyunAktifMi: true,
        oyunDurduruldu: false,
        gecisEkraninda: false,
        mevcutTur: 1,
        toplamTur: 3,
        kalanZaman: 40,
        kalanPasHakki: 2,
        skor: { A: 0, B: 0 },
        anlatacakTakim: "A",
        anlatici: null,
        gozetmen: null,
        altinSkorAktif: false,
    }),
    "B"
);

console.log("room-display smoke test passed");
