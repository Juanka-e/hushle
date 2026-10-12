"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Info, RefreshCw, WifiOff } from "lucide-react";
import { AdminEmptyState } from "@/components/admin/admin-table-shell";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type {
    ConnectionPauseAnalyticsSummary,
    ConnectionPauseOutcome,
    ConnectionPauseTrigger,
} from "@/lib/analytics/connection-pause-analytics";

type RangeDays = 7 | 30;

const RANGE_OPTIONS: ReadonlyArray<{ value: RangeDays; label: string }> = [
    { value: 7, label: "7 gün" },
    { value: 30, label: "30 gün" },
];

const OUTCOME_ORDER: readonly ConnectionPauseOutcome[] = [
    "resumed_after_reconnect",
    "continued_without_missing",
    "ended_by_host",
    "reset_by_host",
    "abandoned",
];

const OUTCOME_LABELS: Record<ConnectionPauseOutcome, string> = {
    resumed_after_reconnect: "Oyuncu dönünce devam",
    continued_without_missing: "Onsuz devam",
    ended_by_host: "Yönetici bitirdi",
    reset_by_host: "Sıfırlandı",
    abandoned: "Terk edildi",
};

const OUTCOME_SHORT_LABELS: Record<ConnectionPauseOutcome, string> = {
    resumed_after_reconnect: "Oyuncu döndü",
    continued_without_missing: "Onsuz devam",
    ended_by_host: "Yönetici bitirdi",
    reset_by_host: "Sıfırlandı",
    abandoned: "Terk edildi",
};

const OUTCOME_ACCENTS: Record<ConnectionPauseOutcome, string> = {
    resumed_after_reconnect: "bg-emerald-500",
    continued_without_missing: "bg-sky-500",
    ended_by_host: "bg-violet-500",
    reset_by_host: "bg-amber-500",
    abandoned: "bg-rose-500",
};

const TRIGGER_ORDER: readonly ConnectionPauseTrigger[] = [
    "narrator",
    "inspector",
    "team_below_minimum",
];

const TRIGGER_LABELS: Record<ConnectionPauseTrigger, string> = {
    narrator: "Anlatıcı",
    inspector: "Gözetmen",
    team_below_minimum: "Takım 2'nin altına düştü",
};

const numberFormatter = new Intl.NumberFormat("tr-TR");
const decimalFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const dayFormatter = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    weekday: "short",
    timeZone: "UTC",
});

function formatCount(value: number): string {
    return numberFormatter.format(value);
}

function formatShare(part: number, total: number): string {
    if (total <= 0) return "%0";
    return `%${Math.round((part / total) * 100)}`;
}

function formatDuration(seconds: number | null): string {
    if (seconds === null) return "—";
    const rounded = Math.max(0, Math.round(seconds));
    if (rounded < 60) return `${rounded} sn`;
    if (rounded < 3_600) {
        const minutes = Math.floor(rounded / 60);
        const rest = rounded % 60;
        return rest === 0 ? `${minutes} dk` : `${minutes} dk ${String(rest).padStart(2, "0")} sn`;
    }
    const hours = Math.floor(rounded / 3_600);
    const minutes = Math.floor((rounded % 3_600) / 60);
    return minutes === 0 ? `${hours} sa` : `${hours} sa ${String(minutes).padStart(2, "0")} dk`;
}

function formatDay(isoDate: string): string {
    const parsed = new Date(`${isoDate}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) ? dayFormatter.format(parsed) : isoDate;
}

function isSummary(value: unknown): value is ConnectionPauseAnalyticsSummary {
    return (
        typeof value === "object"
        && value !== null
        && "daily" in value
        && Array.isArray((value as { daily: unknown }).daily)
        && "outcomes" in value
        && "byTrigger" in value
    );
}

function Notice({
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

function KpiTile({
    label,
    value,
    caption,
    accent,
    emphasis = false,
}: {
    label: string;
    value: string;
    caption?: string;
    accent?: string;
    emphasis?: boolean;
}) {
    return (
        <div
            className={`rounded-2xl border p-4 ${
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

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
    return (
        <h3
            id={id}
            className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground"
        >
            {children}
        </h3>
    );
}

function LoadingState() {
    return (
        <div className="space-y-4" aria-busy="true" aria-live="polite">
            <span className="sr-only">Bağlantı kopması verileri yükleniyor</span>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }, (_, index) => (
                    <Skeleton key={index} className="h-24 rounded-2xl" />
                ))}
            </div>
            <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
    );
}

