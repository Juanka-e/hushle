import { Prisma } from "@hushle/platform-db";
import {
    getEmailProviderReadiness,
    type EmailProviderReadiness,
} from "@hushle/platform-email";
import { getOrSetJsonCache } from "@hushle/platform-cache";
import { unlink } from "node:fs/promises";
import path from "node:path";
import {
    APPLICATION_CACHE_KEYS,
    invalidateStoreCatalogCache,
    invalidateMobileStorePolicyCache,
    invalidateSystemSettingsCache,
} from "@/lib/cache/application-cache";
import { prisma } from "@/lib/prisma";
import {
    DEFAULT_SYSTEM_SETTINGS,
    normalizeSystemSettings,
    SYSTEM_SETTINGS_NAMESPACES,
} from "@/lib/system-settings/schema";
import type {
    CaptchaProviderReadiness,
    SystemSettings,
} from "@/types/system-settings";

const SYSTEM_SETTINGS_CACHE_TTL_MS = 15_000;

interface SystemSettingsCacheState {
    warnedAboutFallback: boolean;
}

type SystemSettingsGlobal = typeof globalThis & {
    __hushleSystemSettingsCacheState?: SystemSettingsCacheState;
};

function getSystemSettingsCacheState(): SystemSettingsCacheState {
    const globalState = globalThis as SystemSettingsGlobal;
    globalState.__hushleSystemSettingsCacheState ??= {
        warnedAboutFallback: false,
    };
    return globalState.__hushleSystemSettingsCacheState;
}

function isCaptchaProviderConfigured(siteKey: string | undefined, secretKey: string | undefined): boolean {
    return Boolean(siteKey && siteKey.trim() && secretKey && secretKey.trim());
}

export function getCaptchaProviderReadiness(): CaptchaProviderReadiness {
    return {
        turnstileConfigured: isCaptchaProviderConfigured(
            process.env.TURNSTILE_SITE_KEY,
            process.env.TURNSTILE_SECRET_KEY
        ),
        recaptchaConfigured: isCaptchaProviderConfigured(
            process.env.RECAPTCHA_SITE_KEY,
            process.env.RECAPTCHA_SECRET_KEY
        ),
    };
}

export function getOutboundEmailReadiness(): EmailProviderReadiness {
    return getEmailProviderReadiness();
}

export async function clearSystemSettingsCache(): Promise<void> {
    await invalidateSystemSettingsCache();
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
}

function getBrandingManagedAssetValues(settings: SystemSettings): string[] {
    return [
        settings.branding.logoUrl,
        settings.branding.faviconUrl,
        settings.branding.ogImageUrl,
    ]
        .map((value) => value.trim())
        .filter(Boolean);
}

function resolveManagedBrandingAssetPath(assetUrl: string): string | null {
    if (!assetUrl.startsWith("/branding/")) {
        return null;
    }

    const normalizedRelativePath = path.normalize(assetUrl.replace(/^\/+/, ""));
    const publicRoot = path.resolve(process.cwd(), "public");
    const assetPath = path.resolve(publicRoot, normalizedRelativePath);

    if (!assetPath.startsWith(publicRoot)) {
        return null;
    }

    return assetPath;
}

async function cleanupUnusedBrandingAssets(previous: SystemSettings, next: SystemSettings): Promise<void> {
    const nextActiveAssetUrls = new Set(getBrandingManagedAssetValues(next));
    const previousAssetUrls = new Set(getBrandingManagedAssetValues(previous));

    const staleAssetPaths = [...previousAssetUrls]
        .filter((assetUrl) => !nextActiveAssetUrls.has(assetUrl))
        .map(resolveManagedBrandingAssetPath)
        .filter((value): value is string => Boolean(value));

    await Promise.all(
        staleAssetPaths.map(async (staleAssetPath) => {
            try {
                await unlink(staleAssetPath);
            } catch {
                // Ignore missing or already-removed asset files.
            }
        })
    );
}

function buildSettingsFromRows(
    rows: Array<{ key: string; value: unknown }>
): SystemSettings {
    const rawSettings: Partial<Record<keyof SystemSettings, unknown>> = {};

    for (const row of rows) {
        if (SYSTEM_SETTINGS_NAMESPACES.includes(row.key as keyof SystemSettings)) {
            rawSettings[row.key as keyof SystemSettings] = row.value;
        }
    }

    return normalizeSystemSettings({
        ...DEFAULT_SYSTEM_SETTINGS,
        ...rawSettings,
    });
}

function shouldFallbackToDefaultSettings(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    return (
        error.message.includes("Can't reach database server") ||
        error.message.includes("Can't connect to database server") ||
        error.message.includes("Connection refused") ||
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("the URL must start with the protocol `prisma://`") ||
        error.message.includes("the URL must start with the protocol `prisma+postgres://`")
    );
}

function logSystemSettingsFallback(error: Error): void {
    const cache = getSystemSettingsCacheState();
    if (cache.warnedAboutFallback) {
        return;
    }

    console.warn(
        "[system-settings] Falling back to default settings because the database is unavailable.",
        error.message
    );
    cache.warnedAboutFallback = true;
}

export async function getSystemSettings(options?: {
    forceRefresh?: boolean;
}): Promise<SystemSettings> {
    if (process.env.SKIP_DATABASE_DURING_BUILD === "true") {
        return normalizeSystemSettings(DEFAULT_SYSTEM_SETTINGS);
    }

    if (options?.forceRefresh) {
        await clearSystemSettingsCache();
    }

    const result = await getOrSetJsonCache<SystemSettings>({
        key: APPLICATION_CACHE_KEYS.systemSettings,
        ttlMs: SYSTEM_SETTINGS_CACHE_TTL_MS,
        loader: async () => {
            try {
                const rows = await prisma.systemSetting.findMany({
                    where: {
                        key: {
                            in: [...SYSTEM_SETTINGS_NAMESPACES],
                        },
                    },
                    select: {
                        key: true,
                        value: true,
                    },
                });

                const settings = buildSettingsFromRows(rows);
                getSystemSettingsCacheState().warnedAboutFallback = false;
                return settings;
            } catch (error) {
                if (shouldFallbackToDefaultSettings(error)) {
                    logSystemSettingsFallback(error as Error);
                    return normalizeSystemSettings(DEFAULT_SYSTEM_SETTINGS);
                }

                throw error;
            }
        },
    });

    return normalizeSystemSettings(result.value);
}

export async function updateSystemSettings(
    nextSettings: SystemSettings,
    updatedByUserId: number
): Promise<SystemSettings> {
    const previousSettings = await getSystemSettings();
    const normalizedSettings = normalizeSystemSettings(nextSettings);

    await prisma.$transaction(
        SYSTEM_SETTINGS_NAMESPACES.map((namespace) =>
            prisma.systemSetting.upsert({
                where: { key: namespace },
                update: {
                    value: toInputJsonValue(normalizedSettings[namespace]),
                    updatedByUserId,
                },
                create: {
                    key: namespace,
                    value: toInputJsonValue(normalizedSettings[namespace]),
                    updatedByUserId,
                },
            })
        )
    );

    await Promise.all([
        clearSystemSettingsCache(),
        invalidateStoreCatalogCache(),
        invalidateMobileStorePolicyCache(),
    ]);
    await cleanupUnusedBrandingAssets(previousSettings, normalizedSettings);

    return normalizedSettings;
}

