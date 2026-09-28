"use client";

import { useState, useSyncExternalStore } from "react";
import Image, { type ImageLoaderProps } from "next/image";
import { ArrowRight, Check, Pause, Play, RotateCcw, Sparkles, X } from "lucide-react";
import { GameCard } from "@/components/game/game-card";
import type { ResolvedCardBackTheme } from "@/lib/cosmetics/card-back";
import type { ResolvedCardFaceTheme } from "@/lib/cosmetics/card-face";
import {
    buildCosmeticPatternStyle,
    getCosmeticMotionClass,
    getCosmeticMotionStyle,
} from "@/lib/cosmetics/effects";
import {
    defaultCardFlipSettings,
    readCardFlipSettings,
    subscribeCardFlipSettings,
    writeCardFlipSettings,
} from "@/lib/game/card-flip-settings";
import {
    canUseTabuAction,
    getActiveNarratorTeam,
    isCardViewerRole,
    ROOM_ROLE_INSPECTOR,
    ROOM_ROLE_NARRATOR,
    shouldShowGuessPanel,
} from "@/lib/game/room-display";
import { useI18n } from "@/components/providers/i18n-provider";
import type { CardData, GameState } from "@/types/game";

interface ActiveGameProps {
    gameState: GameState | null;
    card: CardData | null;
    myRole: string;
    isPrimaryInspector: boolean;
    narratorName: string;
    inspectorName: string;
    isHost: boolean;
    settings: { sure: number; mod: "tur" | "skor"; deger: number };
    cardFaceTheme: ResolvedCardFaceTheme | null;
    cardBackTheme: ResolvedCardBackTheme | null;
    onWordAction: (action: "dogru" | "tabu" | "pas") => void;
    onPauseResume: () => void;
    onResetGame: () => void;
}

