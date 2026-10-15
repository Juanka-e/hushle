"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRightLeft, DatabaseZap, Info } from "lucide-react";
import {
    formatLabCount,
    LabKpiTile,
    LabNotice,
    LabRangeActions,
    LabSectionHeading,
    type LabRangeDays,
} from "@/components/admin/lab/lab-card-parts";
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
    GUEST_SEAT_RETENTION_DAYS,
    type GuestClaimAnalyticsSummary,
    type GuestClaimClosedReason,
    type GuestClaimWaitingReason,
} from "@/lib/analytics/guest-claim-analytics-rules";

const WAITING_ORDER: readonly GuestClaimWaitingReason[] = [
    "email_verification",
    "suspension",
    "retry",
    "other",
];

const WAITING_LABELS: Record<GuestClaimWaitingReason, string> = {
    email_verification: "E-posta doğrulaması bekleniyor",
    suspension: "Süreli askının bitmesi bekleniyor",
    retry: "Hatadan sonra yeniden denenecek",
    other: "Sırada veya diğer",
};

const WAITING_ACCENTS: Record<GuestClaimWaitingReason, string> = {
    email_verification: "bg-sky-500",
    suspension: "bg-amber-500",
    retry: "bg-rose-500",
    other: "bg-slate-400",
};

const CLOSED_ORDER: readonly GuestClaimClosedReason[] = [
    "already_participant",
    "already_recorded",
    "not_eligible",
    "expired",
    "suspended",
    "user_missing",
    "invalid_snapshot",
    "failed",
    "other",
];

const CLOSED_LABELS: Record<GuestClaimClosedReason, string> = {
    already_participant: "Hesap maçta zaten oynamış",
    already_recorded: "Maç hesapta zaten kayıtlı",
    not_eligible: "Ödül kurallarına uymadı",
    expired: "Süre doldu (doğrulanmadı)",
    suspended: "Hesap kalıcı yasaklı",
    user_missing: "Hesap silinmiş",
    invalid_snapshot: "Maç kaydı okunamadı",
    failed: "Hata, deneme hakkı bitti",
    other: "Diğer",
};

const percentFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

function formatPercent(value: number): string {
    return `%${percentFormatter.format(value)}`;
}

function isSummary(value: unknown): value is GuestClaimAnalyticsSummary {
    return (
        typeof value === "object"
        && value !== null
        && "eligible" in value
        && typeof (value as { eligible: unknown }).eligible === "number"
        && "waitingByReason" in value
        && "closedByReason" in value
    );
}

function LoadingState() {
    return (
        <div className="space-y-4" aria-busy="true" aria-live="polite">
            <span className="sr-only">Misafir maç aktarımı verileri yükleniyor</span>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 8 }, (_, index) => (
                    <Skeleton key={index} className="h-24 rounded-2xl" />
                ))}
            </div>
            <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
    );
}

