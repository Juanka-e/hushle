export const TABU_MODE_ID = "tabu" as const;
export const GAME_MODE_IDS = [TABU_MODE_ID] as const;

export type GameModeId = (typeof GAME_MODE_IDS)[number];
export type TeamId = "A" | "B";
export type MatchFormat = "tur" | "skor";
export type Score = Record<TeamId, number>;
export type MatchWinner = TeamId | "Berabere";
export type WordAction = "dogru" | "tabu" | "pas";

export const GAME_CONTENT_LOCALES = ["tr", "en"] as const;
export type GameContentLocale = (typeof GAME_CONTENT_LOCALES)[number];

export interface GameContentLocaleDefinition {
    code: GameContentLocale;
    nativeName: string;
    adminLabel: string;
    intlLocale: string;
}

export const GAME_CONTENT_LOCALE_DEFINITIONS: Readonly<
    Record<GameContentLocale, GameContentLocaleDefinition>
> = Object.freeze({
    tr: Object.freeze({
        code: "tr",
        nativeName: "Türkçe",
        adminLabel: "Türkçe paket",
        intlLocale: "tr-TR",
    }),
    en: Object.freeze({
        code: "en",
        nativeName: "English",
        adminLabel: "English pack",
        intlLocale: "en-US",
    }),
});

export const DEFAULT_GAME_CONTENT_LOCALE: GameContentLocale = "tr";

export function isGameContentLocale(value: unknown): value is GameContentLocale {
    return (
        typeof value === "string" &&
        GAME_CONTENT_LOCALES.includes(value as GameContentLocale)
    );
}

export function normalizeGameContentLocale(value: unknown): GameContentLocale {
    return isGameContentLocale(value) ? value : DEFAULT_GAME_CONTENT_LOCALE;
}

export function getGameContentLocaleDefinition(
    locale: GameContentLocale
): GameContentLocaleDefinition {
    return GAME_CONTENT_LOCALE_DEFINITIONS[locale];
}

export interface TabuRoomSettings {
    sure: number;
    mod: MatchFormat;
    deger: number;
    wordLocale: GameContentLocale;
}

export interface TabuInitialState {
    oyunAktifMi: false;
    oyunDurduruldu: false;
    gecisEkraninda: false;
    mevcutTur: 0;
    toplamTur: 0;
    kalanZaman: number;
    kalanPasHakki: number;
    skor: Score;
    anlatacakTakim: "A";
    takimA_anlaticiIndex: -1;
    takimB_anlaticiIndex: -1;
    altinSkorAktif: false;
    basladiAt: null;
    bittiAt: null;
}

export interface GameModeDefinition<TSettings, TInitialState> {
    id: GameModeId;
    displayName: string;
    defaultSettings: Readonly<TSettings>;
    normalizeSettings(input: unknown): TSettings;
    createInitialState(settings?: TSettings): TInitialState;
}

export type TabuFinishDecision =
    | { kind: "golden-score" }
    | { kind: "finished"; winner: MatchWinner };

export const TABU_DEFAULT_SETTINGS: Readonly<TabuRoomSettings> = Object.freeze({
    sure: 60,
    mod: "tur",
    deger: 2,
    wordLocale: DEFAULT_GAME_CONTENT_LOCALE,
});

export const TABU_PASS_LIMIT = 3;

function toInputRecord(input: unknown): Record<string, unknown> {
    return typeof input === "object" && input !== null
        ? (input as Record<string, unknown>)
        : {};
}

export function normalizeTabuRoomSettings(input: unknown): TabuRoomSettings {
    const value = toInputRecord(input);
    const sure = Math.min(
        120,
        Math.max(30, Number.parseInt(String(value.sure), 10) || 60)
    );
    const mod: MatchFormat = value.mod === "skor" ? "skor" : "tur";
    const rawValue = Number.parseInt(String(value.deger), 10);
    const deger =
        mod === "skor"
            ? Math.min(100, Math.max(10, rawValue || 10))
            : Math.min(30, Math.max(2, rawValue || 2));

    const wordLocale = normalizeGameContentLocale(value.wordLocale);

    return { sure, mod, deger, wordLocale };
}

export function createInitialTabuState(
    settings: TabuRoomSettings = TABU_DEFAULT_SETTINGS
): TabuInitialState {
    return {
        oyunAktifMi: false,
        oyunDurduruldu: false,
        gecisEkraninda: false,
        mevcutTur: 0,
        toplamTur: 0,
        kalanZaman: settings.sure,
        kalanPasHakki: TABU_PASS_LIMIT,
        skor: { A: 0, B: 0 },
        anlatacakTakim: "A",
        takimA_anlaticiIndex: -1,
        takimB_anlaticiIndex: -1,
        altinSkorAktif: false,
        basladiAt: null,
        bittiAt: null,
    };
}

export function shouldFinishTabuBeforeRound(input: {
    settings: TabuRoomSettings;
    currentRound: number;
    speakingTeam: TeamId;
    startingTeam?: TeamId;
    goldenScoreActive: boolean;
}): boolean {
    return (
        input.speakingTeam === (input.startingTeam ?? "A") &&
        !input.goldenScoreActive &&
        input.settings.mod === "tur" &&
        input.currentRound > input.settings.deger
    );
}

export function shouldFinishTabuAfterAction(input: {
    settings: TabuRoomSettings;
    score: Score;
    actingTeam: TeamId;
    action: WordAction;
    goldenScoreActive: boolean;
}): boolean {
    if (
        input.goldenScoreActive &&
        (input.action === "dogru" || input.action === "tabu")
    ) {
        return true;
    }

    return (
        input.settings.mod === "skor" &&
        input.score[input.actingTeam] >= input.settings.deger
    );
}

export function resolveTabuFinish(input: {
    settings: TabuRoomSettings;
    score: Score;
    goldenScoreActive: boolean;
}): TabuFinishDecision {
    if (
        input.settings.mod === "tur" &&
        !input.goldenScoreActive &&
        input.score.A === input.score.B
    ) {
        return { kind: "golden-score" };
    }

    return { kind: "finished", winner: resolveMatchWinner(input.score) };
}

export function resolveMatchWinner(score: Score): MatchWinner {
    if (score.A === score.B) return "Berabere";
    return score.A > score.B ? "A" : "B";
}

export const TABU_GAME_MODE: GameModeDefinition<
    TabuRoomSettings,
    TabuInitialState
> = Object.freeze({
    id: TABU_MODE_ID,
    displayName: "Tabu",
    defaultSettings: TABU_DEFAULT_SETTINGS,
    normalizeSettings: normalizeTabuRoomSettings,
    createInitialState: createInitialTabuState,
});

const GAME_MODE_REGISTRY: ReadonlyMap<GameModeId, typeof TABU_GAME_MODE> = new Map([
    [TABU_MODE_ID, TABU_GAME_MODE],
]);

export function getGameMode(modeId: GameModeId): typeof TABU_GAME_MODE {
    const mode = GAME_MODE_REGISTRY.get(modeId);
    if (!mode) {
        throw new Error(`Unknown game mode: ${modeId}`);
    }
    return mode;
}

export function isGameModeId(value: unknown): value is GameModeId {
    return typeof value === "string" && GAME_MODE_IDS.includes(value as GameModeId);
}
