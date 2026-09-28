import { resolveCardBackTheme, type CardBackThemeSource, type ResolvedCardBackTheme } from "@/lib/cosmetics/card-back";
import { resolveCardFaceTheme, type CardFaceThemeSource, type ResolvedCardFaceTheme } from "@/lib/cosmetics/card-face";

export interface RoomCardCosmeticsSnapshot {
    cardFace: CardFaceThemeSource | null;
    cardBack: CardBackThemeSource | null;
}

export interface RoomCardThemePayload {
    cardFaceTheme: ResolvedCardFaceTheme | null;
    cardBackTheme: ResolvedCardBackTheme | null;
}

export function createEmptyRoomCardThemes(): RoomCardThemePayload {
    return {
        cardFaceTheme: null,
        cardBackTheme: null,
    };
}

export function resolveRoomCardThemes(
    snapshot: RoomCardCosmeticsSnapshot | null | undefined
): RoomCardThemePayload {
    if (!snapshot) {
        return createEmptyRoomCardThemes();
    }

    return {
        cardFaceTheme: snapshot.cardFace ? resolveCardFaceTheme(snapshot.cardFace) : null,
        cardBackTheme: snapshot.cardBack ? resolveCardBackTheme(snapshot.cardBack) : null,
    };
}
