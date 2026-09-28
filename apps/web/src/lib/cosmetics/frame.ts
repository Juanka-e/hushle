import {
    getTemplateNumber,
    getTemplateString,
} from "@/lib/cosmetics/template-config";
import type {
    CosmeticFrameStyle,
    CosmeticMotionPreset,
    CosmeticPattern,
    StoreItemRarity,
    StoreItemRenderMode,
    TemplateConfig,
} from "@/types/economy";

export interface FrameThemeSource {
    renderMode: StoreItemRenderMode;
    imageUrl: string;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
    rarity: StoreItemRarity;
}

export interface ResolvedFrameTheme {
    accentColor: string;
    secondaryColor: string;
    imageUrl: string | null;
    pattern: CosmeticPattern;
    patternOpacity: number;
    patternScale: number;
    glowColor: string;
    glowBlur: number;
    glowOpacity: number;
    frameStyle: CosmeticFrameStyle;
    thickness: number;
    radius: number;
    motionPreset: CosmeticMotionPreset;
    motionSpeedMs: number;
}

const safeHexColorPattern = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const supportedPatterns = new Set<CosmeticPattern>([
    "none",
    "grid",
    "dots",
    "diagonal",
    "chevrons",
    "rings",
    "noise",
]);
const supportedFrameStyles = new Set<CosmeticFrameStyle>(["solid", "double", "ornate"]);
const supportedMotions = new Set<CosmeticMotionPreset>(["none", "pulse", "drift", "shimmer"]);

const rarityThemes: Record<
    StoreItemRarity,
    Omit<ResolvedFrameTheme, "imageUrl">
> = {
    common: {
        accentColor: "#94a3b8",
        secondaryColor: "#e2e8f0",
        pattern: "none",
        patternOpacity: 0,
        patternScale: 16,
        glowColor: "#94a3b8",
        glowBlur: 18,
        glowOpacity: 0.12,
        frameStyle: "solid",
        thickness: 2,
        radius: 16,
        motionPreset: "none",
        motionSpeedMs: 5000,
    },
    rare: {
        accentColor: "#38bdf8",
        secondaryColor: "#67e8f9",
        pattern: "grid",
        patternOpacity: 0.16,
        patternScale: 14,
        glowColor: "#38bdf8",
        glowBlur: 20,
        glowOpacity: 0.18,
        frameStyle: "double",
        thickness: 2,
        radius: 18,
        motionPreset: "drift",
        motionSpeedMs: 7000,
    },
    epic: {
        accentColor: "#a855f7",
        secondaryColor: "#d8b4fe",
        pattern: "dots",
        patternOpacity: 0.22,
        patternScale: 14,
        glowColor: "#a855f7",
        glowBlur: 24,
        glowOpacity: 0.22,
        frameStyle: "double",
        thickness: 3,
        radius: 18,
        motionPreset: "pulse",
        motionSpeedMs: 4800,
    },
    legendary: {
        accentColor: "#f59e0b",
        secondaryColor: "#fde68a",
        pattern: "chevrons",
        patternOpacity: 0.26,
        patternScale: 12,
        glowColor: "#fb923c",
        glowBlur: 28,
        glowOpacity: 0.28,
        frameStyle: "ornate",
        thickness: 3,
        radius: 20,
        motionPreset: "shimmer",
        motionSpeedMs: 3600,
    },
};

function getSafeColor(value: TemplateConfig[string] | undefined, fallback: string): string {
    return typeof value === "string" && safeHexColorPattern.test(value) ? value : fallback;
}

function getSafePattern(value: string | undefined, fallback: CosmeticPattern): CosmeticPattern {
    return value && supportedPatterns.has(value as CosmeticPattern)
        ? (value as CosmeticPattern)
        : fallback;
}

function getSafeMotion(value: string | undefined, fallback: CosmeticMotionPreset): CosmeticMotionPreset {
    return value && supportedMotions.has(value as CosmeticMotionPreset)
        ? (value as CosmeticMotionPreset)
        : fallback;
}

