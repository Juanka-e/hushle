"use client";

import { EyeOff } from "lucide-react";
import type { HostStreamSnapshot } from "@hushle/domain-streamer";
import { useI18n } from "@/components/providers/i18n-provider";

// The host's secret card: the word and its taboo list from the host room's snapshot. It lives
// only on the panel; nothing here is sent anywhere or shared with the stream screen. A streamer
// who captures the whole display can hide it: the words then leave the page (not just the view).
// The choice is the panel's (StreamerPanel), above the live view's rejoin remount, so a rejoin
// keeps it; it is in memory only and a reload shows the card again.

export function StreamerCardView({ state, hidden, onToggleHidden }: { state: HostStreamSnapshot; hidden: boolean; onToggleHidden: () => void }) {
    const { t } = useI18n();
    const card = state.card;
    return (
        <section
            data-testid="streamer-card"
            className="rounded-3xl border-2 border-dashed border-rose-300 bg-rose-50/70 p-5 dark:border-rose-900/70 dark:bg-rose-950/20"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-white">
                    <EyeOff size={14} aria-hidden="true" />
                    {t("streamer.panel.cardSecret")}
                </span>
                <span className="flex flex-wrap items-center gap-3">
                    {state.pool ? (
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                            {t("streamer.panel.cardPool", { drawn: state.pool.drawn, eligible: state.pool.eligible })}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        onClick={onToggleHidden}
                        className="min-h-9 rounded-xl border border-rose-200 bg-white px-3 text-xs font-black text-rose-700 transition hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-950 dark:text-rose-300"
                    >
                        {hidden ? t("streamer.panel.cardShow") : t("streamer.panel.cardHide")}
                    </button>
                </span>
            </div>
            {hidden ? (
                <p data-testid="streamer-card-hidden" className="mt-4 text-base font-semibold text-slate-600 dark:text-slate-300">
                    {t("streamer.panel.cardHidden")}
                </p>
            ) : card ? (
                <div className="mt-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{t("streamer.panel.cardTarget")}</p>
                    <p data-testid="streamer-card-target" className="mt-1 break-words text-4xl font-black tracking-tight text-slate-900 dark:text-white">
                        {card.target}
                    </p>
                    <p className="mt-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{t("streamer.panel.cardTaboos")}</p>
                    <ul data-testid="streamer-card-taboos" className="mt-2 flex flex-wrap gap-2">
                        {card.taboos.map((word, index) => (
                            <li
                                key={`${index}-${word}`}
                                className="rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-base font-bold text-rose-700 dark:border-rose-900/60 dark:bg-slate-950 dark:text-rose-300"
                            >
                                {word}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : (
                <p className="mt-4 text-base font-semibold text-slate-600 dark:text-slate-300">{t("streamer.panel.cardWaiting")}</p>
            )}
        </section>
    );
}
