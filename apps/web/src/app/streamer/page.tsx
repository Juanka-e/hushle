import Link from "next/link";
import { redirect } from "next/navigation";
import { StreamerConfigError } from "@hushle/platform-streamer";
import { StreamerPanel } from "@/components/streamer/streamer-panel";
import { streamerGateState } from "@/components/streamer/streamer-panel-model";
import type { AppLocale } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";
import { getRequestLocale } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/session";
import { getVisibleCategories } from "@/lib/socket/category-service";
import { listCardBacksForUser } from "@/lib/streamer/card-backs";
import { verifyActiveConnections } from "@/lib/streamer/connections-view";
import { createConnectFlowDeps } from "@/lib/streamer/deps";
import { createSessionServiceDeps } from "@/lib/streamer/session-deps";
import { currentSession, isStreamerSessionError, lastSettings } from "@/lib/streamer/session-service";
import { getSystemSettings } from "@/lib/system-settings/service";
import type { StreamerConnectionsResponse } from "@/types/streamer";
import type { StreamerPanelCategory, StreamerPanelChannel, StreamerPanelInitial, StreamSessionView } from "@/types/streamer-session";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

type VisibleCategory = Awaited<ReturnType<typeof getVisibleCategories>>[number];

function panelCategories(roots: VisibleCategory[]): StreamerPanelCategory[] {
    return roots.map((root) => ({
        id: root.id,
        name: root.name,
        children: root.children.map((child) => ({ id: child.id, name: child.name })),
    }));
}

// The same body GET /api/streamer/sessions answers, plus what the form needs: the first paint
// has the session, the prefill, the card backs and both category packs (the session's word
// language picks one), so the panel never starts on a spinner. `known` is the session the gate
// already read, if it did.
async function loadPanel(
    userId: number,
    locale: AppLocale,
    channels: StreamerPanelChannel[],
    needsReconnect: boolean,
    known?: StreamSessionView | null
): Promise<StreamerPanelInitial> {
    const { features } = await getSystemSettings();
    const deps = createSessionServiceDeps();
    const [session, last, cardBacks, tr, en] = await Promise.all([
        known === undefined ? currentSession(deps, userId) : known,
        lastSettings(deps, userId),
        // An unreachable catalogue leaves the theme's card as the only choice.
        listCardBacksForUser(userId, { streamerShowcaseAllCosmetics: features.streamerShowcaseAllCosmetics }).catch((error: unknown) => {
            if (isStreamerSessionError(error)) return [];
            throw error;
        }),
        getVisibleCategories("tr"),
        getVisibleCategories("en"),
    ]);
    return {
        data: { enabled: true, session, lastSettings: last, cardBacks },
        channels,
        categories: { tr: panelCategories(tr), en: panelCategories(en) },
        locale,
        needsReconnect,
    };
}

// The streamer panel's door: decides which of four states the streamer is in. A linked channel
// (`ready`) opens the host panel; the others point to the right place. A session that is still
// live always opens the panel, so the streamer can end it; when its own platform's link is not
// active (`live-reconnect`) the panel warns that a new session needs a reconnect.
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
    const activePlatforms = view.platforms.filter((entry) => entry.connection?.status === "active").map((entry) => entry.platform);
    const broken = view.platforms.find((entry) => entry.connection?.status === "needs_reconnect");
    // Read whenever streamer mode is on: a live session opens the panel, and whether its own
    // platform's link is active decides the warning. loadPanel reuses it.
    const known = view.enabled ? await currentSession(createSessionServiceDeps(), sessionUser.id) : undefined;

    const state = streamerGateState({
        enabled: view.enabled,
        activePlatforms,
        brokenChannel: Boolean(broken),
        liveSession: known ?? null,
    });
    if (state === "ready" || state === "live-reconnect") {
        const channels: StreamerPanelChannel[] = view.platforms.flatMap((entry) =>
            entry.connection?.status === "active"
                ? [{ platform: entry.platform, label: entry.label, displayName: entry.connection.displayName }]
                : []
        );
        const initial = await loadPanel(sessionUser.id, locale, channels, state === "live-reconnect", known);
        return (
            <main className="min-h-screen bg-slate-100 px-4 py-10 dark:bg-slate-950">
                <StreamerPanel initial={initial} />
            </main>
        );
    }
    const title =
        state === "coming-soon" ? t("streamer.comingSoon") : state === "reconnect" ? t("streamer.reconnect") : t("streamer.notLinked");
    const help =
        state === "coming-soon"
            ? t("streamer.comingSoonHelp")
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
                    {state !== "coming-soon" ? (
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
