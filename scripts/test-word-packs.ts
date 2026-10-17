import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
    getGameContentLocaleDefinition,
    isGameContentLocale,
    type GameContentLocale,
} from "@hushle/domain-game";
import {
    MAX_BULK_WORD_UPLOAD_FILE_BYTES,
    MAX_BULK_WORD_UPLOAD_ROWS,
    MAX_WORD_FIELD_LENGTH,
    normalizeLabel,
    parseBulkWordUploadRow,
    splitBulkWordUploadLines,
} from "../apps/web/src/lib/admin-words-bulk-upload/parser";

// Validates the curated word packs in content/word-packs. Every CSV is parsed
// with the same parser the admin bulk upload route uses (csv_categories mode).

const PACK_DIR = path.join("content", "word-packs");
const README_PATH = path.join(PACK_DIR, "README.md");
const PACK_FILE_PATTERN = /^([a-z]{2})-[a-z0-9]+(?:-[a-z0-9]+)*-v\d+\.csv$/;
const PACK_HEADERS: Record<GameContentLocale, string> = {
    tr: "kelime,zorluk,kategori,alt_kategori,yasak1,yasak2,yasak3,yasak4,yasak5",
    en: "word,difficulty,category,subcategory,taboo1,taboo2,taboo3,taboo4,taboo5",
};
const TABOO_WORDS_PER_CARD = 5;
const MIN_CARDS_PER_LOCALE: Record<GameContentLocale, number> = { tr: 500, en: 400 };
const MIN_CATEGORIES_PER_LOCALE = 8;
const MAX_CATEGORIES_PER_LOCALE = 12;
const MIN_CARDS_PER_CATEGORY = 30;
// 1 = easy, 2 = medium, 3 = hard (GameCard: Kolay / Orta / Zor).
const DIFFICULTY_TARGETS: Record<1 | 2 | 3, number> = { 1: 0.4, 2: 0.4, 3: 0.2 };
const LOCALE_DIFFICULTY_TOLERANCE = 0.05;
const CATEGORY_DIFFICULTY_TOLERANCE = 0.1;
const MAX_WORDS_PER_FIELD = 3;
const MAX_FIELD_CHARACTERS = 30;

// GameCard on a phone is 320px wide with a 4px border. The target word uses
// text-4xl font-black tracking-wider inside px-6; a long word may spill into
// that padding but the card clips at 312px, so keep 8px clear on each side.
// Taboo rows use text-xl font-semibold tracking-tight inside px-8, after an
// 18px icon and a 12px gap, which leaves 218px before a word overflows.
const TARGET_WORD_MAX_WIDTH_PX = 296;
const TABOO_WORD_MAX_WIDTH_PX = 218;
// Uppercase glyph advances in Inter (the app font), letter spacing included,
// measured in Chromium: [target 900 weight 36px, taboo 600 weight 20px].
// Summing advances ignores kerning, so estimates run slightly wide.
const GLYPH_WIDTHS: Record<string, readonly [number, number]> = {
    A: [30.9, 14.3], B: [25.8, 12.7], C: [28.7, 14.2], "Ç": [28.7, 14.2],
    D: [27.8, 13.9], E: [23.9, 11.6], F: [22.8, 11.3], G: [29, 14.5],
    "Ğ": [31.8, 15.1], H: [28.8, 14.4], I: [12.3, 5], "İ": [15.8, 5.1],
    J: [23.2, 11.1], K: [29.1, 13.6], L: [22.2, 10.8], M: [36.2, 17.9],
    N: [29.5, 14.7], O: [29.7, 14.9], "Ö": [29.7, 14.9], P: [25.4, 12.4],
    Q: [30.1, 15], R: [25.8, 12.5], S: [25.8, 12.5], "Ş": [27.8, 12.8],
    T: [26.5, 12.7], U: [27.8, 14.2], "Ü": [27.8, 14.2], V: [30.9, 14.3],
    W: [41.4, 20.3], X: [30.1, 13.9], Y: [29.7, 13.8], Z: [26.8, 12.5],
    "Â": [30.9, 14.3], "Î": [15.8, 5.1], "Û": [27.8, 14.2], "-": [18.9, 8.8],
    "'": [15.2, 6],
};
const WIDEST_GLYPH: readonly [number, number] = [41.4, 20.3];

