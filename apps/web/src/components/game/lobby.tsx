"use client";
import { useState, useEffect, useMemo } from "react";
import {
    Settings,
    Trophy,
    Hash,
    Clock,
    Link2,
    Copy,
    Check,
    LayoutGrid,
    X,
    Shuffle,
    Users,
    EyeOff,
    Eye,
    ChevronDown,
    Square,
    CheckSquare,
    Play,
    ShieldAlert,
} from "lucide-react";
import type {
    CategoryItem,
    PendingAdminHandoffState,
    RoomStartReadiness,
} from "@/types/game";
import { useI18n } from "@/components/providers/i18n-provider";
import {
    GAME_CONTENT_LOCALES,
    GAME_CONTENT_LOCALE_DEFINITIONS,
    type GameContentLocale,
} from "@hushle/domain-game";

interface LobbyProps {
    roomCode: string;
    settings: { sure: number; mod: "tur" | "skor"; deger: number; wordLocale: GameContentLocale };
    selectedCategories: number[];
    selectedDifficulties: number[];
    categories: CategoryItem[];
    isHost: boolean;
    startReadiness: RoomStartReadiness;
    pendingAdminHandoff: PendingAdminHandoffState | null;
    onUpdateSettings: (settings: {
        sure: number;
        mod: "tur" | "skor";
        deger: number;
        wordLocale: GameContentLocale;
    }) => void;
    onUpdateCategories: (ids: number[]) => void;
    onUpdateDifficulties: (ids: number[]) => void;
    onInitialSet?: (categories: number[], difficulties: number[]) => void;
    onShuffleTeams: () => void;
    onSwitchTeam: () => void;
    onStartGame: () => void;
    onKickPlayer: (playerId: string) => void;
    onTransferHost: (playerId: string) => void;
}

