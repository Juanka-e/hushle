"use client";

import Image, { type ImageLoaderProps } from "next/image";
import { Crown, ChevronLeft, ChevronRight, Users, Shield, Swords, MoreVertical, UserX, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    buildCosmeticPatternStyle,
    getCosmeticMotionClass,
    getCosmeticMotionStyle,
} from "@/lib/cosmetics/effects";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Player } from "@/types/game";
import { useI18n } from "@/components/providers/i18n-provider";

interface SidebarProps {
    team: "A" | "B";
    players: Player[];
    creatorPlayerId: string;
    currentPlayerId: string;
    isOpen: boolean;
    onToggle: () => void;
    isMobile: boolean;
    onMoveNarrator?: (playerId: string, direction: "up" | "down") => void;
    onSwitchTeam?: () => void;
    onKickPlayer?: (playerId: string) => void;
    onTransferHost?: (playerId: string) => void;
}

const teamTheme = {
    A: {
        primary: "text-red-600 dark:text-red-500",
        bg: "bg-red-50 dark:bg-red-900/10",
        border: "border-red-200 dark:border-red-900/30",
        gradient: "from-red-500/10 to-transparent",
        avatar: "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400",
        hover: "hover:bg-red-50 dark:hover:bg-red-900/20",
        footerBg: "bg-red-500",
    },
    B: {
        primary: "text-blue-600 dark:text-blue-500",
        bg: "bg-blue-50 dark:bg-blue-900/10",
        border: "border-blue-200 dark:border-blue-900/30",
        gradient: "from-blue-500/10 to-transparent",
        avatar: "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400",
        hover: "hover:bg-blue-50 dark:hover:bg-blue-900/20",
        footerBg: "bg-blue-500",
    },
};

const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;

function toHexAlpha(opacity: number): string {
    return Math.round(Math.max(0, Math.min(1, opacity)) * 255)
        .toString(16)
        .padStart(2, "0");
}

