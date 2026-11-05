// The one rule for who may receive the active card. Both the per-player turn info
// (`yeniTurBilgisi`) and the mid-turn card fan-out (`kartGuncelle`) go through it, so a
// spectator can never be handed the word just because their team value happens to differ.

export interface CardViewerLike {
    playerId: string;
    takim: "A" | "B" | null;
    rol: string;
}

export interface CardNarratorLike {
    playerId: string;
    takim: "A" | "B" | null;
}

export function shouldPlayerSeeCard(
    player: CardViewerLike,
    narrator: CardNarratorLike,
    inspector: { playerId: string } | null
): boolean {
    if (player.rol === "İzleyici") return false;
    if (player.playerId === narrator.playerId) return true;
    if (inspector && player.playerId === inspector.playerId) return true;
    return player.takim !== null && narrator.takim !== null && player.takim !== narrator.takim;
}
