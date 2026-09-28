"use client";

import { useState, useEffect, useCallback, type ReactNode, type MouseEvent } from "react";
import { Bell, HelpCircle, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { DashboardNav, DashboardNavMobile, type DashboardTab } from "./dashboard-nav";
import { DashboardProfileSidebar } from "./dashboard-profile-sidebar";
import { SupportDeskSheet } from "./support-desk-sheet";
import { NotificationsSheet } from "./notifications-sheet";
import { NOTIFICATIONS_UPDATED_EVENT } from "@/lib/notification-events";
import type { NotificationUnreadCountResponse } from "@/types/notifications";

interface DashboardOverlayProps {
    isOpen: boolean;
    onClose: () => void;
}

export function DashboardOverlay({ isOpen, onClose }: DashboardOverlayProps) {
    // Close on ESC
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [isOpen, onClose]);

    // Prevent body scroll when open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }
        return () => {
            document.body.style.overflow = "";
        };
    }, [isOpen]);

    const handleBackdrop = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            if (e.target === e.currentTarget) onClose();
        },
        [onClose]
    );

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-stretch justify-center p-0 glass-overlay sm:items-center sm:p-6 md:p-8"
            onClick={handleBackdrop}
        >
            <div className="glass-panel relative flex h-[100dvh] w-full animate-fade-in-up overflow-hidden rounded-none shadow-[0_30px_90px_-45px_rgba(15,23,42,0.5)] sm:h-[88vh] sm:max-w-[1280px] sm:rounded-[34px]">
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-white/50 bg-white/75 text-slate-600 shadow-sm backdrop-blur-sm transition-all hover:bg-red-500 hover:text-white dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-red-500"
                >
                    <X size={16} />
                </button>

                <DashboardLayout />
            </div>
        </div>
    );
}

/**
 * Shared 3-column dashboard layout:  Nav | Content | Profile Sidebar
 * Used by both DashboardOverlay (in-game hover) and the full-page home.
 */