const FIELD_PATTERNS: Record<GameContentLocale, RegExp> = {
    tr: /^[A-Za-zÇçĞğİıÖöŞşÜüÂâÎîÛû]+(?:[ '-][A-Za-zÇçĞğİıÖöŞşÜüÂâÎîÛû]+)*$/,
    en: /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/,
};
const MOJIBAKE_PATTERN = /\u00c3|\u00c4|\u00c5|\u00e2\u20ac|\u00ef\u00b8|\ufffd/;

// Turkish written without its letters, wrong dotted/dotless I, and common
// misspellings (TDK). Compared against Turkish lowercase words.
const SUSPICIOUS_TURKISH_WORDS = new Set([
    "agac", "agiz", "aksam", "ates", "ayakkabi", "bicak", "buyuk", "buzdolabi",
    "carsi", "catal", "cay", "cicek", "cocuk", "corba", "dis", "dunya",
    "firin", "gozluk", "goz", "gunes", "guzel", "isik", "kahvalti", "kasik",
    "kis", "kitapci", "kopek", "kopru", "kucuk", "kus", "muzik", "ogle",
    "ogrenci", "ogretmen", "ozel", "ruzgar", "sarki", "sehir", "sicak",
    "soguk", "sut", "ucak", "ulke", "yagmur", "yesil", "yildiz",
    "ıçli", "ığne", "ılkbahar", "ıncir", "ınek", "ıngiltere", "ınternet",
    "ıskambil", "ıspanya", "ıstanbul", "ısviçre", "ıtalya", "ıtfaiye", "ızmir",
    "işık", "ilık", "islak", "ispanak", "ihlamur", "irmak",
    "ahçı", "ambülans", "antranör", "antreman", "büskivi", "döküman", "egsoz",
    "eşortman", "herkez", "klavuz", "laboratuar", "makina", "orjinal",
    "pantalon", "sandoviç", "süpriz", "şarz", "şöför", "traş", "yalnış", "yanlız",
]);

// Suffixes that turn a very short root into a related word (su/suyu, ev/evler).
const SHORT_ROOT_SUFFIX = /^(?:y?[aeıiuü]|l[ae]r|l[ıiuü]k?|[cçsş][ıiuü]z?|[dt][ae]n?|n[ıiuü]n|y[ıiuü]n|[ıiuü]n|s|es|ed|ing|er|y)/;
// Suffix chains that make one target a near duplicate of another
// (kitap/kitapçılar, tenis/masa tenisi, farm/farmer). The whole remainder must
// be suffixes, and the dative is left out, so bal/balık or dev/deve pass.
const NEAR_DUPLICATE_SUFFIXES: Record<GameContentLocale, RegExp> = {
    tr: /^(?:[cç][ıiuü]|l[ıiuü]k|l[ıiuü]|s[ıiuü]z|l[ae]r|s[ıiuü]|y[ıiuü]|n[ıiuü]n|[ıiuü]n|[ıiuü])+$/,
    en: /^(?:s|es|er|ers|ing|ed|y|ies|ist|ian)$/,
};
// Turkish consonant softening before a vowel suffix: kitap/kitabı, ağaç/ağacı.
const SOFTENED_CONSONANTS: Record<string, readonly string[]> = {
    p: ["b"], "ç": ["c"], t: ["d"], k: ["ğ", "g"],
};
const VOWEL_CLASS = "aeıioöuü";
const VOWEL_DROP_PATTERN = new RegExp(`^(.*[^${VOWEL_CLASS}])([${VOWEL_CLASS}])([^${VOWEL_CLASS}])$`);

type Difficulty = 1 | 2 | 3;

interface PackCard {
    file: string;
    rowNumber: number;
    locale: GameContentLocale;
    target: string;
    difficulty: Difficulty;
    category: string;
    taboo: string[];
}

function intlLocale(locale: GameContentLocale): string {
    return getGameContentLocaleDefinition(locale).intlLocale;
}

// Mirrors utf8mb4_unicode_ci closely enough for duplicate checks: case and
// accent insensitive. Dotless i is folded too, which is stricter than MySQL.
function collationKey(value: string, locale: GameContentLocale): string {
    return value
        .trim()
        .toLocaleLowerCase(intlLocale(locale))
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ı/g, "i")
        .replace(/\s+/g, " ");
}

// Lowercase words with the locale's casing rules; letters keep their accents.
function wordsOf(value: string, locale: GameContentLocale, minLength = 2): string[] {
    return value
        .trim()
        .toLocaleLowerCase(intlLocale(locale))
        .split(/[\s'-]+/)
        .filter((word) => word.length >= minLength);
}

function stemVariants(word: string): string[] {
    const softened = SOFTENED_CONSONANTS[word.at(-1) ?? ""] ?? [];
    return [word, ...softened.map((letter) => `${word.slice(0, -1)}${letter}`)];
}

// True when two lowercase words share a root closely enough that one would
// give the other away: containment, a shared 4-letter stem, consonant
// softening (kitap/kitabı), vowel drop (ağız/ağzı), a short root plus a suffix
// (su/suyu) or English e/y endings (bake/baking, fly/flies). Deliberately strict.
function areRelatedWords(first: string, second: string): boolean {
    if (first === second) return true;
    const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
    if (shorter.length >= 3 && longer.includes(shorter)) return true;
    if (shorter.length >= 4 && first.slice(0, 4) === second.slice(0, 4)) return true;
    if (shorter.length < 3) {
        return longer.startsWith(shorter) && SHORT_ROOT_SUFFIX.test(longer.slice(shorter.length));
    }
    if (stemVariants(shorter).some((variant) => longer.startsWith(variant))) return true;
    if (shorter.endsWith("e") && shorter.length >= 4 && longer.startsWith(shorter.slice(0, -1))) {
        return true;
    }
    if (shorter.endsWith("y") && longer.startsWith(`${shorter.slice(0, -1)}i`)) return true;
    const dropped = VOWEL_DROP_PATTERN.exec(shorter);
    const stem = dropped ? `${dropped[1]}${dropped[3]}` : null;
    return Boolean(
        stem && stem.length >= 3 && longer.startsWith(stem)
            && VOWEL_CLASS.includes(longer.charAt(stem.length) || "-")
    );
}

function relatedWordPair(
    first: string,
    second: string,
    locale: GameContentLocale
): [string, string] | null {
    for (const left of wordsOf(first, locale)) {
        for (const right of wordsOf(second, locale)) {
            if (areRelatedWords(left, right)) return [left, right];
        }
    }
    return null;
}

function extendsWord(stem: string, word: string, locale: GameContentLocale): boolean {
    if (stem === word) return true;
    return stemVariants(stem).some(
        (variant) => word.startsWith(variant)
            && NEAR_DUPLICATE_SUFFIXES[locale].test(word.slice(variant.length))
    );
}

// Near duplicates: the same collation key, or every word of the shorter
// phrase repeated (possibly with a suffix) in the longer one: Futbol / Futbol
// topu, Tenis / Masa tenisi, Kitap / Kitapçı.
function areNearDuplicates(first: string, second: string, locale: GameContentLocale): boolean {
    if (collationKey(first, locale) === collationKey(second, locale)) return true;
    const firstWords = wordsOf(first, locale, 1);
    const secondWords = wordsOf(second, locale, 1);
    const [fewer, more] = firstWords.length <= secondWords.length
        ? [firstWords, secondWords]
        : [secondWords, firstWords];
    return fewer.every(
        (word) => word.length >= 3 && more.some((other) => extendsWord(word, other, locale))
    );
}

function estimateWordWidths(
    value: string,
    locale: GameContentLocale,
    kind: "target" | "taboo"
): number[] {
    const column = kind === "target" ? 0 : 1;
    return value.split(" ").map((word) => {
        const upper = word.toLocaleUpperCase(intlLocale(locale));
        let width = 0;
        for (const glyph of upper) {
            width += (GLYPH_WIDTHS[glyph] ?? WIDEST_GLYPH)[column];
        }
        return Math.round(width * 10) / 10;
    });
}

function checkField(
    value: string,
    label: string,
    locale: GameContentLocale,
    kind: "target" | "taboo" | "category",
    problems: string[]
) {
    if (!FIELD_PATTERNS[locale].test(value)) {
        problems.push(`${label} "${value}" has characters outside the ${locale} word pattern`);
    }
    if (value.length > MAX_WORD_FIELD_LENGTH) {
        problems.push(`${label} "${value}" exceeds the ${MAX_WORD_FIELD_LENGTH} character column`);
    }
    if (kind === "category") return;
    if (value.length > MAX_FIELD_CHARACTERS) {
        problems.push(`${label} "${value}" is longer than ${MAX_FIELD_CHARACTERS} characters`);
    }
    const words = value.split(" ");
    if (words.length > MAX_WORDS_PER_FIELD) {
        problems.push(`${label} "${value}" has more than ${MAX_WORDS_PER_FIELD} words`);
    }
    const first = value.charAt(0);
    if (first !== first.toLocaleUpperCase(intlLocale(locale))) {
        problems.push(`${label} "${value}" must start with an uppercase letter`);
    }
    const limit = kind === "target" ? TARGET_WORD_MAX_WIDTH_PX : TABOO_WORD_MAX_WIDTH_PX;
    estimateWordWidths(value, locale, kind).forEach((width, index) => {
        if (width > limit) {
            problems.push(`${label} "${value}": "${words[index]}" is about ${width}px wide on the card (limit ${limit}px)`);
        }
    });
    if (locale === "tr") {
        for (const word of value.toLocaleLowerCase("tr-TR").split(/[\s'-]+/)) {
            if (SUSPICIOUS_TURKISH_WORDS.has(word)) {
                problems.push(`${label} "${value}": "${word}" looks like a misspelled or ASCII-folded Turkish word`);
            }
        }
    }
}

function checkCard(card: PackCard, problems: string[]) {
    const label = `${card.file}:${card.rowNumber} "${card.target}"`;
    checkField(card.target, `${label} target`, card.locale, "target", problems);
    if (card.taboo.length !== TABOO_WORDS_PER_CARD) {
        problems.push(`${label} has ${card.taboo.length} taboo words, expected ${TABOO_WORDS_PER_CARD}`);
    }
    card.taboo.forEach((taboo, index) => {
        checkField(taboo, `${label} taboo`, card.locale, "taboo", problems);
        const related = relatedWordPair(card.target, taboo, card.locale);
        if (related) {
            problems.push(`${label} taboo "${taboo}" shares a root with the target (${related.join(" ~ ")})`);
        }
        for (const other of card.taboo.slice(index + 1)) {
            if (areNearDuplicates(taboo, other, card.locale)) {
                problems.push(`${label} repeats taboo "${taboo}" / "${other}"`);
            }
        }
    });
}

function readPackFile(fileName: string, problems: string[]): PackCard[] {
    const match = PACK_FILE_PATTERN.exec(fileName);
    const locale = match?.[1];
    if (!locale || !isGameContentLocale(locale)) {
        problems.push(`${fileName}: name must look like <locale>-<name>-v<N>.csv with a game content locale`);
        return [];
    }

    const bytes = readFileSync(path.join(PACK_DIR, fileName));
    if (bytes.length > MAX_BULK_WORD_UPLOAD_FILE_BYTES) {
        problems.push(`${fileName}: larger than the bulk upload limit`);
    }
    if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
        problems.push(`${fileName}: must not start with a UTF-8 BOM`);
    }
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        problems.push(`${fileName}: is not valid UTF-8`);
        return [];
    }
    if (MOJIBAKE_PATTERN.test(text)) {
        problems.push(`${fileName}: contains a mojibake marker`);
    }
    if (/\t|"|;/.test(text)) {
        problems.push(`${fileName}: tabs, quotes and semicolons are not supported by the uploader`);
    }

    const nonEmptyLines = text.split("\n").map((line) => line.replace(/\r$/, "")).filter((line) => line.trim());
    if (nonEmptyLines[0] !== PACK_HEADERS[locale]) {
        problems.push(`${fileName}: first line must be the header "${PACK_HEADERS[locale]}"`);
    }

    const split = splitBulkWordUploadLines(text, locale);
    if ("error" in split) {
        problems.push(`${fileName}: ${split.error}`);
        return [];
    }
    if (split.rows.length !== nonEmptyLines.length - 1) {
        problems.push(`${fileName}: the uploader did not detect the header row`);
    }

    const cards: PackCard[] = [];
    for (const row of split.rows) {
        const parsed = parseBulkWordUploadRow(row, "csv_categories");
        const label = `${fileName}:${row.rowNumber}`;
        if ("error" in parsed) {
            problems.push(`${label}: ${parsed.error}`);
            continue;
        }
        if (parsed.fieldError) {
            problems.push(`${label}: ${parsed.fieldError}`);
            continue;
        }
        if (row.line.replace(/\r$/, "") !== parsed.columns.join(",")) {
            problems.push(`${label}: fields must not have surrounding spaces`);
        }
        if (parsed.columns.length !== 4 + TABOO_WORDS_PER_CARD) {
            problems.push(`${label}: expected ${4 + TABOO_WORDS_PER_CARD} columns, found ${parsed.columns.length}`);
        }
        if (parsed.subcategoryName) {
            problems.push(`${label}: packs use root categories only, leave alt_kategori empty`);
        }
        if (!parsed.categoryName) {
            problems.push(`${label}: category is required`);
            continue;
        }
        if (String(parsed.difficulty) !== parsed.columns[1]) {
            problems.push(`${label}: difficulty must be a plain 1, 2 or 3`);
        }
        checkField(parsed.categoryName, `${label} category`, locale, "category", problems);
        cards.push({
            file: fileName,
            rowNumber: row.rowNumber,
            locale,
            target: parsed.wordText,
            difficulty: parsed.difficulty as Difficulty,
            category: parsed.categoryName,
            taboo: parsed.tabooWords,
        });
    }
    return cards;
}

function share(count: number, total: number): number {
    return total === 0 ? 0 : count / total;
}

function checkDifficultyMix(cards: PackCard[], tolerance: number, label: string, problems: string[]) {
    for (const difficulty of [1, 2, 3] as const) {
        const actual = share(cards.filter((card) => card.difficulty === difficulty).length, cards.length);
        if (Math.abs(actual - DIFFICULTY_TARGETS[difficulty]) > tolerance + 1e-9) {
            problems.push(
                `${label}: difficulty ${difficulty} is ${(actual * 100).toFixed(1)}%, target ${DIFFICULTY_TARGETS[difficulty] * 100}% +/- ${tolerance * 100}`
            );
        }
    }
}

function checkLocale(locale: GameContentLocale, cards: PackCard[], readme: string, problems: string[]) {
    if (cards.length < MIN_CARDS_PER_LOCALE[locale]) {
        problems.push(`${locale}: ${cards.length} cards, need at least ${MIN_CARDS_PER_LOCALE[locale]}`);
    }
    checkDifficultyMix(cards, LOCALE_DIFFICULTY_TOLERANCE, locale, problems);

    const byCategory = new Map<string, PackCard[]>();
    const categoryNames = new Map<string, string>();
    for (const card of cards) {
        const key = normalizeLabel(card.category, locale);
        const knownName = categoryNames.get(key);
        if (knownName && knownName !== card.category) {
            problems.push(`${locale}: category written as both "${knownName}" and "${card.category}"`);
        }
        categoryNames.set(key, knownName ?? card.category);
        byCategory.set(key, [...(byCategory.get(key) ?? []), card]);
    }
    if (byCategory.size < MIN_CATEGORIES_PER_LOCALE || byCategory.size > MAX_CATEGORIES_PER_LOCALE) {
        problems.push(
            `${locale}: ${byCategory.size} categories, expected ${MIN_CATEGORIES_PER_LOCALE}-${MAX_CATEGORIES_PER_LOCALE}`
        );
    }
    for (const [key, categoryCards] of byCategory) {
        const name = categoryNames.get(key)!;
        if (categoryCards.length < MIN_CARDS_PER_CATEGORY) {
            problems.push(`${locale} "${name}": ${categoryCards.length} cards, need ${MIN_CARDS_PER_CATEGORY}`);
        }
        checkDifficultyMix(categoryCards, CATEGORY_DIFFICULTY_TOLERANCE, `${locale} "${name}"`, problems);
        if (!readme.includes(name)) {
            problems.push(`${README_PATH} does not list the ${locale} category "${name}"`);
        }
    }

    for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
            if (areNearDuplicates(cards[i].target, cards[j].target, locale)) {
                problems.push(
                    `${locale}: duplicate or near-duplicate targets "${cards[i].target}" (${cards[i].file}:${cards[i].rowNumber}) and "${cards[j].target}" (${cards[j].file}:${cards[j].rowNumber})`
                );
            }
        }
    }
}

function runSelfChecks() {
    // Parser contract shared with processBulkWordUpload.
    assert.deepEqual(splitBulkWordUploadLines(" \n\r\n"), { error: "CSV dosyası boş." });
    const split = splitBulkWordUploadLines("KELİME,zorluk\r\n\r\nElma,1,Meyve,,Kırmızı\r\nArmut,2,Meyve,,Sarı\n", "tr");
    assert.ok("rows" in split);
    assert.deepEqual(split.rows.map((row) => row.rowNumber), [2, 3]);
    const parsedRow = parseBulkWordUploadRow(split.rows[0], "csv_categories");
    assert.ok(!("error" in parsedRow));
    assert.equal(parsedRow.wordText, "Elma");
    assert.equal(parsedRow.categoryName, "Meyve");
    assert.deepEqual(parsedRow.tabooWords, ["Kırmızı"]);
    assert.equal(parsedRow.fieldError, null);
    assert.ok("rows" in splitBulkWordUploadLines("word,difficulty\nApple,1,Fruit,,Red", "en"));
    assert.deepEqual(
        splitBulkWordUploadLines(Array.from({ length: MAX_BULK_WORD_UPLOAD_ROWS + 1 }, () => "a,1,b").join("\n")),
        { error: `CSV en fazla ${MAX_BULK_WORD_UPLOAD_ROWS} veri satiri icerebilir.` }
    );
    const missingTaboo = parseBulkWordUploadRow({ rowNumber: 7, line: "Elma,1,Meyve,," }, "csv_categories");
    assert.ok(!("error" in missingTaboo));
    assert.equal(missingTaboo.fieldError, "Satır 7: En az 1 yasaklı kelime gerekli.");
    const badDifficulty = parseBulkWordUploadRow({ rowNumber: 3, line: "Elma,4,Meyve,,Kırmızı" }, "csv_categories");
    assert.ok(!("error" in badDifficulty));
    assert.equal(badDifficulty.fieldError, "Satır 3: Zorluk 1-3 arasında olmalı.");
    assert.deepEqual(
        parseBulkWordUploadRow({ rowNumber: 4, line: "Elma,1,Meyve,Kırmızı" }, "csv_categories"),
        { error: "Satır 4: En az 5 sütun gerekli (kelime, zorluk, kategori, alt_kategori, yasakli1)." }
    );
    const fixedRow = parseBulkWordUploadRow({ rowNumber: 2, line: " Elma , 2 , Kırmızı ,, Meyve " }, "fixed_categories");
    assert.ok(!("error" in fixedRow));
    assert.deepEqual(fixedRow.tabooWords, ["Kırmızı", "Meyve"]);
    assert.equal(fixedRow.categoryName, "");
    const tooManyTaboo = parseBulkWordUploadRow(
        { rowNumber: 5, line: `Elma,1,${Array.from({ length: 13 }, (_, index) => `y${index}`).join(",")}` },
        "fixed_categories"
    );
    assert.ok(!("error" in tooManyTaboo));
    assert.equal(tooManyTaboo.fieldError, "Satır 5: En fazla 12 yasaklı kelime eklenebilir.");

    // Root and stem detection.
    const related: Array<[string, string, GameContentLocale]> = [
        ["Kitap", "Kitapçı", "tr"], ["Kitap", "kitaplık", "tr"], ["Kitap", "Kitabı", "tr"],
        ["Ağaç", "Ağacı", "tr"], ["Renk", "Rengi", "tr"], ["Ağız", "Ağzı", "tr"],
        ["Su", "Suyu", "tr"], ["Bilgisayar", "Bilgi", "tr"], ["Diş fırçası", "Diş", "tr"],
        ["Hastane", "Hasta", "tr"], ["Bahçe", "Bahçıvan", "tr"], ["Buzdolabı", "Buz", "tr"],
        ["Bake", "Baking", "en"], ["Snowman", "Snow", "en"], ["Fly", "Flies", "en"],
        ["Library", "Librarian", "en"], ["Paint", "Painter", "en"],
    ];
    for (const [target, taboo, locale] of related) {
        assert.ok(relatedWordPair(target, taboo, locale), `${target} / ${taboo} should be related`);
    }
    const unrelated: Array<[string, string, GameContentLocale]> = [
        ["Kitap", "Okumak", "tr"], ["Kedi", "Miyav", "tr"], ["Su", "Sıvı", "tr"],
        ["Koyun", "Yün", "tr"], ["Kır", "Kir", "tr"],
        ["Göl", "Deniz", "tr"], ["Apple", "Fruit", "en"], ["Ant", "Insect", "en"],
    ];
    for (const [target, taboo, locale] of unrelated) {
        assert.equal(relatedWordPair(target, taboo, locale), null, `${target} / ${taboo} should be unrelated`);
    }
    assert.ok(areNearDuplicates("Futbol", "Futbol topu", "tr"));
    assert.ok(areNearDuplicates("Göl", "Gol", "tr"), "accent-folded duplicates collide in utf8mb4_unicode_ci");
    assert.ok(areNearDuplicates("Kitap", "Kitapçı", "tr"));
    assert.ok(areNearDuplicates("Tenis", "Masa tenisi", "tr"));
    assert.ok(!areNearDuplicates("Kedi", "Köpek", "tr"));
    assert.ok(!areNearDuplicates("At", "Tek boynuzlu at", "tr"));
    assert.ok(!areNearDuplicates("Kale", "Kalemtıraş", "tr"));
    assert.ok(!areNearDuplicates("Dev", "Deve", "tr"));
    assert.ok(!areNearDuplicates("Bal", "Balık", "tr"));
    assert.ok(areNearDuplicates("Kitap", "Kitapçılar", "tr"));
    assert.ok(!areNearDuplicates("Postacı", "E-posta", "tr"));
    assert.ok(areNearDuplicates("Balık", "Mürekkep balığı", "tr"));
    assert.ok(areNearDuplicates("Farm", "Farmer", "en"));

    // Field rules reject the mistakes the packs must not contain.
    const fieldProblems: string[] = [];
    checkCard({
        file: "self-check.csv",
        rowNumber: 1,
        locale: "tr",
        target: "cocuk",
        difficulty: 1,
        category: "Test",
        taboo: ["Oyuncak", "oyuncak", "Istanbul", "Kitap,", "Bebek"],
    }, fieldProblems);
    assert.ok(fieldProblems.some((problem) => problem.includes("uppercase")));
    assert.ok(fieldProblems.some((problem) => problem.includes("ASCII-folded")));
    assert.ok(fieldProblems.some((problem) => problem.includes("repeats taboo")));
    assert.ok(fieldProblems.some((problem) => problem.includes("outside the tr word pattern")));
    const widthProblems: string[] = [];
    checkCard({
        file: "self-check.csv",
        rowNumber: 2,
        locale: "en",
        target: "Wheelbarrow",
        difficulty: 2,
        category: "Test",
        taboo: ["Garden", "Wheel", "Push", "Dirt", "Counterrevolutionary"],
    }, widthProblems);
    assert.ok(widthProblems.some((problem) => problem.includes("\"Wheelbarrow\" is about")));
    assert.ok(widthProblems.some((problem) => problem.includes("\"Counterrevolutionary\" is about")));
    assert.ok(widthProblems.some((problem) => problem.includes("shares a root")));
    assert.ok(estimateWordWidths("Bilgisayar", "tr", "target")[0] <= TARGET_WORD_MAX_WIDTH_PX);
}

runSelfChecks();

assert.ok(existsSync(README_PATH), `${README_PATH} is missing`);
const readme = readFileSync(README_PATH, "utf8");
const packFiles = readdirSync(PACK_DIR).filter((fileName) => fileName.endsWith(".csv")).sort();
const problems: string[] = [];
const cardsByLocale = new Map<GameContentLocale, PackCard[]>();

for (const fileName of packFiles) {
    if (!readme.includes(fileName)) {
        problems.push(`${README_PATH} does not mention ${fileName}`);
    }
    for (const card of readPackFile(fileName, problems)) {
        checkCard(card, problems);
        cardsByLocale.set(card.locale, [...(cardsByLocale.get(card.locale) ?? []), card]);
    }
}

for (const locale of ["tr", "en"] as const) {
    checkLocale(locale, cardsByLocale.get(locale) ?? [], readme, problems);
}

if (problems.length > 0) {
    console.error(`Word pack validation found ${problems.length} problem(s):`);
    for (const problem of problems) {
        console.error(`- ${problem}`);
    }
    process.exit(1);
}

for (const [locale, cards] of cardsByLocale) {
    const categories = new Set(cards.map((card) => card.category));
    const counts = [1, 2, 3].map((difficulty) => cards.filter((card) => card.difficulty === difficulty).length);
    console.log(
        `${locale}: ${cards.length} cards, ${categories.size} categories, difficulty 1/2/3 = ${counts.join("/")}`
    );
}
console.log(`Word pack checks passed for ${packFiles.length} file(s).`);
