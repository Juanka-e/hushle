import {
    DEFAULT_GAME_CONTENT_LOCALE,
    getGameContentLocaleDefinition,
    type GameContentLocale,
} from "@hushle/domain-game";

// Pure CSV parsing for admin bulk word uploads. It has no database access so
// offline checks (for example the word pack validator) parse files exactly the
// way the upload route does.

export type BulkUploadMode = "fixed_categories" | "csv_categories";
export const MAX_BULK_WORD_UPLOAD_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_BULK_WORD_UPLOAD_ROWS = 1_000;
export const MAX_BULK_TABOO_WORDS_PER_ROW = 12;
export const MAX_WORD_FIELD_LENGTH = 255;

export interface BulkWordUploadLine {
    rowNumber: number;
    line: string;
}

export interface ParsedBulkWordRow {
    rowNumber: number;
    columns: string[];
    wordText: string;
    difficulty: number;
    categoryName: string;
    subcategoryName: string;
    tabooWords: string[];
    // First problem that does not depend on database state, or null.
    fieldError: string | null;
}

export function normalizeLabel(
    value: string,
    locale: GameContentLocale = DEFAULT_GAME_CONTENT_LOCALE
): string {
    return value
        .trim()
        .toLocaleLowerCase(getGameContentLocaleDefinition(locale).intlLocale);
}

export function parsePositiveInteger(value: string): number | null {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseRow(line: string): string[] {
    return line.split(",").map((column) => column.trim());
}

export function splitBulkWordUploadLines(
    text: string,
    locale: GameContentLocale = DEFAULT_GAME_CONTENT_LOCALE
): { error: string } | { rows: BulkWordUploadLine[] } {
    const lines = text.split("\n").filter((line) => line.trim());
    if (lines.length === 0) {
        return { error: "CSV dosyası boş." };
    }

    const firstLine = lines[0].toLocaleLowerCase(
        getGameContentLocaleDefinition(locale).intlLocale
    ).trim();
    const startIndex = firstLine.startsWith("word") || firstLine.startsWith("kelime")
        ? 1
        : 0;
    if (lines.length - startIndex > MAX_BULK_WORD_UPLOAD_ROWS) {
        return {
            error: `CSV en fazla ${MAX_BULK_WORD_UPLOAD_ROWS} veri satırı içerebilir.`,
        };
    }

    const rows: BulkWordUploadLine[] = [];
    for (let i = startIndex; i < lines.length; i++) {
        rows.push({ rowNumber: i + 1, line: lines[i] });
    }
    return { rows };
}

export function parseBulkWordUploadRow(
    row: BulkWordUploadLine,
    mode: BulkUploadMode
): { error: string } | ParsedBulkWordRow {
    const { rowNumber } = row;
    const cols = parseRow(row.line);

    const minimumColumns = mode === "csv_categories" ? 5 : 3;
    if (cols.length < minimumColumns) {
        return {
            error: mode === "csv_categories"
                ? `Satır ${rowNumber}: En az 5 sütun gerekli (kelime, zorluk, kategori, alt_kategori, yasakli1).`
                : `Satır ${rowNumber}: En az 3 sütun gerekli (kelime, zorluk, yasakli1).`,
        };
    }

    const wordText = cols[0];
    const difficulty = Number.parseInt(cols[1], 10);
    const tabooOffset = mode === "csv_categories" ? 4 : 2;
    const tabooWords = cols.slice(tabooOffset).filter(Boolean);

    return {
        rowNumber,
        columns: cols,
        wordText,
        difficulty,
        categoryName: mode === "csv_categories" ? cols[2] ?? "" : "",
        subcategoryName: mode === "csv_categories" ? cols[3] ?? "" : "",
        tabooWords,
        fieldError: findBulkWordFieldError(rowNumber, wordText, difficulty, tabooWords),
    };
}

function findBulkWordFieldError(
    rowNumber: number,
    wordText: string,
    difficulty: number,
    tabooWords: string[]
): string | null {
    if (!wordText) {
        return `Satır ${rowNumber}: Kelime boş.`;
    }

    if (wordText.length > MAX_WORD_FIELD_LENGTH) {
        return `Satır ${rowNumber}: Kelime en fazla ${MAX_WORD_FIELD_LENGTH} karakter olabilir.`;
    }

    if (Number.isNaN(difficulty) || difficulty < 1 || difficulty > 3) {
        return `Satır ${rowNumber}: Zorluk 1-3 arasında olmalı.`;
    }

    if (tabooWords.length === 0) {
        return `Satır ${rowNumber}: En az 1 yasaklı kelime gerekli.`;
    }

    if (tabooWords.length > MAX_BULK_TABOO_WORDS_PER_ROW) {
        return `Satır ${rowNumber}: En fazla ${MAX_BULK_TABOO_WORDS_PER_ROW} yasaklı kelime eklenebilir.`;
    }

    if (tabooWords.some((tabooWord) => tabooWord.length > MAX_WORD_FIELD_LENGTH)) {
        return `Satır ${rowNumber}: Yasaklı kelimeler en fazla ${MAX_WORD_FIELD_LENGTH} karakter olabilir.`;
    }

    return null;
}
