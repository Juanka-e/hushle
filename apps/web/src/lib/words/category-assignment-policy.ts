import { prisma } from "@/lib/prisma";
import type { GameContentLocale } from "@hushle/domain-game";

export interface CategorySelectionValidationResult {
    normalizedCategoryIds: number[];
}

export async function validateWordCategorySelection(
    categoryIds: number[],
    locale?: GameContentLocale
): Promise<CategorySelectionValidationResult> {
    const normalizedCategoryIds = Array.from(
        new Set(
            categoryIds.filter((categoryId) =>
                Number.isInteger(categoryId) && categoryId > 0
            )
        )
    );

    if (normalizedCategoryIds.length === 0) {
        return { normalizedCategoryIds: [] };
    }

    const categories = await prisma.category.findMany({
        where: { id: { in: normalizedCategoryIds } },
        select: {
            id: true,
            name: true,
            parentId: true,
            locale: true,
        },
    });

    if (categories.length !== normalizedCategoryIds.length) {
        throw new Error("Secilen kategorilerden biri bulunamadi.");
    }

    if (locale && categories.some((category) => category.locale !== locale)) {
        throw new Error("Kelime yalnızca kendi dilindeki kategorilere bağlanabilir.");
    }

    const categoriesById = new Map(categories.map((category) => [category.id, category]));
    const invalidPairs: string[] = [];

    for (const category of categories) {
        if (!category.parentId) {
            continue;
        }

        const parentCategory = categoriesById.get(category.parentId);
        if (!parentCategory) {
            continue;
        }

        invalidPairs.push(`${parentCategory.name} / ${category.name}`);
    }

    if (invalidPairs.length > 0) {
        throw new Error(
            `Bir kelimeyi hem ana kategoriye hem alt kategorisine birlikte baglayamazsin: ${invalidPairs.join(", ")}. Alt kategori secildiyse yalniz alt kategoriyi kullan.`
        );
    }

    return { normalizedCategoryIds };
}
