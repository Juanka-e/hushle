"use client";

import { memo, useMemo, useState } from "react";
import Image, { type ImageLoaderProps } from "next/image";
import { Flame, Sparkles, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveCardBackTheme } from "@/lib/cosmetics/card-back";
import { resolveCardFaceTheme } from "@/lib/cosmetics/card-face";
import { buildCosmeticPatternStyle, getCosmeticMotionClass, getCosmeticMotionStyle } from "@/lib/cosmetics/effects";
import { resolveFrameTheme } from "@/lib/cosmetics/frame";
import type { StoreItemRarity, StoreItemRenderMode, StoreItemType, TemplateConfig } from "@/types/economy";
import type { AppLocale } from "@/lib/i18n/config";
import { useI18n } from "@/components/providers/i18n-provider";

export interface CosmeticPreviewItem {
    name: string;
    type: StoreItemType;
    rarity: StoreItemRarity;
    renderMode: StoreItemRenderMode;
    renderSpecVersion?: number;
    imageUrl: string;
    thumbnailUrl?: string | null;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
}

const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;

export function formatCosmeticTypeLabel(type: StoreItemType, locale: AppLocale = "tr"): string {
    if (type === "avatar") return "Avatar";
    if (locale === "en") {
        if (type === "frame") return "Frame";
        if (type === "card_back") return "Card Back";
        return "Card Face";
    }
    if (type === "frame") return "Çerçeve";
    if (type === "card_back") return "Kart Arkası";
    return "Kart Önü";
}

function getItemInitial(name: string) {
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "?";
}

function applyHexAlpha(hex: string, opacity: number) {
    return `${hex}${Math.round(opacity * 255).toString(16).padStart(2, "0")}`;
}

export const CosmeticThumbnail = memo(function CosmeticThumbnail({
    item,
}: {
    item: CosmeticPreviewItem;
}) {
    if (item.thumbnailUrl) {
        const isCard = item.type === "card_back" || item.type === "card_face";
        return (
            <div
                className={cn(
                    "relative overflow-hidden border border-white/50 bg-white/70 shadow-[0_18px_38px_-26px_rgba(15,23,42,0.5)] dark:border-white/10 dark:bg-slate-950/70",
                    isCard ? "h-24 w-[74px] rounded-[18px]" : "h-20 w-20 rounded-[22px]"
                )}
                data-cosmetic-thumbnail="asset"
            >
                <Image
                    loader={passthroughImageLoader}
                    unoptimized
                    src={item.thumbnailUrl}
                    alt={item.name}
                    fill
                    sizes={isCard ? "74px" : "80px"}
                    loading="lazy"
                    className="object-contain"
                />
            </div>
        );
    }

    if (item.type === "avatar") {
        return <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[22px] border border-white/50 bg-gradient-to-br from-indigo-500 via-blue-500 to-cyan-400 shadow-[0_18px_38px_-24px_rgba(59,130,246,0.58)] dark:border-white/10" data-cosmetic-thumbnail="fallback">{item.imageUrl ? <Image loader={passthroughImageLoader} unoptimized src={item.imageUrl} alt={item.name} width={80} height={80} loading="lazy" className="h-full w-full object-cover" /> : <span className="text-2xl font-black text-white">{getItemInitial(item.name)}</span>}</div>;
    }
    if (item.type === "frame") {
        const theme = resolveFrameTheme({ renderMode: item.renderMode, imageUrl: item.imageUrl, templateKey: item.templateKey, templateConfig: item.templateConfig, rarity: item.rarity });
        if (!theme) {
            return <div className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-slate-900 text-2xl font-black text-white" data-cosmetic-thumbnail="fallback">{getItemInitial(item.name)}</div>;
        }
        const patternStyle = buildCosmeticPatternStyle({ pattern: theme.pattern, primaryColor: theme.accentColor, secondaryColor: theme.secondaryColor, scale: theme.patternScale, opacity: theme.patternOpacity });
        return <div className="relative h-20 w-20" data-cosmetic-thumbnail="fallback"><div className="absolute inset-0 rounded-[24px]" style={{ border: `${theme.thickness}px solid ${theme.accentColor}`, boxShadow: `0 0 ${Math.min(theme.glowBlur, 14)}px ${applyHexAlpha(theme.glowColor, Math.min(theme.glowOpacity, 0.35))}` }} />{theme.imageUrl ? <Image loader={passthroughImageLoader} unoptimized src={theme.imageUrl} alt={item.name} fill sizes="80px" loading="lazy" className="rounded-[24px] object-cover opacity-85" /> : null}<div className="absolute inset-0 rounded-[24px]" style={patternStyle} /><div className="absolute inset-[12px] flex items-center justify-center rounded-[16px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-xl font-black text-white shadow-lg">{getItemInitial(item.name)}</div></div>;
    }
    return <CosmeticStaticCardThumbnail item={item} />;
});

