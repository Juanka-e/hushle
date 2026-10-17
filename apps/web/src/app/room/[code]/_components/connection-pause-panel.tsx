"use client";

import { useEffect, useState } from "react";
import { Flag, Timer, UserX, Users } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import {
    CONNECTION_PAUSE_RESOLVE_EVENT,
    type ConnectionPauseResolveAction,
    type ConnectionPauseResolvePayload,
} from "@/lib/socket/connection-pause-contract";
import type { ConnectionPauseSummary } from "@/types/game";
import { readConnectionPauseResolution } from "./connection-pause-rules";

/** Re-enables the buttons if the server rejects a decision without sending new state. */
const SUBMIT_RETRY_MS = 5_000;

// The panel can sit below the fold on the transition screen; bring the decision area into view
// when it appears and when the end-match confirmation opens (distinct keys force a remount).
const revealOnMount = (node: HTMLDivElement | null) => {
    node?.scrollIntoView({ block: "nearest" });
};

interface ConnectionPausePanelProps {
    connectionPause: ConnectionPauseSummary | null | undefined;
    canResolve: boolean;
    /** The room page's socket emit helper. */
    onEmit?: (event: string, data?: unknown) => void;
    className?: string;
}

/**
 * Counts down locally from the server's value and restarts whenever a new payload
 * object arrives, so it never depends on the client clock matching the server.
 */
function useResolutionCountdown(
    source: ConnectionPauseSummary | null | undefined,
    initialSeconds: number | null
): number | null {
    const [countdown, setCountdown] = useState({ source, remaining: initialSeconds });
    let current = countdown;
    if (countdown.source !== source) {
        current = { source, remaining: initialSeconds };
        setCountdown(current);
    }

    const isRunning = current.remaining !== null && current.remaining > 0;
    useEffect(() => {
        if (!isRunning) return;
        const intervalId = window.setInterval(() => {
            setCountdown((previous) =>
                previous.remaining === null || previous.remaining <= 0
                    ? previous
                    : { ...previous, remaining: previous.remaining - 1 }
            );
        }, 1_000);
        return () => window.clearInterval(intervalId);
    }, [isRunning, source]);

    return current.remaining;
}

