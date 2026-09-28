export interface CategoryReorderUpdate {
    id: number;
    sortOrder: number;
}

export interface CategoryReorderMeta {
    id: number;
    parentId: number | null;
}

export class AdminCategoryReorderValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AdminCategoryReorderValidationError";
    }
}

function invalid(message: string): never {
    throw new AdminCategoryReorderValidationError(message);
}

export function validateAdminCategoryReorderUpdates(
    updates: CategoryReorderUpdate[],
    categories: CategoryReorderMeta[]
): CategoryReorderUpdate[] {
    if (!Array.isArray(updates) || updates.length === 0) {
        invalid("Sıralama listesi boş olamaz.");
    }

    if (updates.length > 100) {
        invalid("Tek seferde çok fazla kategori sırası güncellenemez.");
    }

    const categoryMap = new Map(categories.map((category) => [category.id, category]));
    const rootCategoryIds = categories
        .filter((category) => category.parentId === null)
        .map((category) => category.id)
        .sort((left, right) => left - right);
    const seenIds = new Set<number>();

    for (const update of updates) {
        if (!Number.isInteger(update.id) || update.id <= 0) {
            invalid("Sıralama listesinde geçersiz kategori kimliği var.");
        }

        if (!Number.isInteger(update.sortOrder) || update.sortOrder < 0) {
            invalid("Sıralama listesinde geçersiz sıralama değeri var.");
        }

        if (seenIds.has(update.id)) {
            invalid("Aynı kategori sıralama listesinde birden fazla kez gönderilemez.");
        }
        seenIds.add(update.id);

        const category = categoryMap.get(update.id);
        if (!category) {
            invalid("Sıralanmaya çalışılan kategorilerden biri bulunamadı.");
        }

        if (category.parentId !== null) {
            invalid("Alt kategoriler bu akışta sürüklenemez. Yalnızca ana kategoriler sıralanabilir.");
        }
    }

    const sortedSeenIds = Array.from(seenIds).sort((left, right) => left - right);
    if (sortedSeenIds.length !== rootCategoryIds.length) {
        invalid("Sıralama isteği tüm ana kategorileri içermeli.");
    }

    for (let index = 0; index < rootCategoryIds.length; index += 1) {
        if (sortedSeenIds[index] !== rootCategoryIds[index]) {
            invalid("Sıralama isteği tüm ana kategorileri içermeli.");
        }
    }

    const normalized = updates
        .map((update) => ({
            id: update.id,
            sortOrder: update.sortOrder,
        }))
        .sort((left, right) => left.sortOrder - right.sortOrder);

    normalized.forEach((update, index) => {
        if (update.sortOrder !== index * 10) {
            invalid("Sıralama değerleri 0'dan başlayarak 10'ar artmalıdır.");
        }
    });

    return normalized;
}
