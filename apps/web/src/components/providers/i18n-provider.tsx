"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
    LOCALE_COOKIE_NAME,
    LOCALE_STORAGE_KEY,
    type AppLocale,
    isAppLocale,
} from "@/lib/i18n/config";
import { translate, type TranslationKey } from "@/lib/i18n/dictionaries";

interface I18nContextValue {
    locale: AppLocale;
    setLocale: (locale: AppLocale) => void;
    t: (key: TranslationKey, values?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
    initialLocale,
    children,
}: {
    initialLocale: AppLocale;
    children: React.ReactNode;
}) {
    const [locale, setLocaleState] = useState<AppLocale>(initialLocale);

    const setLocale = useCallback((nextLocale: AppLocale) => {
        setLocaleState(nextLocale);
        window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
        document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
        document.documentElement.lang = nextLocale;
    }, []);

    useEffect(() => {
        const handleStorage = (event: StorageEvent) => {
            if (event.key === LOCALE_STORAGE_KEY && isAppLocale(event.newValue)) {
                setLocaleState(event.newValue);
                document.cookie = `${LOCALE_COOKIE_NAME}=${event.newValue}; Path=/; Max-Age=31536000; SameSite=Lax`;
                document.documentElement.lang = event.newValue;
            }
        };
        window.addEventListener("storage", handleStorage);
        return () => window.removeEventListener("storage", handleStorage);
    }, []);

    const value = useMemo<I18nContextValue>(
        () => ({
            locale,
            setLocale,
            t: (key, values) => translate(locale, key, values),
        }),
        [locale, setLocale]
    );

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
    const context = useContext(I18nContext);
    if (!context) throw new Error("useI18n must be used within I18nProvider");
    return context;
}
