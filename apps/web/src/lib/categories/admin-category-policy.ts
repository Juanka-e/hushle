import { prisma } from "@/lib/prisma";
import type { GameContentLocale } from "@hushle/domain-game";

export interface NormalizedCategoryInput {
    name?: string;
    parentId?: number | null;
    color?: string | null;
    sortOrder?: number;
    isVisible?: boolean;
    locale?: GameContentLocale;
}

export async function validateAdminCategoryInput(
    input: NormalizedCategoryInput,
    currentCategoryId?: number
): Promise<NormalizedCategoryInput> {
    const normalizedName = input.name?.trim();
    if (input.name !== undefined && !normalizedName) {
        throw new Error("Kategori adi bos olamaz.");
    }

    const normalizedParentId =
        input.parentId === undefined ? undefined : input.parentId === null ? null : input.parentId;

    if (currentCategoryId && normalizedParentId === currentCategoryId) {
        throw new Error("Bir kategori kendisini ust kategori yapamaz.");
    }

    if (normalizedParentId !== undefined && normalizedParentId !== null) {
        const parentCategory = await prisma.category.findUnique({
            where: { id: normalizedParentId },
            select: {
                id: true,
                parentId: true,
                locale: true,
            },
        });

        if (!parentCategory) {
            throw new Error("Secilen ust kategori bulunamadi.");
        }

        if (parentCategory.parentId !== null) {
            throw new Error("Alt kategorinin altina tekrar kategori eklenemez. Su an yalnizca tek seviye destekleniyor.");
        }

        if (input.locale && parentCategory.locale !== input.locale) {
            throw new Error("Alt kategori ile üst kategori aynı kelime dilinde olmalıdır.");
        }
    }

    return {
        ...input,
        name: normalizedName ?? input.name,
        parentId: normalizedParentId,
    };
}

export async function assertCategoryCanBeDeleted(categoryId: number): Promise<void> {
    const [childCount, wordCount] = await Promise.all([
        prisma.category.count({
            where: { parentId: categoryId },
        }),
        prisma.wordCategory.count({
            where: { categoryId },
        }),
    ]);

    if (childCount > 0) {
        throw new Error("Bu ana kategorinin alt kategorileri var. Once alt kategorileri tasiyin veya silin.");
    }

    if (wordCount > 0) {
        throw new Error("Bu kategoriye bagli kelimeler var. Once kelime baglarini temizleyin.");
    }
}

export function hasCategoryHierarchyConflict(
    categoryIds: number[],
    categoriesById: Map<number, { id: number; name: string; parentId: number | null }>
): boolean {
    const categorySet = new Set(categoryIds);

    for (const categoryId of categorySet) {
        const category = categoriesById.get(categoryId);
        if (!category?.parentId) {
            continue;
        }

        if (categorySet.has(category.parentId)) {
            return true;
        }
    }

    return false;
}
