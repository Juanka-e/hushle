"use client";

import { Trophy, Home } from "lucide-react";
import type { GameOverData } from "@/types/game";
import { useI18n } from "@/components/providers/i18n-provider";

interface GameOverScreenProps {
    gameOverData: GameOverData;
    onReturnToLobby: () => void;
}

export function GameOverScreen({ gameOverData, onReturnToLobby }: GameOverScreenProps) {
    const { t } = useI18n();
    const isDraw = gameOverData.kazananTakim === "Berabere";
    const endedByHost = gameOverData.endReason === "host_ended";
    const heading = isDraw
        ? t("gameOver.result")
        : endedByHost
            ? t("gameOver.leading")
            : t("gameOver.winner");
    const winnerColor =
        gameOverData.kazananTakim === "A"
            ? "text-red-600"
            : gameOverData.kazananTakim === "B"
                ? "text-blue-600"
                : "text-gray-600";

    const winnerName =
        gameOverData.kazananTakim === "Berabere"
            ? t("gameOver.draw")
            : t("gameOver.team", { team: gameOverData.kazananTakim });

    return (
        <div className="flex-1 flex items-center justify-center bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
            <div className="bg-white dark:bg-slate-800 p-10 rounded-3xl shadow-2xl border border-gray-100 dark:border-slate-700 text-center max-w-md w-full animate-fade-in">
                <div className={`mb-4 flex justify-center ${endedByHost ? "text-slate-400" : "text-yellow-500"}`}>
                    <Trophy size={64} strokeWidth={1} />
                </div>
                <h3 className="text-xl font-medium text-gray-500 dark:text-gray-400 mb-2">
                    {heading}
                </h3>
                <h1 className={`text-4xl font-black uppercase tracking-tight mb-8 ${winnerColor}`}>
                    {winnerName}
                </h1>
                {endedByHost ? (
                    <p
                        data-testid="game-over-host-ended"
                        className="-mt-4 mb-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                    >
                        {t("gameOver.hostEnded")}
                    </p>
                ) : null}

                <div className="flex justify-center gap-8 mb-8 text-slate-800 dark:text-white">
                    <div className="text-center">
                        <div className="text-3xl font-bold text-red-600">
                            {gameOverData.skor.A}
                        </div>
                        <div className="text-xs font-bold opacity-60">{t("gameOver.team", { team: "A" })}</div>
                    </div>
                    <div className="text-3xl font-light text-gray-300">vs</div>
                    <div className="text-center">
                        <div className="text-3xl font-bold text-blue-600">
                            {gameOverData.skor.B}
                        </div>
                        <div className="text-xs font-bold opacity-60">{t("gameOver.team", { team: "B" })}</div>
                    </div>
                </div>

                <button
                    onClick={onReturnToLobby}
                    className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold flex items-center justify-center gap-2 transition-transform hover:scale-105 shadow-lg"
                >
                    <Home size={20} /> {t("gameOver.returnLobby")}
                </button>
            </div>
        </div>
    );
}
