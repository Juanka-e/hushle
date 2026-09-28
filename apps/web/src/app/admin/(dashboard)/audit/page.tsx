"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, Archive, Database, Search } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminToolbar, AdminToolbarStats } from "@/components/admin/admin-toolbar";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { AdminEmptyState, AdminTableShell } from "@/components/admin/admin-table-shell";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { AdminAuditListResponse, AdminAuditLogView } from "@/types/admin-audit";

type EconomyGuardFilter = "" | "match_reward" | "triggered" | "ceiling" | "repeated_group";
type AuditSource = "hot" | "archive";

const economyGuardPresets: Array<{
    value: EconomyGuardFilter;
    label: string;
    description: string;
}> = [
    { value: "", label: "Tum Kayitlar", description: "Standart audit gorunumu." },
    {
        value: "match_reward",
        label: "Mac Odulleri",
        description: "Tum match finalize kayitlarini gosterir.",
    },
    {
        value: "triggered",
        label: "Koruma Tetikleri",
        description: "Ceiling veya tekrar grup etkisi alan maclari gosterir.",
    },
    {
        value: "ceiling",
        label: "Ceiling",
        description: "Rolling soft cap / hard ceiling tetiklerini izole eder.",
    },
    {
        value: "repeated_group",
        label: "Tekrar Grup",
        description: "Ayni lineup damping tetiklerini izole eder.",
    },
];

function formatDateTime(value: string): string {
    return new Date(value).toLocaleString("tr-TR", {
        dateStyle: "short",
        timeStyle: "short",
    });
}

function renderMetadata(metadata: Record<string, string>): string {
    const entries = Object.entries(metadata);
    if (entries.length === 0) {
        return "-";
    }

    return entries.map(([key, value]) => `${key}: ${value}`).join(" | ");
}

function renderEconomyPill(
    label: string,
    value: string,
    tone: "neutral" | "emerald" | "amber" = "neutral"
) {
    const toneClass =
        tone === "emerald"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
            : tone === "amber"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
              : "border-border/60 bg-background text-foreground";

    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium ${toneClass}`}
        >
            <span className="text-muted-foreground">{label}</span>
            <span>{value}</span>
        </span>
    );
}

function renderLineupIdentityCard(
    player: NonNullable<NonNullable<AdminAuditLogView["economyGuard"]>["lineupIdentities"][number]>
) {
    const badgeClass =
        player.identityType === "registered"
            ? "border-blue-500/30 bg-blue-500/10 text-blue-700"
            : "border-slate-300/80 bg-slate-100 text-slate-700";
    const teamLabel = player.team ? `Takım ${player.team}` : "İzleyici";

    return (
        <div
            key={`${player.identityType}:${player.playerId}`}
            className="min-w-[10.5rem] rounded-2xl border border-border/60 bg-background/90 px-3 py-2"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                        {player.displayNameSnapshot}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                        {player.identityType === "registered" ? (
                            <>
                                @{player.usernameSnapshot ?? "hesap"}
                                {player.userId ? ` · id:${player.userId}` : ""}
                            </>
                        ) : (
                            <>guest · player:{player.playerId}</>
                        )}
                    </div>
                </div>
                <span
                    className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${badgeClass}`}
                >
                    {player.identityType === "registered" ? "Kayıtlı" : "Guest"}
                </span>
            </div>
            <div className="mt-2 text-[11px] font-medium text-muted-foreground">{teamLabel}</div>
        </div>
    );
}

