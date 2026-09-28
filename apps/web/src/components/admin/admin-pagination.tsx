import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AdminPaginationProps {
    page: number;
    pageCount: number;
    onPageChange: (page: number) => void;
}

export function AdminPagination({
    page,
    pageCount,
    onPageChange,
}: AdminPaginationProps) {
    if (pageCount <= 1) {
        return null;
    }

    return (
        <div className="flex items-center justify-center gap-3">
            <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page <= 1}
            >
                <ChevronLeft size={16} />
            </Button>
            <div className="rounded-full border border-border/70 bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground">
                {page} / {pageCount}
            </div>
            <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => onPageChange(Math.min(pageCount, page + 1))}
                disabled={page >= pageCount}
            >
                <ChevronRight size={16} />
            </Button>
        </div>
    );
}

