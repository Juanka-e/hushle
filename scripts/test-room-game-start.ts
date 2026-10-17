import assert from "node:assert/strict";
import {
    beginRoomGameStart,
    canMutateRoomLobby,
    finishRoomGameStart,
    shouldJoinRoomAsSpectator,
} from "../apps/web/src/lib/socket/room-game-start";

function createRoom() {
    return {
        gameStartInProgress: false,
        oyunDurumu: { oyunAktifMi: false },
    };
}

const room = createRoom();
assert.equal(canMutateRoomLobby(room), true);
assert.equal(shouldJoinRoomAsSpectator(room), false);
assert.equal(beginRoomGameStart(room), true);
assert.equal(beginRoomGameStart(room), false, "duplicate start must be rejected");
assert.equal(canMutateRoomLobby(room), false, "lobby mutations must stop synchronously");
assert.equal(shouldJoinRoomAsSpectator(room), true, "joins during start must be spectators");

finishRoomGameStart(room);
assert.equal(canMutateRoomLobby(room), true, "failed starts must release the transition");

room.oyunDurumu.oyunAktifMi = true;
assert.equal(beginRoomGameStart(room), false);
assert.equal(canMutateRoomLobby(room), false);
assert.equal(shouldJoinRoomAsSpectator(room), true);

console.log("room game-start transition checks passed");
