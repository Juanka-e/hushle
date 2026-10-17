import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardAction } from "@/components/ui/card";

// Shared building blocks of the Admin Lab cards, so every section looks and behaves alike.

export type LabRangeDays = 7 | 30;

const RANGE_OPTIONS: ReadonlyArray<{ value: LabRangeDays; label: string }> = [
    { value: 7, label: "7 gün" },
    { value: 30, label: "30 gün" },
];

const numberFormatter = new Intl.NumberFormat("tr-TR");

export function formatLabCount(value: number): string {
    return numberFormatter.format(value);
}

export function LabNotice({
    tone,
    icon,
    children,
    action,
}: {
    tone: "warning" | "info" | "error";
    icon: ReactNode;
    children: ReactNode;
    action?: ReactNode;
}) {
    const toneClass =
        tone === "warning"
            ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
            : tone === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
              : "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200";

    return (
        <div
            role={tone === "info" ? "status" : "alert"}
            className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${toneClass}`}
        >
            <div className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5 shrink-0 [&_svg]:h-4 [&_svg]:w-4">
                    {icon}
                </span>
                <div>{children}</div>
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    );
}

export function LabKpiTile({
    label,
    value,
    caption,
    accent,
    emphasis = false,
    testId,
}: {
    label: string;
    value: string;
    caption?: string;
    accent?: string;
    emphasis?: boolean;
    testId?: string;
}) {
    return (
        <div
            data-testid={testId}
            className={`min-w-0 rounded-2xl border p-4 ${
                emphasis ? "border-primary/40 bg-primary/5" : "border-border/60 bg-muted/20"
            }`}
        >
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {accent ? (
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${accent}`} />
                ) : null}
                {label}
            </dt>
            <dd className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</dd>
            {caption ? (
                <dd className="mt-1 text-xs text-muted-foreground">{caption}</dd>
            ) : null}
        </div>
    );
}

export function LabSectionHeading({ id, children }: { id: string; children: ReactNode }) {
    return (
        <h3
            id={id}
            className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground"
        >
            {children}
        </h3>
    );
}

/** The 7/30 day toggle and refresh button; wraps under the title on narrow cards. */
export function LabRangeActions({
    label,
    days,
    loading,
    onDaysChange,
    onRefresh,
}: {
    label: string;
    days: LabRangeDays;
    loading: boolean;
    onDaysChange: (days: LabRangeDays) => void;
    onRefresh: () => void;
}) {
    return (
        <CardAction className="flex flex-wrap items-center gap-2 @max-xl/card-header:col-start-1 @max-xl/card-header:row-span-1 @max-xl/card-header:row-start-auto @max-xl/card-header:justify-self-start">
            <div
                role="group"
                aria-label={label}
                className="inline-flex rounded-2xl border border-border/70 bg-muted/30 p-1"
            >
                {RANGE_OPTIONS.map((option) => {
                    const active = option.value === days;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onDaysChange(option.value)}
                            className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                active
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
                <RefreshCw
                    aria-hidden="true"
                    className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                />
                Yenile
            </Button>
        </CardAction>
    );
}