function renderEconomyGuard(log: AdminAuditLogView) {
    if (!log.economyGuard) {
        return <span>-</span>;
    }

    const rewardRequested = log.economyGuard.requestedRewardCoin;
    const rewardAllowed = log.economyGuard.allowedRewardCoin;
    const blockedRewardCoin = log.economyGuard.blockedRewardCoin ?? 0;
    const repeatedGroupLabel =
        log.economyGuard.repeatedGroupOrdinal !== null &&
        log.economyGuard.repeatedGroupThreshold !== null
            ? `${log.economyGuard.repeatedGroupOrdinal}. mac / esik ${log.economyGuard.repeatedGroupThreshold}`
            : "aktif";

    return (
        <div className="min-w-[18rem] space-y-2 rounded-2xl border border-border/60 bg-muted/15 p-3">
            <div className="flex flex-wrap gap-2">
                {log.actor?.username
                    ? renderEconomyPill("Oyuncu", log.actor.username, "neutral")
                    : null}
                {log.economyGuard.roomCode
                    ? renderEconomyPill("Lobi", log.economyGuard.roomCode, "neutral")
                    : null}
                {log.economyGuard.rewardSource
                    ? renderEconomyPill("Kaynak", log.economyGuard.rewardSource, "neutral")
                    : null}
                {log.economyGuard.sureSeconds !== null
                    ? renderEconomyPill("Sure", `${log.economyGuard.sureSeconds}s`, "neutral")
                    : null}
            </div>

            {rewardRequested !== null && rewardAllowed !== null ? (
                <div className="rounded-xl bg-background/80 px-3 py-2 text-[12px] leading-5 text-foreground">
                    <span className="font-semibold">Odul</span>
                    <span className="mx-2 text-muted-foreground">{rewardRequested}</span>
                    <span className="text-muted-foreground">-&gt;</span>
                    <span className="mx-2 font-semibold">{rewardAllowed}</span>
                    {blockedRewardCoin > 0 ? (
                        <span className="text-amber-700">
                            ({blockedRewardCoin} coin kesildi)
                        </span>
                    ) : (
                        <span className="text-emerald-700">(tam odul)</span>
                    )}
                </div>
            ) : null}

            {(log.economyGuard.rewardGuardTriggered || log.economyGuard.repeatedGroupTriggered) && (
                <div className="flex flex-wrap gap-2">
                    {log.economyGuard.rewardGuardTriggered
                        ? renderEconomyPill(
                              "Ceiling",
                              log.economyGuard.rewardGuardBand ?? "aktif",
                              "amber"
                          )
                        : null}
                    {log.economyGuard.repeatedGroupTriggered
                        ? renderEconomyPill("Tekrar Grup", repeatedGroupLabel, "amber")
                        : null}
                </div>
            )}

            {log.economyGuard.lineupIdentities.length > 0 ? (
                <div className="space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Lobi Kadrosu
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {log.economyGuard.lineupIdentities.map((player) =>
                            renderLineupIdentityCard(player)
                        )}
                    </div>
                </div>
            ) : log.economyGuard.lineupPlayers.length > 0 ? (
                <div className="space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Lobi Kadrosu
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {log.economyGuard.lineupPlayers.map((player) => (
                            <span
                                key={player}
                                className="rounded-full border border-border/60 bg-background px-2 py-1 text-[11px] text-foreground"
                            >
                                {player}
                            </span>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

export default function AdminAuditPage() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [logs, setLogs] = useState<AdminAuditLogView[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [action, setAction] = useState("");
    const [resourceType, setResourceType] = useState("");
    const [actorRole, setActorRole] = useState("");
    const [economyGuard, setEconomyGuard] = useState<EconomyGuardFilter>("");
    const [source, setSource] = useState<AuditSource>("hot");
    const [actionOptions, setActionOptions] = useState<string[]>([]);
    const [resourceTypeOptions, setResourceTypeOptions] = useState<string[]>([]);
    const [roleOptions, setRoleOptions] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        setSearch((searchParams.get("search") ?? "").trim());
        setAction(searchParams.get("action") ?? "");
        setResourceType(searchParams.get("resourceType") ?? "");
        setActorRole(searchParams.get("actorRole") ?? "");
        const nextEconomyGuard = (searchParams.get("economyGuard") ?? "") as EconomyGuardFilter;
        setEconomyGuard(nextEconomyGuard);
        setSource(searchParams.get("source") === "archive" ? "archive" : "hot");
        setPage(Number(searchParams.get("page") ?? "1") || 1);
    }, [searchParams]);

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            setDebouncedSearch(search.trim());
        }, 350);
        return () => window.clearTimeout(timeout);
    }, [search]);

    useEffect(() => {
        const params = new URLSearchParams();

        if (page > 1) {
            params.set("page", String(page));
        }
        if (debouncedSearch) {
            params.set("search", debouncedSearch);
        }
        if (action) {
            params.set("action", action);
        }
        if (resourceType) {
            params.set("resourceType", resourceType);
        }
        if (actorRole) {
            params.set("actorRole", actorRole);
        }
        if (economyGuard) {
            params.set("economyGuard", economyGuard);
        }
        if (source === "archive") {
            params.set("source", source);
        }

        const next = params.toString();
        const current =
            typeof window === "undefined"
                ? ""
                : window.location.search.startsWith("?")
                  ? window.location.search.slice(1)
                  : window.location.search;

        if (next !== current) {
            router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
        }
    }, [
        action,
        actorRole,
        debouncedSearch,
        economyGuard,
        page,
        pathname,
        resourceType,
        router,
        source,
    ]);

    const loadLogs = useCallback(async (signal: AbortSignal) => {
        setLoading(true);
        setLoadError(null);
        try {
            const params = new URLSearchParams({
                page: String(page),
                limit: "15",
            });
            if (debouncedSearch) params.set("search", debouncedSearch);
            if (action) params.set("action", action);
            if (resourceType) params.set("resourceType", resourceType);
            if (actorRole) params.set("actorRole", actorRole);
            if (economyGuard) params.set("economyGuard", economyGuard);
            params.set("source", source);

            const response = await fetch(`/api/admin/audit?${params.toString()}`, {
                cache: "no-store",
                signal,
            });
            if (!response.ok) {
                return;
            }

            const payload = (await response.json()) as AdminAuditListResponse;
            setLogs(payload.logs);
            setPage(payload.page);
            setPages(payload.pages);
            setTotal(payload.total);
            setActionOptions(payload.actionOptions);
            setResourceTypeOptions(payload.resourceTypeOptions);
            setRoleOptions(payload.roleOptions);
        } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) {
                setLogs([]);
                setTotal(0);
                setLoadError("Audit kayıtları yüklenemedi. Lütfen tekrar deneyin.");
            }
        } finally {
            if (!signal.aborted) {
                setLoading(false);
            }
        }
    }, [action, actorRole, debouncedSearch, economyGuard, page, resourceType, source]);

    useEffect(() => {
        const controller = new AbortController();
        void loadLogs(controller.signal);
        return () => controller.abort();
    }, [loadLogs]);

    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, action, resourceType, actorRole, economyGuard, source]);

    useEffect(() => {
        setLogs([]);
        setTotal(0);
    }, [source]);

    const stats = useMemo(
        () => [
            { label: "gorunen", value: String(logs.length) },
            { label: "toplam", value: String(total) },
            { label: "sayfa", value: `${page} / ${pages}` },
        ],
        [logs.length, page, pages, total]
    );

    const activePreset =
        economyGuardPresets.find((preset) => preset.value === economyGuard) ?? economyGuardPresets[0];

    return (
        <div className="space-y-6">
            <AdminPageHeader
                title="Audit Kayitlari"
                description="Aktif ve arşivlenmiş operasyon kayıtlarını ayrı, güvenli görünümlerde inceleyin."
                meta={`${source === "hot" ? "aktif" : "arşiv"} · ${total} kayıt`}
                icon={<Activity className="h-5 w-5 text-emerald-500" />}
            />

            <AdminToolbar>
                <div className="flex-1 space-y-3">
                    <div className="inline-flex rounded-2xl border border-border/70 bg-muted/30 p-1">
                        <button
                            type="button"
                            onClick={() => setSource("hot")}
                            className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                                source === "hot"
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Database className="h-4 w-4" />
                            Aktif kayıtlar
                        </button>
                        <button
                            type="button"
                            onClick={() => setSource("archive")}
                            className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                                source === "archive"
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Archive className="h-4 w-4" />
                            Arşiv
                        </button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="relative md:col-span-2 xl:col-span-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Action, admin, resource veya ozet ara..."
                                className="pl-9"
                            />
                        </div>

                        <select
                            value={action}
                            onChange={(event) => setAction(event.target.value)}
                            className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none"
                        >
                            <option value="">Tum action&apos;lar</option>
                            {actionOptions.map((option) => (
                                <option key={option} value={option}>
                                    {option}
                                </option>
                            ))}
                        </select>

                        <select
                            value={resourceType}
                            onChange={(event) => setResourceType(event.target.value)}
                            className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none"
                        >
                            <option value="">Tum resource tipleri</option>
                            {resourceTypeOptions.map((option) => (
                                <option key={option} value={option}>
                                    {option}
                                </option>
                            ))}
                        </select>

                        <select
                            value={actorRole}
                            onChange={(event) => setActorRole(event.target.value)}
                            className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none"
                        >
                            <option value="">Tum roller</option>
                            {roleOptions.map((option) => (
                                <option key={option} value={option}>
                                    {option}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <div>
                                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                    Economy Review
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    {activePreset.description}
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {economyGuardPresets.map((preset) => {
                                const active = preset.value === economyGuard;
                                return (
                                    <button
                                        key={preset.value || "all"}
                                        type="button"
                                        onClick={() => setEconomyGuard(preset.value)}
                                        className={`rounded-2xl border px-3 py-2 text-sm transition ${
                                            active
                                                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700"
                                                : "border-border/60 bg-background text-foreground hover:border-emerald-400/40 hover:bg-emerald-500/5"
                                        }`}
                                    >
                                        {preset.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
                <AdminToolbarStats stats={stats} />
            </AdminToolbar>

            {loadError ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700">
                    {loadError}
                </div>
            ) : null}

            <AdminTableShell
                title={source === "hot" ? "Aktif Audit Geçmişi" : "Arşivlenmiş Audit Geçmişi"}
                description={
                    source === "hot"
                        ? "Retention süresi içindeki güncel operasyonlar listelenir."
                        : "Sıcak tablodan güvenle taşınmış eski operasyonlar listelenir."
                }
                loading={loading}
                isEmpty={!loading && logs.length === 0}
                emptyState={
                    <AdminEmptyState
                        icon={<Activity className="h-6 w-6" />}
                        title="Audit kaydi bulunamadi"
                        description="Mevcut filtrelerle eslesen bir operasyon kaydi yok."
                    />
                }
                footer={<AdminPagination page={page} pageCount={pages} onPageChange={setPage} />}
            >
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/20">
                            <TableHead>Zaman</TableHead>
                            <TableHead>Actor</TableHead>
                            <TableHead>Action</TableHead>
                            <TableHead>Resource</TableHead>
                            <TableHead>Ozet</TableHead>
                            <TableHead>Not</TableHead>
                            <TableHead>Koruma</TableHead>
                            <TableHead>Metadata</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {logs.map((log) => (
                            <TableRow key={`${log.source}:${log.id}`}>
                                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                    <div>{formatDateTime(log.createdAt)}</div>
                                    {log.archivedAt ? (
                                        <div className="mt-1 text-[10px]">
                                            Arşiv: {formatDateTime(log.archivedAt)}
                                        </div>
                                    ) : null}
                                </TableCell>
                                <TableCell>
                                    <div className="space-y-1">
                                        <div className="font-medium text-foreground">
                                            {log.actor?.username ??
                                                (log.actor?.id ? "Silinmiş hesap" : "Sistem")}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {log.actor?.role ?? "system"}
                                            {log.actor?.id ? ` | id:${log.actor.id}` : ""}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="font-mono text-xs text-foreground">
                                    {log.action}
                                </TableCell>
                                <TableCell>
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium text-foreground">
                                            {log.resourceType}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {log.resourceId ?? "-"}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="max-w-xs text-sm text-muted-foreground">
                                    {log.summary ?? "-"}
                                </TableCell>
                                <TableCell className="max-w-xs text-sm text-muted-foreground">
                                    {log.note ?? "-"}
                                </TableCell>
                                <TableCell className="max-w-md align-top text-xs text-muted-foreground">
                                    {renderEconomyGuard(log)}
                                </TableCell>
                                <TableCell className="max-w-md text-xs text-muted-foreground">
                                    {renderMetadata(log.metadata)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </AdminTableShell>
        </div>
    );
}
