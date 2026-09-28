import type { CSSProperties } from "react";
import type { CosmeticMotionPreset, CosmeticPattern } from "@/types/economy";

interface CosmeticPatternStyleOptions {
    pattern: CosmeticPattern;
    primaryColor: string;
    secondaryColor: string;
    scale: number;
    opacity: number;
}

export function getCosmeticMotionClass(motionPreset: CosmeticMotionPreset): string {
    if (motionPreset === "pulse") {
        return "cosmetic-motion-pulse";
    }

    if (motionPreset === "drift") {
        return "cosmetic-motion-drift";
    }

    if (motionPreset === "shimmer") {
        return "cosmetic-motion-shimmer";
    }

    return "";
}

export function getCosmeticMotionStyle(motionSpeedMs: number): CSSProperties | undefined {
    return motionSpeedMs > 0
        ? {
            animationDuration: `${motionSpeedMs}ms`,
        }
        : undefined;
}

export function buildCosmeticPatternStyle({
    pattern,
    primaryColor,
    secondaryColor,
    scale,
    opacity,
}: CosmeticPatternStyleOptions): CSSProperties | undefined {
    if (pattern === "none" || opacity <= 0) {
        return undefined;
    }

    const safeScale = `${Math.max(8, Math.min(48, scale))}px`;
    const safeOpacity = Math.max(0, Math.min(1, opacity));
    const primary = `${primaryColor}${toHexAlpha(safeOpacity)}`;
    const secondary = `${secondaryColor}${toHexAlpha(Math.max(0.08, safeOpacity * 0.72))}`;

    if (pattern === "grid") {
        return {
            backgroundImage: `linear-gradient(to right, ${primary} 1px, transparent 1px), linear-gradient(to bottom, ${primary} 1px, transparent 1px)`,
            backgroundSize: `${safeScale} ${safeScale}`,
        };
    }

    if (pattern === "dots") {
        return {
            backgroundImage: `radial-gradient(circle, ${primary} 1.2px, transparent 1.3px)`,
            backgroundSize: `${safeScale} ${safeScale}`,
        };
    }

    if (pattern === "diagonal") {
        return {
            backgroundImage: `linear-gradient(135deg, ${primary} 25%, transparent 25%, transparent 50%, ${secondary} 50%, ${secondary} 75%, transparent 75%, transparent)`,
            backgroundSize: `${safeScale} ${safeScale}`,
        };
    }

    if (pattern === "chevrons") {
        return {
            backgroundImage: `linear-gradient(135deg, ${primary} 25%, transparent 25%), linear-gradient(225deg, ${secondary} 25%, transparent 25%)`,
            backgroundPosition: `0 0, calc(${safeScale} / 2) 0`,
            backgroundSize: `${safeScale} ${safeScale}`,
        };
    }

    if (pattern === "rings") {
        return {
            backgroundImage: `radial-gradient(circle, transparent 45%, ${primary} 46%, transparent 51%), radial-gradient(circle, transparent 20%, ${secondary} 21%, transparent 28%)`,
            backgroundSize: `${safeScale} ${safeScale}`,
        };
    }

    return {
        backgroundImage: `repeating-linear-gradient(45deg, ${primary}, ${primary} 2px, transparent 2px, transparent 5px), repeating-linear-gradient(-45deg, ${secondary}, ${secondary} 2px, transparent 2px, transparent 6px)`,
        backgroundSize: `${safeScale} ${safeScale}`,
    };
}

function toHexAlpha(opacity: number): string {
    return Math.round(opacity * 255)
        .toString(16)
        .padStart(2, "0");
}
