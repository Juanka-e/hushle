"use client";

import { useCallback, useEffect, useState } from "react";
import {
    AlertTriangle,
    CheckCircle2,
    CreditCard,
    RefreshCw,
    RotateCcw,
    Search,
    ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { AdminEmptyState, AdminTableShell } from "@/components/admin/admin-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ReversalRequest = {
    id: string;
    outcome: "refund" | "chargeback";
    status: "pending" | "processing" | "provider_failed" | "provider_review";
    executionMode: "externally_confirmed" | "provider_api";
    externalReference: string;
    reason: string;
    createdAt: string;
    requestedBy: { id: number; username: string };
    providerRefundAttempt: {
        id: string;
        status: "processing" | "succeeded" | "failed" | "uncertain";
        amountMinor: number;
        currency: string;
        referenceNo: string;
        providerRefundReference: string | null;
        errorCode: string | null;
        startedAt: string;
        completedAt: string | null;
        lastCheckedAt: string | null;
    } | null;
};
type PaymentItem = {
    id: string;
    status: string;
    provider: string;
    productNameSnapshot: string;
    productKind: string;
    totalAmountMinor: number;
    currency: string;
    createdAt: string;
    user: { id: number; username: string };
    fulfillment: { status: string; errorCode: string | null } | null;
    reversal: {
        id: string;
        outcome: string;
        status: string;
        externalReference: string;
        reason: string;
        evidence: unknown;
        manualReviewCase: {
            id: string;
            status: "open" | "resolved" | "waived";
            reasonCode: string;
            unrecoveredCoin: number | null;
            resolutionNote: string | null;
            resolvedAt: string | null;
            noticeSentAt: string | null;
            resolvedBy: { id: number; username: string } | null;
        } | null;
    } | null;
    reversalRequests: ReversalRequest[];
    reconciliationCase: {
        id: string;
        status: string;
        reasonCode: string;
        attemptCount: number;
        lastErrorCode: string | null;
    } | null;
    webhookEvents: Array<{
        id: string;
        status: string;
        outcome: string;
        lastErrorCode: string | null;
        attemptCount: number;
    }>;
};
type PaymentResponse = {
    items: PaymentItem[];
    page: number;
    pages: number;
    total: number;
    counts: { openCases: number; deadLetters: number; pendingApprovals: number; openManualReviews: number };
    alerts: {
        openCaseThresholdExceeded: boolean;
        deadLetterThresholdExceeded: boolean;
        caseAlertThreshold: number;
        deadLetterAlertThreshold: number;
        oldestOpenCaseAt: string | null;
    };
    schedulerHealth: Array<{
        job: "payment-webhook" | "payment-reconciliation";
        status: "healthy" | "stale" | "missing" | "not_configured" | "unavailable";
        lastCompletedAt: string | null;
        durationMs: number | null;
        maxAgeSeconds: number;
    }>;
    refundExecutionByProvider: {
        paytr: RefundReadiness;
        shopier_v2: RefundReadiness;
    };
    checkoutControl: {
        control: {
            paused: boolean;
            rolloutPercent: number;
            revision: number;
            lastChangeReason: string;
        };
        available: boolean;
        source: "default" | "stored" | "invalid";
        updatedAt: string | null;
        updatedBy: { id: number; username: string } | null;
    };
    checkoutActivation: {
        activeProvider: string | null;
        runtimeReady: boolean;
        legalReady: boolean;
        providerSurfaceReady: boolean;
        rolloutSeedConfigured: boolean;
    };
};

type RefundReadiness = {
    provider: string;
    mode: "disabled" | "sandbox" | "live" | "invalid";
    ready: boolean;
    issues: string[];
};

function schedulerStatusText(status: PaymentResponse["schedulerHealth"][number]["status"]): string {
    return {
        healthy: "Çalışıyor",
        stale: "Gecikmiş",
        missing: "Çalışma kanıtı yok",
        not_configured: "Yapılandırılmadı",
        unavailable: "Durum okunamadı",
    }[status];
}

function money(minor: number, currency: string): string {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(minor / 100);
}