const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;
export function ActiveGame({
    gameState,
    card,
    myRole,
    isPrimaryInspector,
    narratorName,
    inspectorName,
    isHost,
    settings,
    cardFaceTheme,
    cardBackTheme,
    onWordAction,
    onPauseResume,
    onResetGame,
}: ActiveGameProps) {
    const { t } = useI18n();
    const activeNarratorTeam = getActiveNarratorTeam(gameState);
    const timerPercent = gameState
        ? (gameState.kalanZaman / (gameState.toplamSure || settings.sure || 60)) * 100
        : 100;
    const canSeeCard = Boolean(card) && (isCardViewerRole(myRole) || shouldShowGuessPanel(myRole));
    const showGuessPanel = !canSeeCard && shouldShowGuessPanel(myRole);
    const canSubmitTabu = canUseTabuAction(myRole, isPrimaryInspector);
    const narratorColorClass =
        activeNarratorTeam === "A"
            ? "text-red-600 dark:text-red-400"
            : "text-blue-600 dark:text-blue-400";
    const inspectorColorClass =
        activeNarratorTeam === "A"
            ? "text-blue-600 dark:text-blue-400"
            : "text-red-600 dark:text-red-400";

    return (
        <div className="flex-1 flex flex-col p-4 sm:p-6 max-w-5xl mx-auto w-full">
            <div className="w-full mb-6">
                <div className="flex items-center justify-center gap-6 sm:gap-12 mb-6">
                    <div className="text-center">
                        <div className="text-4xl lg:text-5xl font-black text-red-600 dark:text-red-500 leading-none">
                            {gameState?.skor.A ?? 0}
                        </div>
                        <div className="text-[10px] sm:text-xs text-red-500/80 font-bold uppercase tracking-wider mt-1">
                            {t("game.teamA")}
                        </div>
                    </div>

                    <div className="flex flex-col items-center justify-center w-32 relative">
                        <div
                            className={`text-4xl font-black font-mono transition-colors ${activeNarratorTeam === "A"
                                ? "text-red-600 dark:text-red-500"
                                : "text-blue-600 dark:text-blue-500"
                                }`}
                        >
                            {gameState?.kalanZaman ?? 0}
                        </div>
                        <div className="w-full h-2.5 bg-gray-200 dark:bg-slate-700 rounded-full mt-1 overflow-hidden shadow-inner">
                            <div
                                className={`h-full transition-all duration-1000 ease-linear ${activeNarratorTeam === "A" ? "bg-red-500" : "bg-blue-500"}`}
                                style={{ width: `${timerPercent}%` }}
                            />
                        </div>
                    </div>

                    <div className="text-center">
                        <div className="text-4xl lg:text-5xl font-black text-blue-600 dark:text-blue-500 leading-none">
                            {gameState?.skor.B ?? 0}
                        </div>
                        <div className="text-[10px] sm:text-xs text-blue-500/80 font-bold uppercase tracking-wider mt-1">
                            {t("game.teamB")}
                        </div>
                    </div>
                </div>

                <div className="flex flex-col items-center gap-3">
                    <div className="flex items-center gap-4 text-xs sm:text-sm font-medium">
                        <div className="flex items-center gap-2 bg-white dark:bg-slate-800 px-4 py-2 rounded-full shadow-sm border border-gray-200 dark:border-slate-700">
                            <span className="text-gray-400 uppercase tracking-widest text-[10px]">
                                {t("game.narrator")}
                            </span>
                            <span className={`${narratorColorClass} font-bold`}>
                                {narratorName}
                            </span>
                        </div>

                        <div className="flex items-center gap-2 bg-white dark:bg-slate-800 px-4 py-2 rounded-full shadow-sm border border-gray-200 dark:border-slate-700">
                            <span className="text-gray-400 uppercase tracking-widest text-[10px]">
                                {t("game.moderator")}
                            </span>
                            <span className={`${inspectorColorClass} font-bold`}>
                                {inspectorName}
                            </span>
                        </div>
                    </div>

                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        {gameState && gameState.toplamTur > 0
                            ? t("game.round", { current: gameState.mevcutTur, total: gameState.toplamTur })
                            : settings.mod === "skor"
                                ? t("game.target", { score: settings.deger })
                                : ""}
                    </div>

                    {gameState?.altinSkorAktif && (
                        <span className="flex items-center gap-1 px-3 py-1 rounded-lg bg-amber-500/20 text-amber-400 font-bold text-xs">
                            <Sparkles className="h-3.5 w-3.5" />
                            {t("game.goldenScore")}
                        </span>
                    )}
                </div>
            </div>

            <div className="flex-1 flex items-center justify-center relative min-h-[350px]">
                {card && canSeeCard && (
                    <div className="w-full animate-fade-in">
                        <ViewerCardPreview
                            key={`${card.id}-${myRole}`}
                            card={card}
                            cardFaceTheme={cardFaceTheme}
                            cardBackTheme={cardBackTheme}
                        />
                    </div>
                )}

                {showGuessPanel && (
                    cardBackTheme ? (
                        <div className="w-full max-w-[320px] sm:max-w-[360px] animate-fade-in">
                            <CardBackPanel cardBackTheme={cardBackTheme} />
                        </div>
                    ) : (
                        <div className="w-full max-w-[320px] sm:max-w-[360px] animate-fade-in">
                            <div className="flex min-h-[474px] flex-col items-center justify-center rounded-3xl border-4 border-gray-200 bg-white px-8 py-10 text-center shadow-xl dark:border-slate-700 dark:bg-slate-800 sm:min-h-[500px]">
                                <h3 className="text-3xl font-black uppercase tracking-[0.18em] text-slate-800 dark:text-white">
                                    {t("game.guess")}
                                </h3>
                            </div>
                        </div>
                    )
                )}
            </div>

            {myRole === ROOM_ROLE_NARRATOR && (
                <div className="mt-auto pt-6">
                    <div className="w-full max-w-md mx-auto grid grid-cols-3 gap-3">
                        <button
                            onClick={() => onWordAction("dogru")}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-xl shadow-md font-bold flex flex-col items-center justify-center transition-transform active:scale-95"
                        >
                            <Check size={24} className="mb-1" />
                            <span className="text-sm">{t("game.correct")}</span>
                        </button>

                        {canSubmitTabu && (
                            <button
                                onClick={() => onWordAction("tabu")}
                                className="bg-rose-500 hover:bg-rose-600 text-white py-4 rounded-xl shadow-md font-bold flex flex-col items-center justify-center transition-transform active:scale-95"
                            >
                                <X size={24} className="mb-1" />
                                <span className="text-sm">{t("game.taboo")}</span>
                            </button>
                        )}

                        <button
                            onClick={() => onWordAction("pas")}
                            disabled={(gameState?.kalanPasHakki ?? 0) <= 0}
                            className={`bg-amber-400 hover:bg-amber-500 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 text-white py-4 rounded-xl shadow-md font-bold flex flex-col items-center justify-center transition-transform active:scale-95 ${canSubmitTabu ? "" : "col-span-2"}`}
                        >
                            <ArrowRight size={24} className="mb-1" />
                            <span className="text-sm">{t("game.pass")} ({gameState?.kalanPasHakki ?? 0})</span>
                        </button>
                    </div>
                </div>
            )}

            {myRole === ROOM_ROLE_INSPECTOR && isPrimaryInspector && (
                <div className="mt-auto pt-6">
                    <div className="w-full max-w-md mx-auto">
                        <button
                            onClick={() => onWordAction("tabu")}
                            className="w-full bg-rose-500 hover:bg-rose-600 text-white py-4 rounded-xl shadow-md font-bold flex items-center justify-center gap-2 transition-transform active:scale-95"
                        >
                            <X size={24} />
                            <span>{t("game.taboo")}</span>
                        </button>
                    </div>
                </div>
            )}

            {isHost && (
                <div className="flex justify-center gap-4 mt-6">
                    <button
                        onClick={onPauseResume}
                        className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-slate-700 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-2 text-sm font-bold py-2 px-4 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 transition-all active:scale-95"
                    >
                        <Pause size={18} /> {t("transition.pause")}
                    </button>
                    <button
                        onClick={onResetGame}
                        className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-slate-700 hover:text-rose-600 dark:hover:text-rose-400 flex items-center gap-2 text-sm font-bold py-2 px-4 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 transition-all active:scale-95"
                    >
                        <RotateCcw size={18} /> {t("game.returnLobby")}
                    </button>
                </div>
            )}

            {gameState?.oyunDurduruldu && (
                <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-sm dark:bg-slate-900/60">
                    {isHost ? (
                        <button
                            onClick={onPauseResume}
                            className="pointer-events-auto flex h-20 w-20 items-center justify-center rounded-full bg-blue-600 text-white shadow-2xl transition-transform hover:scale-105"
                        >
                            <Play size={32} className="ml-1" />
                        </button>
                    ) : (
                        <div className="text-center space-y-4">
                            <div className="w-20 h-20 bg-gray-400 dark:bg-slate-600 text-white rounded-full flex items-center justify-center shadow-2xl mx-auto">
                                <Pause size={32} />
                            </div>
                            <p className="text-sm text-gray-500 font-medium">{t("game.paused")}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export function ViewerCardPreview({
    card,
    cardFaceTheme,
    cardBackTheme,
}: {
    card: CardData;
    cardFaceTheme: ResolvedCardFaceTheme | null;
    cardBackTheme: ResolvedCardBackTheme | null;
}) {
    const { t } = useI18n();
    const isFlipEnabled = useSyncExternalStore(
        subscribeCardFlipSettings,
        () => readCardFlipSettings().enabled,
        () => defaultCardFlipSettings.enabled
    );
    const [flippedCardId, setFlippedCardId] = useState<CardData["id"] | null>(null);
    const isFlipped = flippedCardId === card.id;
    const canFlip = isFlipEnabled && Boolean(cardBackTheme);

    const handleFlipToggle = () => {
        const next = !isFlipEnabled;
        writeCardFlipSettings({ enabled: next });
        if (!next) {
            setFlippedCardId(null);
        }
    };

    return (
        <>
            <div className="mb-4 flex justify-center gap-2">
                <button
                    type="button"
                    role="switch"
                    aria-checked={isFlipEnabled}
                    onClick={handleFlipToggle}
                    data-testid="card-flip-toggle"
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] transition-colors ${
                        isFlipEnabled
                            ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                            : "bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                >
                    {t("game.cardFlip")}
                    <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] dark:bg-slate-900/20">
                        {isFlipEnabled ? t("game.on") : t("game.off")}
                    </span>
                </button>
            </div>
            {canFlip ? (
                <p className="mb-4 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t("game.cardFlipHint")}
                </p>
            ) : null}
            <div className="flex justify-center">
                <button
                    type="button"
                    onClick={() => {
                        if (canFlip) {
                            setFlippedCardId((current) =>
                                current === card.id ? null : card.id
                            );
                        }
                    }}
                    data-testid="viewer-card-preview"
                    aria-pressed={isFlipped}
                    className={`relative h-[500px] w-full max-w-[360px] [perspective:1600px] ${canFlip ? "cursor-pointer" : "cursor-default"}`}
                >
                    <div
                        className={`relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d] ${
                            isFlipped ? "[transform:rotateY(180deg)]" : ""
                        }`}
                    >
                        <div className="absolute inset-0 [backface-visibility:hidden]">
                            <GameCard card={card} theme={cardFaceTheme} />
                        </div>
                        <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                            <CardBackPanel cardBackTheme={cardBackTheme} />
                        </div>
                    </div>
                </button>
            </div>
        </>
    );
}

export function CardBackPanel({ cardBackTheme }: { cardBackTheme: ResolvedCardBackTheme | null }) {
    const { t } = useI18n();
    const cardBackMotionClass = cardBackTheme ? getCosmeticMotionClass(cardBackTheme.motionPreset) : "";
    const cardBackMotionStyle = cardBackTheme ? getCosmeticMotionStyle(cardBackTheme.motionSpeedMs) : undefined;
    const cardBackPatternStyle = cardBackTheme
        ? buildCosmeticPatternStyle({
            pattern: cardBackTheme.pattern,
            primaryColor: cardBackTheme.borderColor,
            secondaryColor: cardBackTheme.secondaryColor,
            scale: cardBackTheme.patternScale,
            opacity: cardBackTheme.patternOpacity,
        })
        : undefined;

    if (!cardBackTheme) {
        return null;
    }

    return (
        <div
            className="relative overflow-hidden rounded-3xl border-4 shadow-xl ring-1 dark:ring-slate-900"
            style={{
                backgroundColor: cardBackTheme.surfaceColor,
                borderColor: cardBackTheme.borderColor,
                boxShadow: `0 20px 50px -25px ${cardBackTheme.accentColor}, 0 0 ${cardBackTheme.glowBlur}px -12px ${cardBackTheme.glowColor}${Math.round(cardBackTheme.glowOpacity * 255)
                    .toString(16)
                    .padStart(2, "0")}`,
            }}
        >
            {cardBackTheme.overlayImageUrl ? (
                <Image
                    loader={passthroughImageLoader}
                    unoptimized
                    src={cardBackTheme.overlayImageUrl}
                    alt=""
                    aria-hidden="true"
                    fill
                    className="object-cover pointer-events-none"
                    style={{ opacity: cardBackTheme.overlayOpacity }}
                />
            ) : null}
            {cardBackPatternStyle ? (
                <div
                    className={`absolute inset-0 pointer-events-none ${cardBackMotionClass}`}
                    aria-hidden="true"
                    style={{ ...cardBackPatternStyle, ...cardBackMotionStyle }}
                />
            ) : null}
            <div
                className="absolute inset-0 pointer-events-none"
                aria-hidden="true"
                style={{
                    background: `radial-gradient(circle at top left, ${cardBackTheme.accentColor}33, transparent 35%), radial-gradient(circle at bottom right, ${cardBackTheme.borderColor}33, transparent 38%)`,
                }}
            />
            <div className="relative z-10 flex min-h-[474px] flex-col items-center justify-center px-8 py-10 text-center sm:min-h-[500px]">
                <div className="space-y-3">
                    <h3
                        className="text-3xl font-black uppercase tracking-[0.18em]"
                        style={{ color: cardBackTheme.titleColor }}
                    >
                        {t("game.guess")}
                    </h3>
                </div>
            </div>
            <div
                className="h-4 border-t dark:border-slate-700"
                style={{ backgroundColor: cardBackTheme.secondaryColor }}
            />
        </div>
    );
}


