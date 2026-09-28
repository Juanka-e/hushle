"use client";

import type { CSSProperties } from "react";
import Image, { type ImageLoaderProps } from "next/image";
import { Flame, Sparkles, Stars, Target } from "lucide-react";
import { CoinMark } from "@/components/ui/coin-badge";
import { resolveCardBackTheme } from "@/lib/cosmetics/card-back";
import { resolveCardFaceTheme } from "@/lib/cosmetics/card-face";
import { getCosmeticMotionClass, getCosmeticMotionStyle, buildCosmeticPatternStyle } from "@/lib/cosmetics/effects";
import { resolveFrameTheme } from "@/lib/cosmetics/frame";
import { cn } from "@/lib/utils";
import type { StoreItemRarity, StoreItemRenderMode, StoreItemType, TemplateConfig } from "@/types/economy";

const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;

export interface CosmeticPreviewDraft {
    type: StoreItemType;
    name: string;
    rarity: StoreItemRarity;
    renderMode: StoreItemRenderMode;
    renderSpecVersion: number;
    imageUrl: string;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
    badgeText: string | null;
    isFeatured: boolean;
    priceCoin: number;
}

interface CosmeticLivePreviewProps {
    draft: CosmeticPreviewDraft;
    templateConfigError?: string | null;
}

const rarityShellClass: Record<StoreItemRarity, string> = {
    common: "border-slate-200/80 bg-slate-100/70 text-slate-700 dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-200",
    rare: "border-sky-200/80 bg-sky-50/90 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300",
    epic: "border-fuchsia-200/80 bg-fuchsia-50/90 text-fuchsia-700 dark:border-fuchsia-900/50 dark:bg-fuchsia-950/30 dark:text-fuchsia-300",
    legendary: "border-amber-200/80 bg-amber-50/90 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300",
};

const rarityChipClass: Record<StoreItemRarity, string> = {
    common: "bg-slate-600 text-white",
    rare: "bg-sky-600 text-white",
    epic: "bg-fuchsia-600 text-white",
    legendary: "bg-amber-500 text-slate-950",
};

function getInitial(value: string): string {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "T";
}

