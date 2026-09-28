import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildUtilityPageMetadata } from "@/lib/branding/metadata";
import { getSessionUser } from "@/lib/session";
import { getSystemSettings } from "@/lib/system-settings/service";

export async function generateMetadata(): Promise<Metadata> {
    const settings = await getSystemSettings();

    return buildUtilityPageMetadata({
        branding: settings.branding,
        title: `Magaza | ${settings.branding.siteName}`,
        description: `${settings.branding.siteName} magaza ve odul alanina yonlendirme sayfasi.`,
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
