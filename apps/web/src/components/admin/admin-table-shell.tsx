import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface AdminTableShellProps {
    title?: string;
    description?: string;
    loading?: boolean;
    isEmpty?: boolean;
    emptyState?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
}

export function AdminTableShell({
    title,
    description,
    loading = false,
    isEmpty = false,
    emptyState,
    children,
    footer,
}: AdminTableShellProps) {
    return (
        <Card className="overflow-hidden border-border/70 shadow-sm">
            {title || description ? (
                <CardHeader className="border-b border-border/60 bg-muted/20">
                    {title ? <CardTitle>{title}</CardTitle> : null}
                    {description ? (
                        <p className="text-sm text-muted-foreground">{description}</p>
                    ) : null}
                </CardHeader>
            ) : null}
            <CardContent className="p-0">
                {loading ? (
                    <div className="space-y-3 p-6">
                        <Skeleton className="h-10 w-full rounded-xl" />
                        <Skeleton className="h-10 w-full rounded-xl" />
                        <Skeleton className="h-10 w-full rounded-xl" />
                    </div>
                ) : isEmpty ? (
                    emptyState
                ) : (
                    children
                )}
            </CardContent>
            {footer ? <div className="border-t border-border/60 p-4">{footer}</div> : null}
        </Card>
    );
}

interface AdminEmptyStateProps {
    icon?: ReactNode;
    title: string;
    description: string;
}

export function AdminEmptyState({
    icon,
    title,
    description,
}: AdminEmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            {icon ? (
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border/70 bg-muted/30 text-muted-foreground">
                    {icon}
                </div>
            ) : null}
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {description}
            </p>
        </div>
    );
}

