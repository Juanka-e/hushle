"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Archive, Bell, Check, CheckCheck, LifeBuoy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { NotificationListResponse, NotificationType, NotificationView } from "@/types/notifications";
import { dispatchNotificationsUpdated } from "@/lib/notification-events";
import { useI18n } from "@/components/providers/i18n-provider";
import { toIntlLocale } from "@/lib/i18n/config";

const notificationBadgeClass: Record<NotificationType, string> = {
    system: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300",
    support_reply: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
    support_status: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
    economy: "bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300",
    moderation: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",
};

function formatDateTime(value: string, locale: string): string {
    return new Date(value).toLocaleString(locale, {
        dateStyle: "short",
        timeStyle: "short",
    });
}

interface NotificationsSheetProps {
    isOpen: boolean;
    unreadCount: number;
    onUnreadCountChange: Dispatch<SetStateAction<number>>;
    onClose: () => void;
    onOpenSupport?: (ticketId?: number | null) => void;
}

export function NotificationsSheet({
    isOpen,
    unreadCount,
    onUnreadCountChange,
    onClose,
    onOpenSupport,
}: NotificationsSheetProps) {
    const { locale, t } = useI18n();
    const notificationLabels: Record<NotificationType, string> = {
        system: t("notifications.system"),
        support_reply: t("notifications.supportReply"),
        support_status: t("notifications.supportStatus"),
        economy: t("notifications.economy"),
        moderation: t("notifications.moderation"),
    };
    const [notifications, setNotifications] = useState<NotificationView[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [busyNotificationIds, setBusyNotificationIds] = useState<number[]>([]);
    const [filter, setFilter] = useState<"all" | "unread">("all");

    useEffect(() => {
        window.dispatchEvent(
            new CustomEvent("tabu:notifications-sheet-state", {
                detail: {
                    open: isOpen,
                },
            })
        );

        return () => {
            window.dispatchEvent(
                new CustomEvent("tabu:notifications-sheet-state", {
                    detail: {
                        open: false,
                    },
                })
            );
        };
    }, [isOpen]);

    const loadNotifications = useCallback(
        async (options?: { silent?: boolean }) => {
            if (!options?.silent) {
                setLoading(true);
            }

            try {
                const params = new URLSearchParams({
                    limit: "30",
                    filter,
                });
                const response = await fetch(`/api/notifications?${params.toString()}`, {
                    cache: "no-store",
                });

                if (!response.ok) {
                    if (!options?.silent) {
                        toast.error(t("notifications.loadFailed"));
                    }
                    return;
                }

                const payload = (await response.json()) as NotificationListResponse;
                setNotifications(payload.notifications);
                onUnreadCountChange(payload.unreadCount);
            } catch {
                if (!options?.silent) {
                    toast.error(t("notifications.loadFailed"));
                }
            } finally {
                if (!options?.silent) {
                    setLoading(false);
                }
            }
        },
        [filter, onUnreadCountChange, t]
    );

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        void loadNotifications();
    }, [isOpen, loadNotifications]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const intervalId = window.setInterval(() => {
            void loadNotifications({ silent: true });
        }, 20_000);

        const visibilityHandler = () => {
            if (document.visibilityState === "visible") {
                void loadNotifications({ silent: true });
            }
        };

        window.addEventListener("focus", visibilityHandler);
        document.addEventListener("visibilitychange", visibilityHandler);

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener("focus", visibilityHandler);
            document.removeEventListener("visibilitychange", visibilityHandler);
        };
    }, [isOpen, loadNotifications]);

    const markRead = useCallback(
        async (notification: NotificationView) => {
            if (notification.isRead || busyNotificationIds.includes(notification.id)) {
                return true;
            }

            setBusyNotificationIds((current) => [...current, notification.id]);
            try {
                const response = await fetch(`/api/notifications/${notification.id}/read`, {
                    method: "PATCH",
                });

                if (!response.ok) {
                    toast.error(t("notifications.updateFailed"));
                    return false;
                }

                setNotifications((current) =>
                    current.map((entry) =>
                        entry.id === notification.id
                            ? { ...entry, isRead: true, readAt: new Date().toISOString() }
                            : entry
                    )
                );
                onUnreadCountChange((current) => Math.max(0, current - 1));
                dispatchNotificationsUpdated();
                return true;
            } catch {
                toast.error(t("notifications.updateFailed"));
                return false;
            } finally {
                setBusyNotificationIds((current) => current.filter((id) => id !== notification.id));
            }
        },
        [busyNotificationIds, onUnreadCountChange, t]
    );

    const markAllRead = useCallback(async () => {
        setSaving(true);
        try {
            const response = await fetch("/api/notifications/read-all", {
                method: "POST",
            });

            if (!response.ok) {
                toast.error(t("notifications.updatesFailed"));
                return;
            }

            setNotifications((current) =>
                current.map((entry) => ({
                    ...entry,
                    isRead: true,
                    readAt: entry.readAt ?? new Date().toISOString(),
                }))
            );
            onUnreadCountChange(0);
            dispatchNotificationsUpdated();
            toast.success(t("notifications.allReadSuccess"));
        } catch {
            toast.error(t("notifications.updatesFailed"));
        } finally {
            setSaving(false);
        }
    }, [onUnreadCountChange, t]);

    const archiveOne = useCallback(
        async (notification: NotificationView) => {
            if (busyNotificationIds.includes(notification.id)) {
                return;
            }

            setBusyNotificationIds((current) => [...current, notification.id]);
            try {
                const response = await fetch(`/api/notifications/${notification.id}/read`, {
                    method: "DELETE",
                });

                if (!response.ok) {
                    toast.error(t("notifications.removeFailed"));
                    return;
                }

                setNotifications((current) => current.filter((entry) => entry.id !== notification.id));
                if (!notification.isRead) {
                    onUnreadCountChange((current) => Math.max(0, current - 1));
                }
                dispatchNotificationsUpdated();
            } catch {
                toast.error(t("notifications.removeFailed"));
            } finally {
                setBusyNotificationIds((current) => current.filter((id) => id !== notification.id));
            }
        },
        [busyNotificationIds, onUnreadCountChange, t]
    );

    const archiveAll = useCallback(async () => {
        setSaving(true);
        try {
            const response = await fetch("/api/notifications/archive-all", {
                method: "POST",
            });

            if (!response.ok) {
                toast.error(t("notifications.removesFailed"));
                return;
            }

            setNotifications([]);
            onUnreadCountChange(0);
            dispatchNotificationsUpdated();
            toast.success(t("notifications.cleared"));
        } catch {
            toast.error(t("notifications.removesFailed"));
        } finally {
            setSaving(false);
        }
    }, [onUnreadCountChange, t]);

    const visibleNotifications = useMemo(
        () => (filter === "unread" ? notifications.filter((notification) => !notification.isRead) : notifications),
        [filter, notifications]
    );

    const handlePrimaryAction = useCallback(
        async (notification: NotificationView) => {
            const marked = await markRead(notification);
            if (!marked) {
                return;
            }

            if (notification.resourceType === "support_ticket" && onOpenSupport) {
                const ticketId = notification.resourceId ? Number(notification.resourceId) : null;
                onClose();
                onOpenSupport(Number.isInteger(ticketId) ? ticketId : null);
            }
        },
        [markRead, onClose, onOpenSupport]
    );

    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[125] flex items-center justify-end bg-slate-950/45 backdrop-blur-sm">
            <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-sky-300/20 bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(255,255,255,0.92))] shadow-2xl dark:border-sky-900/20 dark:bg-[linear-gradient(180deg,rgba(9,12,18,0.96),rgba(12,15,23,0.94))]">
                <div className="border-b border-sky-200/60 px-5 py-4 dark:border-sky-900/20">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 shadow-sm dark:bg-sky-950/40 dark:text-sky-200">
                                <Bell className="h-5 w-5" />
                            </div>
                            <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-sky-600 dark:text-sky-300">
                                    {t("notifications.center")}
                                </div>
                                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                                    {t("notifications.title")}
                                </h2>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    {unreadCount > 0 ? t("notifications.unreadCount", { count: unreadCount }) : t("notifications.noNew")}
                                </p>
                            </div>
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={onClose}
                            className="h-10 w-10 shrink-0 rounded-full border border-slate-200/70 bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
                            aria-label={t("notifications.close")}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="border-b border-sky-200/60 px-5 py-4 dark:border-sky-900/20">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setFilter("all")}
                                className={`rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-[0.18em] ${
                                    filter === "all"
                                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                                        : "bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                }`}
                            >
                                {t("notifications.all")}
                            </button>
                            <button
                                type="button"
                                onClick={() => setFilter("unread")}
                                className={`rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-[0.18em] ${
                                    filter === "unread"
                                        ? "bg-sky-600 text-white"
                                        : "bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                }`}
                            >
                                {t("notifications.unread")} {unreadCount > 0 ? `(${unreadCount})` : ""}
                            </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void markAllRead()}
                                disabled={saving || unreadCount === 0}
                                className="gap-2"
                            >
                                <CheckCheck className="h-4 w-4" />
                                {t("notifications.markAllRead")}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void archiveAll()}
                                disabled={saving || notifications.length === 0}
                                className="gap-2"
                            >
                                <Archive className="h-4 w-4" />
                                {t("notifications.clearAll")}
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-5">
                    {loading ? (
                        <div className="rounded-3xl border border-dashed border-sky-200/60 bg-white/60 p-6 text-sm text-slate-500 dark:border-sky-900/20 dark:bg-black/10 dark:text-slate-400">
                            {t("notifications.loading")}
                        </div>
                    ) : visibleNotifications.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-sky-200/60 bg-white/60 p-6 text-sm text-slate-500 dark:border-sky-900/20 dark:bg-black/10 dark:text-slate-400">
                            {filter === "unread"
                                ? t("notifications.noUnread")
                                : t("notifications.empty")}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {visibleNotifications.map((notification) => (
                                <div
                                    key={notification.id}
                                    className={`rounded-[26px] border p-4 shadow-sm transition ${
                                        notification.isRead
                                            ? "border-slate-200/70 bg-white/65 dark:border-slate-800/80 dark:bg-zinc-950/35"
                                            : "border-sky-200/70 bg-sky-50/70 dark:border-sky-900/40 dark:bg-sky-950/10"
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span
                                                    className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${notificationBadgeClass[notification.type]}`}
                                                >
                                                    {notificationLabels[notification.type]}
                                                </span>
                                                {!notification.isRead ? (
                                                    <span className="rounded-full bg-rose-500 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                                                        {t("notifications.new")}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white">
                                                {notification.title}
                                            </h3>
                                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">
                                                {notification.body}
                                            </p>
                                        </div>
                                        <div className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                                            {formatDateTime(notification.createdAt, toIntlLocale(locale))}
                                        </div>
                                    </div>

                                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                        <div className="text-xs text-slate-500 dark:text-slate-400">
                                            {notification.resourceType === "support_ticket" ? (
                                                <span className="inline-flex items-center gap-1">
                                                    <LifeBuoy className="h-3.5 w-3.5" />
                                                    {t("notifications.ticket", { id: notification.resourceId ?? "" })}
                                                </span>
                                            ) : notification.isRead ? (
                                                t("notifications.read")
                                            ) : (
                                                t("notifications.unread")
                                            )}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2">
                                            {!notification.isRead ? (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => void markRead(notification)}
                                                    disabled={busyNotificationIds.includes(notification.id)}
                                                    className="gap-2"
                                                >
                                                    <Check className="h-4 w-4" />
                                                    {t("notifications.markRead")}
                                                </Button>
                                            ) : null}
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => void archiveOne(notification)}
                                                disabled={busyNotificationIds.includes(notification.id)}
                                                className="gap-2"
                                            >
                                                <Archive className="h-4 w-4" />
                                                {t("notifications.clear")}
                                            </Button>
                                            {notification.resourceType === "support_ticket" ? (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    onClick={() => void handlePrimaryAction(notification)}
                                                >
                                                    {t("notifications.openSupport")}
                                                </Button>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
