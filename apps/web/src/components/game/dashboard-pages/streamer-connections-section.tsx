"use client";

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { DashboardSection } from "@/components/game/dashboard-page-shell";
import { useI18n } from "@/components/providers/i18n-provider";
import { useHydrated } from "@/hooks/use-hydrated";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { runRequest, startRequest } from "@/lib/run-request";
import type { StreamerConnectionsResponse, StreamerConnectionView } from "@/types/streamer";

// "Yayın kanalları": one row per platform. Linking is a plain navigation to the connect
// route (the browser follows the OAuth redirects); removing is a POST with confirmation.

const ERROR_KEYS: Record<string, TranslationKey> = {
    unauthenticated: "settings.streamerErrorUnauthenticated",
    account_not_active: "settings.streamerErrorAccountNotActive",
    platform_invalid: "settings.streamerErrorPlatformInvalid",
    disabled: "settings.streamerErrorDisabled",
    platform_unavailable: "settings.streamerErrorPlatformUnavailable",
    rate_limited: "settings.streamerErrorRateLimited",
    state_missing: "settings.streamerErrorStateMissing",
    state_invalid: "settings.streamerErrorStateInvalid",
    state_expired: "settings.streamerErrorStateExpired",
    state_mismatch: "settings.streamerErrorStateMismatch",
    denied: "settings.streamerErrorDenied",
    already_linked_elsewhere: "settings.streamerErrorAlreadyLinkedElsewhere",
    platform_error: "settings.streamerErrorPlatformError",
    internal_error: "settings.streamerErrorInternalError",
};

function labelFor(platform: string, platforms: StreamerConnectionView[]): string {
    return platforms.find((entry) => entry.platform === platform)?.label ?? platform;
}

export function StreamerConnectionsSection() {
    const { t } = useI18n();
    const hydrated = useHydrated();
    const [data, setData] = useState<StreamerConnectionsResponse | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
    const [urlDismissed, setUrlDismissed] = useState(false);

    const fetchConnections = async (): Promise<StreamerConnectionsResponse | null> => {
        const response = await fetch("/api/streamer/connections", { cache: "no-store" });
        if (!response.ok) return null;
        return (await response.json()) as StreamerConnectionsResponse;
    };

    useEffect(() => startRequest(fetchConnections, { apply: setData, fail: () => setData(null) }), []);

    // The connect result rides in the URL once; any later action replaces it.
    const urlParams = hydrated && !urlDismissed ? new URLSearchParams(window.location.search) : null;
    const urlStatus = urlParams?.get("streamer");
    const urlPlatform = urlParams?.get("platform") ?? "";
    const urlCode = urlParams?.get("code") ?? "";
    const platforms = data?.platforms ?? [];
    const urlMessage =
        urlStatus === "linked"
            ? { tone: "ok" as const, text: t("settings.streamerLinked", { platform: labelFor(urlPlatform, platforms) }) }
            : urlStatus === "error"
              ? { tone: "error" as const, text: t(ERROR_KEYS[urlCode] ?? "settings.streamerErrorInternalError") }
              : null;
    const shownMessage = message ?? urlMessage;

    if (!data || !data.enabled || platforms.length === 0) {
        return null;
    }

    const disconnect = async (entry: StreamerConnectionView) => {
        if (!window.confirm(t("settings.streamerDisconnectConfirm", { platform: entry.label }))) return;
        setBusy(entry.platform);
        setUrlDismissed(true);
        setMessage(null);
        await runRequest(
            async () => {
                const response = await fetch(`/api/streamer/connections/${entry.platform}/disconnect`, { method: "POST" });
                if (!response.ok) throw new Error(`disconnect failed (${response.status})`);
                return fetchConnections();
            },
            {
                apply: (next) => {
                    setData(next);
                    setMessage({ tone: "ok", text: t("settings.streamerDisconnected", { platform: entry.label }) });
                },
                fail: () => setMessage({ tone: "error", text: t("settings.streamerDisconnectFailed") }),
                settle: () => setBusy(null),
            }
        );
    };

    const anyActive = platforms.some((entry) => entry.connection?.status === "active");

    return (
        <DashboardSection
            title={t("settings.streamerTitle")}
            description={t("settings.streamerHelp")}
            action={<Radio size={18} className="text-violet-600" />}
        >
            <div className="space-y-3" data-testid="streamer-connections">
                {platforms.map((entry) => {
                    const connection = entry.connection;
                    const linked = connection !== null && connection.status !== "revoked";
                    const needsReconnect = connection?.status === "needs_reconnect";
                    const statusText = !linked
                        ? t("settings.notLinked")
                        : needsReconnect
                          ? t("settings.streamerReconnectNeeded")
                          : t("settings.streamerReady");
                    const startHref = `/api/streamer/connect/${entry.platform}/start`;
                    return (
                        <div
                            key={entry.platform}
                            data-testid={`streamer-row-${entry.platform}`}
                            className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-900/60"
                        >
                            <div className="flex items-center gap-3">
                                {connection?.avatarUrl && linked ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={connection.avatarUrl} alt="" className="h-10 w-10 rounded-xl object-cover" />
                                ) : (
                                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-lg font-black text-slate-800 shadow-sm dark:bg-slate-800 dark:text-white">
                                        {entry.label.charAt(0)}
                                    </span>
                                )}
                                <div>
                                    <div className="text-sm font-black text-slate-800 dark:text-slate-100">
                                        {entry.label}
                                        {linked && connection ? (
                                            <span className="ml-2 font-semibold text-slate-600 dark:text-slate-300">{connection.displayName}</span>
                                        ) : null}
                                    </div>
                                    <div className={`text-xs ${needsReconnect ? "text-amber-700 dark:text-amber-300" : "text-slate-500 dark:text-slate-400"}`}>
                                        {statusText}
                                        {linked && connection ? (
                                            <>
                                                {" · "}
                                                <a href={connection.channelUrl} target="_blank" rel="noopener noreferrer" className="underline">
                                                    {connection.channelUrl.replace(/^https?:\/\//, "")}
                                                </a>
                                            </>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {!linked || needsReconnect ? (
                                    entry.configured ? (
                                        <a
                                            href={startHref}
                                            className="min-h-10 rounded-xl bg-slate-900 px-4 text-xs font-black leading-10 text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                                        >
                                            {needsReconnect ? t("settings.streamerReconnect") : t("settings.streamerLink")}
                                        </a>
                                    ) : (
                                        <span className="text-xs text-slate-500 dark:text-slate-400">{t("settings.streamerUnavailable")}</span>
                                    )
                                ) : null}
                                {linked ? (
                                    <button
                                        type="button"
                                        disabled={busy !== null}
                                        onClick={() => void disconnect(entry)}
                                        className="min-h-10 rounded-xl border border-rose-200 bg-white px-4 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-slate-950 dark:text-rose-300"
                                    >
                                        {busy === entry.platform ? t("settings.processing") : t("settings.streamerDisconnect")}
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    );
                })}
                {anyActive ? (
                    <a href="/streamer" className="inline-block text-xs font-bold text-violet-700 underline dark:text-violet-300">
                        {t("settings.streamerPanelLink")}
                    </a>
                ) : null}
                {shownMessage ? (
                    <p
                        role="status"
                        className={`text-xs leading-5 ${shownMessage.tone === "error" ? "text-rose-700 dark:text-rose-300" : "text-slate-600 dark:text-slate-300"}`}
                    >
                        {shownMessage.text}
                    </p>
                ) : null}
            </div>
        </DashboardSection>
    );
}
