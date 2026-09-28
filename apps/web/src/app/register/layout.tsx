import type { ReactNode } from "react";
import type { Metadata } from "next";
import { buildUtilityPageMetadata } from "@/lib/branding/metadata";
import { getSystemSettings } from "@/lib/system-settings/service";

export async function generateMetadata(): Promise<Metadata> {
    const settings = await getSystemSettings();

    return buildUtilityPageMetadata({
        branding: settings.branding,
        title: `Kayit Ol | ${settings.branding.siteName}`,
        description: `${settings.branding.siteName} icin yeni bir hesap olustur.`,
        pathname: "/register",
        noIndex: true,
    });
}

export default function RegisterLayout({ children }: { children: ReactNode }) {
    return children;
}