export function Lobby({
    roomCode,
    settings,
    selectedCategories,
    selectedDifficulties,
    categories,
    isHost,
    startReadiness,
    pendingAdminHandoff,
    onUpdateSettings,
    onUpdateCategories,
    onUpdateDifficulties,
    onInitialSet,
    onShuffleTeams,
    onSwitchTeam,
    onStartGame,
}: LobbyProps) {
    const { t } = useI18n();
    const difficultyLabels: Record<number, string> = {
        1: t("room.easy"),
        2: t("room.medium"),
        3: t("room.hard"),
    };
    const [copied, setCopied] = useState(false);
    const [hideUrl, setHideUrl] = useState(false);
    const [hideUrlReady, setHideUrlReady] = useState(false);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [tempSelectedCategories, setTempSelectedCategories] = useState<number[]>(selectedCategories);
    const [tempSelectedDifficulties, setTempSelectedDifficulties] = useState<number[]>(selectedDifficulties);
    const [mounted, setMounted] = useState(false);
    const [handoffRemainingSeconds, setHandoffRemainingSeconds] = useState<number | null>(null);
    const [showStartRequirement, setShowStartRequirement] = useState(false);
    const startBlockedReason = useMemo(() => {
        if (!startReadiness.ready) {
            return t("room.minimumPlayers");
        }
        if (selectedCategories.length === 0) {
            return t("room.categoryRequired");
        }
        if (selectedDifficulties.length === 0) {
            return t("room.difficultyRequired");
        }
        return null;
    }, [
        selectedCategories.length,
        selectedDifficulties.length,
        startReadiness.ready,
        t,
    ]);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!showStartRequirement) return;

        const timeoutId = window.setTimeout(
            () => setShowStartRequirement(false),
            1_600
        );
        return () => window.clearTimeout(timeoutId);
    }, [showStartRequirement]);

    useEffect(() => {
        if (!mounted) return;

        try {
            window.sessionStorage.setItem("tabu_activeRoomCode", roomCode);
            const stored = window.localStorage.getItem(`tabu_room_hide_url:${roomCode}`) === "true";
            setHideUrl(stored);
        } finally {
            setHideUrlReady(true);
        }
    }, [mounted, roomCode]);

    useEffect(() => {
        if (!mounted || !hideUrlReady) return;

        const nextPath = hideUrl ? "/room" : `/room/${roomCode}`;
        if (window.location.pathname !== nextPath) {
            window.history.replaceState(window.history.state, "", nextPath);
        }

        window.localStorage.setItem(`tabu_room_hide_url:${roomCode}`, hideUrl ? "true" : "false");
    }, [hideUrl, hideUrlReady, mounted, roomCode]);

    useEffect(() => {
        if (!pendingAdminHandoff) {
            setHandoffRemainingSeconds(null);
            return;
        }

        const updateRemaining = () => {
            const seconds = Math.max(
                0,
                Math.ceil((pendingAdminHandoff.deadlineAt - Date.now()) / 1000)
            );
            setHandoffRemainingSeconds(seconds);
        };

        updateRemaining();
        const intervalId = window.setInterval(updateRemaining, 1000);
        return () => window.clearInterval(intervalId);
    }, [pendingAdminHandoff]);

    const copyRoomLink = () => {
        const link = `${window.location.origin}/room/${roomCode}`;
        navigator.clipboard?.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Flatten categories - memoize to avoid recomputation on every render
    const flatCategories = useMemo(() => {
        const result: CategoryItem[] = [];
        if (Array.isArray(categories)) {
            for (const cat of categories) {
                result.push(cat);
                if ((cat as { children?: CategoryItem[] }).children) {
                    for (const child of (cat as { children: CategoryItem[] }).children) {
                        result.push(child);
                    }
                }
            }
        }
        return result;
    }, [categories]);

    const categoryPathLabelById = useMemo(() => {
        const entries = new Map<number, string>();
        for (const cat of categories) {
            const children = (cat as { children?: CategoryItem[] }).children || [];
            entries.set(cat.id, cat.name);
            for (const child of children) {
                entries.set(child.id, `${cat.name} / ${child.name}`);
            }
        }
        return entries;
    }, [categories]);

    // Initialize categories and difficulties when first loaded (run once)
    useEffect(() => {
        // Only initialize if both are empty (first time loading)
        if (categories.length > 0 && selectedCategories.length === 0 && selectedDifficulties.length === 0) {
            // Select all categories by default
            const allCategoryIds = flatCategories.map(c => c.id);
            const allDifficulties = [1, 2, 3];
            // Use onInitialSet if available to avoid race condition
            if (onInitialSet) {
                onInitialSet(allCategoryIds, allDifficulties);
            } else if (onUpdateCategories && onUpdateDifficulties) {
                // Fallback to old API
                onUpdateCategories(allCategoryIds);
                setTimeout(() => onUpdateDifficulties(allDifficulties), 10);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [categories.length, flatCategories.length]);

    // Memoize parent categories for accordion
    const parentCategories = useMemo(() =>
        categories.filter((c) => !(c as { parentId?: number }).parentId),
        [categories]
    );

    const toggleCategory = (id: number) => {
        if (!isHost) return;
        setTempSelectedCategories((prev) =>
            prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
        );
    };

    const toggleDifficulty = (level: number) => {
        if (!isHost) return;
        setTempSelectedDifficulties((prev) => {
            if (prev.includes(level)) {
                if (prev.length === 1) return prev; // Don't deselect last
                return prev.filter((d) => d !== level);
            }
            return [...prev, level];
        });
    };

    const toggleExpand = (key: string) => {
        setExpandedCategories((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const confirmCategories = () => {
        onUpdateCategories(tempSelectedCategories);
        onUpdateDifficulties(tempSelectedDifficulties);
        setShowCategoryModal(false);
    };

    const isAllSelected = flatCategories.length > 0 && flatCategories.every((c) => tempSelectedCategories.includes(c.id));

    const toggleAllCategories = () => {
        if (!isHost) return;
        if (isAllSelected) {
            setTempSelectedCategories([]);
        } else {
            setTempSelectedCategories(flatCategories.map((c) => c.id));
        }
    };

    const clampTargetScore = (value: number) => {
        if (!Number.isFinite(value)) return 10;
        return Math.min(100, Math.max(10, value));
    };

    const clampRoundCount = (value: number) => {
        if (!Number.isFinite(value)) return 2;
        return Math.min(30, Math.max(2, Math.round(value)));
    };

    const handleHideUrlToggle = () => {
        setHideUrl((current) => !current);
    };

    const getSelectedText = () => {
        if (selectedCategories.length === 0) return t("room.noneSelected");
        if (flatCategories.length > 0 && selectedCategories.length === flatCategories.length) return t("room.allCategories");
        const firstLabel = categoryPathLabelById.get(selectedCategories[0]) || t("room.categoryFallback");
        if (selectedCategories.length === 1) return firstLabel;
        return t("room.moreCategories", { label: firstLabel, count: selectedCategories.length - 1 });
    };

    return (
        <div className="flex flex-col items-center w-full max-w-xl mx-auto p-4 sm:p-6 animate-fade-in">
            <div className="w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                {/* Header — URL Style Room Code */}
                <div className="bg-gray-50 dark:bg-slate-900 p-6 border-b border-gray-100 dark:border-slate-700 transition-all duration-300">
                    {!hideUrl ? (
                        <div className="animate-fade-in">
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 text-center">
                                {t("room.inviteLink")}
                            </label>

                            <button
                                onClick={copyRoomLink}
                                className="w-full bg-slate-800 text-left rounded-lg p-3.5 flex items-center justify-between group hover:bg-slate-700 transition-colors shadow-inner ring-1 ring-white/10 mb-3"
                            >
                                <div className="flex items-center gap-2 overflow-hidden font-mono text-sm sm:text-base w-full">
                                    <Link2
                                        size={16}
                                        className="text-blue-400 flex-shrink-0"
                                    />
                                    <div className="flex items-center truncate">
                                        <span className="text-slate-400">
                                            {mounted ? `${window.location.origin}/room/` : "/room/"}
                                        </span>
                                        <span className="text-white font-bold tracking-wider">
                                            {roomCode}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex-shrink-0 ml-3">
                                    {copied ? (
                                        <Check
                                            size={18}
                                            className="text-green-400"
                                        />
                                    ) : (
                                        <Copy
                                            size={18}
                                            className="text-slate-400 group-hover:text-white transition-colors"
                                        />
                                    )}
                                </div>
                            </button>
                        </div>
                    ) : (
                        <div className="text-center py-2 animate-fade-in">
                            <span className="text-sm text-gray-400 italic">
                                {t("room.hidden")}
                            </span>
                        </div>
                    )}

                    <button
                        onClick={handleHideUrlToggle}
                        className="flex items-center justify-center gap-2 w-full text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                    >
                        {hideUrl ? <Eye size={14} /> : <EyeOff size={14} />}
                        {hideUrl
                            ? t("room.showLink")
                            : t("room.hideLink")}
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-8">
                    {/* Action Buttons Grid */}
                    <div>
                        <div className="grid grid-cols-3 gap-3">
                            {/* Categories Button */}
                            <button
                                onClick={() => {
                                    setTempSelectedCategories(selectedCategories);
                                    setTempSelectedDifficulties(selectedDifficulties);
                                    setShowCategoryModal(true);
                                }}
                                disabled={false}
                                className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/50 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-300 transition-all active:scale-95 disabled:opacity-50"
                            >
                                <LayoutGrid size={24} />
                                <span className="text-xs font-bold">
                                    {t("room.categories")}
                                </span>
                            </button>

                            {/* Shuffle Teams Button */}
                            <button
                                onClick={onShuffleTeams}
                                disabled={!isHost}
                                className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-200 transition-all active:scale-95 disabled:opacity-50"
                            >
                                <Shuffle size={24} />
                                <span className="text-xs font-bold">
                                    {t("room.shuffleTeams")}
                                </span>
                            </button>

                            {/* Change Team Button */}
                            <button
                                onClick={onSwitchTeam}
                                className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 transition-all active:scale-95"
                            >
                                <Users size={24} />
                                <span className="text-xs font-bold">
                                    {t("room.switchTeam")}
                                </span>
                            </button>
                        </div>

                        {/* Selected Categories Info */}
                        <div className="mt-4 text-center">
                            <span className="text-xs text-gray-400 uppercase font-semibold">
                                {t("room.selectedCategories")}
                            </span>
                            <div className="flex items-center justify-center gap-2 mt-1">
                                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                    {getSelectedText()}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="h-px bg-gray-100 dark:bg-slate-700" />

                    {pendingAdminHandoff && handoffRemainingSeconds !== null ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-amber-950 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 rounded-full bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200">
                                    <ShieldAlert size={18} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-700/80 dark:text-amber-300/80">
                                        {t("room.handoffPending")}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold">
                                        {t("room.handoffCountdown", { seconds: handoffRemainingSeconds })}
                                    </div>
                                    <div className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
                                        {t("room.handoffHelp")}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {/* Game Settings */}
                    <div>
                        <div className="flex items-center gap-2 mb-4 text-gray-800 dark:text-gray-200">
                            <Settings size={18} />
                            <h3 className="font-semibold">{t("room.gameSettings")}</h3>
                        </div>

                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                            <label htmlFor="room-word-language" className="text-sm font-medium text-muted-foreground" title={t("room.wordLanguageHelp")}>
                                {t("room.wordLanguage")}
                            </label>
                            <select id="room-word-language" value={settings.wordLocale}
                                onChange={event => onUpdateSettings({ ...settings, wordLocale: event.target.value as GameContentLocale })}
                                disabled={!isHost}
                                className="min-h-11 max-w-full rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70">
                                {GAME_CONTENT_LOCALES.map(locale => (
                                    <option key={locale} value={locale}>{GAME_CONTENT_LOCALE_DEFINITIONS[locale].nativeName}</option>
                                ))}
                            </select>
                        </div>
                        <details className="group/settings mb-4">
                            <summary className="cursor-pointer py-2 text-sm font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("room.advancedSettings")}</summary>
                            <div className="pt-3">
                        {/* Game Mode Selection */}
                        <div className="mb-4">
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                                {t("room.gameMode")}
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() =>
                                        isHost &&
                                        onUpdateSettings({
                                            ...settings,
                                            mod: "tur",
                                            deger: clampRoundCount(settings.deger),
                                        })
                                    }
                                    disabled={!isHost}
                                    className={`flex items-center justify-center gap-2 py-3 rounded-xl border transition-all ${
                                        settings.mod === "tur"
                                            ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300 ring-1 ring-blue-500/20"
                                            : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
                                        }`}
                                >
                                    <Hash size={16} />
                                    <span className="text-sm font-medium">
                                        {t("room.roundCount")}
                                    </span>
                                </button>
                                <button
                                    onClick={() =>
                                        isHost &&
                                        onUpdateSettings({
                                            ...settings,
                                            mod: "skor",
                                            deger: clampTargetScore(settings.deger),
                                        })
                                    }
                                    disabled={!isHost}
                                    className={`flex items-center justify-center gap-2 py-3 rounded-xl border transition-all ${
                                        settings.mod === "skor"
                                            ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300 ring-1 ring-blue-500/20"
                                            : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
                                        }`}
                                >
                                    <Trophy size={16} />
                                    <span className="text-sm font-medium">
                                        {t("room.targetScore")}
                                    </span>
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                                    <Clock size={12} /> {t("room.durationSeconds")}
                                </label>
                                <select
                                    value={settings.sure}
                                    onChange={(e) =>
                                        onUpdateSettings({
                                            ...settings,
                                            sure: Number(e.target.value),
                                        })
                                    }
                                    className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                    disabled={!isHost}
                                >
                                    {[30, 45, 60, 90, 120].map((seconds) => (
                                        <option key={seconds} value={seconds}>{t("room.secondsValue", { count: seconds })}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                {settings.mod === "tur" ? (
                                    <>
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                                            <Hash size={12} /> {t("room.totalRounds")}
                                        </label>
                                        <input
                                            type="number"
                                            min={2}
                                            max={30}
                                            step={1}
                                            value={settings.deger}
                                            onChange={(e) =>
                                                onUpdateSettings({
                                                    ...settings,
                                                    deger: clampRoundCount(Number(e.target.value)),
                                                })
                                            }
                                            onBlur={(e) =>
                                                onUpdateSettings({
                                                    ...settings,
                                                    deger: clampRoundCount(Number(e.target.value)),
                                                })
                                            }
                                            className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                            disabled={!isHost}
                                        />
                                        <p className="mt-1 text-[11px] text-gray-400">
                                            {t("room.roundRange")}
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                                            <Trophy size={12} /> {t("room.targetScore")}
                                        </label>
                                        <input
                                            type="number"
                                            min={10}
                                            max={100}
                                            step={5}
                                            value={settings.deger}
                                            onChange={(e) =>
                                                onUpdateSettings({
                                                    ...settings,
                                                    deger: clampTargetScore(Number(e.target.value)),
                                                })
                                            }
                                            onBlur={(e) =>
                                                onUpdateSettings({
                                                    ...settings,
                                                    deger: clampTargetScore(Number(e.target.value)),
                                                })
                                            }
                                            className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                            disabled={!isHost}
                                        />
                                        <p className="mt-1 text-[11px] text-gray-400">
                                            {t("room.scoreHint")}
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                            </div>
                        </details>
                    </div>

                    {/* Start Action */}
                    <div className="pt-2">
                        {isHost ? (
                            <div className="group relative">
                                <button
                                    type="button"
                                    aria-disabled={Boolean(startBlockedReason)}
                                    aria-describedby={
                                        startBlockedReason
                                            ? "room-start-requirement"
                                            : undefined
                                    }
                                    onClick={() => {
                                        if (startBlockedReason) {
                                            setShowStartRequirement(true);
                                            return;
                                        }
                                        onStartGame();
                                    }}
                                    className={`flex w-full transform items-center justify-center gap-2 rounded-xl py-4 text-lg font-bold text-white shadow-lg transition-all active:scale-[0.99] ${
                                        startBlockedReason
                                            ? "cursor-not-allowed bg-gray-400 shadow-none"
                                            : "bg-green-600 shadow-green-600/20 hover:bg-green-700"
                                    }`}
                                >
                                    <Play size={22} />
                                    {t("room.startGame")}
                                </button>
                                {startBlockedReason ? (
                                    <div
                                        id="room-start-requirement"
                                        role="tooltip"
                                        data-click-visible={showStartRequirement}
                                        className={`pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-semibold leading-5 text-amber-800 shadow-xl transition duration-150 dark:border-amber-800/60 dark:bg-amber-950 dark:text-amber-200 ${
                                            showStartRequirement
                                                ? "translate-y-0 opacity-100"
                                                : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
                                        }`}
                                    >
                                        {startBlockedReason}
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <div className="w-full py-4 text-gray-400 text-center text-sm animate-pulse bg-gray-50 dark:bg-slate-900/50 rounded-xl">
                                {t("room.hostStarting")}
                            </div>
                        )}

                    </div>
                </div>
            </div>

            {/* Category Selection Modal - ACCORDION STYLE */}
            {showCategoryModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        {/* Modal Header */}
                        <div className="p-6 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-800 z-10">
                            <div>
                                <h3 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                    <LayoutGrid className="text-blue-500" />
                                    {t("room.categories")}
                                </h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {isHost
                                        ? t("room.categoryHostHelp")
                                        : t("room.categoryReadonlyHelp")}
                                </p>

                                {/* Difficulty Selection */}
                                <div className="mt-3 flex items-center gap-2">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wide mr-1">
                                        {t("room.difficulty")}
                                    </span>
                                    {[1, 2, 3].map((diff) => {
                                        const isSelected =
                                            tempSelectedDifficulties.includes(
                                                diff
                                            );
                                        return (
                                            <button
                                                key={diff}
                                                onClick={() =>
                                                    toggleDifficulty(diff)
                                                }
                                                disabled={!isHost}
                                                className={`px-3 py-1 rounded-full text-xs font-bold border transition-all ${
                                                    isSelected
                                                        ? "bg-slate-800 text-white dark:bg-white dark:text-slate-900 border-transparent"
                                                        : "bg-transparent text-gray-400 border-gray-300 dark:border-slate-600"
                                                    }`}
                                            >
                                                {difficultyLabels[diff]}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <button
                                onClick={() => setShowCategoryModal(false)}
                                className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-full text-gray-500 transition-colors"
                            >
                                <X size={24} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-4 overflow-y-auto flex-1 custom-scrollbar">
                            <div className="space-y-2">
                                {/* Select All Row */}
                                <div className="bg-gray-50 dark:bg-slate-900 rounded-xl overflow-hidden border border-gray-100 dark:border-slate-700 mb-2">
                                    <div className="flex items-center p-3 gap-3 bg-blue-50/50 dark:bg-blue-900/10">
                                        <button
                                            onClick={toggleAllCategories}
                                            disabled={!isHost}
                                            className={`flex-shrink-0 transition-colors ${isAllSelected ? "text-blue-600" : "text-gray-300 dark:text-gray-600"}`}
                                        >
                                            {isAllSelected ? (
                                                <CheckSquare size={24} />
                                            ) : (
                                                <Square size={24} />
                                            )}
                                        </button>
                                        <span className="font-bold text-slate-800 dark:text-slate-200 text-sm sm:text-base">
                                            {t("room.allCategories")}
                                        </span>
                                    </div>
                                </div>

                                {/* Category Accordion */}
                                {parentCategories.map((mainCat) => {
                                    const children = (
                                        mainCat as {
                                            children?: CategoryItem[];
                                        }
                                    ).children || [];
                                    const allItems = [mainCat, ...children];
                                    const allSubSelected = allItems.every((c) =>
                                        tempSelectedCategories.includes(c.id)
                                    );
                                    const someSubSelected = allItems.some((c) =>
                                        tempSelectedCategories.includes(c.id)
                                    );
                                    const isExpanded = expandedCategories.has(
                                        String(mainCat.id)
                                    );

                                    return (
                                        <div
                                            key={mainCat.id}
                                            className="bg-gray-50 dark:bg-slate-900 rounded-xl overflow-hidden border border-gray-100 dark:border-slate-700"
                                        >
                                            {/* Accordion Header */}
                                            <div className="flex items-center p-3 gap-3">
                                                <button
                                                    onClick={() => {
                                                        if (!isHost) return;
                                                        const ids =
                                                            allItems.map(
                                                                (c) => c.id
                                                            );
                                                        if (allSubSelected) {
                                                            setTempSelectedCategories(
                                                                (prev) =>
                                                                    prev.filter(
                                                                        (id) =>
                                                                            !ids.includes(
                                                                                id
                                                                            )
                                                                    )
                                                            );
                                                        } else {
                                                            setTempSelectedCategories(
                                                                (prev) => {
                                                                    const set =
                                                                        new Set(
                                                                            prev
                                                                        );
                                                                    ids.forEach(
                                                                        (id) =>
                                                                            set.add(
                                                                                id
                                                                            )
                                                                    );
                                                                    return Array.from(
                                                                        set
                                                                    );
                                                                }
                                                            );
                                                        }
                                                    }}
                                                    disabled={!isHost}
                                                    className={`flex-shrink-0 transition-colors ${allSubSelected || someSubSelected ? "text-blue-600" : "text-gray-300 dark:text-gray-600"}`}
                                                >
                                                    {allSubSelected ? (
                                                        <CheckSquare
                                                            size={24}
                                                        />
                                                    ) : someSubSelected ? (
                                                        <div className="relative">
                                                            <Square size={24} />
                                                            <div className="absolute inset-0 flex items-center justify-center">
                                                                <div className="w-3 h-3 bg-blue-600 rounded-sm" />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <Square size={24} />
                                                    )}
                                                </button>

                                                <button
                                                    onClick={() =>
                                                        toggleExpand(
                                                            String(mainCat.id)
                                                        )
                                                    }
                                                    className="flex-1 flex items-center justify-between group"
                                                >
                                                    <div className="flex flex-col items-start">
                                                        <span className="font-bold text-slate-800 dark:text-slate-200 text-sm sm:text-base">
                                                            {mainCat.name}
                                                        </span>
                                                        <span className="text-xs text-gray-400">
                                                            {t("room.selectedCount", {
                                                                selected: allItems.filter((c) => tempSelectedCategories.includes(c.id)).length,
                                                                total: allItems.length,
                                                            })}
                                                        </span>
                                                    </div>
                                                    <div
                                                        className={`p-1.5 rounded-full text-gray-400 group-hover:bg-gray-200 dark:group-hover:bg-slate-700 transition-all duration-200 ${isExpanded ? "rotate-180" : ""}`}
                                                    >
                                                        <ChevronDown
                                                            size={20}
                                                        />
                                                    </div>
                                                </button>
                                            </div>

                                            {/* Accordion Body - Responsive Grid */}
                                            <div
                                                className={`transition-all duration-300 ease-in-out overflow-hidden ${
                                                    isExpanded
                                                        ? "max-h-96 opacity-100"
                                                        : "max-h-0 opacity-0"
                                                }`}
                                            >
                                                <div className="p-3 pt-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 border-t border-gray-100 dark:border-slate-800 mt-1">
                                                    {allItems.map((subCat) => {
                                                        const isSelected =
                                                            tempSelectedCategories.includes(
                                                                subCat.id
                                                            );
                                                        const isParentRow = subCat.id === mainCat.id;
                                                        return (
                                                            <button
                                                                key={subCat.id}
                                                                onClick={() =>
                                                                    toggleCategory(
                                                                        subCat.id
                                                                    )
                                                                }
                                                                disabled={!isHost}
                                                                className={`p-2.5 rounded-lg border text-left transition-all flex items-center justify-between ${
                                                                    isSelected
                                                                        ? "border-blue-500 bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/50 shadow-sm"
                                                                        : "border-gray-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
                                                                    }`}
                                                            >
                                                                <div className="min-w-0">
                                                                    <span className="block truncate text-xs sm:text-sm font-medium">
                                                                        {subCat.name}
                                                                    </span>
                                                                    {isParentRow ? (
                                                                        <span className="mt-0.5 block text-[11px] uppercase tracking-[0.16em] text-gray-400">
                                                                            Sadece ana kategori kelimeleri
                                                                        </span>
                                                                    ) : (
                                                                        <span className="mt-0.5 block text-[11px] uppercase tracking-[0.16em] text-gray-400">
                                                                            {mainCat.name} alt kategorisi
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {isSelected && (
                                                                    <Check
                                                                        size={
                                                                            14
                                                                        }
                                                                        className="text-blue-600 dark:text-blue-400 flex-shrink-0"
                                                                    />
                                                                )}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* If no parent categories, show flat list */}
                                {parentCategories.length === 0 &&
                                    flatCategories.length > 0 && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                            {flatCategories.map((cat) => {
                                                const isSelected =
                                                    tempSelectedCategories.includes(
                                                        cat.id
                                                    );
                                                return (
                                                    <button
                                                        key={cat.id}
                                                        onClick={() =>
                                                            toggleCategory(
                                                                cat.id
                                                            )
                                                        }
                                                        disabled={!isHost}
                                                        className={`p-2.5 rounded-lg border text-left transition-all flex items-center justify-between ${
                                                            isSelected
                                                                ? "border-blue-500 bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/50 shadow-sm"
                                                                : "border-gray-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
                                                            }`}
                                                    >
                                                        <span className="text-xs sm:text-sm font-medium truncate">
                                                            {cat.name}
                                                        </span>
                                                        {isSelected && (
                                                            <Check
                                                                size={14}
                                                                className="flex-shrink-0"
                                                            />
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}

                                {flatCategories.length === 0 && (
                                    <div className="text-center py-8 text-gray-400">
                                        {t("room.categoryLoading")}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="p-6 border-t border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-900">
                            <button
                                onClick={isHost ? confirmCategories : () => setShowCategoryModal(false)}
                                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-[0.99]"
                            >
                                {isHost
                                    ? t("room.confirmSelection", { count: tempSelectedCategories.length })
                                    : t("room.close")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