function getSafeFrameStyle(value: string | undefined, fallback: CosmeticFrameStyle): CosmeticFrameStyle {
    return value && supportedFrameStyles.has(value as CosmeticFrameStyle)
        ? (value as CosmeticFrameStyle)
        : fallback;
}

function getSafeRange(value: number | undefined, fallback: number, min: number, max: number): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, value));
}

function getSafeOpacity(value: number | undefined, fallback: number, max: number): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return fallback;
    }

    return Math.min(max, Math.max(0, value));
}

function applyTemplateKey(
    rarityTheme: Omit<ResolvedFrameTheme, "imageUrl">,
    templateKey: string | null
): Omit<ResolvedFrameTheme, "imageUrl"> {
    switch (templateKey) {
        case "royal_ring":
            return {
                ...rarityTheme,
                accentColor: "#8b5cf6",
                secondaryColor: "#ddd6fe",
                frameStyle: "ornate",
            };
        case "glacier_edge":
            return {
                ...rarityTheme,
                accentColor: "#0ea5e9",
                secondaryColor: "#67e8f9",
                pattern: "grid",
            };
        case "ember_edge":
            return {
                ...rarityTheme,
                accentColor: "#f97316",
                secondaryColor: "#fdba74",
                pattern: "diagonal",
            };
        default:
            return rarityTheme;
    }
}

export function resolveFrameTheme(source: FrameThemeSource | null): ResolvedFrameTheme | null {
    if (!source) {
        return null;
    }

    const rarityTheme = rarityThemes[source.rarity];
    const keyedTheme = applyTemplateKey(rarityTheme, source.templateKey);
    const config = source.templateConfig ?? {};

    return {
        accentColor: getSafeColor(
            getTemplateString(config, ["palette", "primary"]) ?? getTemplateString(config, ["accentColor"]),
            keyedTheme.accentColor
        ),
        secondaryColor: getSafeColor(
            getTemplateString(config, ["palette", "secondary"]),
            keyedTheme.secondaryColor
        ),
        imageUrl: source.renderMode === "image" && source.imageUrl ? source.imageUrl : null,
        pattern: getSafePattern(
            getTemplateString(config, ["pattern", "type"]) ?? getTemplateString(config, ["texture"]),
            keyedTheme.pattern
        ),
        patternOpacity: getSafeOpacity(
            getTemplateNumber(config, ["pattern", "opacity"]),
            keyedTheme.patternOpacity,
            0.4
        ),
        patternScale: getSafeRange(
            getTemplateNumber(config, ["pattern", "scale"]),
            keyedTheme.patternScale,
            8,
            36
        ),
        glowColor: getSafeColor(
            getTemplateString(config, ["glow", "color"]),
            keyedTheme.glowColor
        ),
        glowBlur: getSafeRange(
            getTemplateNumber(config, ["glow", "blur"]),
            keyedTheme.glowBlur,
            8,
            40
        ),
        glowOpacity: getSafeOpacity(
            getTemplateNumber(config, ["glow", "opacity"]),
            keyedTheme.glowOpacity,
            0.35
        ),
        frameStyle: getSafeFrameStyle(
            getTemplateString(config, ["frame", "style"]),
            keyedTheme.frameStyle
        ),
        thickness: getSafeRange(
            getTemplateNumber(config, ["frame", "thickness"]),
            keyedTheme.thickness,
            2,
            6
        ),
        radius: getSafeRange(
            getTemplateNumber(config, ["frame", "radius"]),
            keyedTheme.radius,
            12,
            24
        ),
        motionPreset: getSafeMotion(
            getTemplateString(config, ["motion", "preset"]),
            keyedTheme.motionPreset
        ),
        motionSpeedMs: getSafeRange(
            getTemplateNumber(config, ["motion", "speedMs"]),
            keyedTheme.motionSpeedMs,
            1800,
            12000
        ),
    };
}
