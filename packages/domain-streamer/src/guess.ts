import type { GuessTolerance } from "./types";

const TURKISH_FOLDING: Record<string, string> = {
    "ı": "i",
    "ş": "s",
    "ğ": "g",
    "ç": "c",
    "ö": "o",
    "ü": "u",
};

/**
 * NFC, Turkish lower-casing, drop everything that is not a letter, digit or whitespace,
 * collapse whitespace. "normal" additionally folds the Turkish letters to ASCII.
 */
export function normalizeGuess(text: string, tolerance: GuessTolerance): string {
    let normalized = text
        .normalize("NFC")
        .toLocaleLowerCase("tr")
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
    if (tolerance === "normal") {
        normalized = normalized.replace(/[ışğçöü]/g, (char) => TURKISH_FOLDING[char] ?? char);
    }
    return normalized;
}

export function guessMatches(text: string, target: string, tolerance: GuessTolerance): boolean {
    return normalizeGuess(text, tolerance) === normalizeGuess(target, tolerance);
}
