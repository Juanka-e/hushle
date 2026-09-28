import type { ReactNode } from "react";

interface AdminPageHeaderProps {
    title: string;
    description: string;
    meta?: string;
    icon?: ReactNode;
    action?: ReactNode;
}

export function AdminPageHeader({
    title,
    description,
    meta,
    icon,
    action,
}: AdminPageHeaderProps) {
    return (
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1.5">
                <div className="flex items-center gap-3">
                    {icon ? (
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border/70 bg-card shadow-sm">
                            {icon}
                        </div>
                    ) : null}
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">
                            {title}
                        </h1>
                        {meta ? (
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                {meta}
                            </p>
                        ) : null}
                    </div>
                </div>
                <p className="max-w-3xl text-sm text-muted-foreground">
                    {description}
                </p>
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    );
}

