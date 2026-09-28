"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Coins,
  Gamepad2,
  Target,
  Trophy,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { DashboardEmptyState, DashboardPageShell, DashboardSection } from "@/components/game/dashboard-page-shell";
import { CoinBadge } from "@/components/ui/coin-badge";
import type { DashboardDataResponse } from "@/types/economy";
import { WALLET_UPDATED_EVENT } from "@/lib/wallet-events";
import { useI18n } from "@/components/providers/i18n-provider";
import { toIntlLocale } from "@/lib/i18n/config";

const statCardStyles = {
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  violet: "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400",
} as const;

type StatTone = keyof typeof statCardStyles;

interface StatCardConfig {
  label: string;
  value: string;
  icon: typeof Gamepad2;
  tone: StatTone;
  subLabel: string;
  trend: "up" | "neutral" | "down";
}

export function DashContent() {
  const { data: session } = useSession();
  const { locale, t } = useI18n();
  const [data, setData] = useState<DashboardDataResponse | null>(null);

  useEffect(() => {
    if (!session?.user) {
      return;
    }

    const load = async () => {
      try {
        const response = await fetch("/api/user/dashboard", { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as DashboardDataResponse;
        setData(payload);
      } catch {
        // Leave panel in empty state.
      }
    };

    void load();

    const handleWalletUpdated = () => {
      void load();
    };

    window.addEventListener(WALLET_UPDATED_EVENT, handleWalletUpdated);
    return () => {
      window.removeEventListener(WALLET_UPDATED_EVENT, handleWalletUpdated);
    };
  }, [session]);

  const recentWins = data?.recentMatches.filter((match) => match.won).length ?? 0;
  const recentMatchCount = data?.recentMatches.length ?? 0;

  const stats: StatCardConfig[] = [
    {
      label: t("dashboard.matches"),
      value: data?.totalMatches.toLocaleString() ?? "0",
      icon: Gamepad2,
      tone: "blue",
      subLabel: t("dashboard.recentResults", { count: recentMatchCount }),
      trend: "neutral",
    },
    {
      label: t("dashboard.wins"),
      value: data?.totalWins.toLocaleString() ?? "0",
      icon: Trophy,
      tone: "emerald",
      subLabel: t("dashboard.winRate", { rate: data?.winRate ?? 0 }),
      trend: (data?.winRate ?? 0) >= 50 ? "up" : "neutral",
    },
    {
      label: t("dashboard.coin"),
      value: data?.coinBalance.toLocaleString() ?? "0",
      icon: Coins,
      tone: "amber",
      subLabel: t("dashboard.totalEarned", { count: data?.totalCoinEarned ?? 0 }),
      trend: (data?.coinBalance ?? 0) > 0 ? "up" : "neutral",
    },
    {
      label: t("dashboard.form"),
      value: `${recentWins}/${recentMatchCount}`,
      icon: Target,
      tone: "violet",
      subLabel: t("dashboard.recentWins"),
      trend: recentMatchCount > 0 && recentWins < Math.ceil(recentMatchCount / 2) ? "down" : "up",
    },
  ];

  return (
    <DashboardPageShell
      eyebrow={t("dashboard.summary")}
      title={t("dashboard.overview")}
      description={t("dashboard.overviewHelp")}
      action={<CoinBadge value={data?.coinBalance ?? 0} className="rounded-2xl px-4 py-3" valueClassName="text-xl" />}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            const trendIcon =
              stat.trend === "up" ? (
                <TrendingUp size={14} className="mr-1" />
              ) : stat.trend === "down" ? (
                <TrendingDown size={14} className="mr-1" />
              ) : null;

            return (
              <div
                key={stat.label}
                className="rounded-[26px] border border-white/60 bg-white/72 p-5 shadow-[0_16px_50px_-36px_rgba(15,23,42,0.45)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:bg-white/85 dark:border-slate-800/70 dark:bg-slate-950/45 dark:hover:bg-slate-950/60"
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <span className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    {stat.label}
                  </span>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${statCardStyles[stat.tone]}`}>
                    <Icon size={18} />
                  </div>
                </div>
                <div className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                  {stat.value}
                </div>
                <div className="mt-2 flex items-center text-xs font-bold text-slate-500 dark:text-slate-400">
                  {trendIcon}
                  {stat.subLabel}
                </div>
              </div>
            );
          })}
        </div>

        <DashboardSection
          title={t("dashboard.recentActivity")}
          description={t("dashboard.recentActivityHelp")}
          action={
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {t("dashboard.recentMatches", { count: recentMatchCount })}
            </span>
          }
        >
          {!data?.recentMatches || data.recentMatches.length === 0 ? (
            <DashboardEmptyState
              title={t("dashboard.noMatches")}
              description={t("dashboard.noMatchesHelp")}
              icon={<Gamepad2 className="h-5 w-5" />}
            />
          ) : (
            <div className="space-y-3">
              {data.recentMatches.map((match) => (
                <div
                  key={match.id}
                  className="flex flex-col gap-4 rounded-[24px] border border-slate-200/70 bg-white/75 p-4 transition hover:border-slate-300 hover:bg-white dark:border-slate-800/80 dark:bg-slate-950/40 dark:hover:border-slate-700 dark:hover:bg-slate-950/60 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xs font-black shadow-sm ${
                        match.won
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                          : "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"
                      }`}
                    >
                      {match.won ? "W" : "L"}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-black text-slate-900 dark:text-white">
                        {t("dashboard.room", { code: match.roomCode })}
                      </div>
                      <div className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                        {new Date(match.createdAt).toLocaleDateString(toIntlLocale(locale))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-4 sm:block sm:text-right">
                    <div
                      className={`text-lg font-black ${
                        match.won ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {match.scoreA} - {match.scoreB}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:justify-end">
                      +{match.coinEarned}
                      <Coins size={10} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DashboardSection>
      </div>
    </DashboardPageShell>
  );
}
