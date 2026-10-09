export interface RoomGameStartState {
    gameStartInProgress: boolean;
    oyunDurumu: {
        oyunAktifMi: boolean;
    };
}

export function beginRoomGameStart(room: RoomGameStartState): boolean {
    if (room.gameStartInProgress || room.oyunDurumu.oyunAktifMi) {
        return false;
    }

    room.gameStartInProgress = true;
    return true;
}

export function finishRoomGameStart(room: RoomGameStartState): void {
    room.gameStartInProgress = false;
}

export function canMutateRoomLobby(room: RoomGameStartState): boolean {
    return !room.gameStartInProgress && !room.oyunDurumu.oyunAktifMi;
}

export function shouldJoinRoomAsSpectator(room: RoomGameStartState): boolean {
    return room.gameStartInProgress || room.oyunDurumu.oyunAktifMi;
}
