import type { ReactNode } from "react";
import type { Metadata } from "next";
import { buildUtilityPageMetadata } from "@/lib/branding/metadata";
import { translate } from "@/lib/i18n/dictionaries";
import { getRequestLocale } from "@/lib/i18n/server";
import { getSystemSettings } from "@/lib/system-settings/service";

export async function generateMetadata(): Promise<Metadata> {
    const [settings, locale] = await Promise.all([getSystemSettings(), getRequestLocale()]);
    const siteName = settings.branding.siteName;

    return buildUtilityPageMetadata({
        branding: settings.branding,
        title: translate(locale, "meta.loginTitle", { siteName }),
        description: translate(locale, "meta.loginDescription", { siteName }),
        pathname: "/login",
        noIndex: true,
    });
}

export default function LoginLayout({ children }: { children: ReactNode }) {
    return children;
}
