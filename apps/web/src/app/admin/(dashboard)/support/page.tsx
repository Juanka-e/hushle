"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
    Headset,
    LifeBuoy,
    MessageSquareText,
    RefreshCw,
    Search,
    Send,
    ShieldAlert,
    UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { AdminEmptyState, AdminTableShell } from "@/components/admin/admin-table-shell";
import { AdminToolbar, AdminToolbarStats } from "@/components/admin/admin-toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runRequest, startRequest } from "@/lib/run-request";
import type {
    SupportAdminListResponse,
    SupportTicketPriority,
    SupportTicketStatus,
    SupportTicketView,
} from "@/types/support";

const statusLabels: Record<SupportTicketStatus, string> = {
    open: "Açık",
    in_progress: "İşlemde",
    resolved: "Çözüldü",
    closed: "Kapalı",
};

const priorityLabels: Record<SupportTicketPriority, string> = {
    low: "Düşük",
    normal: "Normal",
    high: "Yüksek",
};

const statusBadgeClass: Record<SupportTicketStatus, string> = {
    open: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300",
    in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
    resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
    closed: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const priorityBadgeClass: Record<SupportTicketPriority, string> = {
    low: "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
    normal: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
    high: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",
};

function formatDateTime(value: string): string {
    return new Date(value).toLocaleString("tr-TR", {
        dateStyle: "short",
        timeStyle: "short",
    });
}

function buildInventoryHref(userId: number, username: string): string {
    const params = new URLSearchParams({
        userId: String(userId),
        search: username,
    });
    return `/admin/inventory?${params.toString()}`;
}

function buildUsersHref(username: string): string {
    const params = new URLSearchParams({
        search: username,
    });
    return `/admin/users?${params.toString()}`;
}

function buildAuditHref(username: string): string {
    const params = new URLSearchParams({
        search: username,
    });
    return `/admin/audit?${params.toString()}`;
}

/** A refused queue request; the message is the server's reason, if it gave one. */
class SupportQueueError extends Error {}

async function requestSupportQueue(
    query: { page: number; status: "all" | SupportTicketStatus; search: string },
    signal?: AbortSignal
): Promise<SupportAdminListResponse> {
    const params = new URLSearchParams({
        page: String(query.page),
        limit: "12",
        status: query.status,
    });
    if (query.search) {
        params.set("search", query.search);
    }

    const response = await fetch(`/api/admin/support/tickets?${params.toString()}`, {
        cache: "no-store",
        signal,
    });
    const payload = (await response.json().catch(() => null)) as
        | SupportAdminListResponse
        | { error?: string }
        | null;
    if (!response.ok || !payload || !("tickets" in payload)) {
        throw new SupportQueueError((payload && "error" in payload && payload.error) || "");
    }
    return payload;
}

function supportQueueErrorMessage(error: unknown, fallback: string): string {
    return error instanceof SupportQueueError && error.message ? error.message : fallback;
}

export default function AdminSupportPage() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [tickets, setTickets] = useState<SupportTicketView[]>([]);
    const [assignableAdmins, setAssignableAdmins] = useState<SupportAdminListResponse["assignableAdmins"]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [pageCount, setPageCount] = useState(1);
    const [total, setTotal] = useState(0);
    const [status, setStatus] = useState<"all" | SupportTicketStatus>("all");
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
    const [ticketStatus, setTicketStatus] = useState<SupportTicketStatus>("open");
    const [ticketPriority, setTicketPriority] = useState<SupportTicketPriority>("normal");
    const [assignedAdminId, setAssignedAdminId] = useState<string>("unassigned");
    const [messageBody, setMessageBody] = useState("");
    const [messageMode, setMessageMode] = useState<"public" | "internal">("public");
    const [savingTicket, setSavingTicket] = useState(false);
    const [sendingMessage, setSendingMessage] = useState(false);

    // Adjusted during render instead of in effects. The URL filters apply on load and on
    // each navigation (a ?ticketId= is selected once it appears in the queue), so the URL
    // write below never runs with the defaults.
    const urlKey = searchParams.toString();
    const [syncedUrlKey, setSyncedUrlKey] = useState<string | null>(null);
    const [pendingTicketId, setPendingTicketId] = useState<number | null>(null);
    if (syncedUrlKey !== urlKey) {
        setSyncedUrlKey(urlKey);
        const nextSearch = (searchParams.get("search") ?? "").trim();
        const nextStatus = searchParams.get("status");
        const nextTicketId = Number(searchParams.get("ticketId") ?? "");

        setSearchInput(nextSearch);
        setSearch(nextSearch);
        setPage(1);
        if (nextStatus === "all" || nextStatus === "open" || nextStatus === "in_progress" || nextStatus === "resolved" || nextStatus === "closed") {
            setStatus(nextStatus);
        }
        setPendingTicketId(Number.isInteger(nextTicketId) && nextTicketId > 0 ? nextTicketId : null);
    }
    const urlSynced = syncedUrlKey !== null;

    useEffect(() => {
        if (!urlSynced) {
            return;
        }

        const params = new URLSearchParams();

        if (search.trim()) {
            params.set("search", search.trim());
        }

        if (status !== "all") {
            params.set("status", status);
        }

        // An unresolved deep link stays in the URL until the queue can select it.
        const ticketIdForUrl = selectedTicketId ?? pendingTicketId;
        if (ticketIdForUrl) {
            params.set("ticketId", String(ticketIdForUrl));
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
    }, [pathname, pendingTicketId, router, search, selectedTicketId, status, urlSynced]);

    const selectedTicket = useMemo(
        () => tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
        [selectedTicketId, tickets]
    );

    const queueHandlers = useMemo(
        () => ({
            apply: (payload: SupportAdminListResponse) => {
                setTickets(payload.tickets);
                setAssignableAdmins(payload.assignableAdmins);
                setTotal(payload.total);
                setPageCount(payload.pages);
            },
            settle: () => setLoading(false),
        }),
        []
    );

    // A new page, status or search shows the loading state from the render it changes in.
    const queueKey = `${page}|${status}|${search}`;
    const [loadingQueueKey, setLoadingQueueKey] = useState(queueKey);
    if (loadingQueueKey !== queueKey) {
        setLoadingQueueKey(queueKey);
        setLoading(true);
    }

    useEffect(() => {
        const abort = new AbortController();
        const cancel = startRequest(() => requestSupportQueue({ page, status, search }, abort.signal), {
            ...queueHandlers,
            fail: (error) => toast.error(supportQueueErrorMessage(error, "Destek kuyruğu yüklenemedi.")),
        });
        return () => {
            cancel();
            abort.abort();
        };
    }, [page, queueHandlers, search, status]);

    // A new queue picks the selection: the ?ticketId= deep link once it is listed, then the
    // current ticket if still listed, then the first ticket.
    const [selectionTickets, setSelectionTickets] = useState(tickets);
    if (selectionTickets !== tickets) {
        setSelectionTickets(tickets);
        const pendingListed = pendingTicketId !== null && tickets.some((ticket) => ticket.id === pendingTicketId);
        if (pendingListed) {
            setSelectedTicketId(pendingTicketId);
            setPendingTicketId(null);
        } else if (!selectedTicketId || !tickets.some((ticket) => ticket.id === selectedTicketId)) {
            setSelectedTicketId(tickets[0]?.id ?? null);
        }
    }

    // The edit form follows each new ticket value (after a selection or a reload).
    const [formTicket, setFormTicket] = useState<SupportTicketView | null>(null);
    if (selectedTicket && formTicket !== selectedTicket) {
        setFormTicket(selectedTicket);
        setTicketStatus(selectedTicket.status);
        setTicketPriority(selectedTicket.priority);
        setAssignedAdminId(
            selectedTicket.assignedAdmin ? String(selectedTicket.assignedAdmin.id) : "unassigned"
        );
        setMessageMode("public");
        setMessageBody("");
    }

    async function refreshCurrentPage() {
        setLoading(true);
        await runRequest(() => requestSupportQueue({ page, status, search }), {
            ...queueHandlers,
            fail: (error) => toast.error(supportQueueErrorMessage(error, "Destek kuyruğu yenilenemedi.")),
        });
    }

    async function saveTicketChanges() {
        if (!selectedTicket) {
            return;
        }

        setSavingTicket(true);
        try {
            const response = await fetch(`/api/admin/support/tickets/${selectedTicket.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status: ticketStatus,
                    priority: ticketPriority,
                    assignedAdminUserId: assignedAdminId === "unassigned" ? null : Number(assignedAdminId),
                }),
            });

            const payload = (await response.json()) as SupportTicketView | { error?: string };
            if (!response.ok || !("id" in payload)) {
                toast.error(("error" in payload && payload.error) || "Talep güncellenemedi.");
                return;
            }

            setTickets((current) =>
                current.map((ticket) => (ticket.id === payload.id ? payload : ticket))
            );
            toast.success("Destek talebi güncellendi.");
        } catch {
            toast.error("Destek talebi güncellenemedi.");
        } finally {
            setSavingTicket(false);
        }
    }

    async function sendAdminMessage() {
        if (!selectedTicket) {
            return;
        }

        setSendingMessage(true);
        try {
            const response = await fetch(`/api/admin/support/tickets/${selectedTicket.id}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    body: messageBody,
                    isInternal: messageMode === "internal",
                }),
            });

            const payload = (await response.json()) as SupportTicketView | { error?: string };
            if (!response.ok || !("id" in payload)) {
                toast.error(("error" in payload && payload.error) || "Mesaj gönderilemedi.");
                return;
            }

            setTickets((current) =>
                current.map((ticket) => (ticket.id === payload.id ? payload : ticket))
            );
            setMessageBody("");
            toast.success(messageMode === "internal" ? "İç not eklendi." : "Kullanıcıya cevap gönderildi.");
        } catch {
            toast.error("Mesaj gönderilemedi.");
        } finally {
            setSendingMessage(false);
        }
    }

    const stats = [
        { label: "Toplam", value: String(total) },
        {
            label: "Bu sayfa",
            value: String(tickets.length),
        },
        {
            label: "Açık",
            value: String(tickets.filter((ticket) => ticket.status === "open").length),
        },
        {
            label: "İşlemde",
            value: String(tickets.filter((ticket) => ticket.status === "in_progress").length),
        },
    ];

    return (
        <div className="space-y-6">
            <AdminPageHeader
                title="Support Desk"
                description="Oyuncu taleplerini topla, admin ataması yap, iç not veya görünür cevapla talepleri yönet."
                meta="Support Desk Foundation"
                icon={<Headset className="h-5 w-5 text-foreground" />}
                action={
                    <Button type="button" variant="outline" className="gap-2" onClick={() => void refreshCurrentPage()}>
                        <RefreshCw className="h-4 w-4" />
                        Yenile
                    </Button>
                }
            />

            <AdminToolbar>
                <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
                    <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={searchInput}
                            onChange={(event) => setSearchInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    setPage(1);
                                    setSearch(searchInput.trim());
                                }
                            }}
                            className="pl-9"
                            placeholder="Başlık veya kullanıcı adına göre ara"
                        />
                    </div>
                    <select
                        value={status}
                        onChange={(event) => {
                            setStatus(event.target.value as "all" | SupportTicketStatus);
                            setPage(1);
                        }}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="all">Tüm durumlar</option>
                        {Object.entries(statusLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                    <Button
                        type="button"
                        onClick={() => {
                            setPage(1);
                            setSearch(searchInput.trim());
                        }}
                    >
                        Ara
                    </Button>
                </div>
                <AdminToolbarStats stats={stats} />
            </AdminToolbar>

            <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
                <AdminTableShell
                    title="Ticket Queue"
                    description="En son hareket alan destek talepleri önce gelir."
                    loading={loading}
                    isEmpty={!loading && tickets.length === 0}
                    emptyState={
                        <AdminEmptyState
                            icon={<LifeBuoy className="h-5 w-5" />}
                            title="Destek talebi yok"
                            description="Seçili filtrelerde gösterilecek bir support ticket bulunmuyor."
                        />
                    }
                    footer={
                        <AdminPagination
                            page={page}
                            pageCount={pageCount}
                            onPageChange={setPage}
                        />
                    }
                >
                    <div className="divide-y divide-border/60">
                        {tickets.map((ticket) => {
                            const isSelected = ticket.id === selectedTicketId;
                            return (
                                <button
                                    key={ticket.id}
                                    type="button"
                                    onClick={() => setSelectedTicketId(ticket.id)}
                                    className={`flex w-full flex-col gap-3 px-5 py-4 text-left transition ${
                                        isSelected ? "bg-primary/5" : "hover:bg-muted/30"
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-semibold text-foreground">
                                                {ticket.subject}
                                            </div>
                                            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                                <UserRound className="h-3.5 w-3.5" />
                                                @{ticket.user.username}
                                            </div>
                                        </div>
                                        <span
                                            className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusBadgeClass[ticket.status]}`}
                                        >
                                            {statusLabels[ticket.status]}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                        <span
                                            className={`rounded-full px-2 py-1 font-black uppercase tracking-[0.16em] ${priorityBadgeClass[ticket.priority]}`}
                                        >
                                            {priorityLabels[ticket.priority]}
                                        </span>
                                        <span>#{ticket.id}</span>
                                        <span>{formatDateTime(ticket.lastMessageAt)}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </AdminTableShell>

                <AdminTableShell
                    title="Ticket Detail"
                    description="Durum, öncelik, atama ve mesaj akışlarını tek panelden yönet."
                    loading={loading}
                    isEmpty={!loading && !selectedTicket}
                    emptyState={
                        <AdminEmptyState
                            icon={<MessageSquareText className="h-5 w-5" />}
                            title="Ticket seçilmedi"
                            description="Soldaki kuyruktan bir ticket seçerek detay panelini aç."
                        />
                    }
                >
                    {selectedTicket ? (
                        <div className="flex h-full flex-col">
                            <div className="border-b border-border/60 px-5 py-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span
                                        className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusBadgeClass[selectedTicket.status]}`}
                                    >
                                        {statusLabels[selectedTicket.status]}
                                    </span>
                                    <span
                                        className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${priorityBadgeClass[selectedTicket.priority]}`}
                                    >
                                        {priorityLabels[selectedTicket.priority]}
                                    </span>
                                </div>
                                <h2 className="mt-3 text-xl font-semibold text-foreground">
                                    {selectedTicket.subject}
                                </h2>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    Kullanıcı: @{selectedTicket.user.username} - Açılış: {formatDateTime(selectedTicket.createdAt)}
                                    {selectedTicket.assignedAdmin
                                        ? ` - Atanan yetkili: @${selectedTicket.assignedAdmin.username}`
                                        : ""}
                                </p>
                                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                    <div className="rounded-2xl border border-border/70 bg-muted/15 px-4 py-3">
                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Mesaj</div>
                                        <div className="mt-1 text-sm font-semibold text-foreground">
                                            {selectedTicket.messages.length} kayıt
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-border/70 bg-muted/15 px-4 py-3">
                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">İç not</div>
                                        <div className="mt-1 text-sm font-semibold text-foreground">
                                            {selectedTicket.messages.filter((entry) => entry.isInternal).length} not
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-border/70 bg-muted/15 px-4 py-3">
                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Görünür cevap</div>
                                        <div className="mt-1 text-sm font-semibold text-foreground">
                                            {
                                                selectedTicket.messages.filter(
                                                    (entry) => !entry.isInternal && entry.author?.role === "admin"
                                                ).length
                                            } cevap
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-border/70 bg-muted/15 px-4 py-3">
                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Son hareket</div>
                                        <div className="mt-1 text-sm font-semibold text-foreground">
                                            {formatDateTime(selectedTicket.lastMessageAt)}
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <Button asChild variant="outline" size="sm">
                                        <Link href={buildInventoryHref(selectedTicket.user.id, selectedTicket.user.username)}>
                                            Envantere Git
                                        </Link>
                                    </Button>
                                    <Button asChild variant="outline" size="sm">
                                        <Link href={buildUsersHref(selectedTicket.user.username)}>
                                            Kullanıcıda Aç
                                        </Link>
                                    </Button>
                                    <Button asChild variant="outline" size="sm">
                                        <Link href={buildAuditHref(selectedTicket.user.username)}>
                                            Audit Kaydına Git
                                        </Link>
                                    </Button>
                                </div>
                            </div>

                            <div className="grid gap-4 border-b border-border/60 px-5 py-4 md:grid-cols-3">
                                <div className="space-y-2">
                                    <label className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                                        Durum
                                    </label>
                                    <select
                                        value={ticketStatus}
                                        onChange={(event) => setTicketStatus(event.target.value as SupportTicketStatus)}
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                        {Object.entries(statusLabels).map(([value, label]) => (
                                            <option key={value} value={value}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                                        Öncelik
                                    </label>
                                    <select
                                        value={ticketPriority}
                                        onChange={(event) => setTicketPriority(event.target.value as SupportTicketPriority)}
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                        {Object.entries(priorityLabels).map(([value, label]) => (
                                            <option key={value} value={value}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                                        Atanan admin
                                    </label>
                                    <select
                                        value={assignedAdminId}
                                        onChange={(event) => setAssignedAdminId(event.target.value)}
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                        <option value="unassigned">Atama yok</option>
                                        {assignableAdmins.map((admin) => (
                                            <option key={admin.id} value={admin.id}>
                                                @{admin.username}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="md:col-span-3 flex justify-end">
                                    <Button
                                        type="button"
                                        onClick={() => void saveTicketChanges()}
                                        disabled={savingTicket}
                                    >
                                        {savingTicket ? "Kaydediliyor..." : "Ticketi Güncelle"}
                                    </Button>
                                </div>
                            </div>

                            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
                                {selectedTicket.messages.map((entry) => (
                                    <div
                                        key={entry.id}
                                        className={`rounded-2xl border px-4 py-3 ${
                                            entry.isInternal
                                                ? "border-rose-200/70 bg-rose-50/70 dark:border-rose-900/30 dark:bg-rose-950/20"
                                                : entry.author?.role === "admin"
                                                  ? "border-amber-200/70 bg-amber-50/70 dark:border-amber-900/30 dark:bg-amber-950/20"
                                                  : "border-border/70 bg-card/70"
                                        }`}
                                    >
                                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                                            <div className="flex items-center gap-2">
                                                <span className="font-black uppercase tracking-[0.18em]">
                                                    {entry.isInternal
                                                        ? "İç Not"
                                                        : entry.author?.role === "admin"
                                                          ? "Destek Ekibi"
                                                          : "Oyuncu"}
                                                </span>
                                                {entry.author ? <span>@{entry.author.username}</span> : null}
                                            </div>
                                            <span>{formatDateTime(entry.createdAt)}</span>
                                        </div>
                                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                                            {entry.body}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            <div className="border-t border-border/60 px-5 py-4">
                                <div className="mb-3 flex flex-wrap items-center gap-2">
                                    <Button
                                        type="button"
                                        variant={messageMode === "public" ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setMessageMode("public")}
                                    >
                                        Kullanıcıya Cevap
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={messageMode === "internal" ? "secondary" : "outline"}
                                        size="sm"
                                        onClick={() => setMessageMode("internal")}
                                    >
                                        <ShieldAlert className="h-4 w-4" />
                                        İç Not
                                    </Button>
                                </div>
                                {selectedTicket.status === "closed" && messageMode === "public" ? (
                                    <div className="mb-3 rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200">
                                        Kapalı ticket için oyuncuya yeni public cevap göndermeden önce durumu tekrar açık ya da işlemde yap.
                                    </div>
                                ) : null}
                                <textarea
                                    value={messageBody}
                                    onChange={(event) => setMessageBody(event.target.value)}
                                    rows={5}
                                    maxLength={2000}
                                    className="min-h-[130px] w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary resize-y"
                                    placeholder={
                                        messageMode === "internal"
                                            ? "Bu not sadece adminler tarafından görünür."
                                            : "Oyuncuya gönderilecek cevabı yaz."
                                    }
                                />
                                <div className="mt-3 flex justify-end">
                                    <Button
                                        type="button"
                                        onClick={() => void sendAdminMessage()}
                                        disabled={
                                            sendingMessage ||
                                            messageBody.trim().length < 6 ||
                                            (selectedTicket.status === "closed" && messageMode === "public")
                                        }
                                        className="gap-2"
                                    >
                                        <Send className="h-4 w-4" />
                                        {sendingMessage
                                            ? "Gönderiliyor..."
                                            : messageMode === "internal"
                                              ? "İç Not Ekle"
                                              : "Cevap Gönder"}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </AdminTableShell>
            </div>
        </div>
    );
}
