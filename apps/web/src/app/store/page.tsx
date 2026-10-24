import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildUtilityPageMetadata } from "@/lib/branding/metadata";
import { translate } from "@/lib/i18n/dictionaries";
import { getRequestLocale } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/session";
import { getSystemSettings } from "@/lib/system-settings/service";

export async function generateMetadata(): Promise<Metadata> {
    const [settings, locale] = await Promise.all([getSystemSettings(), getRequestLocale()]);
    const siteName = settings.branding.siteName;

    return buildUtilityPageMetadata({
        branding: settings.branding,
        title: translate(locale, "meta.storeTitle", { siteName }),
        description: translate(locale, "meta.storeDescription", { siteName }),
        pathname: "/store",
        noIndex: true,
    });
}

export default async function StorePage() {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        redirect("/login?callbackUrl=/dashboard%3Ftab%3Dshop");
    }

    redirect("/dashboard?tab=shop");
}
