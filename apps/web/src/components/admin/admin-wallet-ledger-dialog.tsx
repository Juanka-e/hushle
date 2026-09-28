"use client";

import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, BookOpen, Loader2, ShieldCheck, ShieldX, X } from "lucide-react";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { Button } from "@/components/ui/button";
import type { AdminUserModerationView } from "@/types/moderation";
import type {
    AdminWalletLedgerEntry,
    AdminWalletLedgerResponse,
    AdminWalletLedgerSource,
} from "@/types/admin-wallet-ledger";

const sourceLabels: Record<AdminWalletLedgerSource, string> = {
    legacy_balance_snapshot: "Eski bakiye başlangıcı",
    account_opening: "Hesap açılışı",
    match_reward: "Maç ödülü",
    store_item_purchase: "Mağaza ürünü",
    store_bundle_purchase: "Mağaza paketi",
    payment_topup: "Ücretli coin paketi",
    payment_reversal: "Ödeme coin iadesi",
    coin_grant: "Coin kodu",
    admin_adjustment: "Admin düzeltmesi",
};

function formatDateTime(value: string): string {
    return new Date(value).toLocaleString("tr-TR", {
        dateStyle: "short",
        timeStyle: "short",
    });
}

function LedgerEntryCard({ entry }: { entry: AdminWalletLedgerEntry }) {
    const credit = entry.deltaCoin >= 0;
    return (
        <article className="rounded-2xl border border-border/70 bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                    <div
                        className={`rounded-xl p-2 ${
                            credit
                                ? "bg-emerald-500/10 text-emerald-700"
                                : "bg-rose-500/10 text-rose-700"
                        }`}
                    >
                        {credit ? (
                            <ArrowUpRight className="h-4 w-4" />
                        ) : (
                            <ArrowDownRight className="h-4 w-4" />
                        )}
                    </div>
                    <div>
                        <div className="font-semibold">{sourceLabels[entry.source]}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                            {formatDateTime(entry.createdAt)} · kayıt #{entry.id}
                        </div>
                    </div>
                </div>
                <div className="text-right">
                    <div
                        className={`text-lg font-black ${
                            credit ? "text-emerald-700" : "text-rose-700"
                        }`}
                    >
                        {credit ? "+" : ""}
                        {entry.deltaCoin.toLocaleString("tr-TR")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {entry.balanceBefore.toLocaleString("tr-TR")} →{" "}
                        {entry.balanceAfter.toLocaleString("tr-TR")}
                    </div>
                </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                {entry.referenceType ? (
                    <span>
                        Referans: {entry.referenceType}
                        {entry.referenceId ? ` #${entry.referenceId}` : ""}
                    </span>
                ) : null}
                {entry.actor ? <span>Aktör: @{entry.actor.username}</span> : null}
                {entry.adjustmentReason ? <span>Neden: {entry.adjustmentReason}</span> : null}
            </div>
        </article>
    );
}

export function AdminWalletLedgerDialog({
    user,
    onClose,
}: {
    user: AdminUserModerationView;
    onClose(): void;
}) {
    const [page, setPage] = useState(1);
    const [data, setData] = useState<AdminWalletLedgerResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        void fetch(`/api/admin/users/${user.id}/wallet-ledger?page=${page}&limit=20`, {
            cache: "no-store",
            signal: controller.signal,
        })
            .then(async (response) => {
                if (!response.ok) {
                    const payload = (await response.json().catch(() => null)) as {
                        error?: string;
                    } | null;
                    throw new Error(payload?.error ?? "Cüzdan geçmişi yüklenemedi.");
                }
                return response.json() as Promise<AdminWalletLedgerResponse>;
            })
            .then(setData)
            .catch((fetchError: unknown) => {
                if (!(fetchError instanceof DOMException) || fetchError.name !== "AbortError") {
                    setError(
                        fetchError instanceof Error
                            ? fetchError.message
                            : "Cüzdan geçmişi yüklenemedi."
                    );
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [page, user.id]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4">
            <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
                <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
                    <div>
                        <div className="flex items-center gap-2">
                            <BookOpen className="h-5 w-5 text-amber-500" />
                            <h2 className="text-lg font-bold">Cüzdan Hareketleri</h2>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                            @{user.username} · kullanıcı #{user.id}
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        aria-label="Cüzdan geçmişini kapat"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </header>

                {data ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/15 px-4 py-3 sm:px-6">
                        <div>
                            <div className="text-xs text-muted-foreground">Güncel bakiye</div>
                            <div className="text-xl font-black">
                                {data.coinBalance.toLocaleString("tr-TR")} coin
                            </div>
                        </div>
                        <div
                            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
                                data.reconciliationStatus === "reconciled"
                                    ? "bg-emerald-500/10 text-emerald-700"
                                    : data.reconciliationStatus === "mismatch"
                                      ? "bg-red-500/10 text-red-700"
                                      : "bg-amber-500/10 text-amber-700"
                            }`}
                        >
                            {data.reconciliationStatus === "reconciled" ? (
                                <ShieldCheck className="h-4 w-4" />
                            ) : (
                                <ShieldX className="h-4 w-4" />
                            )}
                            {data.reconciliationStatus === "reconciled"
                                ? "Bakiye zinciri uyumlu"
                                : data.reconciliationStatus === "mismatch"
                                  ? `Uyumsuz: ledger ${data.latestLedgerBalance ?? 0}`
                                  : "İlk ledger hareketi bekleniyor"}
                        </div>
                    </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                    {loading ? (
                        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            Hareketler yükleniyor
                        </div>
                    ) : error ? (
                        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">
                            {error}
                        </div>
                    ) : data?.entries.length ? (
                        <div className="space-y-3">
                            {data.entries.map((entry) => (
                                <LedgerEntryCard key={entry.id} entry={entry} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
                            Bu cüzdan için henüz ledger hareketi yok. İlk coin işleminde mevcut
                            bakiye otomatik başlangıç kaydıyla korunacak.
                        </div>
                    )}
                </div>

                {data && data.pages > 1 ? (
                    <footer className="border-t border-border px-4 py-3 sm:px-6">
                        <AdminPagination
                            page={data.page}
                            pageCount={data.pages}
                            onPageChange={(nextPage) => {
                                setLoading(true);
                                setError(null);
                                setPage(nextPage);
                            }}
                        />
                    </footer>
                ) : null}
            </div>
        </div>
    );
}
