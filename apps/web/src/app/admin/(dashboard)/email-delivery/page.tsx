"use client";

import { useCallback, useEffect, useState } from "react";
import { MailWarning, RefreshCw, RotateCcw, Search, ShieldBan } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { AdminEmptyState, AdminTableShell } from "@/components/admin/admin-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
    AdminEmailDeliveryItem,
    AdminEmailDeliveryResponse,
    AdminEmailDeliveryStatus,
} from "@/types/admin-email-delivery";

const statusLabels: Record<AdminEmailDeliveryStatus, string> = {
    pending: "Bekliyor",
    processing: "İşleniyor",
    sent: "Gönderildi",
    dead_letter: "İnceleme gerekli",
};

const statusClasses: Record<AdminEmailDeliveryStatus, string> = {
    pending: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    processing: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
    sent: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    dead_letter: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
};

function formatDate(value: string | null): string {
    return value
        ? new Date(value).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })
        : "-";
}

export default function AdminEmailDeliveryPage() {
    const [data, setData] = useState<AdminEmailDeliveryResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState<"all" | AdminEmailDeliveryStatus>("dead_letter");
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [retryingId, setRetryingId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: "20", status });
            if (search) params.set("search", search);
            const response = await fetch(`/api/admin/email-delivery?${params}`, { cache: "no-store" });
            const payload = (await response.json().catch(() => null)) as
                | AdminEmailDeliveryResponse
                | { error?: string }
                | null;
            if (!response.ok || !payload || !("items" in payload)) {
                throw new Error(payload && "error" in payload ? payload.error : undefined);
            }
            setData(payload);
        } catch (error) {
            toast.error(error instanceof Error && error.message ? error.message : "E-posta kuyruğu yüklenemedi.");
        } finally {
            setLoading(false);
        }
    }, [page, search, status]);

    useEffect(() => {
        void load();
    }, [load]);

    async function retry(item: AdminEmailDeliveryItem) {
        setRetryingId(item.id);
        try {
            const response = await fetch(`/api/admin/email-delivery/${item.id}/retry`, { method: "POST" });
            const payload = (await response.json().catch(() => null)) as { error?: string } | null;
            if (!response.ok) throw new Error(payload?.error || "Mesaj yeniden kuyruğa alınamadı.");
            toast.success("Mesaj kontrollü olarak yeniden kuyruğa alındı.");
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Mesaj yeniden kuyruğa alınamadı.");
        } finally {
            setRetryingId(null);
        }
    }

    return (
        <div className="space-y-6 p-4 md:p-6">
            <AdminPageHeader
                title="E-posta Teslimatı"
                description="Başarısız teslimatları inceleyin. Yeniden deneme otomatik değildir; teslimat engeli olan adresler önce araştırılmalıdır."
                meta={data ? `${data.counts.dead_letter} inceleme bekliyor` : undefined}
                icon={<MailWarning className="h-5 w-5 text-rose-600" />}
                action={
                    <Button variant="outline" onClick={() => void load()} disabled={loading}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                        Yenile
                    </Button>
                }
            />

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {(["dead_letter", "pending", "processing", "sent"] as const).map((entry) => (
                    <button
                        key={entry}
                        type="button"
                        onClick={() => { setStatus(entry); setPage(1); }}
                        className={`rounded-2xl border p-4 text-left transition ${status === entry ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"}`}
                    >
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            {statusLabels[entry]}
                        </span>
                        <strong className="mt-2 block text-2xl text-foreground">{data?.counts[entry] ?? 0}</strong>
                    </button>
                ))}
            </div>

            <form
                className="flex flex-col gap-3 sm:flex-row"
                onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); setPage(1); }}
            >
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        placeholder="Alıcı, şablon veya mesaj kimliği ara"
                        className="pl-9"
                    />
                </div>
                <Button type="submit">Ara</Button>
            </form>

            <AdminTableShell
                title={status === "all" ? "Tüm teslimatlar" : statusLabels[status]}
                description="Hata ayrıntıları oyuncuya gösterilmez. Bu ekran yalnız operasyon ve destek incelemesi içindir."
                loading={loading}
                isEmpty={!loading && (data?.items.length ?? 0) === 0}
                emptyState={<AdminEmptyState icon={<MailWarning />} title="Kayıt bulunamadı" description="Bu filtrede e-posta teslimat kaydı yok." />}
                footer={data ? <AdminPagination page={page} pageCount={data.pages} onPageChange={setPage} /> : undefined}
            >
                <div className="divide-y divide-border/60">
                    {data?.items.map((item) => (
                        <article key={item.id} className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:items-center lg:p-5">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[item.status]}`}>
                                        {statusLabels[item.status]}
                                    </span>
                                    <span className="text-xs font-medium text-muted-foreground">{item.template}</span>
                                    {item.suppression ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white">
                                            <ShieldBan className="h-3 w-3" /> Teslimat engeli
                                        </span>
                                    ) : null}
                                </div>
                                <h2 className="mt-2 truncate font-semibold text-foreground">{item.subject}</h2>
                                <p className="truncate text-sm text-muted-foreground">{item.recipient}{item.username ? ` · @${item.username}` : ""}</p>
                                {item.lastError ? <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">{item.lastError}</p> : null}
                            </div>
                            <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                                <div><dt>Otomatik deneme</dt><dd className="font-semibold text-foreground">{item.attemptCount}</dd></div>
                                <div><dt>Manuel retry</dt><dd className="font-semibold text-foreground">{item.manualRetryCount}</dd></div>
                                <div><dt>Oluşturuldu</dt><dd className="font-semibold text-foreground">{formatDate(item.createdAt)}</dd></div>
                                <div><dt>Son deneme</dt><dd className="font-semibold text-foreground">{formatDate(item.lastAttemptAt)}</dd></div>
                            </dl>
                            {item.status === "dead_letter" ? (
                                <Button
                                    variant="outline"
                                    disabled={Boolean(item.suppression) || retryingId === item.id}
                                    onClick={() => void retry(item)}
                                    title={item.suppression ? "Teslimat engeli kaldırılmadan retry yapılamaz." : undefined}
                                >
                                    <RotateCcw className="mr-2 h-4 w-4" />
                                    {retryingId === item.id ? "Kuyruğa alınıyor" : "Yeniden dene"}
                                </Button>
                            ) : null}
                        </article>
                    ))}
                </div>
            </AdminTableShell>
        </div>
    );
}
