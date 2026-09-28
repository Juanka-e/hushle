"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    Archive,
    Clock3,
    Coins,
    Loader2,
    ShieldAlert,
    Trophy,
    Users,
    X,
} from "lucide-react";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { Button } from "@/components/ui/button";
import type { AdminUserModerationView } from "@/types/moderation";
import type {
    AdminMatchHistoryItem,
    AdminMatchHistoryResponse,
} from "@/types/admin-match-history";

function formatDateTime(value: string): string {
    return new Date(value).toLocaleString("tr-TR", {
        dateStyle: "short",
        timeStyle: "short",
    });
}

function formatDuration(seconds: number | null): string {
    if (seconds === null) return "Bilinmiyor";
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes > 0 ? `${minutes} dk ${remainder} sn` : `${remainder} sn`;
}

function buildAuditHref(match: AdminMatchHistoryItem): string {
    const params = new URLSearchParams({
        search: String(match.id),
        action: "game.match.finalize",
    });
    if (match.review?.auditSource === "archive") {
        params.set("source", "archive");
    }
    return `/admin/audit?${params.toString()}`;
}

function MatchCard({ match }: { match: AdminMatchHistoryItem }) {
    const guardTriggered =
        match.review?.rewardGuardTriggered ||
        match.review?.repeatedGroupTriggered;

    return (
        <article className="rounded-2xl border border-border/70 bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                match.won
                                    ? "bg-emerald-500/10 text-emerald-700"
                                    : "bg-slate-500/10 text-slate-700"
                            }`}
                        >
                            {match.won ? "Kazandı" : "Kaybetti"}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                            {match.roomCode}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {match.gameType}
                        </span>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                        {formatDateTime(match.matchStartedAt)}
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-black tracking-tight text-foreground">
                        {match.scoreA} - {match.scoreB}
                    </div>
                    <div className="text-xs text-muted-foreground">
                        Takım {match.team ?? "bilinmiyor"}
                    </div>
                </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-muted/30 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" />
                        Süre
                    </div>
                    <div className="mt-1 text-sm font-semibold">
                        {formatDuration(match.matchDurationSeconds)}
                    </div>
                </div>
                <div className="rounded-xl bg-muted/30 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Kural</div>
                    <div className="mt-1 text-sm font-semibold">
                        {match.matchFormat
                            ? `${match.matchFormat === "tur" ? "Tur" : "Hedef skor"} · ${
                                  match.matchTarget ?? "?"
                              }`
                            : "Bilinmiyor"}
                    </div>
                </div>
                <div className="rounded-xl bg-muted/30 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        Kadro
                    </div>
                    <div className="mt-1 text-sm font-semibold">
                        {match.lineupPlayerCount} oyuncu
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                        {match.lineupAuthenticatedCount} kayıtlı ·{" "}
                        {match.lineupGuestCount} guest
                    </div>
                </div>
                <div className="rounded-xl bg-muted/30 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Coins className="h-3.5 w-3.5" />
                        Ödül
                    </div>
                    <div className="mt-1 text-sm font-semibold">
                        {match.coinEarned} coin
                    </div>
                    {match.review?.requestedRewardCoin !== null &&
                    match.review?.requestedRewardCoin !== undefined ? (
                        <div className="text-[11px] text-muted-foreground">
                            İstenen {match.review.requestedRewardCoin}
                        </div>
                    ) : null}
                </div>
            </div>

            {guardTriggered ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
                    <ShieldAlert className="h-4 w-4" />
                    {match.review?.rewardGuardTriggered
                        ? `Ceiling: ${match.review.rewardGuardBand ?? "tetiklendi"}`
                        : null}
                    {match.review?.repeatedGroupTriggered
                        ? "Tekrar eden grup azaltımı"
                        : null}
                    {(match.review?.blockedRewardCoin ?? 0) > 0
                        ? `${match.review?.blockedRewardCoin} coin engellendi`
                        : null}
                </div>
            ) : null}

            {match.review?.lineupIdentities.length ? (
                <div className="mt-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Maç kadrosu
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {match.review.lineupIdentities.map((player) => (
                            <span
                                key={`${player.identityType}:${player.playerId}`}
                                className="rounded-full border border-border/70 bg-muted/20 px-2.5 py-1 text-xs"
                            >
                                {player.displayNameSnapshot} ·{" "}
                                {player.team ? `Takım ${player.team}` : "İzleyici"}
                                {player.identityType === "guest" ? " · Guest" : ""}
                            </span>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="mt-3 text-xs text-muted-foreground">
                    Bu maç için detaylı kadro snapshot&apos;ı bulunmuyor.
                </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                <span>
                    Anlatıcı rotasyonu bu sürümde geçmiş snapshot olarak tutulmuyor.
                </span>
                {match.review ? (
                    <Button asChild variant="ghost" size="sm">
                        <Link href={buildAuditHref(match)}>
                            {match.review.auditSource === "archive" ? (
                                <Archive className="h-3.5 w-3.5" />
                            ) : null}
                            Audit
                        </Link>
                    </Button>
                ) : null}
            </div>
        </article>
    );
}

export function AdminUserMatchHistoryDialog({
    user,
    onClose,
}: {
    user: AdminUserModerationView;
    onClose(): void;
}) {
    const [page, setPage] = useState(1);
    const [data, setData] = useState<AdminMatchHistoryResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();

        void fetch(`/api/admin/users/${user.id}/matches?page=${page}&limit=10`, {
            cache: "no-store",
            signal: controller.signal,
        })
            .then(async (response) => {
                if (!response.ok) {
                    const payload = (await response.json().catch(() => null)) as {
                        error?: string;
                    } | null;
                    throw new Error(
                        payload?.error ?? "Maç geçmişi yüklenemedi."
                    );
                }
                return response.json() as Promise<AdminMatchHistoryResponse>;
            })
            .then(setData)
            .catch((fetchError: unknown) => {
                if (
                    !(fetchError instanceof DOMException) ||
                    fetchError.name !== "AbortError"
                ) {
                    setError(
                        fetchError instanceof Error
                            ? fetchError.message
                            : "Maç geçmişi yüklenemedi."
                    );
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, [page, user.id]);

    const winRate = useMemo(() => {
        if (!data?.total) return 0;
        return Math.round((data.summary.wins / data.total) * 100);
    }, [data]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4">
            <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
                <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
                    <div>
                        <div className="flex items-center gap-2">
                            <Trophy className="h-5 w-5 text-amber-500" />
                            <h2 className="text-lg font-bold">Maç Geçmişi</h2>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                            @{user.username}
                            {user.displayName ? ` · ${user.displayName}` : ""}
                            {" · "}id:{user.id}
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        aria-label="Maç geçmişini kapat"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </header>

                {data ? (
                    <div className="grid grid-cols-2 gap-2 border-b border-border bg-muted/15 px-4 py-3 sm:grid-cols-4 sm:px-6">
                        <div>
                            <div className="text-xs text-muted-foreground">Maç</div>
                            <div className="font-bold">{data.total}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Galibiyet</div>
                            <div className="font-bold">
                                {data.summary.wins} · %{winRate}
                            </div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Toplam coin</div>
                            <div className="font-bold">
                                {data.summary.totalCoinEarned}
                            </div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Ort. süre</div>
                            <div className="font-bold">
                                {formatDuration(
                                    data.summary.averageDurationSeconds
                                )}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                                {data.summary.durationSampleCount} süre snapshot&apos;ı
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                    {loading ? (
                        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            Maçlar yükleniyor
                        </div>
                    ) : error ? (
                        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">
                            {error}
                        </div>
                    ) : data?.matches.length ? (
                        <div className="space-y-3">
                            {data.matches.map((match) => (
                                <MatchCard key={match.id} match={match} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
                            Bu kullanıcı için kayıtlı maç bulunmuyor.
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