function SummaryView({ summary }: { summary: GuestClaimAnalyticsSummary }) {
    const waitingRows = WAITING_ORDER.filter(
        (reason) => reason !== "other" || summary.waitingByReason.other > 0
    );
    const closedRows = CLOSED_ORDER.filter(
        (reason) => reason !== "other" || summary.closedByReason.other > 0
    );

    return (
        <div className="space-y-8">
            {summary.eligible === 0 ? (
                <LabNotice tone="info" icon={<Info />}>
                    Son {summary.days} günde biten maçlarda kayıtlı misafir koltuğu yok.
                </LabNotice>
            ) : null}

            <section aria-labelledby="guest-claim-kpis" className="space-y-3">
                <LabSectionHeading id="guest-claim-kpis">Özet</LabSectionHeading>
                <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <LabKpiTile
                        testId="guest-claim-eligible"
                        label="Kayıtlı misafir koltuğu"
                        value={formatLabCount(summary.eligible)}
                        caption="Maçı oyuncu olarak bitiren misafirler"
                        emphasis
                    />
                    <LabKpiTile
                        testId="guest-claim-claimed"
                        label="Talep edilen"
                        value={formatLabCount(summary.claimed)}
                        caption={`Talep oranı ${formatPercent(summary.claimRatePercent)}`}
                    />
                    <LabKpiTile
                        testId="guest-claim-settled"
                        label="Hesaba geçen"
                        value={formatLabCount(summary.settled)}
                        caption={`Erken biten maçtan: ${formatLabCount(summary.settledFromHostEnded)} (0 coin)`}
                        accent="bg-emerald-500"
                    />
                    <LabKpiTile
                        testId="guest-claim-coins"
                        label="Verilen coin"
                        value={formatLabCount(summary.coinGranted)}
                        caption="Hesaba geçen maçların toplamı"
                        accent="bg-emerald-500"
                    />
                    <LabKpiTile
                        testId="guest-claim-waiting"
                        label="Bekleyen"
                        value={formatLabCount(summary.waiting)}
                        caption="Doğrulama, askı veya yeniden deneme"
                        accent="bg-sky-500"
                    />
                    <LabKpiTile
                        testId="guest-claim-closed"
                        label="Aktarılmadan kapanan"
                        value={formatLabCount(summary.closed)}
                        caption={`Reddedilen ${formatLabCount(summary.rejected)} · süresi dolan ${formatLabCount(summary.expired)}`}
                        accent="bg-rose-500"
                    />
                    <LabKpiTile
                        testId="guest-claim-accounts"
                        label="Talep eden hesap"
                        value={formatLabCount(summary.distinctAccounts)}
                        caption="Farklı hesap sayısı; kimlik gösterilmez"
                    />
                    <LabKpiTile
                        testId="guest-claim-unclaimed"
                        label="Talep edilmeyen"
                        value={formatLabCount(summary.unclaimed)}
                        caption="Teklif kullanılmadı"
                    />
                </dl>
                {summary.unknownStatus > 0 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                        {formatLabCount(summary.unknownStatus)} koltuk bu sürümün tanımadığı bir
                        durumda; talep edilenlere dahil.
                    </p>
                ) : null}
            </section>

            <div className="grid gap-8 lg:grid-cols-2">
                <section aria-labelledby="guest-claim-waiting" className="min-w-0 space-y-3">
                    <LabSectionHeading id="guest-claim-waiting">Bekleyen talepler</LabSectionHeading>
                    <ul className="space-y-3">
                        {waitingRows.map((reason) => {
                            const count = summary.waitingByReason[reason];
                            const percent = summary.waiting > 0 ? (count / summary.waiting) * 100 : 0;
                            return (
                                <li key={reason} className="space-y-1.5" data-testid={`guest-claim-waiting-${reason}`}>
                                    <div className="flex items-baseline justify-between gap-3 text-sm">
                                        <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                                            <span
                                                aria-hidden="true"
                                                className={`h-2 w-2 shrink-0 rounded-full ${WAITING_ACCENTS[reason]}`}
                                            />
                                            {WAITING_LABELS[reason]}
                                        </span>
                                        <span className="shrink-0 tabular-nums text-muted-foreground">
                                            {formatLabCount(count)}
                                        </span>
                                    </div>
                                    <div
                                        aria-hidden="true"
                                        className="h-2 overflow-hidden rounded-full bg-muted"
                                    >
                                        <div
                                            className={`h-full rounded-full ${WAITING_ACCENTS[reason]}`}
                                            style={{ width: `${percent}%` }}
                                        />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                        Bekleyen talepler kendiliğinden işlenir: e-posta doğrulanınca, askı bitince
                        ya da yeniden deneme zamanı gelince. Bir hafta içinde doğrulanmayan talep
                        kapanır.
                    </p>
                </section>

                <section aria-labelledby="guest-claim-closed" className="min-w-0 space-y-3">
                    <LabSectionHeading id="guest-claim-closed">Aktarılmadan kapananlar</LabSectionHeading>
                    <dl className="divide-y divide-border/60 rounded-2xl border border-border/60">
                        {closedRows.map((reason) => {
                            const count = summary.closedByReason[reason];
                            return (
                                <div
                                    key={reason}
                                    data-testid={`guest-claim-closed-${reason}`}
                                    className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${
                                        count === 0 ? "text-muted-foreground" : ""
                                    }`}
                                >
                                    <dt className="min-w-0">{CLOSED_LABELS[reason]}</dt>
                                    <dd className="shrink-0 font-semibold tabular-nums">
                                        {formatLabCount(count)}
                                    </dd>
                                </div>
                            );
                        })}
                    </dl>
                </section>
            </div>
        </div>
    );
}

export function GuestClaimCard() {
    const [days, setDays] = useState<LabRangeDays>(7);
    const [summary, setSummary] = useState<GuestClaimAnalyticsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const load = useCallback(async (range: LabRangeDays, signal?: AbortSignal) => {
        setLoading(true);
        setLoadError(null);
        try {
            const response = await fetch(`/api/admin/lab/guest-claims?days=${range}`, {
                cache: "no-store",
                signal,
            });
            const payload = (await response.json().catch(() => null)) as unknown;
            if (!response.ok || !isSummary(payload)) {
                const message =
                    payload && typeof payload === "object" && "error" in payload
                        ? String((payload as { error: unknown }).error)
                        : null;
                throw new Error(message || "Misafir maç aktarımı verileri yüklenemedi.");
            }
            setSummary(payload);
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            setLoadError(
                error instanceof Error && error.message
                    ? error.message
                    : "Misafir maç aktarımı verileri yüklenemedi."
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
        <Card data-testid="guest-claim-lab" className="border-border/70 shadow-sm">
            <CardHeader className="border-b border-border/60">
                <CardTitle className="flex items-center gap-2 text-lg">
                    <ArrowRightLeft aria-hidden="true" className="h-5 w-5 text-emerald-500" />
                    Misafir maç aktarımı
                </CardTitle>
                <CardDescription className="col-start-1">
                    Maçı oyuncu olarak bitiren misafir, kayıt olarak ya da giriş yaparak maçı ve
                    coinini bir hesaba geçirebilir. Bu kart teklifin kaç koltuğa çıktığını ve
                    taleplerin nasıl sonuçlandığını gösterir.
                </CardDescription>
                <LabRangeActions
                    label="Misafir maç aktarımı zaman aralığı"
                    days={days}
                    loading={loading}
                    onDaysChange={setDays}
                    onRefresh={() => void load(days)}
                />
            </CardHeader>

            <CardContent className="space-y-6" aria-busy={loading}>
                {loadError ? (
                    <LabNotice
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
                    </LabNotice>
                ) : null}

                {summary && !summary.available && !showingStale && !loadError ? (
                    <LabNotice
                        tone="error"
                        icon={<DatabaseZap />}
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
                        Veritabanından okunamadı; misafir aktarım verileri gösterilemiyor.
                    </LabNotice>
                ) : null}

                {summary === null || showingStale ? (
                    loading ? <LoadingState /> : null
                ) : summary.available ? (
                    <SummaryView summary={summary} />
                ) : null}

                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                        Koltuk verisi {GUEST_SEAT_RETENTION_DAYS} gün tutulur ve maç kaydıyla birlikte silinir. Pencere
                        maçın bitiş zamanına göre hesaplanır (son {days} × 24 saat); her koltuk şu
                        anki durumuyla sayılır. Kişisel veri gösterilmez.
                    </span>
                </p>
            </CardContent>
        </Card>
    );
}
