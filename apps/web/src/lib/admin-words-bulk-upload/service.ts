import { prisma } from "@/lib/prisma";
import {
    DEFAULT_GAME_CONTENT_LOCALE,
    type GameContentLocale,
} from "@hushle/domain-game";
import {
    normalizeLabel,
    parseBulkWordUploadRow,
    parsePositiveInteger,
    splitBulkWordUploadLines,
    type BulkUploadMode,
} from "./parser";

export {
    MAX_BULK_TABOO_WORDS_PER_ROW,
    MAX_BULK_WORD_UPLOAD_FILE_BYTES,
    MAX_BULK_WORD_UPLOAD_ROWS,
    normalizeLabel,
    parsePositiveInteger,
    parseRow,
    type BulkUploadMode,
} from "./parser";

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

    const split = splitBulkWordUploadLines(text, locale);
    if ("error" in split) {
        return { error: split.error } as const;
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

    for (const row of split.rows) {
        const parsed = parseBulkWordUploadRow(row, mode);
        if ("error" in parsed) {
            results.errors.push(parsed.error);
            continue;
        }

        const { rowNumber, wordText, difficulty, tabooWords } = parsed;
        let categoryIds = fixedCategoryIds;

        // Category lookup errors keep their precedence over field errors.
        if (mode === "csv_categories") {
            const resolved = extractCsvCategoryIds(rowNumber, parsed.columns, categoryIndex!, locale);
            if ("error" in resolved) {
                results.errors.push(resolved.error);
                continue;
            }
            categoryIds = resolved.categoryIds;
        }

        if (parsed.fieldError) {
            results.errors.push(parsed.fieldError);
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
