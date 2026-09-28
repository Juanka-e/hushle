import {
    getTemplateNumber,
    getTemplateString,
} from "@/lib/cosmetics/template-config";
import {
    resolveCosmeticRenderSpecVersion,
    type CosmeticRenderSpecResolution,
} from "@/lib/cosmetics/render-spec-version";
import type {
    CosmeticMotionPreset,
    CosmeticPattern,
    StoreItemRarity,
    StoreItemRenderMode,
    TemplateConfig,
} from "@/types/economy";

export interface CardFaceThemeSource {
    renderSpecVersion?: number;
    renderMode: StoreItemRenderMode;
    imageUrl: string;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
    rarity: StoreItemRarity;
}

export interface ResolvedCardFaceTheme {
    renderSpecVersion: number;
    requestedRenderSpecVersion: number;
    usedRenderSpecFallback: boolean;
    accentColor: string;
    secondaryColor: string;
    surfaceColor: string;
    borderColor: string;
    wordColor: string;
    tabooColor: string;
    footerColor: string;
    pattern: CosmeticPattern;
    patternOpacity: number;
    patternScale: number;
    motionPreset: CosmeticMotionPreset;
    motionSpeedMs: number;
    glowColor: string;
    glowBlur: number;
    glowOpacity: number;
    overlayImageUrl: string | null;
    overlayOpacity: number;
}

type CardFaceVisualTheme = Omit<
    ResolvedCardFaceTheme,
    | "renderSpecVersion"
    | "requestedRenderSpecVersion"
    | "usedRenderSpecFallback"
    | "overlayImageUrl"
    | "overlayOpacity"
>;

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
const supportedMotions = new Set<CosmeticMotionPreset>(["none", "pulse", "drift", "shimmer"]);

const rarityThemes: Record<StoreItemRarity, CardFaceVisualTheme> = {
    common: {
        accentColor: "#64748b",
        secondaryColor: "#cbd5e1",
        surfaceColor: "#f8fafc",
        borderColor: "#cbd5e1",
        wordColor: "#ffffff",
        tabooColor: "#dc2626",
        footerColor: "#e2e8f0",
        pattern: "none",
        patternOpacity: 0,
        patternScale: 18,
        motionPreset: "none",
        motionSpeedMs: 5000,
        glowColor: "#94a3b8",
        glowBlur: 24,
        glowOpacity: 0.22,
    },
    rare: {
        accentColor: "#2563eb",
        secondaryColor: "#67e8f9",
        surfaceColor: "#0f172a",
        borderColor: "#60a5fa",
        wordColor: "#ffffff",
        tabooColor: "#f87171",
        footerColor: "#dbeafe",
        pattern: "grid",
        patternOpacity: 0.2,
        patternScale: 18,
        motionPreset: "drift",
        motionSpeedMs: 7200,
        glowColor: "#38bdf8",
        glowBlur: 26,
        glowOpacity: 0.2,
    },
    epic: {
        accentColor: "#7c3aed",
        secondaryColor: "#c084fc",
        surfaceColor: "#1e1b4b",
        borderColor: "#c084fc",
        wordColor: "#ffffff",
        tabooColor: "#fda4af",
        footerColor: "#ede9fe",
        pattern: "dots",
        patternOpacity: 0.22,
        patternScale: 18,
        motionPreset: "pulse",
        motionSpeedMs: 5200,
        glowColor: "#a855f7",
        glowBlur: 30,
        glowOpacity: 0.24,
    },
    legendary: {
        accentColor: "#ea580c",
        secondaryColor: "#fdba74",
        surfaceColor: "#431407",
        borderColor: "#fdba74",
        wordColor: "#fff7ed",
        tabooColor: "#fecaca",
        footerColor: "#ffedd5",
        pattern: "diagonal",
        patternOpacity: 0.26,
        patternScale: 20,
        motionPreset: "shimmer",
        motionSpeedMs: 3600,
        glowColor: "#fb923c",
        glowBlur: 34,
        glowOpacity: 0.28,
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

function getSafeOpacity(value: number | undefined, fallback: number, max: number): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return fallback;
    }
    return Math.min(max, Math.max(0, value));
}

function getSafeMotion(value: string | undefined, fallback: CosmeticMotionPreset): CosmeticMotionPreset {
    return value && supportedMotions.has(value as CosmeticMotionPreset)
        ? (value as CosmeticMotionPreset)
        : fallback;
}

function getSafeRange(value: number | undefined, fallback: number, min: number, max: number): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, value));
}

