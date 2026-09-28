export interface PaginatedSlice<T> {
    items: T[];
    page: number;
    pageCount: number;
    total: number;
}

export function paginateItems<T>(
    items: readonly T[],
    page: number,
    pageSize: number
): PaginatedSlice<T> {
    const total = items.length;
    const safePageSize = Math.max(1, pageSize);
    const pageCount = Math.max(1, Math.ceil(total / safePageSize));
    const safePage = Math.min(Math.max(1, page), pageCount);
    const startIndex = (safePage - 1) * safePageSize;

    return {
        items: items.slice(startIndex, startIndex + safePageSize),
        page: safePage,
        pageCount,
        total,
    };
}

export function normalizeSearchTerm(value: string): string {
    return value.trim().toLocaleLowerCase("tr-TR");
}

export function matchesAdminSearch(
    searchTerm: string,
    values: ReadonlyArray<string | null | undefined>
): boolean {
    const normalizedSearch = normalizeSearchTerm(searchTerm);
    if (!normalizedSearch) {
        return true;
    }

    return values.some((value) =>
        value ? normalizeSearchTerm(value).includes(normalizedSearch) : false
    );
}

export function toggleSelection(
    current: ReadonlySet<number>,
    itemId: number
): Set<number> {
    const next = new Set(current);
    if (next.has(itemId)) {
        next.delete(itemId);
    } else {
        next.add(itemId);
    }
    return next;
}

export function replaceSelection(itemIds: readonly number[]): Set<number> {
    return new Set(itemIds);
}

export function hasFullSelection(
    selected: ReadonlySet<number>,
    visibleIds: readonly number[]
): boolean {
    return visibleIds.length > 0 && visibleIds.every((itemId) => selected.has(itemId));
}