function CosmeticStaticCardThumbnail({ item }: { item: CosmeticPreviewItem }) {
    if (item.type === "card_back") {
        const theme = resolveCardBackTheme({ renderSpecVersion: item.renderSpecVersion, renderMode: item.renderMode, imageUrl: item.imageUrl, templateKey: item.templateKey, templateConfig: item.templateConfig, rarity: item.rarity });
        const patternStyle = buildCosmeticPatternStyle({ pattern: theme.pattern, primaryColor: theme.borderColor, secondaryColor: theme.secondaryColor, scale: theme.patternScale, opacity: theme.patternOpacity });
        return (
            <div className="relative h-24 w-[74px] overflow-hidden rounded-[18px] bg-slate-950 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.5)]" data-cosmetic-thumbnail="fallback">
                {theme.overlayImageUrl ? <Image loader={passthroughImageLoader} unoptimized src={theme.overlayImageUrl} alt={item.name} fill sizes="74px" loading="lazy" className="object-cover opacity-85" /> : null}
                <div className="absolute inset-0" style={patternStyle} />
                <div className="absolute inset-[10%] rounded-[12px] border-2" style={{ borderColor: theme.borderColor }} />
                <div className="absolute inset-[22%] rounded-[8px] border" style={{ borderColor: theme.secondaryColor }} />
            </div>
        );
    }

    const theme = resolveCardFaceTheme({ renderSpecVersion: item.renderSpecVersion, renderMode: item.renderMode, imageUrl: item.imageUrl, templateKey: item.templateKey, templateConfig: item.templateConfig, rarity: item.rarity });
    const patternStyle = buildCosmeticPatternStyle({ pattern: theme.pattern, primaryColor: theme.borderColor, secondaryColor: theme.secondaryColor, scale: theme.patternScale, opacity: theme.patternOpacity });
    return (
        <div className="relative h-24 w-[74px] overflow-hidden rounded-[18px] bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.5)]" data-cosmetic-thumbnail="fallback">
            <div className="absolute inset-[7px] rounded-[12px] border-2" style={{ borderColor: theme.borderColor, ...patternStyle }} />
            <div className="absolute inset-x-[12px] top-[12px] h-5 rounded-md" style={{ backgroundColor: theme.accentColor }} />
            <div className="absolute inset-x-[18px] top-[44px] h-2 rounded-full bg-slate-900/15" />
            <div className="absolute inset-x-[20px] bottom-[15px] h-2 rounded-full" style={{ backgroundColor: theme.footerColor }} />
        </div>
    );
}

export function CosmeticLargePreview({
    item,
    enableFlipToggle = true,
}: {
    item: CosmeticPreviewItem;
    enableFlipToggle?: boolean;
}) {
    const { t } = useI18n();
    if (item.type === "avatar") {
        return <div className="flex min-h-[320px] items-center justify-center p-6"><div className="space-y-5 text-center"><div className="mx-auto flex h-36 w-36 items-center justify-center overflow-hidden rounded-[36px] border border-white/20 bg-gradient-to-br from-indigo-500 via-blue-500 to-cyan-400 shadow-[0_24px_60px_-34px_rgba(59,130,246,0.65)]">{item.imageUrl ? <Image loader={passthroughImageLoader} unoptimized src={item.imageUrl} alt={item.name} width={144} height={144} className="h-full w-full object-cover" /> : <span className="text-5xl font-black text-white">{getItemInitial(item.name)}</span>}</div><div><div className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">{t("cosmetics.playerTile")}</div><div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{item.name}</div></div></div></div>;
    }
    if (item.type === "frame") {
        const theme = resolveFrameTheme({ renderMode: item.renderMode, imageUrl: item.imageUrl, templateKey: item.templateKey, templateConfig: item.templateConfig, rarity: item.rarity });
        if (!theme) {
            return <div className="flex min-h-[320px] items-center justify-center p-6"><div className="flex h-56 w-56 items-center justify-center rounded-[44px] bg-slate-900 text-5xl font-black text-white">{getItemInitial(item.name)}</div></div>;
        }
        const patternStyle = buildCosmeticPatternStyle({ pattern: theme.pattern, primaryColor: theme.accentColor, secondaryColor: theme.secondaryColor, scale: theme.patternScale, opacity: theme.patternOpacity });
        return <div className="flex min-h-[320px] items-center justify-center p-6"><div className="relative flex h-56 w-56 items-center justify-center"><div className="absolute inset-0 rounded-[44px]" style={{ border: `${theme.thickness}px solid ${theme.accentColor}`, boxShadow: `0 0 ${theme.glowBlur}px ${applyHexAlpha(theme.glowColor, theme.glowOpacity)}` }} />{theme.frameStyle !== "solid" ? <div className="absolute inset-[14px] rounded-[34px] border" style={{ borderColor: theme.secondaryColor, opacity: theme.frameStyle === "double" ? 0.8 : 0.6 }} /> : null}{theme.imageUrl ? <Image loader={passthroughImageLoader} unoptimized src={theme.imageUrl} alt={item.name} fill className="rounded-[44px] object-cover opacity-85" /> : null}<div className={cn("absolute inset-0 rounded-[44px]", getCosmeticMotionClass(theme.motionPreset))} style={{ ...patternStyle, ...getCosmeticMotionStyle(theme.motionSpeedMs) }} /><div className="absolute inset-[34px] rounded-[28px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" /><div className="absolute inset-[58px] flex items-center justify-center rounded-[24px] bg-gradient-to-br from-indigo-500 via-blue-500 to-cyan-400 text-4xl font-black text-white shadow-lg">{getItemInitial(item.name)}</div></div></div>;
    }
    return <CosmeticCardFlipPreview item={item} enableFlipToggle={enableFlipToggle} />;
}

