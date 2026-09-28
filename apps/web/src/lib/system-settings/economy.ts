import type { SystemSettings } from "@/types/system-settings";

export interface MatchRewardGuardState {
    enabled: boolean;
    windowHours: number;
    softCapCoin: number;
    hardCapCoin: number;
    minMultiplier: number;
    dampingProfile: "gentle" | "standard" | "strict";
}

export interface RepeatedGroupGuardState {
    enabled: boolean;
    windowHours: number;
    threshold: number;
    minMultiplier: number;
}

const ECONOMY_TIME_ZONE = "Europe/Istanbul";

export interface MatchRewardResolution {
    baseRewardCoin: number;
    finalRewardCoin: number;
    multiplier: number;
    weekendBoostApplied: boolean;
}

export interface StoreLiveopsState {
    bundlesEnabled: boolean;
    couponsEnabled: boolean;
    discountCampaignsEnabled: boolean;
    storePriceMultiplier: number;
    activeMatchCoinMultiplier: number;
    weekendBoostApplied: boolean;
}

export function getMatchRewardGuardState(
    settings: SystemSettings
): MatchRewardGuardState {
    const softCapCoin = Math.max(0, settings.economy.matchRewardSoftCapCoin);
    const hardCapCoin = Math.max(softCapCoin, settings.economy.matchRewardHardCapCoin);

    return {
        enabled: settings.economy.matchRewardGuardEnabled,
        windowHours: settings.economy.matchRewardWindowHours,
        softCapCoin,
        hardCapCoin,
        minMultiplier: Math.min(1, Math.max(0, settings.economy.matchRewardMinMultiplier)),
        dampingProfile: settings.economy.matchRewardDampingProfile,
    };
}

export function getRepeatedGroupGuardState(
    settings: SystemSettings
): RepeatedGroupGuardState {
    return {
        enabled: settings.economy.repeatedGroupEnabled,
        windowHours: settings.economy.repeatedGroupWindowHours,
        threshold: Math.max(2, settings.economy.repeatedGroupThreshold),
        minMultiplier: Math.min(1, Math.max(0, settings.economy.repeatedGroupMinMultiplier)),
    };
}

function normalizeMultiplier(multiplier: number): number {
    return Math.max(0, Math.round(multiplier * 100) / 100);
}

function roundCoinAmount(amount: number): number {
    return Math.max(0, Math.round(amount));
}

export function isEconomyWeekend(date: Date): boolean {
    const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: ECONOMY_TIME_ZONE,
        weekday: "short",
    }).format(date);

    return weekday === "Sat" || weekday === "Sun";
}

export function resolveActiveMatchCoinMultiplier(
    settings: SystemSettings,
    now: Date
): { multiplier: number; weekendBoostApplied: boolean } {
    const baseMultiplier = normalizeMultiplier(settings.economy.matchCoinMultiplier);
    const weekendBoostApplied = settings.economy.weekendCoinMultiplierEnabled && isEconomyWeekend(now);

    if (!weekendBoostApplied) {
        return {
            multiplier: baseMultiplier,
            weekendBoostApplied: false,
        };
    }

    return {
        multiplier: normalizeMultiplier(baseMultiplier * settings.economy.weekendCoinMultiplier),
        weekendBoostApplied: true,
    };
}

export function resolveMatchRewardCoin(
    baseRewardCoin: number,
    settings: SystemSettings,
    now: Date
): MatchRewardResolution {
    const { multiplier, weekendBoostApplied } = resolveActiveMatchCoinMultiplier(settings, now);

    return {
        baseRewardCoin,
        finalRewardCoin: roundCoinAmount(baseRewardCoin * multiplier),
        multiplier,
        weekendBoostApplied,
    };
}

export function applyStorePriceMultiplier(
    basePriceCoin: number,
    settings: Pick<SystemSettings, "economy">
): number {
    return roundCoinAmount(basePriceCoin * settings.economy.storePriceMultiplier);
}

export function getStoreLiveopsState(
    settings: SystemSettings,
    now: Date
): StoreLiveopsState {
    const { multiplier, weekendBoostApplied } = resolveActiveMatchCoinMultiplier(settings, now);

    return {
        bundlesEnabled: settings.economy.bundlesEnabled,
        couponsEnabled: settings.economy.couponsEnabled,
        discountCampaignsEnabled: settings.economy.discountCampaignsEnabled,
        storePriceMultiplier: normalizeMultiplier(settings.economy.storePriceMultiplier),
        activeMatchCoinMultiplier: multiplier,
        weekendBoostApplied,
    };
}