function applyTemplateKey(baseTheme: CardFaceVisualTheme, templateKey: string | null): CardFaceVisualTheme {
    switch (templateKey) {
        case "signal_grid":
            return {
                ...baseTheme,
                accentColor: "#0ea5e9",
                secondaryColor: "#67e8f9",
                borderColor: "#67e8f9",
                pattern: "grid" as const,
            };
        case "ember_glow":
            return {
                ...baseTheme,
                accentColor: "#f97316",
                secondaryColor: "#fdba74",
                borderColor: "#fdba74",
                surfaceColor: "#431407",
                pattern: "diagonal" as const,
                motionPreset: "shimmer" as const,
            };
        case "royal_velvet":
            return {
                ...baseTheme,
                accentColor: "#8b5cf6",
                secondaryColor: "#ddd6fe",
                borderColor: "#c4b5fd",
                surfaceColor: "#312e81",
                pattern: "dots" as const,
            };
        default:
            return baseTheme;
    }
}

function resolveCardFaceThemeV1(
    source: CardFaceThemeSource | null,
    spec: CosmeticRenderSpecResolution
): ResolvedCardFaceTheme {
    const fallbackBase = rarityThemes.rare;

    if (!source) {
        return {
            renderSpecVersion: spec.effectiveVersion,
            requestedRenderSpecVersion: spec.requestedVersion,
            usedRenderSpecFallback: spec.usedFallback,
            ...fallbackBase,
            overlayImageUrl: null,
            overlayOpacity: 0,
        };
    }

    const rarityBase = rarityThemes[source.rarity];
    const keyedTheme = applyTemplateKey(rarityBase, source.templateKey);
    const config = source.templateConfig ?? {};

    return {
        renderSpecVersion: spec.effectiveVersion,
        requestedRenderSpecVersion: spec.requestedVersion,
        usedRenderSpecFallback: spec.usedFallback,
        accentColor: getSafeColor(
            getTemplateString(config, ["palette", "primary"]) ?? getTemplateString(config, ["accentColor"]),
            keyedTheme.accentColor
        ),
        secondaryColor: getSafeColor(
            getTemplateString(config, ["palette", "secondary"]),
            keyedTheme.secondaryColor
        ),
        surfaceColor: getSafeColor(
            getTemplateString(config, ["palette", "surface"]) ?? getTemplateString(config, ["surfaceColor"]),
            keyedTheme.surfaceColor
        ),
        borderColor: getSafeColor(
            getTemplateString(config, ["palette", "border"]) ?? getTemplateString(config, ["borderColor"]),
            keyedTheme.borderColor
        ),
        wordColor: getSafeColor(
            getTemplateString(config, ["palette", "word"]) ?? getTemplateString(config, ["wordColor"]),
            keyedTheme.wordColor
        ),
        tabooColor: getSafeColor(
            getTemplateString(config, ["palette", "taboo"]) ?? getTemplateString(config, ["tabooColor"]),
            keyedTheme.tabooColor
        ),
        footerColor: getSafeColor(
            getTemplateString(config, ["palette", "footer"]) ?? getTemplateString(config, ["footerColor"]),
            keyedTheme.footerColor
        ),
        pattern: getSafePattern(
            getTemplateString(config, ["pattern", "type"]) ?? getTemplateString(config, ["texture"]),
            keyedTheme.pattern
        ),
        patternOpacity: getSafeOpacity(
            getTemplateNumber(config, ["pattern", "opacity"]),
            keyedTheme.patternOpacity,
            0.42
        ),
        patternScale: getSafeRange(
            getTemplateNumber(config, ["pattern", "scale"]),
            keyedTheme.patternScale,
            8,
            40
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
        glowColor: getSafeColor(
            getTemplateString(config, ["glow", "color"]),
            keyedTheme.glowColor
        ),
        glowBlur: getSafeRange(
            getTemplateNumber(config, ["glow", "blur"]),
            keyedTheme.glowBlur,
            8,
            56
        ),
        glowOpacity: getSafeOpacity(
            getTemplateNumber(config, ["glow", "opacity"]),
            keyedTheme.glowOpacity,
            0.36
        ),
        overlayImageUrl: source.renderMode === "image" && source.imageUrl ? source.imageUrl : null,
        overlayOpacity: source.renderMode === "image"
            ? 0.18
            : getSafeOpacity(
                getTemplateNumber(config, ["overlay", "opacity"]) ?? getTemplateNumber(config, ["overlayOpacity"]),
                0,
                0.35
            ),
    };
}

export function resolveCardFaceTheme(source: CardFaceThemeSource | null): ResolvedCardFaceTheme {
    const spec = resolveCosmeticRenderSpecVersion(source?.renderSpecVersion);

    switch (spec.effectiveVersion) {
        case 1:
            return resolveCardFaceThemeV1(source, spec);
    }
}
