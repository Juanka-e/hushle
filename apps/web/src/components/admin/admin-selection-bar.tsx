import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface AdminSelectionBarProps {
    selectedCount: number;
    children?: ReactNode;
    onClear: () => void;
}

export function AdminSelectionBar({
    selectedCount,
    children,
    onClear,
}: AdminSelectionBarProps) {
    if (selectedCount <= 0) {
        return null;
    }

    return (
        <div className="flex flex-col gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 p-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-medium text-foreground">
                {selectedCount} kayit secildi
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {children}
                <Button type="button" variant="outline" size="sm" onClick={onClear}>
                    Secimi temizle
                </Button>
            </div>
        </div>
    );
}
