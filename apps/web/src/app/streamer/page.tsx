import Link from "next/link";
import { redirect } from "next/navigation";
import { StreamerConfigError } from "@hushle/platform-streamer";
import { translate } from "@/lib/i18n/dictionaries";
import { getRequestLocale } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/session";
import { verifyActiveConnections } from "@/lib/streamer/connections-view";
import { createConnectFlowDeps } from "@/lib/streamer/deps";
import type { StreamerConnectionsResponse } from "@/types/streamer";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

// The streamer panel's door. The panel itself arrives in the next phase; this page only
// decides which of four states the streamer is in and points them to the right place.
export default async function StreamerPage() {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        redirect("/login?callbackUrl=/streamer");
    }
    const locale = await getRequestLocale();
    const t = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate(locale, key, values);

    let view: StreamerConnectionsResponse = { enabled: false, platforms: [] };
    try {
        view = await verifyActiveConnections(createConnectFlowDeps(null), sessionUser.id);
    } catch (error) {
        if (!(error instanceof StreamerConfigError)) throw error;
    }
    const active = view.platforms.find((entry) => entry.connection?.status === "active");
    const broken = view.platforms.find((entry) => entry.connection?.status === "needs_reconnect");

    const state = !view.enabled ? "coming-soon" : active ? "ready" : broken ? "reconnect" : "not-linked";
    const title =
        state === "coming-soon"
            ? t("streamer.comingSoon")
            : state === "ready"
              ? t("streamer.ready")
              : state === "reconnect"
                ? t("streamer.reconnect")
                : t("streamer.notLinked");
    const help =
        state === "coming-soon"
            ? t("streamer.comingSoonHelp")
            : state === "ready"
              ? t("streamer.readyHelp", { name: active!.connection!.displayName, platform: active!.label })
              : state === "reconnect"
                ? t("streamer.reconnectHelp", { platform: broken!.label })
                : t("streamer.notLinkedHelp");

    return (
        <main className="min-h-screen bg-slate-100 px-4 py-16 dark:bg-slate-950">
            <section className="mx-auto max-w-xl rounded-[28px] border border-white/60 bg-white/80 p-8 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-900/60">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-600 dark:text-violet-300">{t("streamer.gateTitle")}</p>
                <h1 className="mt-3 text-2xl font-black text-slate-900 dark:text-white">{title}</h1>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{help}</p>
                <div className="mt-6 flex flex-wrap gap-3">
                    {state !== "coming-soon" && state !== "ready" ? (
                        <Link
                            href="/dashboard?tab=settings"
                            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                        >
                            {t("streamer.goSettings")}
                        </Link>
                    ) : null}
                    <Link
                        href="/dashboard"
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    >
                        {t("streamer.backToDashboard")}
                    </Link>
                </div>
            </section>
        </main>
    );
}