export function Sidebar({
    team,
    players,
    creatorPlayerId,
    currentPlayerId,
    isOpen,
    onToggle,
    isMobile,
    onMoveNarrator,
    onSwitchTeam,
    onKickPlayer,
    onTransferHost,
}: SidebarProps) {
    const { t } = useI18n();
    const theme = teamTheme[team];
    const isTeamA = team === "A";
    const teamPlayers = players.filter((p) => p.takim === team);
    // Use playerId comparison for reliable host detection (socketId changes on reconnect)
    const isHost = currentPlayerId && creatorPlayerId ? currentPlayerId === creatorPlayerId : false;

    // Sidebar width
    const sidebarWidth = isOpen ? "w-80" : "w-20";

    // Position classes: mobile = fixed sliding panel, desktop = relative flex item
    const positionClasses = isMobile
        ? `fixed inset-y-0 z-[100] ${isTeamA ? "left-0" : "right-0"} w-72 shadow-2xl transform transition-transform duration-300 ${isOpen
            ? "translate-x-0"
            : isTeamA
                ? "-translate-x-full"
                : "translate-x-full"
        }`
        : `relative h-full transition-all duration-300 ease-in-out flex-shrink-0 ${sidebarWidth}`;

    const borderClass = isTeamA ? "border-r" : "border-l";

    return (
        <aside
            className={`${positionClasses} flex flex-col bg-white dark:bg-slate-900 border-gray-100 dark:border-slate-800 ${!isMobile ? borderClass : ""} overflow-hidden group/sidebar`}
        >
            {/* Background Decor: Watermark Letter */}
            <div className="absolute top-0 inset-x-0 h-96 pointer-events-none select-none overflow-hidden">
                <div
                    className={`absolute inset-0 bg-gradient-to-b ${theme.gradient} opacity-100`}
                />
                <div
                    className={`absolute -top-12 ${isTeamA ? "-left-10" : "-right-10"} text-[14rem] font-black opacity-[0.04] dark:opacity-[0.06] ${theme.primary} leading-none`}
                >
                    {team}
                </div>
            </div>

            {/* Header */}
            <div className="relative z-10 flex flex-col justify-center min-h-[5rem] px-4 pt-4 pb-2">
                {isMobile ? (
                    <button
                        type="button"
                        aria-label={t("common.closeTeamPanel", { team })}
                        onClick={onToggle}
                        className={`absolute top-4 rounded-xl border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition hover:text-gray-900 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300 dark:hover:text-white ${
                            isTeamA ? "right-3" : "left-3"
                        }`}
                    >
                        {isTeamA ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
                    </button>
                ) : null}
                <div
                    className={`flex items-center ${isMobile
                        ? isTeamA
                            ? "justify-start pr-12"
                            : "justify-end pl-12"
                        : !isOpen
                        ? "justify-center"
                        : isTeamA
                            ? "justify-between"
                            : "justify-start gap-3"
                        }`}
                >
                    {/* Toggle Button for Team B (left side for symmetry) */}
                    {!isTeamA && !isMobile && isOpen && (
                        <button
                            onClick={onToggle}
                            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            <ChevronRight size={20} />
                        </button>
                    )}

                    {/* Title Area */}
                    {isOpen || isMobile ? (
                        <div className="flex items-center gap-3 animate-fade-in">
                            <div
                                className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm border border-white/50 dark:border-white/10 ${theme.bg}`}
                            >
                                {isTeamA ? (
                                    <Swords size={20} className={theme.primary} />
                                ) : (
                                    <Shield size={20} className={theme.primary} />
                                )}
                            </div>
                            <div>
                                <h2
                                    className={`text-2xl font-black uppercase tracking-tight leading-none ${theme.primary}`}
                                >
                                    {t("common.team", { team })}
                                </h2>
                                <div
                                    className={`h-1 w-8 rounded-full ${theme.bg} mt-1 brightness-95`}
                                />
                            </div>
                        </div>
                    ) : (
                        // Collapsed Header Icon
                        <div
                            className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-2xl shadow-sm border border-white/50 dark:border-white/10 ${theme.bg} ${theme.primary}`}
                        >
                            {team}
                        </div>
                    )}

                    {/* Toggle Button for Team A (right side) */}
                    {isTeamA && !isMobile && isOpen && (
                        <button
                            onClick={onToggle}
                            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            <ChevronLeft size={20} />
                        </button>
                    )}
                </div>
            </div>

            {/* Player List */}
            <div className="relative z-10 flex-1 overflow-y-auto px-3 py-4 space-y-3 scrollbar-hide">
                {/* Collapsed Toggle Button */}
                {!isOpen && !isMobile && (
                    <button
                        onClick={onToggle}
                        className="w-full flex justify-center mb-6 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    >
                        {isTeamA ? (
                            <ChevronRight size={24} />
                        ) : (
                            <ChevronLeft size={24} />
                        )}
                    </button>
                )}

                {teamPlayers.map((player, playerIndex) => {
                    const isCreator = player.playerId === creatorPlayerId;
                    const isMe = player.playerId === currentPlayerId;
                    const canManage = isHost && !isMe && !isCreator;
                    const framePatternStyle = player.cosmetics?.framePattern && player.cosmetics.frameAccentColor
                        ? buildCosmeticPatternStyle({
                            pattern: player.cosmetics.framePattern,
                            primaryColor: player.cosmetics.frameAccentColor,
                            secondaryColor: player.cosmetics.frameSecondaryColor ?? player.cosmetics.frameAccentColor,
                            scale: player.cosmetics.framePatternScale ?? 14,
                            opacity: player.cosmetics.framePatternOpacity ?? 0,
                        })
                        : undefined;
                    const frameMotionClass = player.cosmetics?.frameMotionPreset
                        ? getCosmeticMotionClass(player.cosmetics.frameMotionPreset)
                        : "";
                    const frameMotionStyle = player.cosmetics?.frameMotionSpeedMs
                        ? getCosmeticMotionStyle(player.cosmetics.frameMotionSpeedMs)
                        : undefined;
                    const frameThickness = player.cosmetics?.frameThickness ?? 2;
                    const frameRadius = player.cosmetics?.frameRadius ?? 16;
                    const frameGlowColor = player.cosmetics?.frameGlowColor ?? player.cosmetics?.frameAccentColor ?? undefined;
                    const frameGlowOpacity = player.cosmetics?.frameGlowOpacity ?? 0;
                    const frameGlowBlur = player.cosmetics?.frameGlowBlur ?? 18;
                    const frameStyle = player.cosmetics?.frameStyle ?? "solid";

                    return (
                        <div
                            key={player.playerId}
                            className={`group relative flex items-center gap-3 rounded-2xl transition-all duration-200 cursor-default select-none border border-transparent ${isOpen || isMobile
                                ? `p-3 ${theme.hover}`
                                : "justify-center py-2"
                                }`}
                        >
                            {/* Avatar */}
                            <div className="relative">
                                <div
                                    className={`relative w-11 h-11 shadow-sm transition-transform duration-200 group-hover:scale-105 ring-2 ring-white dark:ring-slate-900 overflow-hidden ${frameMotionClass}`}
                                    style={{
                                        padding: `${frameThickness}px`,
                                        borderRadius: `${frameRadius}px`,
                                        backgroundColor: player.cosmetics?.frameAccentColor ?? undefined,
                                        boxShadow: frameGlowColor
                                            ? `0 0 ${frameGlowBlur}px -6px ${frameGlowColor}${toHexAlpha(frameGlowOpacity)}`
                                            : undefined,
                                        ...frameMotionStyle,
                                    }}
                                >
                                    {framePatternStyle && (
                                        <div
                                            className="absolute inset-0 pointer-events-none"
                                            aria-hidden="true"
                                            style={framePatternStyle}
                                        />
                                    )}
                                    {player.cosmetics?.frameImageUrl && (
                                        <Image
                                            loader={passthroughImageLoader}
                                            unoptimized
                                            src={player.cosmetics.frameImageUrl}
                                            alt=""
                                            aria-hidden="true"
                                            fill
                                            className="object-cover opacity-50 pointer-events-none"
                                        />
                                    )}
                                    {frameStyle === "double" && (
                                        <div
                                            className="absolute inset-[4px] rounded-[12px] border pointer-events-none"
                                            aria-hidden="true"
                                            style={{
                                                borderColor: `${player.cosmetics?.frameSecondaryColor ?? player.cosmetics?.frameAccentColor ?? "#ffffff"}88`,
                                            }}
                                        />
                                    )}
                                    {frameStyle === "ornate" && (
                                        <div
                                            className="absolute inset-[3px] rounded-[14px] pointer-events-none"
                                            aria-hidden="true"
                                            style={{
                                                border: `1px solid ${player.cosmetics?.frameSecondaryColor ?? player.cosmetics?.frameAccentColor ?? "#ffffff"}99`,
                                                boxShadow: `inset 0 0 0 1px ${player.cosmetics?.frameAccentColor ?? "#ffffff"}55`,
                                            }}
                                        />
                                    )}
                                    <div
                                        className={`relative z-10 w-full h-full rounded-[14px] flex items-center justify-center font-black text-lg overflow-hidden ${theme.avatar}`}
                                    >
                                        {player.cosmetics?.avatarImageUrl ? (
                                            <Image
                                                loader={passthroughImageLoader}
                                                unoptimized
                                                src={player.cosmetics.avatarImageUrl}
                                                alt={player.ad}
                                                fill
                                                className="object-cover"
                                            />
                                        ) : (
                                            (player.ad || "?")
                                                .substring(0, 1)
                                                .toUpperCase()
                                        )}
                                    </div>
                                </div>

                                {/* Crown for Host */}
                                {isCreator && (
                                    <div className="absolute -top-2 -right-2 bg-amber-400 text-white p-1 rounded-full ring-4 ring-white dark:ring-slate-900 shadow-sm z-20">
                                        <Crown size={12} strokeWidth={3} />
                                    </div>
                                )}
                            </div>

                            {/* Name (visible when expanded) */}
                            {(isOpen || isMobile) && (
                                <div className="flex-1 min-w-0 animate-fade-in flex flex-col justify-center h-11">
                                    <p
                                        className={`font-bold truncate text-base leading-tight ${player.online
                                            ? "text-slate-700 dark:text-gray-200"
                                            : "text-muted-foreground line-through"
                                            }`}
                                    >
                                        {player.ad}
                                        {isMe && (
                                            <span className="text-muted-foreground text-xs ml-1 font-normal">
                                                (sen)
                                            </span>
                                        )}
                                    </p>
                                </div>
                            )}

                            {(isOpen || isMobile) && isHost && onMoveNarrator && (
                                <div className="flex shrink-0 flex-col">
                                    {(["up", "down"] as const).map(direction => (
                                        <button key={direction} type="button"
                                            aria-label={t(direction === "up" ? "room.orderUp" : "room.orderDown") + ": " + player.ad}
                                            title={t(direction === "up" ? "room.orderUp" : "room.orderDown")}
                                            disabled={direction === "up" ? playerIndex === 0 : playerIndex === teamPlayers.length - 1}
                                            onClick={() => onMoveNarrator(player.playerId, direction)}
                                            className="min-h-8 min-w-8 rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-25">
                                            {direction === "up" ? "↑" : "↓"}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {/* Admin Actions */}
                            {(isOpen || isMobile) && canManage && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-white dark:hover:bg-slate-800 transition-colors">
                                            <MoreVertical size={16} />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuLabel>{t("common.adminActions")}</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => onTransferHost?.(player.playerId)}
                                            className="text-blue-600 focus:text-blue-700 focus:bg-blue-50 cursor-pointer"
                                            disabled={!onTransferHost}
                                        >
                                            <ArrowRightLeft className="mr-2 h-4 w-4" />
                                            <span>{t("common.transferHost")}</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() => onKickPlayer?.(player.playerId)}
                                            className="text-red-600 focus:text-red-700 focus:bg-red-50 cursor-pointer"
                                            disabled={!onKickPlayer}
                                        >
                                            <UserX className="mr-2 h-4 w-4" />
                                            <span>{t("common.kickPlayer")}</span>
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}

                            {/* Active Indicator (Decorative) */}
                            {(isOpen || isMobile) && (
                                <div
                                    className={`w-1 h-6 rounded-full bg-current opacity-0 group-hover:opacity-20 transition-opacity ${theme.primary}`}
                                />
                            )}
                        </div>
                    );
                })}

                {/* Empty State */}
                {teamPlayers.length === 0 && (
                    <div
                        className={`flex flex-col items-center justify-center text-gray-300 dark:text-slate-700 py-12 ${!isOpen && !isMobile ? "scale-75" : ""}`}
                    >
                        <Users
                            size={28}
                            strokeWidth={1.5}
                            className="mb-2 opacity-50"
                        />
                        {(isOpen || isMobile) && (
                            <span className="text-xs font-bold uppercase tracking-widest opacity-60">
                                {t("common.empty")}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Team Switch Button */}
            {
                onSwitchTeam && (isOpen || isMobile) && (
                    <div className="relative z-10 p-3 border-t border-gray-100 dark:border-slate-800">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full text-xs"
                            onClick={onSwitchTeam}
                        >
                            {t("room.switchTeamAction")}
                        </Button>
                    </div>
                )
            }

            {/* Footer Decoration */}
            <div className={`h-1 w-full opacity-60 ${theme.footerBg}`} />
        </aside >
    );
}
