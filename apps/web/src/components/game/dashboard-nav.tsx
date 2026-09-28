"use client";

import { LayoutDashboard, Backpack, ShoppingBag, Settings, HelpCircle, Bell, Play, Gamepad2 } from "lucide-react";
import { useBranding } from "@/components/providers/branding-provider";
import { useI18n } from "@/components/providers/i18n-provider";

export type DashboardTab = "play" | "dash" | "inventory" | "shop" | "settings";

interface DashboardNavProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  showPlayTab?: boolean;
  supportEnabled?: boolean;
  notificationEnabled?: boolean;
  notificationUnreadCount?: number;
  onNotificationsClick?: () => void;
  onHelpClick?: () => void;
}

const navItems = [
  { id: "dash" as const, icon: LayoutDashboard, labelKey: "nav.overview" as const },
  { id: "inventory" as const, icon: Backpack, labelKey: "nav.inventory" as const },
  { id: "shop" as const, icon: ShoppingBag, labelKey: "nav.shop" as const },
  { id: "settings" as const, icon: Settings, labelKey: "nav.settings" as const },
];

export function DashboardNav({
  activeTab,
  onTabChange,
  showPlayTab,
  supportEnabled = false,
  notificationEnabled = false,
  notificationUnreadCount = 0,
  onNotificationsClick,
  onHelpClick,
}: DashboardNavProps) {
  const branding = useBranding();
  const { t } = useI18n();
  const compactLabel = branding.siteShortName.trim().toUpperCase() || "TABU";

  return (
    <nav className="z-10 hidden h-full min-w-[104px] w-[104px] flex-col border-r border-slate-200/60 bg-white/58 px-3 py-6 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/35 md:flex">
      <div className="mb-6">
        {showPlayTab ? (
          <button
            onClick={() => onTabChange("play")}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-[24px] px-3 py-3 text-center shadow-lg transition-all ${
              activeTab === "play"
                ? "scale-[1.02] bg-gradient-to-tr from-purple-500 to-blue-600 text-white ring-2 ring-purple-400/40"
                : "bg-gradient-to-tr from-purple-500 to-blue-600 text-white hover:scale-[1.01]"
            }`}
          >
            <Play size={20} className="ml-0.5" />
            <span className="text-[10px] font-black uppercase tracking-[0.22em]">{t("nav.play")}</span>
          </button>
        ) : (
          <div className="flex min-h-[72px] w-full items-center justify-center overflow-hidden rounded-[24px] border border-white/50 bg-white/85 px-3 text-center shadow-lg dark:border-slate-700/60 dark:bg-slate-900/80">
            <span className="bg-gradient-to-tr from-red-500 to-blue-500 bg-clip-text text-sm font-black uppercase tracking-[0.18em] text-transparent">
              {compactLabel}
            </span>
          </div>
        )}
      </div>

      <div className="flex w-full flex-col gap-2">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`group flex w-full flex-col items-center justify-center gap-1 rounded-[22px] px-2 py-3 text-center transition-all ${
                isActive
                  ? "bg-blue-500/10 text-blue-600 ring-1 ring-blue-500/20 dark:text-blue-400"
                  : "text-slate-500 hover:bg-slate-100/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-900/80 dark:hover:text-slate-200"
              }`}
            >
              <Icon size={22} className="transition-transform group-hover:scale-110" />
              <span className="text-[10px] font-black uppercase tracking-[0.14em]">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </div>

      {supportEnabled || notificationEnabled ? (
        <div className="mt-auto flex w-full flex-col gap-2 border-t border-slate-200/70 pt-4 dark:border-slate-800/70">
          {notificationEnabled ? (
            <button
              type="button"
              onClick={onNotificationsClick}
              className="relative flex w-full flex-col items-center justify-center gap-1 rounded-[22px] px-2 py-3 text-slate-400 transition-all hover:bg-slate-100/70 hover:text-slate-800 dark:text-slate-500 dark:hover:bg-slate-900/80 dark:hover:text-slate-200"
            >
              <Bell size={20} />
              {notificationUnreadCount > 0 ? (
                <span className="absolute right-3 top-2 min-w-[18px] rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black leading-none text-white">
                  {notificationUnreadCount > 9 ? "9+" : notificationUnreadCount}
                </span>
              ) : null}
              <span className="text-[10px] font-black uppercase tracking-[0.14em]">{t("nav.notifications")}</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={onHelpClick}
            className="flex w-full flex-col items-center justify-center gap-1 rounded-[22px] px-2 py-3 text-slate-400 transition-all hover:bg-slate-100/70 hover:text-slate-800 dark:text-slate-500 dark:hover:bg-slate-900/80 dark:hover:text-slate-200"
          >
            <HelpCircle size={20} />
              <span className="text-[10px] font-black uppercase tracking-[0.14em]">{t("nav.support")}</span>
          </button>
        </div>
      ) : null}
    </nav>
  );
}

export function DashboardNavMobile({
  activeTab,
  onTabChange,
  showPlayTab,
}: DashboardNavProps) {
  const branding = useBranding();
  const { t } = useI18n();
  const allItems = showPlayTab
    ? [{ id: "play" as const, icon: Play, labelKey: "nav.play" as const }, ...navItems]
    : navItems;

  return (
    <nav className="border-b border-slate-200/60 bg-white/80 px-3 py-3 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/45 md:hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 rounded-[22px] border border-white/60 bg-white/80 px-3 py-2 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-blue-500 text-white">
            <Gamepad2 size={14} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-black uppercase tracking-[0.18em] text-slate-800 dark:text-slate-100">
              {branding.siteShortName}
            </div>
          </div>
        </div>

        <div className="rounded-full border border-white/60 bg-white/75 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/80 dark:text-slate-400">
          {showPlayTab ? t("nav.lobby") : t("nav.panel")}
        </div>
      </div>

      <div className="scrollbar-hide mt-3 flex items-center gap-2 overflow-x-auto pb-1">
        {allItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex min-w-[74px] flex-col items-center justify-center gap-1 rounded-[20px] px-3 py-2.5 transition-all ${
                isActive
                  ? "bg-blue-500/10 text-blue-600 ring-1 ring-blue-500/20 dark:text-blue-400"
                  : "bg-white/55 text-slate-500 dark:bg-slate-900/70 dark:text-slate-400"
              }`}
            >
              <Icon size={18} />
              <span className="text-[10px] font-black uppercase tracking-[0.14em]">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
