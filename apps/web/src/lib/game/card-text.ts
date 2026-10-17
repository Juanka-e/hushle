import {
    getGameContentLocaleDefinition,
    isGameContentLocale,
    type GameContentLocale,
} from "@hushle/domain-game";

// ─── Content locale ────────────────────────────────────────────

/**
 * The language of the word pack, not of the UI. Cards from the server carry
 * it; the room setting is the fallback for older payloads.
 */
export function resolveCardContentLocale(
    cardLocale: unknown,
    fallbackLocale?: unknown
): GameContentLocale | null {
    if (isGameContentLocale(cardLocale)) {
        return cardLocale;
    }
    if (isGameContentLocale(fallbackLocale)) {
        return fallbackLocale;
    }
    return null;
}

/** BCP 47 tag for the `lang` attribute of word content. */
export function getCardTextLang(locale: GameContentLocale | null): string | undefined {
    return locale ? getGameContentLocaleDefinition(locale).intlLocale : undefined;
}

/**
 * Upper-cases card text with the rules of its content locale, so a Turkish
 * word keeps "i" -> "İ" and "ı" -> "I" even when the UI is English.
 */
export function formatCardText(text: string, locale: GameContentLocale | null): string {
    if (!locale) {
        return text.toUpperCase();
    }
    return text.toLocaleUpperCase(getGameContentLocaleDefinition(locale).intlLocale);
}

// ─── Fit to width ──────────────────────────────────────────────

export interface CardTextFitStep {
    fontSize: number;
    lineHeight: number;
}

export interface CardTextFitConfig {
    /** Largest first; the first step must match the element's CSS size. */
    steps: readonly CardTextFitStep[];
    /** Lines allowed before shrinking further (wrapping at spaces only). */
    maxLines: number;
}

export interface CardTextMeasurement {
    overflowsX: boolean;
    lines: number;
}

export interface CardTextFit {
    step: CardTextFitStep;
    breakInsideWords: boolean;
}

// Target word: text-4xl (36px / 40px) down to an 18px floor, at most two lines.
export const CARD_WORD_FIT: CardTextFitConfig = {
    steps: [
        { fontSize: 36, lineHeight: 40 },
        { fontSize: 32, lineHeight: 36 },
        { fontSize: 28, lineHeight: 32 },
        { fontSize: 25, lineHeight: 28 },
        { fontSize: 22, lineHeight: 25 },
        { fontSize: 20, lineHeight: 23 },
        { fontSize: 18, lineHeight: 21 },
    ],
    maxLines: 2,
};

// Taboo words: text-xl (20px / 28px) down to a 14px floor, one line.
export const CARD_TABOO_FIT: CardTextFitConfig = {
    steps: [
        { fontSize: 20, lineHeight: 28 },
        { fontSize: 18, lineHeight: 25 },
        { fontSize: 16, lineHeight: 22 },
        { fontSize: 14, lineHeight: 20 },
    ],
    maxLines: 1,
};

/**
 * Picks the largest step where the text fits the width within `maxLines`
 * (wrapping only at spaces). At the floor it may wrap onto more lines, and
 * only if a single word is still too wide does it break inside words.
 */
export function chooseCardTextFit(
    config: CardTextFitConfig,
    measure: (step: CardTextFitStep) => CardTextMeasurement
): CardTextFit {
    if (config.steps.length === 0) {
        throw new Error("Card text fit needs at least one step.");
    }

    let floorMeasurement: CardTextMeasurement | null = null;
    for (const step of config.steps) {
        const measurement = measure(step);
        if (!measurement.overflowsX && measurement.lines <= config.maxLines) {
            return { step, breakInsideWords: false };
        }
        floorMeasurement = measurement;
    }

    const floor = config.steps[config.steps.length - 1];
    return {
        step: floor,
        breakInsideWords: floorMeasurement?.overflowsX ?? true,
    };
}
