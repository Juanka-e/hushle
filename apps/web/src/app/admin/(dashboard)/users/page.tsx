"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Coins, Loader2, Search, ShieldBan, StickyNote, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { AdminTableShell, AdminEmptyState } from "@/components/admin/admin-table-shell";
import { AdminToolbar, AdminToolbarStats } from "@/components/admin/admin-toolbar";
import { AdminUserMatchHistoryDialog } from "@/components/admin/admin-user-match-history-dialog";
import { AdminWalletLedgerDialog } from "@/components/admin/admin-wallet-ledger-dialog";
import type {
    AdminUserListResponse,
    AdminUserModerationView,
    ModerationActionType,
} from "@/types/moderation";
import type { WalletAdjustmentType } from "@/types/admin-user-operations";
import { runRequest, startRequest } from "@/lib/run-request";

type StatusFilter = "all" | "active" | "suspended";
type ActionMode = ModerationActionType;

const statusBadgeClass: Record<StatusFilter | "computed_active" | "computed_suspended", string> = {
    all: "bg-muted text-muted-foreground",
    active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    suspended: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    computed_active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    computed_suspended: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const actionLabels: Record<ActionMode, string> = {
    suspend: "Askıya Al",
    reactivate: "Yeniden Etkinleştir",
    note: "İç Not Ekle",
};

const actionDescriptions: Record<ActionMode, string> = {
    suspend: "Kullanıcı oyuna ve korumalı yüzeylere giriş yapamaz.",
    reactivate: "Aktif suspend durumunu kaldırır ve hesabı tekrar kullanıma açar.",
    note: "Yalnızca admin ekibi tarafından görülen operasyon notu ekler.",
};

function formatDateTime(value: string | null): string {
    if (!value) {
        return "-";
    }

    return new Date(value).toLocaleString("tr-TR", {
        dateStyle: "short",
        timeStyle: "short",
    });
}

function getEventLabel(actionType: ActionMode): string {
    if (actionType === "suspend") {
        return "Suspend";
    }
    if (actionType === "reactivate") {
        return "Reactivate";
    }
    return "Not";
}

function formatTrustedIp(ip: string | null): string {
    return ip ?? "Bilinmiyor";
}

function summarizeUserAgent(userAgent: string | null): string {
    if (!userAgent) {
        return "Tarayıcı sinyali yok";
    }

    return userAgent.length > 72 ? `${userAgent.slice(0, 72)}...` : userAgent;
}

function getSupportStatusLabel(status: string | null): string {
    if (!status) return "Kayıt yok";
    if (status === "open") return "Açık";
    if (status === "in_progress") return "İşlemde";
    if (status === "resolved") return "Çözüldü";
    if (status === "closed") return "Kapalı";
    return status;
}

function getWalletAdjustmentLabel(type: "credit" | "debit" | null): string {
    if (!type) {
        return "Kayıt yok";
    }

    return type === "credit" ? "Coin ekleme" : "Coin düşme";
}

function buildSupportHref(user: AdminUserModerationView): string {
    const params = new URLSearchParams({
        search: user.username,
    });
    if (user.supportTicketSummary.latestTicketId) {
        params.set("ticketId", String(user.supportTicketSummary.latestTicketId));
    }
    return `/admin/support?${params.toString()}`;
}

function buildInventoryHref(user: AdminUserModerationView): string {
    const params = new URLSearchParams({
        search: user.username,
        userId: String(user.id),
    });
    return `/admin/inventory?${params.toString()}`;
}

function buildWalletAuditHref(user: AdminUserModerationView): string {
    const params = new URLSearchParams({
        resourceType: "wallet_adjustment",
    });
    if (user.walletAdjustmentSummary.latestAdjustmentId) {
        params.set("search", String(user.walletAdjustmentSummary.latestAdjustmentId));
    } else {
        params.set("search", user.username);
    }
    return `/admin/audit?${params.toString()}`;
}

function buildModerationAuditHref(user: AdminUserModerationView, actionType: ModerationActionType): string {
    const params = new URLSearchParams({
        search: user.username,
        action: `admin.user.${actionType}`,
        resourceType: "user",
    });
    return `/admin/audit?${params.toString()}`;
}

export default function AdminUsersPage() {
    const searchParams = useSearchParams();
    const [users, setUsers] = useState<AdminUserModerationView[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [status, setStatus] = useState<StatusFilter>("all");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deletingEventId, setDeletingEventId] = useState<number | null>(null);
    const [selectedUser, setSelectedUser] = useState<AdminUserModerationView | null>(null);
    const [selectedWalletUser, setSelectedWalletUser] = useState<AdminUserModerationView | null>(null);
    const [selectedMatchUser, setSelectedMatchUser] = useState<AdminUserModerationView | null>(null);
    const [selectedLedgerUser, setSelectedLedgerUser] = useState<AdminUserModerationView | null>(null);
    const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
    const [actionMode, setActionMode] = useState<ActionMode>("suspend");
    const [walletAdjustmentType, setWalletAdjustmentType] = useState<WalletAdjustmentType>("credit");
    const [walletAmount, setWalletAmount] = useState("100");
    const [walletReason, setWalletReason] = useState("");
    const [reason, setReason] = useState("");
    const [suspendedUntil, setSuspendedUntil] = useState("");
    const [walletSaving, setWalletSaving] = useState(false);
    const [trustProxyEnabled, setTrustProxyEnabled] = useState(false);

    // Adjusted during render instead of in effects: the URL filters (on load and on each
    // navigation), then page one whenever the search or status changes.
    const urlKey = searchParams.toString();
    const [syncedUrlKey, setSyncedUrlKey] = useState<string | null>(null);
    if (syncedUrlKey !== urlKey) {
        setSyncedUrlKey(urlKey);
        const nextSearch = (searchParams.get("search") ?? "").trim();
        const nextStatus = searchParams.get("status");

        setSearch(nextSearch);
        setDebouncedSearch(nextSearch);
        if (nextStatus === "all" || nextStatus === "active" || nextStatus === "suspended") {
            setStatus(nextStatus);
        }
        if (!nextStatus) {
            setStatus("all");
        }
        setPage(1);
    }
    const filterKey = `${debouncedSearch}|${status}`;
    const [pageFilterKey, setPageFilterKey] = useState(filterKey);
    if (pageFilterKey !== filterKey) {
        setPageFilterKey(filterKey);
        setPage(1);
    }

    useEffect(() => {
        const timeout = setTimeout(() => {
            setDebouncedSearch(search.trim());
        }, 300);

        return () => clearTimeout(timeout);
    }, [search]);

    const requestUsers = useCallback(async () => {
        const params = new URLSearchParams({
            page: String(page),
            limit: "12",
            status,
        });
        if (debouncedSearch) {
            params.set("search", debouncedSearch);
        }

        const response = await fetch(`/api/admin/users?${params.toString()}`, {
            cache: "no-store",
        });
        if (!response.ok) {
            throw new Error("Users could not be loaded.");
        }
        return (await response.json()) as AdminUserListResponse;
    }, [debouncedSearch, page, status]);
    const userHandlers = useMemo(
        () => ({
            apply: (payload: AdminUserListResponse) => {
                setUsers(payload.users);
                setPage(payload.page);
                setPages(payload.pages);
                setTotal(payload.total);
                setTrustProxyEnabled(payload.trustProxyEnabled);
            },
            fail: () => toast.error("Kullanıcı listesi yüklenemedi."),
            settle: () => setLoading(false),
        }),
        []
    );
    const loadUsers = useCallback(async () => {
        setLoading(true);
        await runRequest(requestUsers, userHandlers);
    }, [requestUsers, userHandlers]);

    // A new page, search or status shows the loading state from the render it changes in.
    const usersKey = `${page}|${filterKey}`;
    const [loadingUsersKey, setLoadingUsersKey] = useState(usersKey);
    if (loadingUsersKey !== usersKey) {
        setLoadingUsersKey(usersKey);
        setLoading(true);
    }

    useEffect(() => startRequest(requestUsers, userHandlers), [requestUsers, userHandlers]);

    const counts = useMemo(() => {
        const suspendedCount = users.filter((user) => user.isSuspended).length;
        const ipSignalCount = users.filter((user) => Boolean(user.lastTrustedIp)).length;
        return {
            visible: users.length,
            suspended: suspendedCount,
            ipSignals: ipSignalCount,
        };
    }, [users]);

    const openActionModal = useCallback(
        (user: AdminUserModerationView, mode: ActionMode) => {
            setSelectedUser(user);
            setActionMode(mode);
            setReason("");
            setSuspendedUntil("");
        },
        []
    );

    const closeActionModal = useCallback(() => {
        setSelectedUser(null);
        setActionMode("suspend");
        setReason("");
        setSuspendedUntil("");
    }, []);

    const openWalletModal = useCallback((user: AdminUserModerationView) => {
        setSelectedWalletUser(user);
        setWalletAdjustmentType("credit");
        setWalletAmount("100");
        setWalletReason("");
    }, []);

    const closeWalletModal = useCallback(() => {
        setSelectedWalletUser(null);
        setWalletAdjustmentType("credit");
        setWalletAmount("100");
        setWalletReason("");
    }, []);

    const submitAction = useCallback(async () => {
        if (!selectedUser) {
            return;
        }

        setSaving(true);
        try {
            const response = await fetch(`/api/admin/users/${selectedUser.id}/moderation`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    actionType: actionMode,
                    reason,
                    suspendedUntil:
                        actionMode === "suspend" && suspendedUntil
                            ? new Date(suspendedUntil).toISOString()
                            : null,
                }),
            });

            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({
                    error: "Moderasyon işlemi tamamlanamadı.",
                }))) as { error?: string };
                toast.error(errorPayload.error ?? "Moderasyon işlemi tamamlanamadı.");
                return;
            }

            toast.success(`${selectedUser.username} için ${actionLabels[actionMode].toLowerCase()} işlemi tamamlandı.`);
            closeActionModal();
            await loadUsers();
        } catch {
            toast.error("Moderasyon işlemi tamamlanamadı.");
        } finally {
            setSaving(false);
        }
    }, [actionMode, closeActionModal, loadUsers, reason, selectedUser, suspendedUntil]);

    const deleteNote = useCallback(async (userId: number, eventId: number) => {
        setDeletingEventId(eventId);
        try {
            const response = await fetch(`/api/admin/users/${userId}/moderation/${eventId}`, {
                method: "DELETE",
            });

            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({
                    error: "İç not silinemedi.",
                }))) as { error?: string };
                toast.error(errorPayload.error ?? "İç not silinemedi.");
                return;
            }

            toast.success("İç not silindi.");
            await loadUsers();
        } catch {
            toast.error("İç not silinemedi.");
        } finally {
            setDeletingEventId(null);
        }
    }, [loadUsers]);

    const submitWalletAdjustment = useCallback(async () => {
        if (!selectedWalletUser) {
            return;
        }

        setWalletSaving(true);
        try {
            const response = await fetch(`/api/admin/users/${selectedWalletUser.id}/wallet-adjustment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    adjustmentType: walletAdjustmentType,
                    amount: Number(walletAmount),
                    reason: walletReason,
                }),
            });

            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({
                    error: "Coin operasyonu tamamlanamadı.",
                }))) as { error?: string };
                toast.error(errorPayload.error ?? "Coin operasyonu tamamlanamadı.");
                return;
            }

            toast.success(
                `${selectedWalletUser.username} için ${
                    walletAdjustmentType === "credit" ? "coin ekleme" : "coin düşme"
                } işlemi tamamlandı.`
            );
            closeWalletModal();
            await loadUsers();
        } catch {
            toast.error("Coin operasyonu tamamlanamadı.");
        } finally {
            setWalletSaving(false);
        }
    }, [closeWalletModal, loadUsers, selectedWalletUser, walletAdjustmentType, walletAmount, walletReason]);

    return (
        <div className="space-y-6">
            <AdminPageHeader
                title="Kullanıcı Operasyonları"
                description="Moderasyon, destek, envanter ve temel gözlem sinyallerini tek operasyon yüzeyinden yönetin."
                meta={`${total} kayıt`}
                icon={<Users className="h-5 w-5 text-amber-500" />}
            />

            <AdminToolbar>
                <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Kullanıcı adı, e-posta veya görünen isim ara..."
                            className="pl-9"
                        />
                    </div>
                    <select
                        value={status}
                        onChange={(event) => setStatus(event.target.value as StatusFilter)}
                        className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none"
                    >
                        <option value="all">Tüm durumlar</option>
                        <option value="active">Aktif</option>
                        <option value="suspended">Askıda</option>
                    </select>
                </div>
                <AdminToolbarStats
                    stats={[
                        { label: "görünen", value: String(counts.visible) },
                        { label: "askıda", value: String(counts.suspended) },
                        { label: "ip sinyali", value: String(counts.ipSignals) },
                        { label: "sayfa", value: `${page} / ${pages}` },
                    ]}
                />
            </AdminToolbar>

            {!trustProxyEnabled ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    `TRUST_PROXY` kapalı. Son IP ve kayıt IP alanları yalnız güvenilir proxy arkasında sinyal üretir; bu yüzden bazı kullanıcılar için boş görünebilir.
                </div>
            ) : null}

            <AdminTableShell
                title="Kullanıcı Operasyon Listesi"
                description="Moderasyon, destek, envanter ve trusted access sinyalleri birlikte listelenir."
                loading={loading}
                isEmpty={!loading && users.length === 0}
                emptyState={
                    <AdminEmptyState
                        icon={<Users className="h-6 w-6" />}
                        title="Kullanıcı bulunamadı"
                        description="Mevcut filtrelerle eşleşen kullanıcı kaydı yok."
                    />
                }
                footer={
                    <AdminPagination page={page} pageCount={pages} onPageChange={setPage} />
                }
            >
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/20">
                            <TableHead>Kullanıcı</TableHead>
                            <TableHead>Durum</TableHead>
                            <TableHead>Coin</TableHead>
                            <TableHead>Gözlem</TableHead>
                            <TableHead>Operasyon Özeti</TableHead>
                            <TableHead>Son Olaylar</TableHead>
                            <TableHead className="text-right">İşlemler</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {users.map((user) => (
                            <TableRow key={user.id}>
                                <TableCell>
                                    <div className="space-y-1">
                                        <div className="font-semibold text-foreground">
                                            {user.displayName || user.username}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            @{user.username} | {user.role}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {user.email ?? "E-posta eklenmemiş"}
                                            {user.emailVerifiedAt
                                                ? " | doğrulandı"
                                                : user.email
                                                  ? " | doğrulanmadı"
                                                  : ""}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            Kayıt: {formatDateTime(user.createdAt)}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="space-y-2">
                                        <span
                                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-[0.16em] ${
                                                user.isSuspended
                                                    ? statusBadgeClass.computed_suspended
                                                    : statusBadgeClass.computed_active
                                            }`}
                                        >
                                            {user.isSuspended ? "Askıda" : "Aktif"}
                                        </span>
                                        {user.isSuspended ? (
                                            <div className="max-w-xs text-xs text-muted-foreground">
                                                <div>{user.suspensionReason || "Sebep yok"}</div>
                                                <div>Bitiş: {formatDateTime(user.suspendedUntil)}</div>
                                            </div>
                                        ) : null}
                                    </div>
                                </TableCell>
                                <TableCell className="font-medium text-foreground">
                                    {user.coinBalance.toLocaleString("tr-TR")}
                                </TableCell>
                                <TableCell>
                                    <div className="space-y-1.5 text-xs text-muted-foreground">
                                        <div>
                                            <span className="font-semibold text-foreground">Son sinyal:</span>{" "}
                                            {formatDateTime(user.lastSeenAt)}
                                        </div>
                                        <div>
                                            <span className="font-semibold text-foreground">Son IP:</span>{" "}
                                            {formatTrustedIp(user.lastTrustedIp)}
                                        </div>
                                        <div>
                                            <span className="font-semibold text-foreground">Kayıt IP:</span>{" "}
                                            {formatTrustedIp(user.registeredTrustedIp)}
                                        </div>
                                        <div className="max-w-xs truncate" title={user.lastUserAgent ?? undefined}>
                                            <span className="font-semibold text-foreground">UA:</span>{" "}
                                            {summarizeUserAgent(user.lastUserAgent)}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="space-y-2 text-xs text-muted-foreground">
                                        <div>
                                            {user.supportTicketSummary.total > 0 ? (
                                                <Link
                                                    href={buildSupportHref(user)}
                                                    className="font-semibold text-foreground underline decoration-dotted underline-offset-4"
                                                >
                                                    Support:
                                                </Link>
                                            ) : (
                                                <span className="font-semibold text-foreground">Support:</span>
                                            )}{" "}
                                            {user.supportTicketSummary.total > 0
                                                ? `${user.supportTicketSummary.total} kayıt, ${user.supportTicketSummary.openCount} açık`
                                                : "Kayıt yok"}
                                        </div>
                                        <div>
                                            <span className="font-semibold text-foreground">Son ticket:</span>{" "}
                                            {getSupportStatusLabel(user.supportTicketSummary.latestStatus)}
                                            {user.supportTicketSummary.latestUpdatedAt
                                                ? ` • ${formatDateTime(user.supportTicketSummary.latestUpdatedAt)}`
                                                : ""}
                                        </div>
                                        <div className="max-w-xs truncate" title={user.supportTicketSummary.latestSubject ?? undefined}>
                                            <span className="font-semibold text-foreground">Konu:</span>{" "}
                                            {user.supportTicketSummary.latestSubject ?? "Ticket yok"}
                                        </div>
                                        <div>
                                            <span className="font-semibold text-foreground">Son coin işlemi:</span>{" "}
                                            {getWalletAdjustmentLabel(user.walletAdjustmentSummary.latestType)}
                                            {user.walletAdjustmentSummary.latestAmount !== null
                                                ? ` • ${user.walletAdjustmentSummary.latestAmount.toLocaleString("tr-TR")}`
                                                : ""}
                                        </div>
                                        <div className="max-w-xs truncate" title={user.walletAdjustmentSummary.latestReason ?? undefined}>
                                            <span className="font-semibold text-foreground">Coin nedeni:</span>{" "}
                                            {user.walletAdjustmentSummary.latestReason ?? "Wallet adjustment yok"}
                                        </div>
                                        {user.supportTicketSummary.latestTicketId ? (
                                            <div>
                                                <Link
                                                    href={buildSupportHref(user)}
                                                    className="font-semibold text-foreground underline decoration-dotted underline-offset-4"
                                                >
                                                    Support kaydına git
                                                </Link>
                                            </div>
                                        ) : null}
                                        {user.walletAdjustmentSummary.latestAdjustmentId ? (
                                            <div>
                                                <Link
                                                    href={buildWalletAuditHref(user)}
                                                    className="font-semibold text-foreground underline decoration-dotted underline-offset-4"
                                                >
                                                    Coin kaydına git
                                                </Link>
                                            </div>
                                        ) : null}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="space-y-2">
                                        {user.recentModerationEvents.length === 0 ? (
                                            <div className="text-xs text-muted-foreground">
                                                Moderasyon kaydı yok.
                                            </div>
                                        ) : (
                                            <>
                                                {(expandedUserId === user.id
                                                    ? user.recentModerationEvents
                                                    : user.recentModerationEvents.slice(0, 2)
                                                ).map((event) => (
                                                    <div
                                                        key={event.id}
                                                        className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-xs"
                                                    >
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="space-y-1">
                                                                <div className="flex items-center gap-2">
                                                                    <Link
                                                                        href={buildModerationAuditHref(user, event.actionType)}
                                                                        className="font-semibold text-foreground underline decoration-dotted underline-offset-4"
                                                                    >
                                                                        {getEventLabel(event.actionType)}
                                                                    </Link>
                                                                    <span className="text-muted-foreground">
                                                                        {formatDateTime(event.createdAt)}
                                                                    </span>
                                                                </div>
                                                                <div className="line-clamp-2 text-muted-foreground">
                                                                    {event.reason}
                                                                </div>
                                                            </div>
                                                            {event.actionType === "note" ? (
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    disabled={deletingEventId === event.id}
                                                                    onClick={() => void deleteNote(user.id, event.id)}
                                                                >
                                                                    {deletingEventId === event.id ? (
                                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                                    ) : (
                                                                        <Trash2 className="h-4 w-4" />
                                                                    )}
                                                                </Button>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                ))}
                                                {user.recentModerationEvents.length > 2 ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="gap-1 px-0 text-xs text-muted-foreground"
                                                        onClick={() =>
                                                            setExpandedUserId((current) =>
                                                                current === user.id ? null : user.id
                                                            )
                                                        }
                                                    >
                                                        <ChevronDown
                                                            className={`h-4 w-4 transition-transform ${
                                                                expandedUserId === user.id ? "rotate-180" : ""
                                                            }`}
                                                        />
                                                        {expandedUserId === user.id
                                                            ? "Daha az göster"
                                                            : `${user.recentModerationEvents.length - 2} olay daha`}
                                                    </Button>
                                                ) : null}
                                            </>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex flex-wrap justify-end gap-2">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setSelectedMatchUser(user)}
                                        >
                                            Maçlar
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setSelectedLedgerUser(user)}
                                        >
                                            Cüzdan
                                        </Button>
                                        {user.role === "admin" ? (
                                            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                                                Admin hesabı
                                            </span>
                                        ) : (
                                            <>
                                                {user.isSuspended ? (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => openActionModal(user, "reactivate")}
                                                    >
                                                        Etkinleştir
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => openActionModal(user, "suspend")}
                                                    >
                                                        Askıya Al
                                                    </Button>
                                                )}
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openWalletModal(user)}
                                                >
                                                    Coin
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openActionModal(user, "note")}
                                                >
                                                    İç Not
                                                </Button>
                                                <Button asChild type="button" variant="ghost" size="sm">
                                                    <Link href={buildSupportHref(user)}>Destek</Link>
                                                </Button>
                                                <Button asChild type="button" variant="ghost" size="sm">
                                                    <Link href={buildInventoryHref(user)}>Envanter</Link>
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </AdminTableShell>

            {selectedMatchUser ? (
                <AdminUserMatchHistoryDialog
                    user={selectedMatchUser}
                    onClose={() => setSelectedMatchUser(null)}
                />
            ) : null}

            {selectedLedgerUser ? (
                <AdminWalletLedgerDialog
                    user={selectedLedgerUser}
                    onClose={() => setSelectedLedgerUser(null)}
                />
            ) : null}

            {selectedUser ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-3xl border border-border bg-card shadow-2xl">
                        <div className="flex items-center justify-between border-b border-border px-5 py-4">
                            <div>
                                <h2 className="text-lg font-semibold text-foreground">
                                    {actionLabels[actionMode]}
                                </h2>
                                <p className="text-sm text-muted-foreground">
                                    @{selectedUser.username} için işlem uygulanıyor.
                                </p>
                            </div>
                            <Button type="button" variant="ghost" size="icon" onClick={closeActionModal}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>

                        <div className="space-y-5 p-5">
                            <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                                <div className="flex items-start gap-3">
                                    {actionMode === "note" ? (
                                        <StickyNote className="mt-0.5 h-5 w-5 text-sky-500" />
                                    ) : (
                                        <ShieldBan className="mt-0.5 h-5 w-5 text-amber-500" />
                                    )}
                                    <div>
                                        <div className="font-semibold text-foreground">
                                            {actionLabels[actionMode]}
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                            {actionDescriptions[actionMode]}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                    {actionMode === "note" ? "Not" : "Gerekçe"}
                                </label>
                                <textarea
                                    value={reason}
                                    onChange={(event) => setReason(event.target.value)}
                                    rows={5}
                                    className="min-h-[120px] w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-y"
                                    placeholder={
                                        actionMode === "note"
                                            ? "Admin ekibi için görünür operasyon notunu yazın..."
                                            : "Moderasyon gerekçesini yazın..."
                                    }
                                />
                            </div>

                            {actionMode === "suspend" ? (
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                        Suspended Until (opsiyonel)
                                    </label>
                                    <Input
                                        type="datetime-local"
                                        value={suspendedUntil}
                                        onChange={(event) => setSuspendedUntil(event.target.value)}
                                    />
                                </div>
                            ) : null}
                        </div>

                        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
                            <Button type="button" variant="outline" onClick={closeActionModal}>
                                İptal
                            </Button>
                            <Button
                                type="button"
                                onClick={() => void submitAction()}
                                disabled={saving || reason.trim().length < 3}
                                className="gap-2"
                            >
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                Kaydet
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            {selectedWalletUser ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-xl rounded-3xl border border-border bg-card shadow-2xl">
                        <div className="flex items-center justify-between border-b border-border px-5 py-4">
                            <div>
                                <h2 className="text-lg font-semibold text-foreground">Coin Operasyonu</h2>
                                <p className="text-sm text-muted-foreground">
                                    @{selectedWalletUser.username} için kontrollü bakiye işlemi uygulanacak.
                                </p>
                            </div>
                            <Button type="button" variant="ghost" size="icon" onClick={closeWalletModal}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>

                        <div className="space-y-5 p-5">
                            <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                                <div className="flex items-start gap-3">
                                    <Coins className="mt-0.5 h-5 w-5 text-amber-500" />
                                    <div className="space-y-1">
                                        <div className="font-semibold text-foreground">
                                            Mevcut bakiye: {selectedWalletUser.coinBalance.toLocaleString("tr-TR")} coin
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                            Her coin işlemi audit log ve wallet adjustment kaydı ile saklanır.
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                        İşlem Türü
                                    </label>
                                    <select
                                        value={walletAdjustmentType}
                                        onChange={(event) =>
                                            setWalletAdjustmentType(event.target.value as WalletAdjustmentType)
                                        }
                                        className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none"
                                    >
                                        <option value="credit">Coin Ekle</option>
                                        <option value="debit">Coin Düş</option>
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                        Miktar
                                    </label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={1000000}
                                        value={walletAmount}
                                        onChange={(event) => setWalletAmount(event.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                    Gerekçe
                                </label>
                                <textarea
                                    value={walletReason}
                                    onChange={(event) => setWalletReason(event.target.value)}
                                    rows={4}
                                    className="min-h-[110px] w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-y"
                                    placeholder="Coin operasyon gerekçesini yazın..."
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
                            <Button type="button" variant="outline" onClick={closeWalletModal}>
                                İptal
                            </Button>
                            <Button
                                type="button"
                                onClick={() => void submitWalletAdjustment()}
                                disabled={
                                    walletSaving ||
                                    walletReason.trim().length < 3 ||
                                    !Number.isInteger(Number(walletAmount)) ||
                                    Number(walletAmount) < 1
                                }
                                className="gap-2"
                            >
                                {walletSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                Kaydet
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}




