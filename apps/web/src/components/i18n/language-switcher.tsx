"use client";

import { Languages } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import type { AppLocale } from "@/lib/i18n/config";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
    const { locale, setLocale, t } = useI18n();

    return (
        <label className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-2 text-xs font-bold shadow-sm backdrop-blur">
            <Languages className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {!compact ? <span className="sr-only">{t("common.language")}</span> : null}
            <select
                value={locale}
                onChange={(event) => setLocale(event.target.value as AppLocale)}
                className="cursor-pointer bg-transparent pr-0.5 outline-none"
                aria-label={t("common.language")}
            >
                <option value="tr">TR</option>
                <option value="en">EN</option>
            </select>
        </label>
    );
}