function refundReadinessMessage(issue: string): string {
    const messages: Record<string, string> = {
        refund_disabled: "Sandbox iade modu kapalı.",
        refund_mode_invalid: "İade modu geçersiz.",
        refund_checkout_mode_mismatch: "İade ve checkout modları uyuşmuyor.",
        shopier_personal_access_token_invalid: "Shopier erişim anahtarı eksik veya geçersiz.",
        shopier_live_acceptance_missing: "Shopier canlı kabul kaydı bulunmuyor.",
        shopier_live_acceptance_evidence_invalid: "Shopier canlı kabul kanıtı geçersiz.",
        paytr_merchant_id_missing: "PayTR mağaza numarası eksik.",
        paytr_merchant_id_invalid: "PayTR mağaza numarası geçersiz.",
        paytr_merchant_key_missing: "PayTR merchant key eksik.",
        paytr_merchant_key_invalid: "PayTR merchant key geçersiz.",
        paytr_merchant_salt_missing: "PayTR merchant salt eksik.",
        paytr_merchant_salt_invalid: "PayTR merchant salt geçersiz.",
    };
    return messages[issue] ?? "İade yapılandırması tamamlanmamış.";
}

async function readError(response: Response, fallback: string): Promise<string> {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error || fallback;
}

function readCoinReversalEvidence(value: unknown): {
    reversedCoin: number | null;
    unrecoveredCoin: number | null;
} | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const evidence = value as Record<string, unknown>;
    if (evidence.kind !== "coin_pack" || typeof evidence.policy !== "string") return null;
    return {
        reversedCoin: typeof evidence.reversedCoin === "number" ? evidence.reversedCoin : null,
        unrecoveredCoin: typeof evidence.unrecoveredCoin === "number" ? evidence.unrecoveredCoin : null,
    };
}

