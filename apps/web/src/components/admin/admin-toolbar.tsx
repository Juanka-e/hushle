import type { ReactNode } from "react";

interface AdminToolbarProps {
    children: ReactNode;
}

export function AdminToolbar({ children }: AdminToolbarProps) {
    return (
        <div className="rounded-3xl border border-border/70 bg-card/95 p-4 shadow-sm">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                {children}
            </div>
        </div>
    );
}

interface AdminToolbarStatsProps {
    stats: ReadonlyArray<{ label: string; value: string }>;
}

export function AdminToolbarStats({ stats }: AdminToolbarStatsProps) {
    return (
        <div className="flex flex-wrap gap-2">
            {stats.map((stat) => (
                <div
                    key={stat.label}
                    className="rounded-2xl border border-border/60 bg-muted/30 px-3 py-2"
                >
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                        {stat.label}
                    </div>
                    <div className="text-sm font-semibold text-foreground">
                        {stat.value}
                    </div>
                </div>
            ))}
        </div>
    );
}