function CosmeticCardFlipPreview({
    item,
    enableFlipToggle,
}: {
    item: CosmeticPreviewItem;
    enableFlipToggle: boolean;
}) {
    const { t } = useI18n();
    const actualSide = item.type === "card_back" ? "back" : "front";
    const [isFlipEnabled, setIsFlipEnabled] = useState(true);
    const [isFlipped, setIsFlipped] = useState(actualSide === "back");
    const frontItem = useMemo(() => createCardSidePreviewItem(item, "front"), [item]);
    const backItem = useMemo(() => createCardSidePreviewItem(item, "back"), [item]);

    const handleCardClick = () => {
        if (!isFlipEnabled) {
            return;
        }

        setIsFlipped((current) => !current);
    };

    const handleFlipToggle = () => {
        setIsFlipEnabled((current) => {
            const next = !current;
            if (!next) {
                setIsFlipped(actualSide === "back");
            }
            return next;
        });
    };

    return (
        <div className="flex min-h-[320px] flex-col items-center justify-center p-6">
            {enableFlipToggle ? (
                <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
                    <button
                        type="button"
                        role="switch"
                        aria-checked={isFlipEnabled}
                        onClick={handleFlipToggle}
                        className={cn(
                            "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] transition-colors",
                            isFlipEnabled
                                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                                : "bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        )}
                    >
                        {t("cosmetics.flip")}
                        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] dark:bg-slate-900/20">
                            {isFlipEnabled ? t("cosmetics.enabled") : t("cosmetics.disabled")}
                        </span>
                    </button>
                </div>
            ) : null}
            <button
                type="button"
                onClick={handleCardClick}
                disabled={!isFlipEnabled}
                className={cn(
                    "relative h-[272px] w-[198px] cursor-pointer [perspective:1600px]",
                    !isFlipEnabled && "cursor-default"
                )}
                aria-label={isFlipEnabled ? t("cosmetics.flipCard") : undefined}
            >
                <div
                    className={cn(
                        "relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d]",
                        isFlipped ? "[transform:rotateY(180deg)]" : ""
                    )}
                >
                    <div className="absolute inset-0 overflow-hidden rounded-[30px] border border-white/30 bg-slate-950 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.65)] [backface-visibility:hidden]">
                        <CosmeticCardPreviewSurface item={frontItem} />
                    </div>
                    <div className="absolute inset-0 overflow-hidden rounded-[30px] border border-white/30 bg-slate-950 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.65)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
                        <CosmeticCardPreviewSurface item={backItem} />
                    </div>
                </div>
            </button>
            {enableFlipToggle ? (
                <div className="mt-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
                    {isFlipEnabled
                        ? t("cosmetics.flipEnabledHelp")
                        : t("cosmetics.flipDisabledHelp")}
                </div>
            ) : null}
        </div>
    );
}

function createCardSidePreviewItem(item: CosmeticPreviewItem, side: "front" | "back"): CosmeticPreviewItem {
    if (side === "front") {
        return item.type === "card_face"
            ? item
            : {
                  ...item,
                  type: "card_face",
                  renderMode: "template",
                  imageUrl: "",
                  templateKey: null,
                  templateConfig: null,
              };
    }

    return item.type === "card_back"
        ? item
        : {
              ...item,
              type: "card_back",
              renderMode: "template",
              imageUrl: "",
              templateKey: null,
              templateConfig: null,
          };
}

function CosmeticCardPreviewSurface({ item, compact = false }: { item: CosmeticPreviewItem; compact?: boolean }) {
    const { t } = useI18n();
    if (item.type === "card_back") {
        const theme = resolveCardBackTheme({ renderSpecVersion: item.renderSpecVersion, renderMode: item.renderMode, imageUrl: item.imageUrl, templateKey: item.templateKey, templateConfig: item.templateConfig, rarity: item.rarity });
        const patternStyle = buildCosmeticPatternStyle({ pattern: theme.pattern, primaryColor: theme.borderColor, secondaryColor: theme.secondaryColor, scale: theme.patternScale, opacity: theme.patternOpacity });
        return <div className="absolute inset-0 overflow-hidden rounded-[inherit] bg-[linear-gradient(180deg,rgba(15,23,42,0.94),rgba(30,41,59,0.98))]">{theme.overlayImageUrl ? <Image loader={passthroughImageLoader} unoptimized src={theme.overlayImageUrl} alt={item.name} fill className="object-cover opacity-90" /> : null}<div className={cn("absolute inset-0", getCosmeticMotionClass(theme.motionPreset))} style={{ ...patternStyle, ...getCosmeticMotionStyle(theme.motionSpeedMs) }} /><div className="absolute inset-[10%] rounded-[22px] border-2" style={{ borderColor: theme.borderColor }} /><div className="absolute inset-[20%] rounded-[16px] border" style={{ borderColor: theme.secondaryColor }} />{!compact ? <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white backdrop-blur-sm">{t("cosmetics.cardBack")}</div> : null}</div>;
    }

    const theme = resolveCardFaceTheme({ renderSpecVersion: item.renderSpecVersion, renderMode: item.renderMode, imageUrl: item.imageUrl, templateKey: item.templateKey, templateConfig: item.templateConfig, rarity: item.rarity });
    const patternStyle = buildCosmeticPatternStyle({ pattern: theme.pattern, primaryColor: theme.borderColor, secondaryColor: theme.secondaryColor, scale: theme.patternScale, opacity: theme.patternOpacity });
    const overlayStyle = theme.overlayImageUrl ? { backgroundImage: `linear-gradient(rgba(255,255,255,${theme.overlayOpacity * 0.7}), rgba(255,255,255,${theme.overlayOpacity * 0.7})), url(${theme.overlayImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined;
    const difficultyIcon = item.rarity === "legendary" ? Flame : item.rarity === "epic" ? Target : Sparkles;
    const DifficultyIcon = difficultyIcon;
    const tabooWords = compact ? ["IPUCU", "SEMBOL", "RENK"] : ["MIKROFON", "SEYIRCI", "ALKIS", "SAHNE", "SPOT"];

    return (
        <div className="absolute inset-0 overflow-hidden rounded-[inherit] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(241,245,249,0.96))] text-slate-900">
            <div className="absolute inset-0" style={overlayStyle} />
            <div
                className={cn("absolute inset-[10px] rounded-[20px] border-2", getCosmeticMotionClass(theme.motionPreset))}
                style={{ borderColor: theme.borderColor, ...patternStyle, ...getCosmeticMotionStyle(theme.motionSpeedMs) }}
            />
            <div className="absolute inset-[18px] rounded-[16px] border bg-white/70 backdrop-blur-[1px]" style={{ borderColor: theme.secondaryColor }} />
            <div className="relative z-10 flex h-full flex-col">
                <div className="relative overflow-hidden px-4 pb-4 pt-5" style={{ backgroundColor: theme.accentColor }}>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.22),transparent_42%)]" />
                    <div className="absolute right-4 top-4 z-10" title="Zorluk">
                        <DifficultyIcon className="h-4 w-4 text-white/90" />
                    </div>
                    <div
                        className={cn(
                            "relative z-10 text-center font-black uppercase tracking-[0.18em]",
                            compact ? "text-xl" : "text-[26px]"
                        )}
                        style={{ color: theme.wordColor }}
                    >
                        Hushle
                    </div>
                    <div className="mx-auto mt-3 h-1.5 w-16 rounded-full" style={{ backgroundColor: theme.borderColor }} />
                </div>
                <div className={cn("relative flex-1", compact ? "px-4 py-4" : "px-5 py-5")}>
                    <div className={cn("text-center font-black uppercase tracking-[0.16em]", compact ? "text-base" : "text-xl")} style={{ color: theme.wordColor }}>
                        SAHNE
                    </div>
                    <div className={cn("mt-4 space-y-2.5", compact ? "" : "mt-5")}>
                        {tabooWords.map((word) => (
                            <div key={word} className="flex items-center gap-2">
                                <span className="text-sm font-black" style={{ color: theme.tabooColor }}>X</span>
                                <span
                                    className={cn("font-bold uppercase tracking-wide", compact ? "text-[11px]" : "text-sm")}
                                    style={{ color: `${theme.wordColor}E0` }}
                                >
                                    {word}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="h-4 border-t" style={{ backgroundColor: theme.footerColor, borderColor: theme.borderColor }} />
            </div>
        </div>
    );
}