function SummaryView({ summary }: { summary: ConnectionPauseAnalyticsSummary }) {
    const resolvedTotal = OUTCOME_ORDER.reduce(
        (total, outcome) => total + summary.outcomes[outcome],
        0
    );
    const triggerTotal = TRIGGER_ORDER.reduce(
        (total, trigger) => total + summary.byTrigger[trigger],
        0
    );
    const averageMissing = summary.paused > 0 ? summary.missingPlayers / summary.paused : null;
    const dailyNewestFirst = [...summary.daily].reverse();

    if (summary.paused === 0 && resolvedTotal === 0) {
        return (
            <AdminEmptyState
                icon={<WifiOff className="h-6 w-6" />}
                title="Bu aralıkta bağlantı kopması yok"
                description={`Son ${summary.days} günde hiçbir maç bağlantı nedeniyle duraklatılmadı.`}
            />
        );
    }

    return (
        <div className="space-y-8">
            <section aria-labelledby="connection-pause-kpis" className="space-y-3">
                <SectionHeading id="connection-pause-kpis">Özet</SectionHeading>
                <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <KpiTile
                        label="Toplam duraklatma"
                        value={formatCount(summary.paused)}
                        caption={`${formatCount(resolvedTotal)} çözüm kaydı`}
                        emphasis
                    />
                    {OUTCOME_ORDER.map((outcome) => (
                        <KpiTile
                            key={outcome}
                            label={OUTCOME_LABELS[outcome]}
                            value={formatCount(summary.outcomes[outcome])}
                            caption={`Çözümlerin ${formatShare(summary.outcomes[outcome], resolvedTotal)}'i`}
                            accent={OUTCOME_ACCENTS[outcome]}
                        />
                    ))}
                </dl>
            </section>

            <div className="grid gap-8 lg:grid-cols-2">
                <section aria-labelledby="connection-pause-triggers" className="space-y-3">
                    <SectionHeading id="connection-pause-triggers">Tetikleyici dağılımı</SectionHeading>
                    <ul className="space-y-3">
                        {TRIGGER_ORDER.map((trigger) => {
                            const count = summary.byTrigger[trigger];
                            const percent = triggerTotal > 0 ? (count / triggerTotal) * 100 : 0;
                            return (
                                <li key={trigger} className="space-y-1.5">
                                    <div className="flex items-baseline justify-between gap-3 text-sm">
                                        <span className="font-medium text-foreground">
                                            {TRIGGER_LABELS[trigger]}
                                        </span>
                                        <span className="tabular-nums text-muted-foreground">
                                            {formatCount(count)} · {formatShare(count, triggerTotal)}
                                        </span>
                                    </div>
                                    <div
                                        aria-hidden="true"
                                        className="h-2 overflow-hidden rounded-full bg-muted"
                                    >
                                        <div
                                            className="h-full rounded-full bg-primary/70"
                                            style={{ width: `${percent}%` }}
                                        />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    {averageMissing !== null ? (
                        <p className="text-xs text-muted-foreground">
                            Duraklatma başına ortalama eksik oyuncu:{" "}
                            <span className="font-semibold text-foreground">
                                {decimalFormatter.format(averageMissing)}
                            </span>
                        </p>
                    ) : null}
                </section>

                <section aria-labelledby="connection-pause-durations" className="space-y-3">
                    <SectionHeading id="connection-pause-durations">Ortalama çözüm süresi</SectionHeading>
                    <dl className="divide-y divide-border/60 rounded-2xl border border-border/60">
                        {OUTCOME_ORDER.map((outcome) => (
                            <div
                                key={outcome}
                                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                            >
                                <dt className="flex items-center gap-2 text-muted-foreground">
                                    <span
                                        aria-hidden="true"
                                        className={`h-2 w-2 shrink-0 rounded-full ${OUTCOME_ACCENTS[outcome]}`}
                                    />
                                    {OUTCOME_LABELS[outcome]}
                                </dt>
                                <dd className="font-semibold tabular-nums text-foreground">
                                    {summary.averageResolutionSeconds[outcome] === null ? (
                                        <span className="relative text-muted-foreground">
                                            <span aria-hidden="true">—</span>
                                            <span className="sr-only">Veri yok</span>
                                        </span>
                                    ) : (
                                        formatDuration(summary.averageResolutionSeconds[outcome])
                                    )}
                                </dd>
                            </div>
                        ))}
                    </dl>
                    <p className="text-xs text-muted-foreground">
                        Duraklatmanın başlangıcından çözüme kadar geçen süre.
                    </p>
                </section>
            </div>

            <section aria-labelledby="connection-pause-daily" className="space-y-3">
                <SectionHeading id="connection-pause-daily">Günlük döküm</SectionHeading>
                <div className="overflow-hidden rounded-2xl border border-border/60">
                    <Table>
                        <TableCaption className="mb-3 text-xs">
                            Günler UTC tarihine göre gruplanır; en yeni gün üstte.
                        </TableCaption>
                        <TableHeader>
                            <TableRow className="bg-muted/20">
                                <TableHead scope="col">Tarih</TableHead>
                                <TableHead scope="col" className="text-right">Duraklatma</TableHead>
                                {OUTCOME_ORDER.map((outcome) => (
                                    <TableHead key={outcome} scope="col" className="text-right">
                                        {OUTCOME_SHORT_LABELS[outcome]}
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {dailyNewestFirst.map((day) => {
                                const quiet =
                                    day.paused === 0
                                    && OUTCOME_ORDER.every((outcome) => day.outcomes[outcome] === 0);
                                return (
                                    <TableRow
                                        key={day.date}
                                        className={quiet ? "text-muted-foreground" : undefined}
                                    >
                                        <TableHead scope="row" className="font-medium">
                                            <time dateTime={day.date}>{formatDay(day.date)}</time>
                                        </TableHead>
                                        <TableCell className="text-right font-semibold tabular-nums">
                                            {formatCount(day.paused)}
                                        </TableCell>
                                        {OUTCOME_ORDER.map((outcome) => (
                                            <TableCell key={outcome} className="text-right tabular-nums">
                                                {formatCount(day.outcomes[outcome])}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </section>
        </div>
    );
}

export function ConnectionPauseCard() {
    const [days, setDays] = useState<RangeDays>(7);
    const [summary, setSummary] = useState<ConnectionPauseAnalyticsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const load = useCallback(async (range: RangeDays, signal?: AbortSignal) => {
        setLoading(true);
        setLoadError(null);
        try {
            const response = await fetch(`/api/admin/lab/connection-pauses?days=${range}`, {
                cache: "no-store",
                signal,
            });
            const payload = (await response.json().catch(() => null)) as unknown;
            if (!response.ok || !isSummary(payload)) {
                const message =
                    payload && typeof payload === "object" && "error" in payload
                        ? String((payload as { error: unknown }).error)
                        : null;
                throw new Error(message || "Bağlantı kopması verileri yüklenemedi.");
            }
            setSummary(payload);
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            setLoadError(
                error instanceof Error && error.message
                    ? error.message
                    : "Bağlantı kopması verileri yüklenemedi."
            );
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(days, controller.signal);
        return () => controller.abort();
    }, [days, load]);

    const showingStale = summary !== null && summary.days !== days;

    return (
        <Card className="border-border/70 shadow-sm">
            <CardHeader className="border-b border-border/60">
                <CardTitle className="flex items-center gap-2 text-lg">
                    <WifiOff aria-hidden="true" className="h-5 w-5 text-rose-500" />
                    Bağlantı kopmaları
                </CardTitle>
                <CardDescription className="col-start-1">
                    Anlatıcı veya gözetmen düştüğünde ya da bir takımda 2&apos;den az çevrimiçi
                    oyuncu kaldığında maç duraklar. Bu kart duraklatmaların neden başladığını ve
                    nasıl çözüldüğünü gösterir.
                </CardDescription>
                <CardAction className="flex flex-wrap items-center gap-2 @max-xl/card-header:col-start-1 @max-xl/card-header:row-span-1 @max-xl/card-header:row-start-auto @max-xl/card-header:justify-self-start">
                    <div
                        role="group"
                        aria-label="Zaman aralığı"
                        className="inline-flex rounded-2xl border border-border/70 bg-muted/30 p-1"
                    >
                        {RANGE_OPTIONS.map((option) => {
                            const active = option.value === days;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => setDays(option.value)}
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
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void load(days)}
                        disabled={loading}
                    >
                        <RefreshCw
                            aria-hidden="true"
                            className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                        />
                        Yenile
                    </Button>
                </CardAction>
            </CardHeader>

            <CardContent className="space-y-6" aria-busy={loading}>
                {loadError ? (
                    <Notice
                        tone="error"
                        icon={<AlertTriangle />}
                        action={
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void load(days)}
                                disabled={loading}
                            >
                                Tekrar dene
                            </Button>
                        }
                    >
                        {loadError}
                    </Notice>
                ) : null}

                {summary && !summary.enabled ? (
                    <Notice tone="info" icon={<Info />}>
                        Veri toplama kapalı (<code>CONNECTION_PAUSE_ANALYTICS_ENABLED=false</code>).
                        Yalnız daha önce kaydedilmiş günler gösterilir.
                    </Notice>
                ) : null}

                {summary && !summary.available ? (
                    <Notice tone="warning" icon={<WifiOff />}>
                        Redis bağlı değil; veri toplanamıyor.
                    </Notice>
                ) : null}

                {summary === null || showingStale ? (
                    loading ? <LoadingState /> : null
                ) : summary.available ? (
                    <SummaryView summary={summary} />
                ) : null}
            </CardContent>
        </Card>
    );
}
