// ─── Game State Enums ──────────────────────────────────────────

import type { ResolvedCardBackTheme } from "@/lib/cosmetics/card-back";
import type { ResolvedCardFaceTheme } from "@/lib/cosmetics/card-face";
import type { GameContentLocale } from "@hushle/domain-game";

export enum GameView {
    LOGIN = "LOGIN",
    LOBBY = "LOBBY",
    TRANSITION = "TRANSITION",
    PLAYING = "PLAYING",
    PAUSED = "PAUSED",
    ROUND_END = "ROUND_END",
    GAME_OVER = "GAME_OVER",
}

export interface PlayerCosmetics {
    avatarImageUrl: string | null;
    frameImageUrl: string | null;
    frameAccentColor: string | null;
    frameSecondaryColor?: string | null;
    framePattern?: "none" | "grid" | "dots" | "diagonal" | "chevrons" | "rings" | "noise" | null;
    framePatternOpacity?: number | null;
    framePatternScale?: number | null;
    frameGlowColor?: string | null;
    frameGlowBlur?: number | null;
    frameGlowOpacity?: number | null;
    frameStyle?: "solid" | "double" | "ornate" | null;
    frameThickness?: number | null;
    frameRadius?: number | null;
    frameMotionPreset?: "none" | "pulse" | "drift" | "shimmer" | null;
    frameMotionSpeedMs?: number | null;
}

// ─── Player & Room ─────────────────────────────────────────────

export interface Player {
    playerId: string;
    ad: string;
    takim: "A" | "B" | null;
    online: boolean;
    rol: "Oyuncu" | "İzleyici" | "Anlatıcı" | "Gözetmen" | "Tahminci";
    cosmetics?: PlayerCosmetics;
}

export interface RoomStartReadiness {
    ready: boolean;
    activePlayers: number;
    minimumPlayers: number;
    teamAPlayers: number;
    teamBPlayers: number;
}

export interface RoomSettings {
    sure: number;
    mod: "tur" | "skor";
    deger: number;
    wordLocale: GameContentLocale;
}

export interface RoomData {
    odaKodu: string;
    creatorPlayerId: string;
    oyuncular: Player[];
    ayarlar: RoomSettings;
    seciliKategoriler: number[];
    seciliZorluklar: number[];
    startReadiness?: RoomStartReadiness;
    banList?: {
        playerIds: Set<string>;
        ips: Set<string>;
    };
}

export interface PendingAdminHandoffState {
    roomCode: string;
    adminPlayerId: string;
    deadlineAt: number;
}

// ─── Card ──────────────────────────────────────────────────────

export type Difficulty = 1 | 2 | 3;
export type DifficultyLabel = "easy" | "medium" | "hard";

export interface CardData {
    id: number;
    word: string;
    difficulty: Difficulty;
    categoryColor: string | null;
    taboo: string[];
}

// ─── Game State (from server) ──────────────────────────────────

export interface GameState {
    oyunAktifMi: boolean;
    oyunDurduruldu: boolean;
    gecisEkraninda: boolean;
    mevcutTur: number;
    toplamTur: number;
    kalanZaman: number;
    kalanPasHakki: number;
    skor: { A: number; B: number };
    anlatacakTakim: "A" | "B";
    anlatici: {
        ad: string;
        takim: "A" | "B";
    } | null;
    gozetmen: {
        ad: string;
        takim: "A" | "B";
    } | null;
    altinSkorAktif: boolean;
    toplamSure?: number;
}

// ─── Socket Events ─────────────────────────────────────────────

export interface TransitionData {
    anlatici: { ad: string; takim: string };
    gozetmen: { ad: string; takim: string } | null;
    kalanSure: number;
    oyunDurduruldu: boolean;
    ilkGecis: boolean;
    cardBackTheme: ResolvedCardBackTheme | null;
}

export interface TurnInfo {
    rol: string;
    isPrimaryGozetmen: boolean;
    kart: CardData | null;
    anlaticiAd: string;
    gozetmenAd: string;
    cardFaceTheme: ResolvedCardFaceTheme | null;
    cardBackTheme: ResolvedCardBackTheme | null;
}

export interface GameOverData {
    kazananTakim: "A" | "B" | "Berabere";
    skor: { A: number; B: number };
}

// ─── Category (from DB) ────────────────────────────────────────

export interface CategoryItem {
    id: number;
    name: string;
    color: string | null;
    parent_id: number | null;
    parentId?: number | null;
    is_visible: boolean;
    isVisible?: boolean;
    sortOrder?: number;
    children?: CategoryItem[];
}