export function ConnectionPausePanel({
    connectionPause,
    canResolve,
    onEmit,
    className = "",
}: ConnectionPausePanelProps) {
    const { t } = useI18n();
    const resolution = readConnectionPauseResolution(connectionPause);
    const remaining = useResolutionCountdown(
        connectionPause,
        resolution?.resolutionAvailableInSeconds ?? null
    );
    const [submittedFor, setSubmittedFor] = useState<ConnectionPauseSummary | null>(null);
    const [confirmingEnd, setConfirmingEnd] = useState(false);
    const isSubmitting = submittedFor !== null && submittedFor === connectionPause;

    useEffect(() => {
        if (!isSubmitting) return;
        const timeoutId = window.setTimeout(() => setSubmittedFor(null), SUBMIT_RETRY_MS);
        return () => window.clearTimeout(timeoutId);
    }, [isSubmitting]);

    if (!connectionPause || !resolution) return null;

    const hasResolutionData = resolution.resolutionAvailableInSeconds !== null && remaining !== null;
    if (!hasResolutionData && resolution.missingPlayers.length === 0) return null;

    const isCountingDown = hasResolutionData && remaining > 0;
    const showActions = canResolve && hasResolutionData && Boolean(onEmit);
    const actionsLocked = isCountingDown || isSubmitting;
    const canContinue = resolution.canContinueWithoutMissing;

    const submit = (action: ConnectionPauseResolveAction) => {
        if (!onEmit || actionsLocked) return;
        if (action === "continue_without_missing" && !canContinue) return;
        const payload: ConnectionPauseResolvePayload = { action };
        setSubmittedFor(connectionPause);
        setConfirmingEnd(false);
        onEmit(CONNECTION_PAUSE_RESOLVE_EVENT, payload);
    };

    const message = !hasResolutionData
        ? null
        : canResolve
            ? isCountingDown
                ? t("connectionPause.resolverWaiting")
                : t("connectionPause.resolverReady")
            : isCountingDown
                ? t("connectionPause.hostWaiting")
                : t("connectionPause.hostReady");

    return (
        <section
            data-testid="connection-pause-panel"
            className={`pointer-events-auto w-full rounded-2xl border border-amber-200/80 bg-amber-50/90 p-4 text-left shadow-sm dark:border-amber-900/50 dark:bg-amber-950/30 ${className}`}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300">
                        <UserX className="h-4 w-4" aria-hidden="true" />
                        {t("connectionPause.missingTitle")}
                    </div>
                    {resolution.missingPlayers.length > 0 ? (
                        <ul className="mt-2 flex flex-wrap gap-2">
                            {resolution.missingPlayers.map((player) => (
                                <li
                                    key={player.playerId || player.ad}
                                    className="inline-flex max-w-full items-center gap-2 rounded-full border border-amber-200/80 bg-white/85 px-3 py-1 text-sm font-bold text-slate-800 dark:border-amber-900/50 dark:bg-slate-900/70 dark:text-slate-100"
                                >
                                    {player.takim ? (
                                        <span
                                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-black text-white ${player.takim === "A" ? "bg-red-500" : "bg-blue-500"}`}
                                            title={player.takim === "A" ? t("transition.teamA") : t("transition.teamB")}
                                        >
                                            {player.takim}
                                        </span>
                                    ) : null}
                                    <span className="truncate">{player.ad}</span>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>

                {isCountingDown ? (
                    <div
                        role="timer"
                        className="flex items-center gap-2 rounded-xl border border-amber-200/80 bg-white/85 px-3 py-2 dark:border-amber-900/50 dark:bg-slate-900/70"
                    >
                        <Timer className="h-4 w-4 text-amber-600 dark:text-amber-300" aria-hidden="true" />
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {t("connectionPause.countdownLabel")}
                        </span>
                        <span className="text-lg font-black tabular-nums text-slate-900 dark:text-white">
                            {t("connectionPause.seconds", { seconds: remaining })}
                        </span>
                    </div>
                ) : null}
            </div>

            {message ? (
                <p aria-live="polite" className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {message}
                </p>
            ) : null}

            {showActions ? (
                confirmingEnd ? (
                    <div
                        key="confirm-end"
                        ref={revealOnMount}
                        role="alertdialog"
                        aria-labelledby="connection-pause-end-title"
                        aria-describedby="connection-pause-end-body"
                        className="mt-4 rounded-xl border border-rose-200 bg-rose-50/90 p-3 dark:border-rose-900/50 dark:bg-rose-950/30"
                    >
                        <p id="connection-pause-end-title" className="font-bold text-slate-900 dark:text-white">
                            {t("connectionPause.endConfirmTitle")}
                        </p>
                        <p id="connection-pause-end-body" className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                            {t("connectionPause.endConfirmBody")}
                        </p>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setConfirmingEnd(false)}
                                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                                {t("connectionPause.endCancel")}
                            </button>
                            <button
                                type="button"
                                onClick={() => submit("end_match")}
                                disabled={actionsLocked}
                                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Flag className="h-4 w-4" aria-hidden="true" />
                                {t("connectionPause.endConfirm")}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div key="actions" ref={revealOnMount} className="mt-4 space-y-2">
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => submit("continue_without_missing")}
                                disabled={actionsLocked || !canContinue}
                                aria-describedby={!canContinue ? "connection-pause-continue-blocked" : undefined}
                                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                            >
                                <Users className="h-4 w-4" aria-hidden="true" />
                                {t("connectionPause.continueWithout")}
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirmingEnd(true)}
                                disabled={actionsLocked}
                                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-600 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
                            >
                                <Flag className="h-4 w-4" aria-hidden="true" />
                                {t("connectionPause.endMatch")}
                            </button>
                        </div>
                        {!canContinue ? (
                            <p
                                id="connection-pause-continue-blocked"
                                className="text-xs font-medium text-slate-500 dark:text-slate-400"
                            >
                                {t("connectionPause.continueBlocked")}
                            </p>
                        ) : null}
                    </div>
                )
            ) : null}
        </section>
    );
}
