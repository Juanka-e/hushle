import type { GameState } from "@/types/game";

export const ROOM_ROLE_PLAYER = "Oyuncu";
export const ROOM_ROLE_SPECTATOR = "\u0130zleyici";
export const ROOM_ROLE_NARRATOR = "Anlat\u0131c\u0131";
export const ROOM_ROLE_INSPECTOR = "G\u00f6zetmen";
export const ROOM_ROLE_GUESSER = "Tahminci";

export const TEAM_A_LABEL = "Tak\u0131m A";
export const TEAM_B_LABEL = "Tak\u0131m B";

export function isCardViewerRole(role: string): boolean {
    return role === ROOM_ROLE_NARRATOR || role === ROOM_ROLE_INSPECTOR;
}

export function shouldShowGuessPanel(role: string): boolean {
    return role === ROOM_ROLE_GUESSER || role === ROOM_ROLE_SPECTATOR;
}

export function canUseTabuAction(role: string, isPrimaryInspector: boolean): boolean {
    return role === ROOM_ROLE_NARRATOR || (role === ROOM_ROLE_INSPECTOR && isPrimaryInspector);
}

export function getActiveNarratorTeam(gameState: GameState | null): "A" | "B" {
    if (gameState?.anlatici?.takim === "A" || gameState?.anlatici?.takim === "B") {
        return gameState.anlatici.takim;
    }

    if (gameState?.anlatacakTakim === "A" || gameState?.anlatacakTakim === "B") {
        return gameState.anlatacakTakim === "A" ? "B" : "A";
    }

    return "A";
}
