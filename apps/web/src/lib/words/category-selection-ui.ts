export interface CategorySelectionTreeNode {
    id: number;
    name: string;
    children?: CategorySelectionTreeNode[];
}

interface CategorySelectionMeta {
    id: number;
    name: string;
    parentId: number | null;
}

export interface WordCategoryToggleResult {
    nextSelection: number[];
    helperText: string;
}

function buildSelectionMetaMap(
    categories: CategorySelectionTreeNode[]
): Map<number, CategorySelectionMeta> {
    const metaMap = new Map<number, CategorySelectionMeta>();

    for (const category of categories) {
        metaMap.set(category.id, {
            id: category.id,
            name: category.name,
            parentId: null,
        });

        for (const child of category.children ?? []) {
            metaMap.set(child.id, {
                id: child.id,
                name: child.name,
                parentId: category.id,
            });
        }
    }

    return metaMap;
}

export function resolveWordCategoryToggle(
    currentSelection: number[],
    toggledCategoryId: number,
    categories: CategorySelectionTreeNode[]
): WordCategoryToggleResult {
    const metaMap = buildSelectionMetaMap(categories);
    const meta = metaMap.get(toggledCategoryId);

    if (!meta) {
        return {
            nextSelection: currentSelection,
            helperText: "",
        };
    }

    const selectionSet = new Set(currentSelection);
    if (selectionSet.has(toggledCategoryId)) {
        selectionSet.delete(toggledCategoryId);
        return {
            nextSelection: Array.from(selectionSet),
            helperText: "",
        };
    }

    let helperText = "";

    if (meta.parentId === null) {
        for (const entry of metaMap.values()) {
            if (entry.parentId === toggledCategoryId) {
                selectionSet.delete(entry.id);
            }
        }

        helperText = `"${meta.name}" ana kategorisi seçildi. Bu seçim yalnız genel havuza bağlı ana kategori kelimelerini kapsar.`;
    } else {
        if (selectionSet.delete(meta.parentId)) {
            const parentName = metaMap.get(meta.parentId)?.name ?? "Ana kategori";
            helperText = `"${meta.name}" alt kategorisi seçildi. Çakışma olmaması için "${parentName}" seçimi kaldırıldı.`;
        } else {
            helperText = `"${meta.name}" alt kategorisi yalnız kendi alt havuzuna bağlanır.`;
        }
    }

    selectionSet.add(toggledCategoryId);

    return {
        nextSelection: Array.from(selectionSet),
        helperText,
    };
}

export function describeBulkCategoryAssignment(
    categoryIdValue: string,
    subcategoryIdValue: string,
    categories: CategorySelectionTreeNode[]
): string {
    const categoryId = Number.parseInt(categoryIdValue, 10);
    const subcategoryId = Number.parseInt(subcategoryIdValue, 10);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return "Fixed modda kategori seçmezsen ortak atama yapılmaz; CSV modunda ise her satır kendi kategori bilgisini taşır.";
    }

    const root = categories.find((category) => category.id === categoryId);
    if (!root) {
        return "";
    }

    if (!Number.isInteger(subcategoryId) || subcategoryId <= 0) {
        return `"${root.name}" seçili. Tüm kelimeler yalnız ana kategoriye bağlı genel havuza yazılır.`;
    }

    const child = (root.children ?? []).find((item) => item.id === subcategoryId);
    if (!child) {
        return "";
    }

    return `"${root.name} / ${child.name}" seçili. Fixed mod bu durumda yalnız alt kategoriyi kullanır.`;
}
