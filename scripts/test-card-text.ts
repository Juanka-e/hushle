import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    CARD_TABOO_FIT,
    CARD_WORD_FIT,
    chooseCardTextFit,
    formatCardText,
    getCardTextLang,
    resolveCardContentLocale,
    type CardTextFitConfig,
    type CardTextFitStep,
} from "../apps/web/src/lib/game/card-text";

// ─── Locale-aware upper case ───────────────────────────────────

const turkish: Array<[string, string]> = [
    ["Kitap", "KİTAP"],
    ["Elektrik mühendisliği", "ELEKTRİK MÜHENDİSLİĞİ"],
    ["Bilgisayar programcısı", "BİLGİSAYAR PROGRAMCISI"],
    ["Gökkuşağı", "GÖKKUŞAĞI"],
    ["Kaliforniya", "KALİFORNİYA"],
    ["Bağımsızlık Günü", "BAĞIMSIZLIK GÜNÜ"],
    ["ılık", "ILIK"],
    ["İstanbul", "İSTANBUL"],
];
for (const [input, expected] of turkish) {
    assert.equal(formatCardText(input, "tr"), expected, input);
}

const english: Array<[string, string]> = [
    ["Electromagnetic", "ELECTROMAGNETIC"],
    ["Photosynthesis", "PHOTOSYNTHESIS"],
    ["Pizza", "PIZZA"],
    ["Independence Day", "INDEPENDENCE DAY"],
];
for (const [input, expected] of english) {
    assert.equal(formatCardText(input, "en"), expected, input);
}

// Unknown locale keeps the old locale-neutral behaviour.
assert.equal(formatCardText("Kitap", null), "KITAP");
assert.equal(formatCardText("", "tr"), "");

assert.equal(resolveCardContentLocale("en", "tr"), "en");
assert.equal(resolveCardContentLocale(undefined, "tr"), "tr");
assert.equal(resolveCardContentLocale("de", "en"), "en");
assert.equal(resolveCardContentLocale(null, null), null);
assert.equal(resolveCardContentLocale("TR", undefined), null);

assert.equal(getCardTextLang("tr"), "tr-TR");
assert.equal(getCardTextLang("en"), "en-US");
assert.equal(getCardTextLang(null), undefined);

// ─── Fit step selection ────────────────────────────────────────

const config: CardTextFitConfig = {
    steps: [
        { fontSize: 30, lineHeight: 34 },
        { fontSize: 24, lineHeight: 28 },
        { fontSize: 18, lineHeight: 22 },
    ],
    maxLines: 2,
};

function measureWith(
    table: Record<number, { overflowsX: boolean; lines: number }>
): (step: CardTextFitStep) => { overflowsX: boolean; lines: number } {
    return (step) => table[step.fontSize];
}

assert.deepEqual(
    chooseCardTextFit(
        config,
        measureWith({ 30: { overflowsX: false, lines: 1 }, 24: { overflowsX: false, lines: 1 }, 18: { overflowsX: false, lines: 1 } })
    ),
    { step: config.steps[0], breakInsideWords: false },
    "short text keeps the original size"
);

assert.deepEqual(
    chooseCardTextFit(
        config,
        measureWith({ 30: { overflowsX: false, lines: 2 }, 24: { overflowsX: false, lines: 1 }, 18: { overflowsX: false, lines: 1 } })
    ),
    { step: config.steps[0], breakInsideWords: false },
    "two words may wrap at a space without shrinking"
);

assert.deepEqual(
    chooseCardTextFit(
        config,
        measureWith({ 30: { overflowsX: true, lines: 1 }, 24: { overflowsX: false, lines: 1 }, 18: { overflowsX: false, lines: 1 } })
    ),
    { step: config.steps[1], breakInsideWords: false },
    "a long word shrinks one step"
);

assert.deepEqual(
    chooseCardTextFit(
        config,
        measureWith({ 30: { overflowsX: false, lines: 4 }, 24: { overflowsX: false, lines: 3 }, 18: { overflowsX: false, lines: 2 } })
    ),
    { step: config.steps[2], breakInsideWords: false },
    "too many lines shrinks to the floor"
);

assert.deepEqual(
    chooseCardTextFit(
        config,
        measureWith({ 30: { overflowsX: false, lines: 5 }, 24: { overflowsX: false, lines: 4 }, 18: { overflowsX: false, lines: 3 } })
    ),
    { step: config.steps[2], breakInsideWords: false },
    "at the floor more lines are allowed, still breaking at spaces"
);

assert.deepEqual(
    chooseCardTextFit(
        config,
        measureWith({ 30: { overflowsX: true, lines: 1 }, 24: { overflowsX: true, lines: 1 }, 18: { overflowsX: true, lines: 1 } })
    ),
    { step: config.steps[2], breakInsideWords: true },
    "only a word wider than the card at the floor breaks inside"
);

const measured: number[] = [];
chooseCardTextFit(config, (step) => {
    measured.push(step.fontSize);
    return { overflowsX: step.fontSize > 24, lines: 1 };
});
assert.deepEqual(measured, [30, 24], "stops at the first fitting step");

assert.throws(() => chooseCardTextFit({ steps: [], maxLines: 1 }, () => ({ overflowsX: false, lines: 1 })));

// ─── Shipped configs ───────────────────────────────────────────

for (const [name, fit, cssSize, cssLineHeight] of [
    ["word", CARD_WORD_FIT, 36, 40],
    ["taboo", CARD_TABOO_FIT, 20, 28],
] as const) {
    assert.equal(fit.steps[0].fontSize, cssSize, `${name} starts at its CSS size`);
    assert.equal(fit.steps[0].lineHeight, cssLineHeight, `${name} starts at its CSS line height`);
    for (let index = 1; index < fit.steps.length; index++) {
        assert.ok(fit.steps[index].fontSize < fit.steps[index - 1].fontSize, `${name} steps shrink`);
        assert.ok(fit.steps[index].lineHeight >= fit.steps[index].fontSize, `${name} line height`);
    }
}
assert.equal(CARD_WORD_FIT.steps.at(-1)?.fontSize, 18);
assert.equal(CARD_TABOO_FIT.steps.at(-1)?.fontSize, 14);

// ─── Card wiring contract ──────────────────────────────────────

const gameCard = readFileSync("apps/web/src/components/game/game-card.tsx", "utf8");
assert.match(gameCard, /formatCardText\(card\.word, textLocale\)/);
assert.match(gameCard, /formatCardText\(word, textLocale\)/);
assert.match(gameCard, /lang=\{textLang\}/);
assert.match(gameCard, /useCardTextFit\(wordRef, displayWord, CARD_WORD_FIT\)/);
assert.match(gameCard, /useCardTextFit\(textRef, text, CARD_TABOO_FIT\)/);
assert.doesNotMatch(
    gameCard,
    /className="[^"]*\buppercase\b[^"]*"/,
    "CSS uppercase follows the page lang; the card upper-cases by content locale"
);

const wordService = readFileSync("apps/web/src/lib/socket/word-service.ts", "utf8");
assert.match(wordService, /locale: filters\.locale,/, "cards carry their content locale");

console.log("card text tests passed");