export function DashboardLayout({
    defaultTab = "dash",
    className = "",
    showPlayTab = false,
    playContent,
}: {
    defaultTab?: DashboardTab;
    className?: string;
    showPlayTab?: boolean;
    playContent?: ReactNode;
}) {
    const [activeTab, setActiveTab] = useState<DashboardTab>(defaultTab);
    const [sidebarMode, setSidebarMode] = useState<"inline" | "desktop">(() => {
        if (typeof window !== "undefined") {
            return window.matchMedia("(min-width: 1280px)").matches ? "desktop" : "inline";
        }

        return "desktop";
    });
    const [supportOpen, setSupportOpen] = useState(false);
    const [supportFocusTicketId, setSupportFocusTicketId] = useState<number | null>(null);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
    const { status } = useSession();
    const supportEnabled = status === "authenticated";
    const notificationEnabled = status === "authenticated";

    const loadNotificationUnreadCount = useCallback(async () => {
        if (!notificationEnabled) {
            setNotificationUnreadCount(0);
            return;
        }

        try {
            const response = await fetch("/api/notifications/unread-count", {
                cache: "no-store",
            });
            if (!response.ok) {
                return;
            }

            const payload = (await response.json()) as NotificationUnreadCountResponse;
            setNotificationUnreadCount(payload.unreadCount);
        } catch {
            // Keep previous count if request fails.
        }
    }, [notificationEnabled]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            void loadNotificationUnreadCount();
        }, 0);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [loadNotificationUnreadCount]);

    useEffect(() => {
        if (!notificationEnabled) {
            return;
        }

        const intervalId = window.setInterval(() => {
            void loadNotificationUnreadCount();
        }, 30_000);

        const refreshHandler = () => {
            void loadNotificationUnreadCount();
        };

        window.addEventListener("focus", refreshHandler);
        window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, refreshHandler);
        document.addEventListener("visibilitychange", refreshHandler);

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener("focus", refreshHandler);
            window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, refreshHandler);
            document.removeEventListener("visibilitychange", refreshHandler);
        };
    }, [loadNotificationUnreadCount, notificationEnabled]);

    useEffect(() => {
        const mediaQuery = window.matchMedia("(min-width: 1280px)");
        const syncSidebarMode = (event?: MediaQueryListEvent) => {
            setSidebarMode((event?.matches ?? mediaQuery.matches) ? "desktop" : "inline");
        };

        syncSidebarMode();
        mediaQuery.addEventListener("change", syncSidebarMode);

        return () => {
            mediaQuery.removeEventListener("change", syncSidebarMode);
        };
    }, []);

    const handleOpenSupportFromNotification = useCallback((ticketId?: number | null) => {
        setNotificationsOpen(false);
        setSupportFocusTicketId(ticketId ?? null);
        setSupportOpen(true);
    }, []);

    return (
        <div className={`relative flex h-full w-full flex-col md:flex-row ${className}`}>
            {/* Nav sidebar */}
            <DashboardNav
                activeTab={activeTab}
                onTabChange={setActiveTab}
                showPlayTab={showPlayTab}
                supportEnabled={supportEnabled}
                notificationEnabled={notificationEnabled}
                notificationUnreadCount={notificationUnreadCount}
                onNotificationsClick={() => setNotificationsOpen(true)}
                onHelpClick={() => setSupportOpen(true)}
            />

            <div className="flex min-h-0 flex-1 flex-col">
                <DashboardNavMobile
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    showPlayTab={showPlayTab}
                />
                {sidebarMode === "inline" ? <DashboardProfileSidebar onTabChange={setActiveTab} mode="inline" /> : null}

                {/* Main content */}
                <main className="relative min-h-0 flex-1 overflow-y-auto scroll-smooth">
                    {activeTab === "play" && playContent ? (
                        playContent
                    ) : (
                        <DashboardContent activeTab={activeTab} />
                    )}
                </main>
            </div>

            {/* Profile sidebar (hidden on mobile/tablet) */}
            {sidebarMode === "desktop" ? <DashboardProfileSidebar onTabChange={setActiveTab} /> : null}
            {supportEnabled ? (
                <>
                    <button
                        type="button"
                        onClick={() => setNotificationsOpen(true)}
                        className="absolute right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-sky-600 text-white shadow-xl transition hover:scale-105 md:hidden"
                        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}
                    >
                        <Bell className="h-5 w-5" />
                        {notificationUnreadCount > 0 ? (
                            <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black leading-none text-white">
                                {notificationUnreadCount > 9 ? "9+" : notificationUnreadCount}
                            </span>
                        ) : null}
                    </button>
                    <button
                        type="button"
                        onClick={() => setSupportOpen(true)}
                        className="absolute right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-xl transition hover:scale-105 dark:bg-amber-200 dark:text-slate-900 md:hidden"
                        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
                    >
                        <HelpCircle className="h-5 w-5" />
                    </button>
                    <NotificationsSheet
                        isOpen={notificationsOpen}
                        unreadCount={notificationUnreadCount}
                        onUnreadCountChange={setNotificationUnreadCount}
                        onClose={() => setNotificationsOpen(false)}
                        onOpenSupport={handleOpenSupportFromNotification}
                    />
                    <SupportDeskSheet
                        isOpen={supportOpen}
                        onClose={() => setSupportOpen(false)}
                        initialTicketId={supportFocusTicketId}
                    />
                </>
            ) : null}
        </div>
    );
}

/* Lazy-load page content based on active tab */
function DashboardContent({
    activeTab,
}: {
    activeTab: DashboardTab;
}) {
    switch (activeTab) {
        case "dash":
            return <DashContentLazy />;
        case "inventory":
            return <InventoryContentLazy />;
        case "shop":
            return <ShopContentLazy />;
        case "settings":
            return <SettingsContentLazy />;
        default:
            return null;
    }
}

/* Dynamic imports for code splitting */
import dynamic from "next/dynamic";

const DashContentLazy = dynamic(
    () =>
        import("./dashboard-pages/dash-content").then((m) => ({
            default: m.DashContent,
        })),
    { loading: () => <PageLoading /> }
);

const InventoryContentLazy = dynamic(
    () =>
        import("./dashboard-pages/inventory-content").then((m) => ({
            default: m.InventoryContent,
        })),
    { loading: () => <PageLoading /> }
);

const ShopContentLazy = dynamic(
    () =>
        import("./dashboard-pages/shop-content").then((m) => ({
            default: m.ShopContent,
        })),
    { loading: () => <PageLoading /> }
);

const SettingsContentLazy = dynamic(
    () =>
        import("./dashboard-pages/settings-content").then((m) => ({
            default: m.SettingsContent,
        })),
    { loading: () => <PageLoading /> }
);

function PageLoading() {
    return (
        <div className="flex h-full items-center justify-center p-8">
            <div className="flex items-center gap-3 rounded-full border border-slate-200/70 bg-white/70 px-4 py-3 text-sm font-bold text-slate-600 shadow-sm dark:border-slate-800/70 dark:bg-slate-950/45 dark:text-slate-300">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                Yukleniyor
            </div>
        </div>
    );
}

