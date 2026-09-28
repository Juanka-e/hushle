import { prisma } from "@/lib/prisma";
import {
    DEFAULT_GAME_CONTENT_LOCALE,
    getGameContentLocaleDefinition,
    type GameContentLocale,
} from "@hushle/domain-game";

export type BulkUploadMode = "fixed_categories" | "csv_categories";
export const MAX_BULK_WORD_UPLOAD_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_BULK_WORD_UPLOAD_ROWS = 1_000;
export const MAX_BULK_TABOO_WORDS_PER_ROW = 12;
const MAX_WORD_FIELD_LENGTH = 255;

export interface BulkUploadResults {
    success: number;
    skipped: number;
    errors: string[];
    skippedRows: string[];
}

interface CategoryRecord {
    id: number;
    name: string;
    parentId: number | null;
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

export async function resolveFixedCategoryIds(
    categoryIdValue: string,
    subcategoryIdValue: string,
    locale: GameContentLocale = DEFAULT_GAME_CONTENT_LOCALE
): Promise<number[] | { error: string }> {
    const selectedCategoryIds = [categoryIdValue, subcategoryIdValue]
        .map(parsePositiveInteger)
        .filter((value): value is number => value !== null);

    const uniqueCategoryIds = Array.from(new Set(selectedCategoryIds));
    if (uniqueCategoryIds.length === 0) {
        return [];
    }

    const categories = await prisma.category.findMany({
        where: { id: { in: uniqueCategoryIds }, locale },
        select: { id: true, parentId: true },
    });

    if (categories.length !== uniqueCategoryIds.length) {
        return { error: "Secilen kategori veya alt kategori bulunamadi." };
    }

    if (subcategoryIdValue) {
        const parentCategoryId = parsePositiveInteger(categoryIdValue);
        const subcategoryId = parsePositiveInteger(subcategoryIdValue);
        const subcategory = categories.find((category) => category.id === subcategoryId);

        if (!subcategory || subcategory.parentId !== parentCategoryId) {
            return { error: "Alt kategori secimi ust kategori ile eslesmiyor." };
        }

        return subcategoryId ? [subcategoryId] : [];
    }

    return categoryIdValue ? [parsePositiveInteger(categoryIdValue)!] : [];
}

export function buildCategoryIndex(
    categories: CategoryRecord[],
    locale: GameContentLocale = DEFAULT_GAME_CONTENT_LOCALE
) {
    const byRootName = new Map<string, CategoryRecord>();
    const byParentAndChildName = new Map<string, CategoryRecord>();

    for (const category of categories) {
        if (category.parentId === null) {
            byRootName.set(normalizeLabel(category.name, locale), category);
            continue;
        }

        const parent = categories.find((item) => item.id === category.parentId);
        if (!parent) {
            continue;
        }

        byParentAndChildName.set(
            `${normalizeLabel(parent.name, locale)}::${normalizeLabel(category.name, locale)}`,
            category
        );
    }

    return { byRootName, byParentAndChildName };
}

export function extractCsvCategoryIds(
    rowIndex: number,
    cols: string[],
    categoryIndex: ReturnType<typeof buildCategoryIndex>,
    locale: GameContentLocale = DEFAULT_GAME_CONTENT_LOCALE
): { categoryIds: number[]; tabooOffset: number } | { error: string } {
    const categoryName = cols[2] ?? "";
    const subcategoryName = cols[3] ?? "";

    if (!categoryName) {
        return { error: `Satir ${rowIndex}: CSV modunda kategori zorunlu.` };
    }

    const rootCategory = categoryIndex.byRootName.get(normalizeLabel(categoryName, locale));
    if (!rootCategory) {
        return { error: `Satir ${rowIndex}: "${categoryName}" kategorisi bulunamadi.` };
    }

    if (!subcategoryName) {
        return { categoryIds: [rootCategory.id], tabooOffset: 4 };
    }

    const subcategory = categoryIndex.byParentAndChildName.get(
        `${normalizeLabel(rootCategory.name, locale)}::${normalizeLabel(subcategoryName, locale)}`
    );
    if (!subcategory) {
        return {
            error: `Satir ${rowIndex}: "${subcategoryName}" alt kategorisi "${categoryName}" altinda bulunamadi.`,
        };
    }

    return { categoryIds: [subcategory.id], tabooOffset: 4 };
}

export async function processBulkWordUpload(options: {
    text: string;
    mode: BulkUploadMode;
    categoryIdValue?: string;
    subcategoryIdValue?: string;
    locale?: GameContentLocale;
}) {
    const {
        text,
        mode,
        categoryIdValue = "",
        subcategoryIdValue = "",
        locale = DEFAULT_GAME_CONTENT_LOCALE,
    } = options;

    const lines = text.split("\n").filter((line) => line.trim());
    if (lines.length === 0) {
        return { error: "CSV dosyasi bos." } as const;
    }

    const firstLine = lines[0].toLocaleLowerCase(
        getGameContentLocaleDefinition(locale).intlLocale
    ).trim();
    const startIndex = firstLine.startsWith("word") || firstLine.startsWith("kelime")
        ? 1
        : 0;
    if (lines.length - startIndex > MAX_BULK_WORD_UPLOAD_ROWS) {
        return {
            error: `CSV en fazla ${MAX_BULK_WORD_UPLOAD_ROWS} veri satiri icerebilir.`,
        } as const;
    }

    let fixedCategoryIds: number[] = [];
    if (mode === "fixed_categories") {
        const resolved = await resolveFixedCategoryIds(categoryIdValue, subcategoryIdValue, locale);
        if (!Array.isArray(resolved)) {
            return { error: resolved.error } as const;
        }
        fixedCategoryIds = resolved;
    }

    let categoryIndex: ReturnType<typeof buildCategoryIndex> | null = null;
    if (mode === "csv_categories") {
        const categories = await prisma.category.findMany({
            where: { locale },
            select: { id: true, name: true, parentId: true },
        });
        categoryIndex = buildCategoryIndex(categories, locale);
    }

    const results: BulkUploadResults = {
        success: 0,
        skipped: 0,
        errors: [],
        skippedRows: [],
    };

    for (let i = startIndex; i < lines.length; i++) {
        const rowNumber = i + 1;
        const cols = parseRow(lines[i]);

        const minimumColumns = mode === "csv_categories" ? 5 : 3;
        if (cols.length < minimumColumns) {
            results.errors.push(
                mode === "csv_categories"
                    ? `Satir ${rowNumber}: En az 5 sutun gerekli (kelime, zorluk, kategori, alt_kategori, yasakli1).`
                    : `Satir ${rowNumber}: En az 3 sutun gerekli (kelime, zorluk, yasakli1).`
            );
            continue;
        }

        const wordText = cols[0];
        const difficulty = Number.parseInt(cols[1], 10);

        let categoryIds = fixedCategoryIds;
        let tabooOffset = 2;

        if (mode === "csv_categories") {
            const resolved = extractCsvCategoryIds(rowNumber, cols, categoryIndex!, locale);
            if ("error" in resolved) {
                results.errors.push(resolved.error);
                continue;
            }
            categoryIds = resolved.categoryIds;
            tabooOffset = resolved.tabooOffset;
        }

        const tabooWords = cols.slice(tabooOffset).filter(Boolean);

        if (!wordText) {
            results.errors.push(`Satir ${rowNumber}: Kelime bos.`);
            continue;
        }

        if (wordText.length > MAX_WORD_FIELD_LENGTH) {
            results.errors.push(`Satir ${rowNumber}: Kelime en fazla ${MAX_WORD_FIELD_LENGTH} karakter olabilir.`);
            continue;
        }

        if (Number.isNaN(difficulty) || difficulty < 1 || difficulty > 3) {
            results.errors.push(`Satir ${rowNumber}: Zorluk 1-3 arasinda olmali.`);
            continue;
        }

        if (tabooWords.length === 0) {
            results.errors.push(`Satir ${rowNumber}: En az 1 yasakli kelime gerekli.`);
            continue;
        }

        if (tabooWords.length > MAX_BULK_TABOO_WORDS_PER_ROW) {
            results.errors.push(`Satir ${rowNumber}: En fazla ${MAX_BULK_TABOO_WORDS_PER_ROW} yasakli kelime eklenebilir.`);
            continue;
        }

        if (tabooWords.some((tabooWord) => tabooWord.length > MAX_WORD_FIELD_LENGTH)) {
            results.errors.push(`Satir ${rowNumber}: Yasakli kelimeler en fazla ${MAX_WORD_FIELD_LENGTH} karakter olabilir.`);
            continue;
        }

        const existing = await prisma.word.findUnique({
            where: { locale_wordText: { locale, wordText } },
        });
        if (existing) {
            results.skipped += 1;
            results.skippedRows.push(`Satir ${rowNumber}: "${wordText}" zaten mevcut, atlandi.`);
            continue;
        }

        try {
            await prisma.word.create({
                data: {
                    wordText,
                    locale,
                    difficulty,
                    tabooWords: {
                        create: tabooWords.map((tabooWordText) => ({ tabooWordText })),
                    },
                    wordCategories:
                        categoryIds.length > 0
                            ? {
                                  create: Array.from(new Set(categoryIds)).map((categoryId) => ({
                                      categoryId,
                                  })),
                              }
                            : undefined,
                },
            });
            results.success += 1;
        } catch {
            results.errors.push(`Satir ${rowNumber}: Veritabani hatasi.`);
        }
    }

    return { results, fixedCategoryIds } as const;
}
