import { isFakePlatformEnabled } from "@hushle/platform-streamer/fake-gate";
import type { Metadata } from "next";
import { StreamScreen } from "@/components/stream/stream-screen";

// The OBS browser source. The shell carries no data and reads no session or cookie: the
// client joins the public room with the key from the URL. Demo scenes (?demo=) exist only
// while the fake platform is on. The switch comes from the package's light gate export: the
// package root would bring the platform clients and the connection store, and the app's streamer
// wiring (@/lib/streamer/deps) the audit log and the rate limiter as well.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: { absolute: "Hushle / Yayın ekranı" },
    robots: { index: false, follow: false },
    referrer: "no-referrer",
};

export default function StreamPage() {
    return <StreamScreen demoAllowed={isFakePlatformEnabled(process.env)} />;
}
