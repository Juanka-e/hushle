"use client";

import { useCallback, useMemo, useState } from "react";
import {
    hasFullSelection,
    replaceSelection,
    toggleSelection,
} from "@/lib/admin/admin-table";

export function useAdminSelection(itemIds: readonly number[]) {
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    const toggleOne = useCallback((itemId: number) => {
        setSelectedIds((current) => toggleSelection(current, itemId));
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    const toggleAll = useCallback(() => {
        setSelectedIds((current) =>
            hasFullSelection(current, itemIds)
                ? new Set()
                : replaceSelection(itemIds)
        );
    }, [itemIds]);

    const selectedCount = selectedIds.size;
    const allSelected = useMemo(
        () => hasFullSelection(selectedIds, itemIds),
        [itemIds, selectedIds]
    );

    return {
        selectedIds,
        selectedCount,
        allSelected,
        clearSelection,
        toggleAll,
        toggleOne,
    };
}

