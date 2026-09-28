import type { StoreItemType, TemplateConfig } from "@/types/economy";

export interface CosmeticAuthoringPreset {
    id: string;
    label: string;
    description: string;
    templateKey: string;
    config: TemplateConfig;
}

const PRESETS: Partial<Record<StoreItemType, CosmeticAuthoringPreset[]>> = {
    frame: [
        {
            id: "forest-ornate",
            label: "Forest Ornate",
            description: "Yumuşak pulse, halkalar ve süslü çift katman.",
            templateKey: "royal_ring",
            config: {
                palette: { primary: "#22c55e", secondary: "#bbf7d0" },
                pattern: { type: "rings", opacity: 0.22, scale: 14 },
                glow: { color: "#4ade80", blur: 24, opacity: 0.24 },
                frame: { style: "ornate", thickness: 3, radius: 20 },
                motion: { preset: "pulse", speedMs: 4200 },
            },
        },
        {
            id: "ember-edge",
            label: "Ember Edge",
            description: "Sıcak tonlu, çift çerçeveli ve düşük hareketli profil.",
            templateKey: "ember_edge",
            config: {
                palette: { primary: "#f97316", secondary: "#fed7aa" },
                pattern: { type: "diagonal", opacity: 0.18, scale: 18 },
                glow: { color: "#fb923c", blur: 20, opacity: 0.2 },
                frame: { style: "double", thickness: 4, radius: 22 },
                motion: { preset: "drift", speedMs: 6800 },
            },
        },
    ],
    card_back: [
        {
            id: "signal-vault",
            label: "Signal Vault",
            description: "Soğuk neon, chevron desen ve yavaş drift.",
            templateKey: "signal_vault",
            config: {
                palette: {
                    surface: "#111827",
                    border: "#38bdf8",
                    primary: "#22d3ee",
                    secondary: "#93c5fd",
                    title: "#f8fafc",
                    detail: "#cbd5e1",
                },
                pattern: { type: "chevrons", opacity: 0.2, scale: 18 },
                glow: { color: "#38bdf8", blur: 30, opacity: 0.22 },
                motion: { preset: "drift", speedMs: 6200 },
            },
        },
        {
            id: "ember-vault",
            label: "Ember Vault",
            description: "Koyu yüzey, sıcak halka deseni ve kontrollü pulse.",
            templateKey: "ember_vault",
            config: {
                palette: {
                    surface: "#1c1917",
                    border: "#fb923c",
                    primary: "#f97316",
                    secondary: "#fed7aa",
                    title: "#fff7ed",
                    detail: "#fdba74",
                },
                pattern: { type: "rings", opacity: 0.2, scale: 20 },
                glow: { color: "#f97316", blur: 26, opacity: 0.2 },
                motion: { preset: "pulse", speedMs: 4800 },
            },
        },
    ],
    card_face: [
        {
            id: "violet-signal",
            label: "Violet Signal",
            description: "Yüksek okunabilirlik, noise dokusu ve shimmer.",
            templateKey: "signal_grid",
            config: {
                palette: {
                    primary: "#8b5cf6",
                    secondary: "#ddd6fe",
                    surface: "#1e1b4b",
                    border: "#c4b5fd",
                    word: "#ffffff",
                    taboo: "#fda4af",
                    footer: "#ede9fe",
                },
                pattern: { type: "noise", opacity: 0.18, scale: 16 },
                glow: { color: "#a855f7", blur: 28, opacity: 0.2 },
                motion: { preset: "shimmer", speedMs: 3400 },
            },
        },
        {
            id: "ember-glow",
            label: "Ember Glow",
            description: "Sıcak vurgu, koyu zemin ve yavaş pulse.",
            templateKey: "ember_glow",
            config: {
                palette: {
                    primary: "#ea580c",
                    secondary: "#fed7aa",
                    surface: "#292524",
                    border: "#fb923c",
                    word: "#fff7ed",
                    taboo: "#fecaca",
                    footer: "#ffedd5",
                },
                pattern: { type: "diagonal", opacity: 0.16, scale: 18 },
                glow: { color: "#f97316", blur: 24, opacity: 0.18 },
                motion: { preset: "pulse", speedMs: 4600 },
            },
        },
    ],
};

export function getCosmeticAuthoringPresets(type: StoreItemType): CosmeticAuthoringPreset[] {
    return PRESETS[type]?.map((preset) => ({
        ...preset,
        config: structuredClone(preset.config),
    })) ?? [];
}

export function serializeCosmeticAuthoringPreset(preset: CosmeticAuthoringPreset): string {
    return JSON.stringify(preset.config, null, 2);
}
