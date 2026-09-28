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

export interface CardBackThemeSource {
    renderSpecVersion?: number;
    renderMode: StoreItemRenderMode;
    imageUrl: string;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
    rarity: StoreItemRarity;
}

export interface ResolvedCardBackTheme {
    renderSpecVersion: number;
    requestedRenderSpecVersion: number;
    usedRenderSpecFallback: boolean;
    surfaceColor: string;
    borderColor: string;
    accentColor: string;
    secondaryColor: string;
    titleColor: string;
    detailColor: string;
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

type CardBackVisualTheme = Omit<
    ResolvedCardBackTheme,
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

const rarityThemes: Record<StoreItemRarity, CardBackVisualTheme> = {
    common: {
        surfaceColor: "#0f172a",
        borderColor: "#475569",
        accentColor: "#94a3b8",
        secondaryColor: "#cbd5e1",
        titleColor: "#f8fafc",
        detailColor: "#cbd5e1",
        pattern: "none",
        patternOpacity: 0,
        patternScale: 18,
        motionPreset: "none",
        motionSpeedMs: 5000,
        glowColor: "#94a3b8",
        glowBlur: 22,
        glowOpacity: 0.18,
    },
    rare: {
        surfaceColor: "#082f49",
        borderColor: "#38bdf8",
        accentColor: "#7dd3fc",
        secondaryColor: "#67e8f9",
        titleColor: "#e0f2fe",
        detailColor: "#bae6fd",
        pattern: "grid",
        patternOpacity: 0.2,
        patternScale: 18,
        motionPreset: "drift",
        motionSpeedMs: 7000,
        glowColor: "#38bdf8",
        glowBlur: 24,
        glowOpacity: 0.2,
    },
    epic: {
        surfaceColor: "#2e1065",
        borderColor: "#a855f7",
        accentColor: "#c084fc",
        secondaryColor: "#ddd6fe",
        titleColor: "#f5f3ff",
        detailColor: "#ddd6fe",
        pattern: "dots",
        patternOpacity: 0.22,
        patternScale: 18,
        motionPreset: "pulse",
        motionSpeedMs: 5000,
        glowColor: "#a855f7",
        glowBlur: 28,
        glowOpacity: 0.24,
    },
    legendary: {
        surfaceColor: "#431407",
        borderColor: "#f97316",
        accentColor: "#fdba74",
        secondaryColor: "#fed7aa",
        titleColor: "#fff7ed",
        detailColor: "#fed7aa",
        pattern: "diagonal",
        patternOpacity: 0.24,
        patternScale: 20,
        motionPreset: "shimmer",
        motionSpeedMs: 3600,
        glowColor: "#fb923c",
        glowBlur: 32,
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

function getSafeRange(value: number | undefined, fallback: number, min: number, max: number): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, value));
}

function getSafeMotion(value: string | undefined, fallback: CosmeticMotionPreset): CosmeticMotionPreset {
    return value && supportedMotions.has(value as CosmeticMotionPreset)
        ? (value as CosmeticMotionPreset)
        : fallback;
}

function applyTemplateKey(
    baseTheme: CardBackVisualTheme,
    templateKey: string | null
): CardBackVisualTheme {
    switch (templateKey) {
        case "midnight_mesh":
            return {
                ...baseTheme,
                surfaceColor: "#111827",
                borderColor: "#60a5fa",
                accentColor: "#22d3ee",
                secondaryColor: "#93c5fd",
                pattern: "grid",
            };
        case "royal_seal":
            return {
                ...baseTheme,
                surfaceColor: "#312e81",
                borderColor: "#c4b5fd",
                accentColor: "#f59e0b",
                secondaryColor: "#ddd6fe",
                pattern: "dots",
            };
        case "ember_vault":
            return {
                ...baseTheme,
                surfaceColor: "#3f1d0f",
                borderColor: "#fb923c",
                accentColor: "#fdba74",
                secondaryColor: "#ffedd5",
                pattern: "diagonal",
            };
        default:
            return baseTheme;
    }
}

function resolveCardBackThemeV1(
    source: CardBackThemeSource | null,
    spec: CosmeticRenderSpecResolution
): ResolvedCardBackTheme {
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
        surfaceColor: getSafeColor(
            getTemplateString(config, ["palette", "surface"]) ?? getTemplateString(config, ["surfaceColor"]),
            keyedTheme.surfaceColor
        ),
        borderColor: getSafeColor(
            getTemplateString(config, ["palette", "border"]) ?? getTemplateString(config, ["borderColor"]),
            keyedTheme.borderColor
        ),
        accentColor: getSafeColor(
            getTemplateString(config, ["palette", "primary"]) ?? getTemplateString(config, ["accentColor"]),
            keyedTheme.accentColor
        ),
        secondaryColor: getSafeColor(
            getTemplateString(config, ["palette", "secondary"]),
            keyedTheme.secondaryColor
        ),
        titleColor: getSafeColor(
            getTemplateString(config, ["palette", "title"]) ?? getTemplateString(config, ["titleColor"]),
            keyedTheme.titleColor
        ),
        detailColor: getSafeColor(
            getTemplateString(config, ["palette", "detail"]) ?? getTemplateString(config, ["detailColor"]),
            keyedTheme.detailColor
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
            42
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
            ? 0.24
            : getSafeOpacity(
                getTemplateNumber(config, ["overlay", "opacity"]) ?? getTemplateNumber(config, ["overlayOpacity"]),
                0,
                0.45
            ),
    };
}

export function resolveCardBackTheme(source: CardBackThemeSource | null): ResolvedCardBackTheme {
    const spec = resolveCosmeticRenderSpecVersion(source?.renderSpecVersion);

    switch (spec.effectiveVersion) {
        case 1:
            return resolveCardBackThemeV1(source, spec);
    }
}