function createOverlayStyle(imageUrl: string | null, opacity: number): CSSProperties | undefined {
    if (!imageUrl) {
        return undefined;
    }

    return {
        backgroundImage: `linear-gradient(rgba(15, 23, 42, ${opacity * 0.36}), rgba(15, 23, 42, ${opacity * 0.36})), url(${imageUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
    };
}

export function CosmeticLivePreview({
    draft,
    templateConfigError = null,
}: CosmeticLivePreviewProps) {
    return (
        <aside className="space-y-4 rounded-[28px] border border-border/70 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-5 text-slate-100 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.8)]">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">
                        Live Preview
                    </div>
                    <h3 className="mt-2 text-xl font-black tracking-tight text-white">
                        {draft.name.trim() || "Untitled Cosmetic"}
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                        Oyun ici render mantigina yakin onizleme.
                    </p>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em]", rarityChipClass[draft.rarity])}>
                    {draft.rarity}
                </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className={cn("rounded-2xl border px-3 py-3", rarityShellClass[draft.rarity])}>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">Type</div>
                    <div className="mt-2 text-sm font-black capitalize">{draft.type.replace("_", " ")}</div>
                </div>
                <div className={cn("rounded-2xl border px-3 py-3", draft.isFeatured ? "border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-100" : "border-slate-700/70 bg-slate-900/70 text-slate-200")}>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">Merch</div>
                    <div className="mt-2 flex items-center gap-2 text-sm font-black">
                        {draft.isFeatured ? <Stars className="h-4 w-4" /> : null}
                        {draft.isFeatured ? "Spotlight" : "Standard"}
                    </div>
                </div>
            </div>

            <div className="rounded-2xl border border-slate-700/70 bg-slate-900/70 px-3 py-3 text-slate-200">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">Render Spec</div>
                <div className="mt-2 text-sm font-black">v{draft.renderSpecVersion}</div>
            </div>

            <div className="rounded-[26px] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_58%)] p-4">
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                        <Sparkles className="h-3.5 w-3.5" />
                        Stage
                    </div>
                    {draft.badgeText ? (
                        <span className="rounded-full bg-blue-500 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                            {draft.badgeText}
                        </span>
                    ) : null}
                </div>
                <PreviewStage draft={draft} />
            </div>

            <div className="rounded-[26px] border border-white/10 bg-slate-950/70 p-4">
                <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                    Shop Card Snapshot
                </div>
                <ShopCardMini draft={draft} />
            </div>

            {templateConfigError ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    Template config error: {templateConfigError}
                </div>
            ) : null}
        </aside>
    );
}

function PreviewStage({ draft }: { draft: CosmeticPreviewDraft }) {
    if (draft.type === "avatar") {
        return <AvatarPreview draft={draft} />;
    }

    if (draft.type === "frame") {
        return <FramePreview draft={draft} />;
    }

    if (draft.type === "card_back") {
        return <CardBackPreview draft={draft} />;
    }

    return <CardFacePreview draft={draft} />;
}

function AvatarPreview({ draft }: { draft: CosmeticPreviewDraft }) {
    return (
        <div className="flex min-h-[280px] items-center justify-center rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(96,165,250,0.16),_transparent_55%),linear-gradient(160deg,rgba(15,23,42,0.92),rgba(30,41,59,0.96))] p-6">
            <div className="space-y-5 text-center">
                <div className="mx-auto flex h-32 w-32 items-center justify-center overflow-hidden rounded-[32px] border border-white/15 bg-gradient-to-br from-indigo-500 via-blue-500 to-cyan-400 shadow-[0_24px_60px_-34px_rgba(59,130,246,0.65)]">
                    {draft.imageUrl ? (
                        <Image
                            loader={passthroughImageLoader}
                            unoptimized
                            src={draft.imageUrl}
                            alt={draft.name}
                            width={128}
                            height={128}
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <span className="text-4xl font-black text-white">{getInitial(draft.name)}</span>
                    )}
                </div>
                <div>
                    <div className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">Player Tile</div>
                    <div className="mt-2 text-lg font-black text-white">{draft.name.trim() || "Avatar Preview"}</div>
                </div>
            </div>
        </div>
    );
}

function FramePreview({ draft }: { draft: CosmeticPreviewDraft }) {
    const theme = resolveFrameTheme({
        renderMode: draft.renderMode,
        imageUrl: draft.imageUrl,
        templateKey: draft.templateKey,
        templateConfig: draft.templateConfig,
        rarity: draft.rarity,
    });

    if (!theme) {
        return null;
    }

    const patternStyle = buildCosmeticPatternStyle({
        pattern: theme.pattern,
        primaryColor: theme.accentColor,
        secondaryColor: theme.secondaryColor,
        scale: theme.patternScale,
        opacity: theme.patternOpacity,
    });
    const motionClass = getCosmeticMotionClass(theme.motionPreset);
    const motionStyle = getCosmeticMotionStyle(theme.motionSpeedMs);

    return (
        <div className="flex min-h-[280px] items-center justify-center rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(192,132,252,0.18),_transparent_55%),linear-gradient(160deg,rgba(15,23,42,0.92),rgba(30,41,59,0.96))] p-6">
            <div className="relative flex h-44 w-44 items-center justify-center">
                <div
                    className="absolute inset-0 rounded-[34px]"
                    style={{
                        border: `${theme.thickness}px solid ${theme.accentColor}`,
                        boxShadow: `0 0 ${theme.glowBlur}px ${theme.glowColor}${Math.round(theme.glowOpacity * 255).toString(16).padStart(2, "0")}`,
                    }}
                />
                {theme.frameStyle !== "solid" ? (
                    <div
                        className="absolute inset-[10px] rounded-[28px] border"
                        style={{
                            borderColor: theme.secondaryColor,
                            opacity: theme.frameStyle === "double" ? 0.8 : 0.6,
                        }}
                    />
                ) : null}
                {theme.frameStyle === "ornate" ? (
                    <>
                        <div className="absolute left-2 top-2 h-4 w-4 rounded-full border" style={{ borderColor: theme.secondaryColor }} />
                        <div className="absolute right-2 top-2 h-4 w-4 rounded-full border" style={{ borderColor: theme.secondaryColor }} />
                        <div className="absolute bottom-2 left-2 h-4 w-4 rounded-full border" style={{ borderColor: theme.secondaryColor }} />
                        <div className="absolute bottom-2 right-2 h-4 w-4 rounded-full border" style={{ borderColor: theme.secondaryColor }} />
                    </>
                ) : null}
                {theme.imageUrl ? (
                    <Image
                        loader={passthroughImageLoader}
                        unoptimized
                        src={theme.imageUrl}
                        alt={draft.name}
                        fill
                        className="rounded-[34px] object-cover opacity-85"
                    />
                ) : null}
                {patternStyle ? (
                    <div className={cn("absolute inset-0 rounded-[34px]", motionClass)} style={{ ...patternStyle, ...motionStyle }} />
                ) : null}
                <div className="absolute inset-[26px] rounded-[24px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
                <div className="absolute inset-[42px] flex items-center justify-center rounded-[20px] bg-gradient-to-br from-indigo-500 via-blue-500 to-cyan-400 text-3xl font-black text-white shadow-lg">
                    {getInitial(draft.name)}
                </div>
            </div>
        </div>
    );
}

function CardFacePreview({ draft }: { draft: CosmeticPreviewDraft }) {
    const theme = resolveCardFaceTheme({
        renderSpecVersion: draft.renderSpecVersion,
        renderMode: draft.renderMode,
        imageUrl: draft.imageUrl,
        templateKey: draft.templateKey,
        templateConfig: draft.templateConfig,
        rarity: draft.rarity,
    });
    const patternStyle = buildCosmeticPatternStyle({
        pattern: theme.pattern,
        primaryColor: theme.borderColor,
        secondaryColor: theme.secondaryColor,
        scale: theme.patternScale,
        opacity: theme.patternOpacity,
    });
    const motionClass = getCosmeticMotionClass(theme.motionPreset);
    const motionStyle = getCosmeticMotionStyle(theme.motionSpeedMs);
    const DifficultyIcon = draft.rarity === "legendary" ? Flame : draft.rarity === "epic" ? Target : Sparkles;

    return (
        <div className="flex min-h-[280px] items-center justify-center rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(168,85,247,0.18),_transparent_55%),linear-gradient(160deg,rgba(15,23,42,0.92),rgba(30,41,59,0.96))] p-6">
            <div
                className="relative h-[248px] w-[186px] overflow-hidden rounded-[28px] border-[3px] shadow-[0_28px_90px_-48px_rgba(168,85,247,0.8)]"
                style={{
                    borderColor: theme.borderColor,
                    backgroundColor: theme.surfaceColor,
                    boxShadow: `0 0 ${theme.glowBlur}px ${theme.glowColor}${Math.round(theme.glowOpacity * 255).toString(16).padStart(2, "0")}`,
                }}
            >
                {theme.overlayImageUrl ? (
                    <div className="absolute inset-0" style={createOverlayStyle(theme.overlayImageUrl, theme.overlayOpacity)} />
                ) : null}
                {patternStyle ? (
                    <div className={cn("absolute inset-0", motionClass)} style={{ ...patternStyle, ...motionStyle }} />
                ) : null}
                <div className="relative z-10 flex h-full flex-col">
                    <div className="relative overflow-hidden px-4 pb-4 pt-5" style={{ backgroundColor: theme.accentColor }}>
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.22),transparent_42%)]" />
                        <div className="absolute right-4 top-4">
                            <DifficultyIcon className="h-4 w-4 text-white/90" />
                        </div>
                        <div className="text-center text-[28px] font-black uppercase tracking-[0.18em]" style={{ color: theme.wordColor }}>
                            HUSHLE
                        </div>
                        <div className="mx-auto mt-3 h-1.5 w-16 rounded-full" style={{ backgroundColor: theme.borderColor }} />
                    </div>
                    <div className="flex-1 px-5 py-5">
                        <div className="text-center text-lg font-black uppercase tracking-[0.16em]" style={{ color: theme.wordColor }}>
                            SAHNE
                        </div>
                        <div className="space-y-3">
                            {["MIKROFON", "SEYIRCI", "ALKIS", "SPOT", "PERDE"].map((word) => (
                                <div key={word} className="flex items-center gap-2">
                                    <span className="text-sm font-black" style={{ color: theme.tabooColor }}>X</span>
                                    <span className="text-sm font-bold uppercase tracking-wide" style={{ color: `${theme.wordColor}E0` }}>
                                        {word}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="h-4 border-t" style={{ backgroundColor: theme.footerColor, borderColor: theme.borderColor }} />
                </div>
            </div>
        </div>
    );
}

function CardBackPreview({ draft }: { draft: CosmeticPreviewDraft }) {
    const theme = resolveCardBackTheme({
        renderSpecVersion: draft.renderSpecVersion,
        renderMode: draft.renderMode,
        imageUrl: draft.imageUrl,
        templateKey: draft.templateKey,
        templateConfig: draft.templateConfig,
        rarity: draft.rarity,
    });
    const patternStyle = buildCosmeticPatternStyle({
        pattern: theme.pattern,
        primaryColor: theme.borderColor,
        secondaryColor: theme.secondaryColor,
        scale: theme.patternScale,
        opacity: theme.patternOpacity,
    });
    const motionClass = getCosmeticMotionClass(theme.motionPreset);
    const motionStyle = getCosmeticMotionStyle(theme.motionSpeedMs);

    return (
        <div className="flex min-h-[280px] items-center justify-center rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(251,146,60,0.18),_transparent_55%),linear-gradient(160deg,rgba(15,23,42,0.92),rgba(30,41,59,0.96))] p-6">
            <div
                className="relative h-[248px] w-[186px] overflow-hidden rounded-[28px] border-[3px]"
                style={{
                    borderColor: theme.borderColor,
                    backgroundColor: theme.surfaceColor,
                    boxShadow: `0 0 ${theme.glowBlur}px ${theme.glowColor}${Math.round(theme.glowOpacity * 255).toString(16).padStart(2, "0")}`,
                }}
            >
                {theme.overlayImageUrl ? (
                    <div className="absolute inset-0" style={createOverlayStyle(theme.overlayImageUrl, theme.overlayOpacity)} />
                ) : null}
                {patternStyle ? (
                    <div className={cn("absolute inset-0", motionClass)} style={{ ...patternStyle, ...motionStyle }} />
                ) : null}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_44%)]" />
                <div className="relative z-10 flex h-full flex-col items-center justify-between px-5 py-6">
                    <div className="text-[11px] font-black uppercase tracking-[0.32em]" style={{ color: theme.detailColor }}>
                        CARD BACK
                    </div>
                    <div className="flex h-24 w-24 items-center justify-center rounded-full border text-center" style={{ borderColor: theme.accentColor, color: theme.titleColor, backgroundColor: `${theme.accentColor}22` }}>
                        <div className="text-xs font-black uppercase tracking-[0.24em]">Tabu</div>
                    </div>
                    <div className="space-y-2 text-center">
                        <div className="text-base font-black uppercase tracking-[0.22em]" style={{ color: theme.titleColor }}>
                            {draft.name.trim() || "Card Back"}
                        </div>
                        <div className="text-[11px] font-medium uppercase tracking-[0.18em]" style={{ color: theme.detailColor }}>
                            Template / image blended preview
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ShopCardMini({ draft }: { draft: CosmeticPreviewDraft }) {
    return (
        <div className={cn(
            "rounded-[24px] border p-4 transition-all",
            draft.isFeatured
                ? "border-fuchsia-400/40 bg-gradient-to-b from-white/8 to-fuchsia-500/10"
                : "border-white/10 bg-white/5"
        )}>
            <div className="relative overflow-hidden rounded-[20px] border border-white/10 bg-slate-900/70 p-3">
                {draft.badgeText ? (
                    <span className="absolute left-3 top-3 rounded-full bg-blue-500 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                        {draft.badgeText}
                    </span>
                ) : null}
                <div className="absolute right-3 top-3 rounded-full bg-white/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-100">
                    {draft.rarity}
                </div>
                <div className="flex h-28 items-center justify-center rounded-[18px] bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
                    {draft.imageUrl ? (
                        <Image
                            loader={passthroughImageLoader}
                            unoptimized
                            src={draft.imageUrl}
                            alt={draft.name}
                            width={96}
                            height={96}
                            className="h-20 w-20 rounded-full object-cover shadow-lg"
                        />
                    ) : (
                        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-2xl font-black text-white shadow-lg">
                            {getInitial(draft.name)}
                        </div>
                    )}
                </div>
            </div>
            <div className="mt-4 flex items-start justify-between gap-3">
                <div>
                    <div className="text-sm font-black text-white">{draft.name.trim() || "Untitled Cosmetic"}</div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {draft.type.replace("_", " ")}
                    </div>
                </div>
                <div className="flex items-center gap-1 text-sm font-black text-amber-300">
                    {draft.priceCoin.toLocaleString()}
                    <CoinMark className="h-4 w-4 ring-0 shadow-none" iconClassName="h-2.5 w-2.5" />
                </div>
            </div>
        </div>
    );
}
