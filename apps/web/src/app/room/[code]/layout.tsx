import type { Metadata } from "next";
import { buildRoomMetadata } from "@/lib/branding/metadata";
import { translate } from "@/lib/i18n/dictionaries";
import { getRequestLocale } from "@/lib/i18n/server";
import { getSystemSettings } from "@/lib/system-settings/service";

export async function generateMetadata(): Promise<Metadata> {
    const [settings, locale] = await Promise.all([getSystemSettings(), getRequestLocale()]);
    const siteName = settings.branding.siteName;
    return buildRoomMetadata(settings.branding, {
        title: translate(locale, "meta.roomTitle", { siteName }),
        description: translate(locale, "meta.roomDescription", { siteName }),
    });
}

export default function RoomLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <>{children}</>;
}
