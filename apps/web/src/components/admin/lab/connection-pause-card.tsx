"use client";

import { AlertTriangle, Info, WifiOff } from "lucide-react";
import { AdminEmptyState } from "@/components/admin/admin-table-shell";
import {
    formatLabCount as formatCount,
    LabKpiTile as KpiTile,
    LabNotice as Notice,
    LabRangeActions,
    LabSectionHeading as SectionHeading,
    type LabRangeDays as RangeDays,
} from "@/components/admin/lab/lab-card-parts";
import { useLabSummary } from "@/components/admin/lab/use-lab-summary";
import { Button } from "@/components/ui/button";
import {
    Card,
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

const decimalFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const dayFormatter = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    weekday: "short",
    timeZone: "UTC",
});

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

function summaryUrl(range: RangeDays): string {
    return `/api/admin/lab/connection-pauses?days=${range}`;
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
    const { days, setDays, summary, loading, loadError, reload } = useLabSummary({
        url: summaryUrl,
        isSummary,
        fallbackError: "Bağlantı kopması verileri yüklenemedi.",
    });

    const showingStale = summary !== null && summary.days !== days;

    return (
        <Card data-testid="connection-pause-lab" className="border-border/70 shadow-sm">
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
                <LabRangeActions
                    label="Bağlantı kopmaları zaman aralığı"
                    days={days}
                    loading={loading}
                    onDaysChange={setDays}
                    onRefresh={() => void reload()}
                />
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
                                onClick={() => void reload()}
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
