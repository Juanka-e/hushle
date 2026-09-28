"use client";

import Image, { type ImageLoaderProps } from "next/image";
import { Feather, Flame, Target, X } from "lucide-react";
import {
    buildCosmeticPatternStyle,
    getCosmeticMotionClass,
    getCosmeticMotionStyle,
} from "@/lib/cosmetics/effects";
import type { ResolvedCardFaceTheme } from "@/lib/cosmetics/card-face";
import type { CardData, Difficulty } from "@/types/game";

interface GameCardProps {
    card: CardData;
    theme?: ResolvedCardFaceTheme | null;
}

const difficultyConfig: Record<
    Difficulty,
    {
        icon: typeof Feather;
        bg: string;
        label: string;
    }
> = {
    1: {
        icon: Feather,
        bg: "bg-blue-500",
        label: "Kolay",
    },
    2: {
        icon: Target,
        bg: "bg-purple-500",
        label: "Orta",
    },
    3: {
        icon: Flame,
        bg: "bg-red-500",
        label: "Zor",
    },
};

const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;

export function GameCard({ card, theme }: GameCardProps) {
    const config = difficultyConfig[card.difficulty] || difficultyConfig[2];
    const Icon = config.icon;
    const motionClass = theme ? getCosmeticMotionClass(theme.motionPreset) : "";
    const motionStyle = theme ? getCosmeticMotionStyle(theme.motionSpeedMs) : undefined;
    const patternStyle = theme
        ? buildCosmeticPatternStyle({
            pattern: theme.pattern,
            primaryColor: theme.borderColor,
            secondaryColor: theme.secondaryColor,
            scale: theme.patternScale,
            opacity: theme.patternOpacity,
        })
        : undefined;

    const headerClass = card.categoryColor || theme ? "" : config.bg;
    const headerStyle = card.categoryColor
        ? { backgroundColor: card.categoryColor }
        : theme
            ? { backgroundColor: theme.accentColor }
            : {};

    return (
        <div className="w-full max-w-[320px] sm:max-w-[360px] mx-auto my-6">
            <div
                className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl overflow-hidden border-4 ring-1 dark:ring-slate-900 relative"
                style={
                    theme
                        ? {
                            borderColor: theme.borderColor,
                            boxShadow: `0 20px 45px -25px ${theme.accentColor}, 0 0 ${theme.glowBlur}px -10px ${theme.glowColor}${Math.round(theme.glowOpacity * 255)
                                .toString(16)
                                .padStart(2, "0")}`,
                        }
                        : undefined
                }
            >
                <div
                    className={`relative py-8 px-6 flex flex-col items-center justify-center text-center ${headerClass}`}
                    style={headerStyle}
                >
                    {theme?.overlayImageUrl && (
                        <Image
                            loader={passthroughImageLoader}
                            unoptimized
                            src={theme.overlayImageUrl}
                            alt=""
                            aria-hidden="true"
                            fill
                            className="object-cover pointer-events-none"
                            style={{ opacity: theme.overlayOpacity }}
                        />
                    )}
                    {theme && patternStyle && (
                        <div
                            className={`absolute inset-0 pointer-events-none ${motionClass}`}
                            aria-hidden="true"
                            style={{ ...patternStyle, ...motionStyle }}
                        />
                    )}
                    {theme && (
                        <div
                            className="absolute inset-0 pointer-events-none"
                            aria-hidden="true"
                            style={{
                                background: `radial-gradient(circle at top left, ${theme.borderColor}33, transparent 38%), radial-gradient(circle at bottom right, ${theme.accentColor}22, transparent 42%)`,
                            }}
                        />
                    )}

                    <div className="absolute top-4 right-4 z-10" title={`Zorluk: ${config.label}`}>
                        <Icon size={20} className="text-white opacity-80" />
                    </div>

                    <h2
                        className="relative z-10 text-4xl font-black uppercase tracking-wider drop-shadow-md"
                        style={{ color: theme?.wordColor ?? "#ffffff" }}
                    >
                        {card.word}
                    </h2>

                    <div
                        className="relative z-10 mt-4 w-16 h-1 rounded-full"
                        style={{ backgroundColor: theme?.borderColor ?? "rgba(255,255,255,0.4)" }}
                    />
                </div>

                <div className="px-8 py-8" style={{ backgroundColor: theme?.surfaceColor ?? undefined }}>
                    <div className="space-y-4">
                        {card.taboo.map((word, index) => (
                            <div key={index} className="flex items-center gap-3 group">
                                <span className="font-bold select-none" style={{ color: theme?.tabooColor ?? undefined }}>
                                    <X size={18} strokeWidth={3} />
                                </span>
                                <span
                                    className="text-xl font-semibold tracking-tight uppercase"
                                    style={{ color: theme?.wordColor ? `${theme.wordColor}DD` : undefined }}
                                >
                                    {word}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="h-4 border-t dark:border-slate-700" style={{ backgroundColor: theme?.footerColor ?? undefined }} />
            </div>
        </div>
    );
}
