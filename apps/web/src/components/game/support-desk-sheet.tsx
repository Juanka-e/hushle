"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    BadgeAlert,
    Headset,
    LifeBuoy,
    Plus,
    Send,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
    SupportDeskResponse,
    SupportTicketCategory,
    SupportTicketStatus,
    SupportTicketView,
} from "@/types/support";
import { useI18n } from "@/components/providers/i18n-provider";
import { toIntlLocale } from "@/lib/i18n/config";

const statusBadgeClass: Record<SupportTicketStatus, string> = {
    open: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300",
    in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
    resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
    closed: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function formatDateTime(value: string, locale: string): string {
    return new Date(value).toLocaleString(locale, {
        dateStyle: "short",
        timeStyle: "short",
    });
}

interface SupportDeskSheetProps {
    isOpen: boolean;
    onClose: () => void;
    initialTicketId?: number | null;
}

export function SupportDeskSheet({ isOpen, onClose, initialTicketId = null }: SupportDeskSheetProps) {
    const { locale, t } = useI18n();
    const categoryLabels: Record<SupportTicketCategory, string> = {
        account: t("support.account"), gameplay: t("support.gameplay"), store: t("support.store"),
        rewards: t("support.rewards"), bug: t("support.bug"), report: t("support.report"), other: t("support.other"),
    };
    const statusLabels: Record<SupportTicketStatus, string> = {
        open: t("support.open"), in_progress: t("support.inProgress"),
        resolved: t("support.resolved"), closed: t("support.closed"),
    };
    const [tickets, setTickets] = useState<SupportTicketView[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
    const [composeMode, setComposeMode] = useState(false);
    const [category, setCategory] = useState<SupportTicketCategory>("gameplay");
    const [subject, setSubject] = useState("");
    const [message, setMessage] = useState("");
    const [replyBody, setReplyBody] = useState("");
    const [saving, setSaving] = useState(false);

    const selectedTicket = useMemo(
        () => tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
        [selectedTicketId, tickets]
    );

    const loadTickets = useCallback(
        async (options?: { silent?: boolean }) => {
            if (!options?.silent) {
                setLoading(true);
            }

            try {
                const response = await fetch("/api/support/tickets", { cache: "no-store" });
                if (!response.ok) {
                    if (!options?.silent) {
                        toast.error(t("support.loadFailed"));
                    }
                    return;
                }

                const payload = (await response.json()) as SupportDeskResponse;
                setTickets(payload.tickets);
                setSelectedTicketId((current) => current ?? payload.tickets[0]?.id ?? null);
            } catch {
                if (!options?.silent) {
                    toast.error(t("support.loadFailed"));
                }
            } finally {
                if (!options?.silent) {
                    setLoading(false);
                }
            }
        },
        [t]
    );

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        void loadTickets();
    }, [isOpen, loadTickets]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const intervalId = window.setInterval(() => {
            void loadTickets({ silent: true });
        }, 10_000);

        const visibilityHandler = () => {
            if (document.visibilityState === "visible") {
                void loadTickets({ silent: true });
            }
        };

        window.addEventListener("focus", visibilityHandler);
        document.addEventListener("visibilitychange", visibilityHandler);

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener("focus", visibilityHandler);
            document.removeEventListener("visibilitychange", visibilityHandler);
        };
    }, [isOpen, loadTickets]);

    useEffect(() => {
        if (!isOpen) {
            setComposeMode(false);
            setReplyBody("");
            return;
        }

        const handler = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [isOpen, onClose]);

    useEffect(() => {
        if (!isOpen || !initialTicketId) {
            return;
        }

        setComposeMode(false);
        setSelectedTicketId(initialTicketId);
    }, [initialTicketId, isOpen]);

    const submitTicket = async () => {
        setSaving(true);
        try {
            const response = await fetch("/api/support/tickets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    category,
                    subject,
                    message,
                }),
            });

            const payload = (await response.json().catch(() => ({ error: t("support.createFailed") }))) as
                | SupportTicketView
                | { error?: string };

            if (!response.ok || !("id" in payload)) {
                toast.error(("error" in payload && payload.error) || t("support.createFailed"));
                return;
            }

            setTickets((current) => [payload, ...current]);
            setSelectedTicketId(payload.id);
            setComposeMode(false);
            setSubject("");
            setMessage("");
            setCategory("gameplay");
            toast.success(t("support.created"));
        } catch {
            toast.error(t("support.createFailed"));
        } finally {
            setSaving(false);
        }
    };

    const submitReply = async () => {
        if (!selectedTicket) {
            return;
        }

        setSaving(true);
        try {
            const response = await fetch(`/api/support/tickets/${selectedTicket.id}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ body: replyBody }),
            });

            const payload = (await response.json().catch(() => ({ error: t("support.sendFailed") }))) as
                | SupportTicketView
                | { error?: string };

            if (!response.ok || !("id" in payload)) {
                toast.error(("error" in payload && payload.error) || t("support.sendFailed"));
                return;
            }

            setTickets((current) =>
                current.map((ticket) => (ticket.id === payload.id ? payload : ticket))
            );
            setReplyBody("");
            toast.success(t("support.sent"));
        } catch {
            toast.error(t("support.sendFailed"));
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-end bg-slate-950/55 backdrop-blur-sm">
            <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden border-l border-amber-300/20 bg-[linear-gradient(180deg,rgba(255,251,235,0.96),rgba(255,255,255,0.92))] shadow-2xl dark:border-amber-900/30 dark:bg-[linear-gradient(180deg,rgba(13,10,8,0.96),rgba(19,17,15,0.94))]">
                <div className="flex items-center justify-between border-b border-amber-200/60 px-5 py-4 dark:border-amber-900/20">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 shadow-sm dark:bg-amber-950/40 dark:text-amber-200">
                            <Headset className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-amber-600 dark:text-amber-300">
                                {t("support.desk")}
                            </div>
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                                {t("support.center")}
                            </h2>
                        </div>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <div className="grid flex-1 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
                    <aside className="border-b border-amber-200/60 bg-white/70 p-4 dark:border-amber-900/20 dark:bg-black/10 lg:border-b-0 lg:border-r">
                        <div className="rounded-[28px] border border-amber-200/60 bg-white/80 p-4 shadow-sm dark:border-amber-900/20 dark:bg-zinc-950/40">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-600 dark:text-amber-300">
                                        {t("support.channel")}
                                    </div>
                                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                        {t("support.channelHelp")}
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    size="sm"
                                    className="gap-2"
                                    onClick={() => {
                                        setComposeMode(true);
                                        setSelectedTicketId(null);
                                    }}
                                >
                                    <Plus className="h-4 w-4" />
                                    {t("support.new")}
                                </Button>
                            </div>
                        </div>

                        <div className="mt-4 space-y-3 overflow-y-auto pb-4 lg:max-h-[calc(100vh-220px)]">
                            {loading ? (
                                <div className="rounded-3xl border border-dashed border-amber-200/60 bg-white/60 p-6 text-sm text-slate-500 dark:border-amber-900/20 dark:bg-black/10 dark:text-slate-400">
                                    {t("support.loading")}
                                </div>
                            ) : tickets.length === 0 ? (
                                <div className="rounded-3xl border border-dashed border-amber-200/60 bg-white/60 p-6 text-sm text-slate-500 dark:border-amber-900/20 dark:bg-black/10 dark:text-slate-400">
                                    {t("support.empty")}
                                </div>
                            ) : (
                                tickets.map((ticket) => (
                                    <button
                                        key={ticket.id}
                                        type="button"
                                        onClick={() => {
                                            setComposeMode(false);
                                            setSelectedTicketId(ticket.id);
                                        }}
                                        className={`w-full rounded-[24px] border p-4 text-left transition ${
                                            selectedTicketId === ticket.id && !composeMode
                                                ? "border-amber-300 bg-amber-50/80 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/20"
                                                : "border-border/70 bg-white/65 hover:border-amber-200 hover:bg-white dark:bg-zinc-950/30 dark:hover:border-amber-900/40"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                                {ticket.subject}
                                            </span>
                                            <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusBadgeClass[ticket.status]}`}>
                                                {statusLabels[ticket.status]}
                                            </span>
                                        </div>
                                        <div className="mt-2 flex items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                            <LifeBuoy className="h-3.5 w-3.5" />
                                            {categoryLabels[ticket.category]}
                                        </div>
                                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                            {t("support.lastActivity", { date: formatDateTime(ticket.lastMessageAt, toIntlLocale(locale)) })}
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </aside>

                    <section className="flex min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.08),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.7),rgba(248,250,252,0.55))] dark:bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.08),transparent_25%),linear-gradient(180deg,rgba(24,24,27,0.85),rgba(9,9,11,0.9))]">
                        {composeMode ? (
                            <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center p-6 md:p-8">
                                <div className="rounded-[32px] border border-amber-200/70 bg-white/85 p-6 shadow-xl dark:border-amber-900/20 dark:bg-zinc-950/55">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-amber-100 dark:text-slate-900">
                                            <BadgeAlert className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-600 dark:text-amber-300">
                                                {t("support.newRequest")}
                                            </div>
                                            <h3 className="text-xl font-semibold text-slate-900 dark:text-white">
                                                {t("support.connect")}
                                            </h3>
                                        </div>
                                    </div>

                                    <div className="mt-6 grid gap-4 md:grid-cols-2">
                                        <div className="space-y-2">
                                            <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                                {t("support.category")}
                                            </label>
                                            <select
                                                value={category}
                                                onChange={(event) => setCategory(event.target.value as SupportTicketCategory)}
                                                className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm outline-none"
                                            >
                                                {Object.entries(categoryLabels).map(([value, label]) => (
                                                    <option key={value} value={value}>
                                                        {label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                                {t("support.subject")}
                                            </label>
                                            <Input
                                                value={subject}
                                                onChange={(event) => setSubject(event.target.value)}
                                                maxLength={160}
                                                placeholder={t("support.subjectPlaceholder")}
                                            />
                                        </div>
                                    </div>

                                    <div className="mt-4 space-y-2">
                                        <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                            {t("support.message")}
                                        </label>
                                        <textarea
                                            value={message}
                                            onChange={(event) => setMessage(event.target.value)}
                                            rows={8}
                                            maxLength={2000}
                                            className="min-h-[180px] w-full rounded-[24px] border border-border bg-background px-4 py-3 text-sm outline-none focus:border-amber-500 resize-y"
                                                placeholder={t("support.messagePlaceholder")}
                                        />
                                    </div>

                                    <div className="mt-6 flex justify-end gap-3">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => {
                                                setComposeMode(false);
                                                setSelectedTicketId(tickets[0]?.id ?? null);
                                            }}
                                        >
                                            {t("common.cancel")}
                                        </Button>
                                        <Button
                                            type="button"
                                            onClick={() => void submitTicket()}
                                            disabled={saving || subject.trim().length < 4 || message.trim().length < 6}
                                            className="gap-2"
                                        >
                                            <Send className="h-4 w-4" />
                                            {t("support.send")}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ) : selectedTicket ? (
                            <div className="flex h-full min-h-0 flex-col">
                                <div className="border-b border-amber-200/60 px-6 py-5 dark:border-amber-900/20">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusBadgeClass[selectedTicket.status]}`}>
                                            {statusLabels[selectedTicket.status]}
                                        </span>
                                        <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white dark:bg-slate-100 dark:text-slate-900">
                                            {categoryLabels[selectedTicket.category]}
                                        </span>
                                    </div>
                                    <h3 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                                        {selectedTicket.subject}
                                    </h3>
                                    <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                        {t("support.requestMeta", { id: selectedTicket.id, date: formatDateTime(selectedTicket.createdAt, toIntlLocale(locale)) })}
                                        {selectedTicket.assignedAdmin
                                            ? ` - ${t("support.assigned", { name: selectedTicket.assignedAdmin.username })}`
                                            : ""}
                                    </div>
                                </div>

                                <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
                                    {selectedTicket.messages.map((entry) => {
                                        const isMine = entry.author?.role !== "admin";
                                        return (
                                            <div
                                                key={entry.id}
                                                className={`max-w-3xl rounded-[24px] border px-4 py-3 shadow-sm ${
                                                    isMine
                                                        ? "ml-auto border-slate-200 bg-white dark:border-slate-800 dark:bg-zinc-950/60"
                                                        : "border-amber-200/70 bg-amber-50/80 dark:border-amber-900/30 dark:bg-amber-950/20"
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                                        {entry.author?.role === "admin" ? t("support.team") : t("support.you")}
                                                    </div>
                                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                                        {formatDateTime(entry.createdAt, toIntlLocale(locale))}
                                                    </div>
                                                </div>
                                                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">
                                                    {entry.body}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="border-t border-amber-200/60 px-6 py-5 dark:border-amber-900/20">
                                    {selectedTicket.status === "closed" || selectedTicket.status === "resolved" ? (
                                        <div className="rounded-2xl border border-dashed border-zinc-300/70 bg-white/70 px-4 py-4 text-sm text-slate-500 dark:border-zinc-700/70 dark:bg-zinc-950/30 dark:text-slate-400">
                                            {selectedTicket.status === "resolved"
                                                ? t("support.resolvedHelp")
                                                : t("support.closedHelp")}
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <textarea
                                                value={replyBody}
                                                onChange={(event) => setReplyBody(event.target.value)}
                                                rows={4}
                                                maxLength={2000}
                                                className="min-h-[110px] w-full rounded-[24px] border border-border bg-background px-4 py-3 text-sm outline-none focus:border-amber-500 resize-y"
                                                placeholder={t("support.replyPlaceholder")}
                                            />
                                            <div className="flex justify-end">
                                                <Button
                                                    type="button"
                                                    onClick={() => void submitReply()}
                                                    disabled={saving || replyBody.trim().length < 6}
                                                    className="gap-2"
                                                >
                                                    <Send className="h-4 w-4" />
                                                    {t("support.sendMessage")}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex h-full items-center justify-center px-8 text-center">
                                <div className="max-w-md space-y-3">
                                    <Headset className="mx-auto h-10 w-10 text-amber-500" />
                                    <h3 className="text-xl font-semibold text-slate-900 dark:text-white">
                                        {t("support.select")}
                                    </h3>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        {t("support.selectHelp")}
                                    </p>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}