export default function AdminPaymentsPage() {
    const [data, setData] = useState<PaymentResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState("all");
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [checkoutPaused, setCheckoutPaused] = useState(true);
    const [rolloutPercent, setRolloutPercent] = useState(0);
    const [rolloutReason, setRolloutReason] = useState("");
    const [rolloutConfirmation, setRolloutConfirmation] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: "20", status });
            if (search) params.set("search", search);
            const response = await fetch(`/api/admin/payments?${params}`, { cache: "no-store" });
            const payload = await response.json().catch(() => null) as PaymentResponse | { error?: string } | null;
            if (!response.ok || !payload || !("items" in payload)) {
                throw new Error(payload && "error" in payload ? payload.error : "Ödemeler yüklenemedi.");
            }
            setData(payload);
            setCheckoutPaused(payload.checkoutControl.control.paused);
            setRolloutPercent(payload.checkoutControl.control.rolloutPercent);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Ödemeler yüklenemedi.");
        } finally {
            setLoading(false);
        }
    }, [page, search, status]);

    async function updateCheckoutControl(input: {
        paused: boolean;
        rolloutPercent: number;
        reason: string;
        confirmation?: string;
    }) {
        if (!data) return;
        setBusyId("checkout-control");
        try {
            const response = await fetch("/api/admin/payments/checkout-control", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    ...input,
                    expectedRevision: data.checkoutControl.control.revision,
                }),
            });
            if (!response.ok) throw new Error(await readError(response, "Ödeme kontrolü güncellenemedi."));
            toast.success(input.paused ? "Yeni checkout işlemleri durduruldu." : "Checkout rollout ayarı güncellendi.");
            setRolloutReason("");
            setRolloutConfirmation("");
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Ödeme kontrolü güncellenemedi.");
        } finally {
            setBusyId(null);
        }
    }
    useEffect(() => { void load(); }, [load]);

    async function post(url: string, body: object, fallback: string): Promise<Record<string, unknown>> {
        const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(await readError(response, fallback));
        return await response.json().catch(() => ({})) as Record<string, unknown>;
    }

    async function retryWebhook(eventId: string) {
        setBusyId(eventId);
        try {
            await post(`/api/admin/payments/webhooks/${eventId}/retry`, { confirmationEventId: eventId }, "Webhook yeniden kuyruğa alınamadı.");
            toast.success("Webhook kontrollü olarak yeniden kuyruğa alındı.");
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Webhook yeniden kuyruğa alınamadı.");
        } finally { setBusyId(null); }
    }

    async function reconcileOrder(orderId: string) {
        setBusyId(orderId);
        try {
            const result = await post(`/api/admin/payments/${orderId}/reconcile`, { confirmationOrderId: orderId }, "Durum sorgusu tamamlanamadı.");
            toast.success(result.outcome === "fulfilled" ? "Sipariş doğrulandı ve tamamlandı." : "Uzlaştırma vakası güncellendi.");
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Durum sorgusu tamamlanamadı.");
        } finally { setBusyId(null); }
    }

    async function requestReversal(event: React.FormEvent<HTMLFormElement>, order: PaymentItem) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusyId(order.id);
        try {
            await post(`/api/admin/payments/${order.id}/reversal`, {
                executionMode: form.get("executionMode"),
                outcome: form.get("outcome"),
                externalReference: form.get("externalReference") || undefined,
                reason: form.get("reason"),
                confirmationOrderId: form.get("confirmationOrderId"),
            }, "Ters işlem talebi oluşturulamadı.");
            toast.success("Talep oluşturuldu. Farklı bir adminin onayı gerekiyor.");
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Ters işlem talebi oluşturulamadı.");
        } finally { setBusyId(null); }
    }

    async function reviewReversal(event: React.FormEvent<HTMLFormElement>, request: ReversalRequest) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusyId(request.id);
        try {
            const response = await post(`/api/admin/payments/reversal-requests/${request.id}/review`, {
                action: form.get("action"),
                reviewNote: form.get("reviewNote"),
                confirmationRequestId: form.get("confirmationRequestId"),
            }, "Reversal incelemesi tamamlanamadı.");
            const result = response.result as { outcome?: string } | undefined;
            if (result?.outcome === "provider_review") toast.warning("Sağlayıcı sonucu belirsiz. Yerel reversal uygulanmadı.");
            else if (result?.outcome === "provider_failed") toast.error("Sağlayıcı iade isteğini reddetti. Yerel reversal uygulanmadı.");
            else toast.success(form.get("action") === "approve" ? "Talep onaylandı ve yerel reversal uygulandı." : "Talep reddedildi.");
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Reversal incelemesi tamamlanamadı.");
        } finally { setBusyId(null); }
    }

    async function recoverProviderRefund(event: React.FormEvent<HTMLFormElement>, request: ReversalRequest) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusyId(request.id);
        try {
            const response = await post(`/api/admin/payments/reversal-requests/${request.id}/recover`, {
                confirmationRequestId: form.get("confirmationRequestId"),
            }, "İade durumu doğrulanamadı.");
            const result = response.result as { outcome?: string } | undefined;
            if (result?.outcome === "applied") toast.success("PayTR iadesi doğrulandı ve yerel reversal uygulandı.");
            else toast.warning("Tamamlanmış iade kanıtı bulunamadı; yerel durum değiştirilmedi.");
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "İade durumu doğrulanamadı.");
        } finally { setBusyId(null); }
    }

    async function resolveCase(event: React.FormEvent<HTMLFormElement>, caseId: string) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusyId(caseId);
        try {
            await post(`/api/admin/payments/cases/${caseId}/resolution`, {
                resolution: form.get("resolution"),
                note: form.get("note"),
                confirmationCaseId: form.get("confirmationCaseId"),
            }, "Uzlaştırma vakası çözülemedi.");
            toast.success("Uzlaştırma vakası güncellendi.");
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Uzlaştırma vakası çözülemedi.");
        } finally { setBusyId(null); }
    }

    async function resolveManualReview(event: React.FormEvent<HTMLFormElement>, reversalId: string) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusyId(reversalId);
        try {
            await post(`/api/admin/payments/reversals/${reversalId}/manual-review`, {
                decision: form.get("decision"),
                resolutionNote: form.get("resolutionNote"),
                notifyUser: form.get("notifyUser") === "on",
                noticeMessage: form.get("noticeMessage") || undefined,
                confirmationReversalId: form.get("confirmationReversalId"),
            }, "Manuel inceleme tamamlanamadı.");
            toast.success("Manuel inceleme kararı kaydedildi.");
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Manuel inceleme tamamlanamadı.");
        } finally { setBusyId(null); }
    }

    const alertActive = Boolean(
        data?.alerts.openCaseThresholdExceeded || data?.alerts.deadLetterThresholdExceeded
    );
    const rolloutExpands = Boolean(
        data
        && !checkoutPaused
        && (
            data.checkoutControl.control.paused
            || rolloutPercent > data.checkoutControl.control.rolloutPercent
        )
    );

    return (
        <div className="space-y-6 p-4 md:p-6">
            <AdminPageHeader
                title="Ödeme Operasyonları"
                description="Harici işlemler yerel reversal ile kaydedilir. Sağlayıcı API iadesi yalnız hazır yapılandırmada ve farklı bir adminin ikinci onayıyla çalışır."
                meta={data ? `${data.counts.openCases} açık vaka · ${data.counts.pendingApprovals} onay bekliyor` : undefined}
                icon={<CreditCard className="h-5 w-5 text-emerald-600" />}
                action={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Yenile</Button>}
            />

            {data ? (
                <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                    <div className="flex flex-col gap-3 border-b bg-muted/25 p-4 md:flex-row md:items-center md:justify-between md:p-5">
                        <div className="flex items-start gap-3">
                            <div className={`mt-0.5 rounded-xl p-2 ${data.checkoutControl.control.paused ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"}`}>
                                <ShieldAlert className="h-5 w-5" />
                            </div>
                            <div>
                                <h2 className="font-semibold">Checkout yayın kontrolü</h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Yalnız yeni ödeme oturumlarını yönetir. Callback, webhook ve uzlaştırma bekleyen siparişleri tamamlamaya devam eder.
                                </p>
                            </div>
                        </div>
                        <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${data.checkoutControl.control.paused ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"}`}>
                            {data.checkoutControl.control.paused
                                ? "Yeni checkout durduruldu"
                                : `Açık · kullanıcıların %${data.checkoutControl.control.rolloutPercent}'i`}
                        </span>
                    </div>

                    <div className="grid gap-4 p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
                        <div className="space-y-4">
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                {[
                                    ["Runtime", data.checkoutActivation.runtimeReady],
                                    ["Hukuki kanıt", data.checkoutActivation.legalReady],
                                    ["Provider yüzeyi", data.checkoutActivation.providerSurfaceReady],
                                    ["Rollout seed", data.checkoutActivation.rolloutSeedConfigured],
                                ].map(([label, ready]) => (
                                    <div key={String(label)} className="rounded-xl border bg-background p-3">
                                        <p className="text-xs text-muted-foreground">{label}</p>
                                        <p className={`mt-1 text-sm font-semibold ${ready ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                                            {ready ? "Hazır" : "Hazır değil"}
                                        </p>
                                    </div>
                                ))}
                            </div>
                            <div className="rounded-xl border bg-muted/20 p-3 text-sm">
                                <p><strong>Aktif provider:</strong> {data.checkoutActivation.activeProvider ?? "Seçilmedi"}</p>
                                <p className="mt-1 text-muted-foreground">
                                    Son değişiklik: {data.checkoutControl.updatedAt ? new Date(data.checkoutControl.updatedAt).toLocaleString("tr-TR") : "Henüz yok"}
                                    {data.checkoutControl.updatedBy ? ` · @${data.checkoutControl.updatedBy.username}` : ""}
                                    {` · rev ${data.checkoutControl.control.revision}`}
                                </p>
                                <p className="mt-1 text-muted-foreground">Not: {data.checkoutControl.control.lastChangeReason}</p>
                            </div>
                            {!data.checkoutControl.available ? (
                                <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
                                    Kontrol kaydı geçersiz. Sistem fail-closed davranır ve yeni checkout açmaz.
                                </div>
                            ) : null}
                        </div>

                        <form
                            className="space-y-3 rounded-xl border bg-background p-4"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void updateCheckoutControl({
                                    paused: checkoutPaused,
                                    rolloutPercent,
                                    reason: rolloutReason,
                                    confirmation: rolloutConfirmation || undefined,
                                });
                            }}
                        >
                            <label className="block text-sm font-medium">
                                Yeni checkout durumu
                                <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={checkoutPaused ? "paused" : "open"} onChange={(event) => setCheckoutPaused(event.target.value === "paused")}>
                                    <option value="paused">Durduruldu</option>
                                    <option value="open">Kademeli olarak açık</option>
                                </select>
                            </label>
                            <label className="block text-sm font-medium">
                                Kullanıcı rollout yüzdesi
                                <Input className="mt-1" type="number" min={checkoutPaused ? 0 : 1} max={100} value={rolloutPercent} onChange={(event) => setRolloutPercent(Number(event.target.value))} required />
                            </label>
                            <label className="block text-sm font-medium">
                                Operasyon notu
                                <Input className="mt-1" value={rolloutReason} onChange={(event) => setRolloutReason(event.target.value)} minLength={3} maxLength={300} placeholder="Neden değiştirildi?" required />
                            </label>
                            {rolloutExpands ? (
                                <label className="block text-sm font-medium text-amber-800 dark:text-amber-200">
                                    Onay için ODEMEYI AC yazın
                                    <Input className="mt-1" value={rolloutConfirmation} onChange={(event) => setRolloutConfirmation(event.target.value)} autoComplete="off" required />
                                </label>
                            ) : null}
                            <div className="grid gap-2 sm:grid-cols-2">
                                <Button type="submit" disabled={busyId === "checkout-control" || !data.checkoutControl.available}>
                                    {busyId === "checkout-control" ? "Kaydediliyor..." : "Kontrolü kaydet"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="destructive"
                                    disabled={busyId === "checkout-control" || data.checkoutControl.control.paused || !data.checkoutControl.available}
                                    onClick={() => void updateCheckoutControl({
                                        paused: true,
                                        rolloutPercent: data.checkoutControl.control.rolloutPercent,
                                        reason: "Admin acil durdurma",
                                    })}
                                >
                                    Acil durdur
                                </Button>
                            </div>
                        </form>
                    </div>
                </section>
            ) : null}

            {data ? (
                <div className="grid gap-3 md:grid-cols-2">
                    {(["paytr", "shopier_v2"] as const).map((provider) => {
                        const readiness = data.refundExecutionByProvider[provider];
                        const providerName = provider === "paytr" ? "PayTR sandbox" : "Shopier canlı";
                        return <div key={provider} className={`flex gap-3 rounded-2xl border p-4 ${readiness.ready ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"}`}>
                            {readiness.ready ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
                            <div>
                                <strong>{providerName} iade {readiness.ready ? "hazır" : "kapalı"}</strong>
                                <p className="mt-1 text-sm opacity-80">{readiness.ready
                                    ? "Tam iade, farklı bir adminin ikinci onayıyla çalışır; belirsiz sonuçta haklar değiştirilmez."
                                    : readiness.issues.map(refundReadinessMessage).join(" ")}</p>
                            </div>
                        </div>;
                    })}
                </div>
            ) : null}

            {alertActive ? (
                <div className="flex gap-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-rose-950 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div><strong>Operasyon eşiği aşıldı</strong><p className="mt-1 text-sm opacity-80">Açık vaka eşiği {data?.alerts.caseAlertThreshold}, dead-letter eşiği {data?.alerts.deadLetterAlertThreshold}. Otomatik ceza veya bakiye kesintisi uygulanmaz; operatör incelemesi gerekir.</p></div>
                </div>
            ) : null}

            {data ? (
                <div className="grid gap-3 md:grid-cols-2">
                    {data.schedulerHealth.map((scheduler) => {
                        const healthy = scheduler.status === "healthy";
                        return (
                            <div key={scheduler.job} className={`flex gap-3 rounded-2xl border p-4 ${healthy ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20"}`}>
                                {healthy ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
                                <div>
                                    <strong>{scheduler.job === "payment-webhook" ? "Webhook worker" : "Uzlaştırma worker"}: {schedulerStatusText(scheduler.status)}</strong>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {scheduler.lastCompletedAt
                                            ? `Son başarılı çalışma: ${new Date(scheduler.lastCompletedAt).toLocaleString("tr-TR")} · ${scheduler.durationMs ?? 0} ms`
                                            : "Henüz başarılı execute heartbeat kaydı bulunmuyor."}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Açık manuel inceleme" value={data?.counts.openManualReviews ?? 0} />
                <Metric label="Açık uzlaştırma" value={data?.counts.openCases ?? 0} tone="amber" />
                <Metric label="İkinci onay bekliyor" value={data?.counts.pendingApprovals ?? 0} tone="sky" />
                <Metric label="Dead-letter" value={data?.counts.deadLetters ?? 0} tone="rose" />
            </div>

            <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); setPage(1); }}>
                <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Sipariş, sağlayıcı referansı veya kullanıcı ara" /></div>
                <select className="h-10 rounded-md border bg-background px-3 text-sm" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">Tüm durumlar</option><option value="awaiting_payment">Ödeme bekliyor</option><option value="fulfilled">Tamamlandı</option><option value="failed">Başarısız</option><option value="refunded">İade</option><option value="chargeback">Ters ibraz</option></select>
                <Button type="submit">Ara</Button>
            </form>

            <AdminTableShell title="Sipariş akışı" description="Coin reversal yalnız ilgili ödeme lotunun kalan kısmını geri alır; kazanılmış coinlere dokunmaz. Harcanmış ücretli kısım manuel incelemede görünür." loading={loading} isEmpty={!loading && (data?.items.length ?? 0) === 0} emptyState={<AdminEmptyState icon={<CreditCard />} title="Sipariş bulunamadı" description="Bu filtrede ödeme siparişi yok." />} footer={data ? <AdminPagination page={page} pageCount={data.pages} onPageChange={setPage} /> : undefined}>
                <div className="divide-y divide-border/60">
                    {data?.items.map((item) => {
                        const webhook = item.webhookEvents[0];
                        const activeRequest = item.reversalRequests[0];
                        const coinReversal = readCoinReversalEvidence(item.reversal?.evidence);
                        const manualReview = item.reversal?.manualReviewCase;
                        const blocksNewRequest = activeRequest && ["pending", "processing", "provider_review"].includes(activeRequest.status);
                        const canRequest = !blocksNewRequest && (
                            (item.status === "fulfilled" && item.fulfillment?.status === "completed" && !item.reversal)
                            || (item.status === "refunded" && item.reversal?.outcome === "refund")
                        );
                        const terminal = ["fulfilled", "failed", "expired", "refunded", "chargeback"].includes(item.status);
                        return (
                            <article key={item.id} className="space-y-4 p-4 lg:p-5">
                                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] lg:items-start">
                                    <div className="min-w-0"><div className="flex flex-wrap gap-2"><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{item.status}</span><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">{item.provider}</span></div><h2 className="mt-2 font-semibold">{item.productNameSnapshot}</h2><p className="truncate text-sm text-muted-foreground">@{item.user.username} · #{item.user.id} · {item.id}</p></div>
                                    <dl className="grid grid-cols-2 gap-2 text-xs"><div><dt className="text-muted-foreground">Tutar</dt><dd className="font-semibold">{money(item.totalAmountMinor, item.currency)}</dd></div><div><dt className="text-muted-foreground">Oluşturuldu</dt><dd className="font-semibold">{new Date(item.createdAt).toLocaleString("tr-TR")}</dd></div><div><dt className="text-muted-foreground">Fulfillment</dt><dd className="font-semibold">{item.fulfillment?.status ?? "-"}</dd></div><div><dt className="text-muted-foreground">Ürün tipi</dt><dd className="font-semibold">{item.productKind}</dd></div></dl>
                                    <div className="flex flex-col gap-2">{item.provider === "paytr" && ["awaiting_payment", "paid"].includes(item.status) ? <Button variant="outline" disabled={busyId === item.id} onClick={() => void reconcileOrder(item.id)}><RefreshCw className="mr-2 h-4 w-4" />Durumu kontrol et</Button> : null}{webhook?.status === "dead_letter" ? <Button variant="outline" disabled={busyId === webhook.id} onClick={() => void retryWebhook(webhook.id)}><RotateCcw className="mr-2 h-4 w-4" />Webhook retry</Button> : null}</div>
                                </div>

                                {item.reconciliationCase?.status === "open" ? (
                                    <details className="rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
                                        <summary className="cursor-pointer font-semibold">Uzlaştırma: {item.reconciliationCase.reasonCode} · {item.reconciliationCase.attemptCount} deneme</summary>
                                        <p className="mt-2 text-muted-foreground">Resolved yalnız terminal siparişlerde kullanılabilir. Ignored otomatik sorgulamayı durdurur ve açık operatör kararını kaydeder.</p>
                                        <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={(event) => void resolveCase(event, item.reconciliationCase!.id)}>
                                            <select name="resolution" className="h-10 rounded-md border bg-background px-3 text-sm" required><option value="resolved" disabled={!terminal}>Çözüldü</option><option value="ignored">Bilinçli olarak yok say</option></select>
                                            <Input name="note" placeholder="Operasyon çözüm notu" minLength={3} maxLength={500} required />
                                            <Input name="confirmationCaseId" placeholder={`Onay için vaka ID: ${item.reconciliationCase.id}`} required />
                                            <Button type="submit" variant="outline" disabled={busyId === item.reconciliationCase.id}><CheckCircle2 className="mr-2 h-4 w-4" />Vakayı güncelle</Button>
                                        </form>
                                    </details>
                                ) : null}

                                {activeRequest ? (
                                    <details open className="rounded-xl border border-sky-300 bg-sky-50 p-3 text-sm dark:bg-sky-950/20">
                                        <summary className="cursor-pointer font-semibold text-sky-950 dark:text-sky-100">{activeRequest.status === "pending" ? "İkinci admin onayı bekleniyor" : activeRequest.status === "provider_failed" ? "Sağlayıcı iade isteğini reddetti" : "Sağlayıcı iadesi doğrulama bekliyor"} · {activeRequest.outcome}</summary>
                                        <p className="mt-2">Talep eden: <strong>@{activeRequest.requestedBy.username}</strong> · {new Date(activeRequest.createdAt).toLocaleString("tr-TR")}</p>
                                        <p className="mt-1 text-muted-foreground">{activeRequest.reason} · Mod: {activeRequest.executionMode} · Referans: {activeRequest.externalReference}</p>
                                        {activeRequest.providerRefundAttempt ? <p className="mt-2 text-xs text-muted-foreground">Deneme: {activeRequest.providerRefundAttempt.status} · {money(activeRequest.providerRefundAttempt.amountMinor, activeRequest.providerRefundAttempt.currency)} · Sağlayıcı iade ID: {activeRequest.providerRefundAttempt.providerRefundReference ?? "henüz yok"} · Hata: {activeRequest.providerRefundAttempt.errorCode ?? "-"}</p> : null}
                                        {activeRequest.status === "pending" ? <><p className="mt-2 text-xs text-muted-foreground">Talebi oluşturan admin kendi talebini onaylayamaz veya reddedemez.</p>
                                        <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={(event) => void reviewReversal(event, activeRequest)}>
                                            <select name="action" className="h-10 rounded-md border bg-background px-3 text-sm" required><option value="approve">Onayla ve uygula</option><option value="reject">Reddet</option></select>
                                            <Input name="reviewNote" placeholder="İkinci admin inceleme notu" minLength={3} maxLength={500} required />
                                            <Input name="confirmationRequestId" placeholder={`Onay için talep ID: ${activeRequest.id}`} required />
                                            <Button type="submit" variant="outline" disabled={busyId === activeRequest.id}><ShieldAlert className="mr-2 h-4 w-4" />Kararı kaydet</Button>
                                        </form></> : null}
                                        {["processing", "provider_review"].includes(activeRequest.status) ? <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={(event) => void recoverProviderRefund(event, activeRequest)}>
                                            <Input name="confirmationRequestId" placeholder={`Doğrulama için talep ID: ${activeRequest.id}`} required />
                                            <Button type="submit" variant="outline" disabled={busyId === activeRequest.id}><RefreshCw className="mr-2 h-4 w-4" />Sağlayıcı durumunu doğrula</Button>
                                        </form> : null}
                                    </details>
                                ) : null}

                                {item.reversal ? <div className="rounded-xl border border-rose-300/70 bg-rose-50 p-3 text-sm dark:bg-rose-950/20"><strong>{item.reversal.outcome}</strong> · {item.reversal.status} · {item.reversal.externalReference}<p className="mt-1 text-muted-foreground">{item.reversal.reason}</p>{coinReversal ? <p className="mt-2 font-medium">{coinReversal.reversedCoin === null ? "Eski coin kaydı: otomatik bakiye işlemi yapılmadı." : `${coinReversal.reversedCoin.toLocaleString("tr-TR")} coin geri alındı · ${(coinReversal.unrecoveredCoin ?? 0).toLocaleString("tr-TR")} coin manuel inceleme`}</p> : null}</div> : null}

                                {manualReview?.status === "open" && item.reversal ? (
                                    <details open className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm dark:bg-orange-950/20">
                                        <summary className="cursor-pointer font-semibold">Açık manuel inceleme · {manualReview.reasonCode}</summary>
                                        <p className="mt-2 text-muted-foreground">
                                            {manualReview.unrecoveredCoin === null
                                                ? "Tutar kanıtı eski kayıt yapısı nedeniyle bilinmiyor."
                                                : `${manualReview.unrecoveredCoin.toLocaleString("tr-TR")} coin otomatik olarak geri alınamadı.`}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">Bu karar bakiye, askıya alma veya ekonomi guard ayarını değiştirmez.</p>
                                        <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={(event) => void resolveManualReview(event, item.reversal!.id)}>
                                            <select name="decision" className="h-10 rounded-md border bg-background px-3 text-sm" required><option value="resolved">İncelendi ve kapatıldı</option><option value="waived">İşlem yapılmadan kapatıldı</option></select>
                                            <Input name="resolutionNote" placeholder="Zorunlu operasyon karar notu" minLength={3} maxLength={500} required />
                                            <label className="flex min-h-10 items-center gap-2 rounded-md border bg-background px-3 text-sm"><input name="notifyUser" type="checkbox" /> Oyuncuya genel bildirim gönder</label>
                                            <Input name="noticeMessage" placeholder="Bildirim mesajı (boşsa güvenli varsayılan metin)" maxLength={500} />
                                            <Input name="confirmationReversalId" placeholder={`Onay için reversal ID: ${item.reversal.id}`} required />
                                            <Button type="submit" variant="outline" disabled={busyId === item.reversal.id}><CheckCircle2 className="mr-2 h-4 w-4" />İncelemeyi kapat</Button>
                                        </form>
                                    </details>
                                ) : manualReview ? (
                                    <div className="rounded-xl border bg-muted/30 p-3 text-sm">
                                        <strong>{manualReview.status === "resolved" ? "İnceleme tamamlandı" : "İşlem yapılmadan kapatıldı"}</strong>
                                        <p className="mt-1 text-muted-foreground">{manualReview.resolutionNote}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {manualReview.resolvedBy ? `@${manualReview.resolvedBy.username}` : "Eski kayıt"}
                                            {manualReview.resolvedAt ? ` · ${new Date(manualReview.resolvedAt).toLocaleString("tr-TR")}` : ""}
                                            {manualReview.noticeSentAt ? " · Oyuncuya bildirim gönderildi" : ""}
                                        </p>
                                    </div>
                                ) : null}

                                {canRequest ? (
                                    <details className="rounded-xl border p-3">
                                        <summary className="cursor-pointer font-semibold"><ShieldAlert className="mr-2 inline h-4 w-4 text-amber-600" />İade veya reversal talebi oluştur</summary>
                                        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => void requestReversal(event, item)}>
                                            <select name="executionMode" className="h-10 rounded-md border bg-background px-3 text-sm" defaultValue="externally_confirmed" required><option value="externally_confirmed">Harici işlem tamamlandı</option><option value="provider_api" disabled={!data?.refundExecutionByProvider[item.provider as "paytr" | "shopier_v2"]?.ready}>{item.provider === "shopier_v2" ? "Shopier API ile tam iade (canlı)" : "PayTR API ile tam iade (sandbox)"}</option></select>
                                            <select name="outcome" className="h-10 rounded-md border bg-background px-3 text-sm" defaultValue={item.status === "refunded" ? "chargeback" : "refund"} required><option value="refund" disabled={item.status === "refunded"}>İade</option><option value="chargeback">Ters ibraz</option></select>
                                            <Input name="externalReference" placeholder="Harici işlem referansı (harici modda zorunlu)" minLength={3} maxLength={191} />
                                            <Input name="reason" placeholder="Operasyon gerekçesi" minLength={3} maxLength={500} required />
                                            <Input name="confirmationOrderId" placeholder="Onay için sipariş UUID'sini yazın" required />
                                            <Button type="submit" variant="destructive" disabled={busyId === item.id}>İkinci onaya gönder</Button>
                                            <p className="text-xs text-muted-foreground md:col-span-2">Sağlayıcı API modu yalnız tam iadeyi destekler. Sonuç belirsizse coin veya envanter değişmez; kör tekrar yerine sağlayıcı durumu doğrulanır.</p>
                                        </form>
                                    </details>
                                ) : null}
                            </article>
                        );
                    })}
                </div>
            </AdminTableShell>
        </div>
    );
}

function Metric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "amber" | "sky" | "rose" }) {
    const tones = {
        default: "border-border bg-card",
        amber: "border-amber-300/70 bg-amber-50/60 dark:bg-amber-950/20",
        sky: "border-sky-300/70 bg-sky-50/60 dark:bg-sky-950/20",
        rose: "border-rose-300/70 bg-rose-50/60 dark:bg-rose-950/20",
    };
    return <div className={`rounded-2xl border p-4 ${tones[tone]}`}><span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span><strong className="mt-2 block text-2xl">{value}</strong></div>;
}
