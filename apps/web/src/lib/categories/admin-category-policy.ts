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
        throw new Error("Kategori adı boş olamaz.");
    }

    const normalizedParentId =
        input.parentId === undefined ? undefined : input.parentId === null ? null : input.parentId;

    if (currentCategoryId && normalizedParentId === currentCategoryId) {
        throw new Error("Bir kategori kendisini üst kategori yapamaz.");
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
            throw new Error("Seçilen üst kategori bulunamadı.");
        }

        if (parentCategory.parentId !== null) {
            throw new Error("Alt kategorinin altına tekrar kategori eklenemez. Şu an yalnızca tek seviye destekleniyor.");
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
        throw new Error("Bu ana kategorinin alt kategorileri var. Önce alt kategorileri taşıyın veya silin.");
    }

    if (wordCount > 0) {
        throw new Error("Bu kategoriye bağlı kelimeler var. Önce kelime bağlarını temizleyin.");
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
