export const SUPPORTED_LOCALES = ["tr", "en"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "tr";
export const LOCALE_COOKIE_NAME = "hushle_locale";
export const LOCALE_STORAGE_KEY = "hushle_locale";

export function isAppLocale(value: unknown): value is AppLocale {
    return typeof value === "string" && SUPPORTED_LOCALES.includes(value as AppLocale);
}

export function normalizeAppLocale(value: unknown): AppLocale {
    return isAppLocale(value) ? value : DEFAULT_LOCALE;
}

export function toIntlLocale(locale: AppLocale): string {
    return locale === "en" ? "en-US" : "tr-TR";
}
