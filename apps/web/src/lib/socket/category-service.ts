import { getOrSetJsonCache } from "@hushle/platform-cache";
import {
    getVisibleCategoriesCacheKey,
    invalidateAdminDashboardStatsCache,
    invalidateVisibleCategoriesCache,
} from "@/lib/cache/application-cache";
import { prisma } from "@/lib/prisma";
import {
    DEFAULT_GAME_CONTENT_LOCALE,
    type GameContentLocale,
} from "@hushle/domain-game";

interface CategoryWithChildren {
    id: number;
    name: string;
    color: string | null;
    parentId: number | null;
    sortOrder: number;
    children: CategoryWithChildren[];
}

const CACHE_TTL_MS = 60_000;

export async function getVisibleCategories(
    locale: GameContentLocale = DEFAULT_GAME_CONTENT_LOCALE
): Promise<CategoryWithChildren[]> {
    const result = await getOrSetJsonCache<CategoryWithChildren[]>({
        key: getVisibleCategoriesCacheKey(locale),
        ttlMs: CACHE_TTL_MS,
        loader: async () => {
            const allCategories = await prisma.category.findMany({
                where: { isVisible: true, locale },
                orderBy: { sortOrder: "asc" },
                select: {
                    id: true,
                    name: true,
                    color: true,
                    parentId: true,
                    sortOrder: true,
                },
            });
            const categories = new Map<number, CategoryWithChildren>();
            const roots: CategoryWithChildren[] = [];

            for (const category of allCategories) {
                categories.set(category.id, {
                    ...category,
                    children: [],
                });
            }

            for (const category of allCategories) {
                const node = categories.get(category.id);
                if (!node) continue;
                const parent = category.parentId
                    ? categories.get(category.parentId)
                    : null;
                if (parent) {
                    parent.children.push(node);
                } else {
                    roots.push(node);
                }
            }

            return roots;
        },
    });

    return result.value;
}

export async function invalidateCategoryCache(): Promise<void> {
    await Promise.all([
        invalidateVisibleCategoriesCache(),
        invalidateAdminDashboardStatsCache(),
    ]);
}
