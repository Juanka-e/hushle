import type { Metadata } from "next";
import { buildRoomMetadata } from "@/lib/branding/metadata";
import { getSystemSettings } from "@/lib/system-settings/service";

export async function generateMetadata(): Promise<Metadata> {
    const settings = await getSystemSettings();
    return buildRoomMetadata(settings.branding);
}

export default function RoomLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <>{children}</>;
}
