import type { Metadata } from "next";
import { StreamScreen } from "@/components/stream/stream-screen";
import { isFakeStreamerPlatformEnabled } from "@/lib/streamer/deps";

// The OBS browser source. The shell carries no data and reads no session or cookie: the
// client joins the public room with the key from the URL. Demo scenes (?demo=) exist only
// while the fake platform is on.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: { absolute: "Hushle / Yayın ekranı" },
    robots: { index: false, follow: false },
    referrer: "no-referrer",
};

export default function StreamPage() {
    return <StreamScreen demoAllowed={isFakeStreamerPlatformEnabled()} />;
}
