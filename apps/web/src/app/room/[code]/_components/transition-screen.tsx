"use client";

import { Clock3, Pause, Play } from "lucide-react";
import type { TransitionData } from "@/types/game";
import { useI18n } from "@/components/providers/i18n-provider";

interface TransitionScreenProps {
    transition: TransitionData;
    isHost?: boolean;
    onPauseResume?: () => void;
}

export function TransitionScreen({
    transition,
    isHost = false,
    onPauseResume,
}: TransitionScreenProps) {
    const { t } = useI18n();
    const getTeamLabel = (team: string) => team === "A" ? t("transition.teamA") : t("transition.teamB");
    const narratorTeamLabel = getTeamLabel(transition.anlatici.takim);
    const inspectorTeamLabel = transition.gozetmen
        ? getTeamLabel(transition.gozetmen.takim)
        : t("transition.waitingOpponent");
    const heading = transition.ilkGecis ? t("transition.gameStarting") : t("transition.narratorChanging");
    const description = transition.ilkGecis
        ? t("transition.firstDescription")
        : t("transition.nextDescription");

    return (
        <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
            <div className="w-full max-w-3xl rounded-[2rem] border border-white/70 bg-white/88 p-5 shadow-[0_35px_100px_-55px_rgba(15,23,42,0.7)] backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/78 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500 dark:border-slate-800 dark:bg-slate-900/75 dark:text-slate-400">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            {t("transition.preparation")}
                        </div>
                        <div className="space-y-1">
                            <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                                {heading}
                            </h2>
                            <p className="max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                                {description}
                            </p>
                        </div>
                    </div>
                </div>

                {transition.ilkGecis && (
                    <div className="mt-5 flex items-center gap-4 rounded-xl border border-border bg-muted/50 p-3" role="status">
                        <div className="starting-team-token relative h-14 w-14 shrink-0 text-2xl font-black text-foreground"
                            style={{ animationPlayState: transition.oyunDurduruldu ? "paused" : "running" }}
                            data-reveal={transition.kalanSure >= 8} aria-hidden="true">
                            <span className="starting-team-face absolute inset-0 grid place-items-center rounded-full border-2 border-current bg-background">{transition.anlatici.takim}</span>
                            <span className="starting-team-face starting-team-reverse absolute inset-0 grid place-items-center rounded-full border-2 border-current bg-background">{transition.anlatici.takim === "A" ? "B" : "A"}</span>
                        </div>
                        <div><p className="text-xs text-muted-foreground">{t("transition.firstTeam")}</p>
                            <p className="font-bold text-foreground">{narratorTeamLabel}</p></div>
                    </div>
                )}
                <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                    <section className="rounded-[1.6rem] border border-slate-200/75 bg-slate-50/85 p-5 dark:border-slate-800/80 dark:bg-slate-900/72">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
                            <Clock3 className="h-4 w-4" />
                            {t("transition.countdown")}
                        </div>

                        <div className="mt-6 flex items-end gap-3">
                            <div className="text-6xl font-black tabular-nums leading-none text-slate-900 dark:text-white sm:text-7xl">
                                {transition.kalanSure}
                            </div>
                            <div className="pb-2 text-sm font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
                                {t("transition.seconds")}
                            </div>
                        </div>

                        <div className="mt-5 rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300">
                            {transition.oyunDurduruldu ? (
                                <div className="space-y-1">
                                    <div className="font-bold text-slate-900 dark:text-white">{t("transition.paused")}</div>
                                    <div>{t("transition.pausedHelp")}</div>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <div className="font-bold text-slate-900 dark:text-white">{t("transition.finalCheck")}</div>
                                    <div>{t("transition.finalCheckHelp")}</div>
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="grid gap-3">
                        <div className="rounded-[1.4rem] border border-red-200/70 bg-red-50/80 p-4 dark:border-red-900/40 dark:bg-red-950/20">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-red-500 dark:text-red-300">
                                        {t("transition.narrator")}
                                    </div>
                                    <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">
                                        {transition.anlatici.ad}
                                    </div>
                                </div>
                                <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700 dark:bg-red-900/40 dark:text-red-200">
                                    {narratorTeamLabel}
                                </span>
                            </div>
                        </div>

                        <div className="rounded-[1.4rem] border border-blue-200/70 bg-blue-50/80 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-500 dark:text-blue-300">
                                        {t("transition.inspector")}
                                    </div>
                                    <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">
                                        {transition.gozetmen?.ad ?? t("transition.waiting")}
                                    </div>
                                </div>
                                <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">
                                    {inspectorTeamLabel}
                                </span>
                            </div>
                        </div>
                    </section>
                </div>

                {isHost && onPauseResume ? (
                    <div className="mt-5 flex justify-end">
                        <button
                            type="button"
                            onClick={onPauseResume}
                            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white/70 px-4 py-2 text-sm font-bold text-gray-700 shadow-sm transition hover:bg-white hover:text-blue-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-gray-200 dark:hover:bg-slate-800 dark:hover:text-blue-300"
                        >
                            {transition.oyunDurduruldu ? <Play size={16} /> : <Pause size={16} />}
                            {transition.oyunDurduruldu ? t("transition.resume") : t("transition.pause")}
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
