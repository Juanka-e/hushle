"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { HostStreamSnapshot } from "@hushle/domain-streamer";
import { DashboardSection } from "@/components/game/dashboard-page-shell";
import { useI18n } from "@/components/providers/i18n-provider";
import { createRevisionGuard } from "@/components/stream/stream-guards";
import { PlayerErrorCode } from "@/lib/errors/player-error-codes";
import { resolveApiErrorMessage } from "@/lib/errors/resolve-player-error";
import type { AppLocale } from "@/lib/i18n/config";
import { runRequest } from "@/lib/run-request";
import { getSocketProtocolErrorMessage, SOCKET_CLIENT_AUTH } from "@/lib/socket/protocol-version";
import type { ScreenSettingsPatch } from "@/lib/streamer/session-settings";
import {
    STREAMER_SOCKET_EVENTS,
    type StreamerActionAck,
    type StreamerHostJoinAck,
    type StreamerHostNoticePayload,
    type StreamerRotateKeyAck,
} from "@/lib/streamer/socket-contract";
import type {
    CardBackOption,
    CreateStreamSessionResponse,
    EndStreamSessionResponse,
    StreamSessionResponse,
    StreamSessionView,
    StreamerPanelChannel,
    StreamerPanelInitial,
} from "@/types/streamer-session";
import { StreamerCardView } from "./streamer-card-view";
import { StreamerObsBox } from "./streamer-obs-box";
import {
    ACK_TIMEOUT_MS,
    ackTimeoutFor,
    actionRefusalAction,
    appendLog,
    closedKindOf,
    connectionLabel,
    createSessionRereader,
    describeTransition,
    goneRereadAction,
    hostNoticeOf,
    isHostSnapshot,
    isLivePhase,
    joinRefusalAction,
    rotateAckOutcome,
    scoreKeys,
    summaryFromSnapshot,
    withCardNameRule,
    type ClosedKind,
    type ConnectionState,
    type LogDraft,
    type LogEntry,
    type PanelSummary,
    type RereadStatus,
    type ScoreEntry,
    type SessionRereader,
} from "./streamer-panel-model";
import { ScreenSettingsFields, StreamerSetupForm } from "./streamer-setup-form";

// The streamer's host panel (/streamer, the gate's `ready` state). Opening and ending a session
// go over HTTP; the live loop (host room join, round actions, look changes, key rotation) goes
// over the Socket.IO host room, whose snapshots carry the secret card for this panel only.
//
// What the panel shows:
//   summary      the session just ended here or elsewhere (`streamer:ended` reason "ended")
//   idle         the server closed it after 6 h without activity (reason "idle")
//   stopped      the service stopped it: streamer mode switched off, or an account action (reason "stopped")
//   interrupted  the process that ran it went away (GET says so, or reason "interrupted")
//   live         an active session: the socket joins its host room
//   setup        nothing open: the form
// Above them, a warning while the channel link needs a reconnect (the gate let a live session
// through, or the host room said so); the session keeps running.

const EVENTS = STREAMER_SOCKET_EVENTS;
const JOIN_RETRY_MS = 5_000;

type HostActionEvent =
    | typeof EVENTS.hostStart
    | typeof EVENTS.hostPause
    | typeof EVENTS.hostResume
    | typeof EVENTS.hostPass
    | typeof EVENTS.hostNext;

type ClosedOutcome = { kind: "ended"; summary: PanelSummary } | { kind: Exclude<ClosedKind, "ended"> };

function errorCodeOf(value: unknown): unknown {
    return value && typeof value === "object" ? (value as { code?: unknown }).code : undefined;
}

function seconds(ms: number, locale: AppLocale): string {
    return (ms / 1000).toLocaleString(locale === "en" ? "en-US" : "tr-TR", { maximumFractionDigits: 1 });
}

function buttonClass(kind: "primary" | "plain" | "danger"): string {
    const base = "min-h-14 rounded-2xl px-5 text-base font-black transition disabled:cursor-not-allowed disabled:opacity-50";
    if (kind === "primary") return `${base} bg-violet-600 text-white shadow-lg shadow-violet-600/20 hover:bg-violet-700`;
    if (kind === "danger") {
        return `${base} border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-950 dark:text-rose-300`;
    }
    return `${base} border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100`;
}

// ---------------------------------------------------------------- scores and summary

function ScoreList({ scores }: { scores: ScoreEntry[] }) {
    const { t } = useI18n();
    const keys = scoreKeys(scores);
    return (
        <ol className="space-y-2">
            {scores.map((entry, index) => (
                <li
                    key={keys[index]}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                >
                    <span className="flex min-w-0 items-center gap-3">
                        <span className="w-6 shrink-0 text-right text-sm font-black text-slate-400">{entry.rank}.</span>
                        <span className="truncate text-sm font-black text-slate-800 dark:text-slate-100">{entry.name}</span>
                        {entry.tied ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                                {t("streamer.panel.tied")}
                            </span>
                        ) : null}
                    </span>
                    <span className="shrink-0 text-sm font-bold text-slate-600 dark:text-slate-300">{t("streamer.panel.points", { count: entry.points })}</span>
                </li>
            ))}
        </ol>
    );
}

function SessionSummary({ summary, onNew }: { summary: PanelSummary; onNew: () => void }) {
    const { t } = useI18n();
    const winners = summary.scores.filter((entry) => entry.rank === 1);
    return (
        <div data-testid="streamer-summary">
            <DashboardSection title={t("streamer.panel.summaryTitle")}>
                <div className="space-y-5">
                    {winners.length > 0 ? (
                        <div
                            data-testid="streamer-summary-winner"
                            className="rounded-3xl bg-gradient-to-br from-violet-600 to-fuchsia-600 p-5 text-white shadow-lg"
                        >
                            <p className="text-xs font-black uppercase tracking-[0.16em] opacity-80">
                                {winners.length > 1 ? t("streamer.panel.summaryWinners") : t("streamer.panel.summaryWinner")}
                            </p>
                            <p className="mt-1 text-3xl font-black">{winners.map((entry) => entry.name).join(" · ")}</p>
                            <p className="mt-1 text-sm font-bold opacity-90">{t("streamer.panel.points", { count: winners[0].points })}</p>
                        </div>
                    ) : (
                        <p className="text-base font-semibold text-slate-600 dark:text-slate-300">{t("streamer.panel.summaryEmpty")}</p>
                    )}
                    {summary.scores.length > 0 ? <ScoreList scores={summary.scores} /> : null}
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                        <span>{t("streamer.panel.summaryParticipants", { count: summary.participants })}</span>
                        {summary.rounds !== null ? <span>{t("streamer.panel.summaryRounds", { count: summary.rounds })}</span> : null}
                    </div>
                    <button type="button" onClick={onNew} className={buttonClass("primary")}>
                        {t("streamer.panel.newSession")}
                    </button>
                </div>
            </DashboardSection>
        </div>
    );
}

function Notice({ title, help, onNew }: { title: string; help: string; onNew: () => void }) {
    const { t } = useI18n();
    return (
        <DashboardSection title={title} description={help}>
            <button type="button" onClick={onNew} className={buttonClass("primary")}>
                {t("streamer.panel.newSession")}
            </button>
        </DashboardSection>
    );
}

// ---------------------------------------------------------------- the live session

interface LiveSessionProps {
    session: StreamSessionView;
    viewKey: string | null;
    /** A rotation got no readable answer; cleared by the next key. */
    keyUnknown: boolean;
    cardBacks: CardBackOption[];
    onViewKey: (viewKey: string) => void;
    /** A rotation got no readable answer: the key on the page may be dead. */
    onKeyUnknown: () => void;
    /** The streamer hid the secret card (kept above this view, so a rejoin keeps it). */
    cardHidden: boolean;
    onToggleCard: () => void;
    onClosed: (outcome: ClosedOutcome) => void;
    /** The host room refused the session (gone or not ours): the caller reloads what is current. */
    onGone: (sessionId: string) => void;
    /** The host room took the join. */
    onJoined: () => void;
    /** A host-room notice (the channel link needs a reconnect); the session keeps running. */
    onNotice: (notice: StreamerHostNoticePayload) => void;
}

function LiveSession({ session, viewKey, keyUnknown, cardBacks, onViewKey, onKeyUnknown, cardHidden, onToggleCard, onClosed, onGone, onJoined, onNotice }: LiveSessionProps) {
    const { t, locale } = useI18n();
    const [snapshot, setSnapshot] = useState<HostStreamSnapshot | null>(null);
    const [connection, setConnection] = useState<ConnectionState>("connecting");
    const [pending, setPending] = useState<string | null>(null);
    const [failure, setFailure] = useState<{ payload: unknown } | null>(null);
    const [log, setLog] = useState<LogEntry[]>([]);
    const [rotated, setRotated] = useState(false);
    const [signedOut, setSignedOut] = useState(false);
    // Streamer mode was switched off: the host room refuses everything, so the panel stops asking.
    const [modeOff, setModeOff] = useState(false);
    const socketRef = useRef<Socket | null>(null);
    // Stops the live connection for good (no rejoin); set by the socket effect.
    const haltRef = useRef<(() => void) | null>(null);
    const lastRef = useRef<HostStreamSnapshot | null>(null);
    const logIdRef = useRef(0);
    // Set while this panel's HTTP end runs: its answer carries the stored summary.
    const endingRef = useRef(false);
    // The session closes once; a late `streamer:ended` after the HTTP answer changes nothing.
    const closedRef = useRef(false);
    // The host room said "ended" while the HTTP end ran: a failed answer still closes the session.
    const endedRef = useRef(false);
    const sessionId = session.id;

    const receive = useEffectEvent((state: HostStreamSnapshot, drafts: LogDraft[]) => {
        lastRef.current = state;
        setSnapshot(state);
        if (drafts.length === 0) return;
        const firstId = logIdRef.current + 1;
        logIdRef.current += drafts.length;
        setLog((current) => appendLog(current, drafts, firstId));
    });

    const finish = (outcome: ClosedOutcome) => {
        if (closedRef.current) return;
        closedRef.current = true;
        onClosed(outcome);
    };

    const closed = useEffectEvent((kind: ClosedKind) => {
        if (kind !== "ended") finish({ kind });
        else if (endingRef.current) endedRef.current = true;
        else finish({ kind: "ended", summary: summaryFromSnapshot(lastRef.current) });
    });

    const gone = useEffectEvent(() => {
        setConnection("gone");
        onGone(sessionId);
    });
    const showModeOff = () => {
        setConnection("off");
        setFailure(null);
        setModeOff(true);
    };
    const modeIsOff = useEffectEvent(() => showModeOff());
    const noticed = useEffectEvent((notice: StreamerHostNoticePayload) => onNotice(notice));
    const loggedOut = useEffectEvent(() => {
        setConnection("closed");
        setFailure(null);
        setSignedOut(true);
    });
    const joinRefused = useEffectEvent((payload: unknown) => setFailure({ payload }));
    const joinedRoom = useEffectEvent(() => {
        setConnection("joined");
        setFailure(null);
        onJoined();
    });
    const protocolError = useEffectEvent((error: unknown) => getSocketProtocolErrorMessage(error, locale));

    useEffect(() => {
        const socket = io({
            path: "/api/socketio",
            auth: SOCKET_CLIENT_AUTH,
            transports: ["websocket", "polling"],
            tryAllTransports: true,
        });
        socketRef.current = socket;
        haltRef.current = () => stop();
        const guard = createRevisionGuard();
        let last: HostStreamSnapshot | null = null;
        let stopped = false;
        // Acks of an earlier join (an earlier connection) are ignored.
        let joinSequence = 0;
        let retry: ReturnType<typeof setTimeout> | undefined;

        const take = (state: HostStreamSnapshot) => {
            const drafts = last ? describeTransition(last, state) : [];
            last = state;
            receive(state, drafts);
        };

        const stop = () => {
            stopped = true;
            clearTimeout(retry);
            socket.disconnect();
        };

        const join = () => {
            if (stopped || !socket.connected) return;
            clearTimeout(retry);
            const sequence = ++joinSequence;
            socket.timeout(ACK_TIMEOUT_MS).emit(EVENTS.hostJoin, { sessionId }, (error: Error | null, reply: StreamerHostJoinAck) => {
                if (stopped || sequence !== joinSequence) return;
                if (!error && reply?.ok === true && isHostSnapshot(reply.state)) {
                    guard.reset(reply.state.revision);
                    take(reply.state);
                    joinedRoom();
                    return;
                }
                const action = joinRefusalAction(error ? undefined : errorCodeOf(reply));
                if (action === "gone") {
                    stop();
                    gone();
                    return;
                }
                if (action === "signedOut") {
                    stop();
                    loggedOut();
                    return;
                }
                if (action === "disabled") {
                    stop();
                    modeIsOff();
                    return;
                }
                // Rate limited, a server error or no answer: say so and ask again shortly.
                joinRefused(error ? {} : reply);
                retry = setTimeout(join, JOIN_RETRY_MS);
            });
        };

        socket.on("connect", () => {
            setConnection("connecting");
            join();
        });
        socket.on("disconnect", (reason) => {
            joinSequence += 1;
            clearTimeout(retry);
            if (stopped) return;
            // A server-side drop (password reset, sign-out elsewhere) does not reconnect by itself.
            setConnection(reason === "io server disconnect" ? "closed" : "reconnecting");
        });
        socket.on("connect_error", (error) => {
            if (stopped) return;
            const message = protocolError(error);
            if (message) {
                joinRefused({ error: message });
                stop();
                setConnection("closed");
                return;
            }
            setConnection("reconnecting");
        });
        socket.on(EVENTS.hostState, (payload: unknown) => {
            if (stopped || !isHostSnapshot(payload) || !guard.accept(payload.revision)) return;
            take(payload);
        });
        socket.on(EVENTS.hostNotice, (payload: unknown) => {
            if (stopped) return;
            const notice = hostNoticeOf(payload);
            if (notice) noticed(notice);
        });
        socket.on(EVENTS.ended, (payload: unknown) => {
            if (stopped) return;
            // null: a rotation closes only the stream screens; the host room stays.
            const kind = closedKindOf(payload);
            if (kind === null) return;
            stop();
            closed(kind);
        });

        return () => {
            stopped = true;
            clearTimeout(retry);
            socket.removeAllListeners();
            socket.disconnect();
            if (socketRef.current === socket) socketRef.current = null;
            haltRef.current = null;
        };
    }, [sessionId]);

    const joined = connection === "joined";
    const busy = pending !== null;

    // `onNoAnswer` replaces the generic failure when the ack does not come in time.
    const emitAction = (event: string, payload: unknown, onOk?: (reply: Record<string, unknown>) => void, onNoAnswer?: () => void) => {
        const socket = socketRef.current;
        if (!socket || !joined || busy) return;
        setPending(event);
        setFailure(null);
        const ack = (error: Error | null, reply: StreamerActionAck | StreamerRotateKeyAck) => {
            setPending(null);
            if (error) {
                if (onNoAnswer) onNoAnswer();
                else setFailure({ payload: {} });
            } else if (reply?.ok !== true) {
                if (actionRefusalAction(errorCodeOf(reply)) === "disabled") {
                    haltRef.current?.();
                    showModeOff();
                } else setFailure({ payload: reply });
            } else onOk?.(reply as unknown as Record<string, unknown>);
        };
        // Socket.IO sends `undefined` arguments as null: the round actions take none at all.
        if (payload === undefined) socket.timeout(ackTimeoutFor(event)).emit(event, ack);
        else socket.timeout(ackTimeoutFor(event)).emit(event, payload, ack);
    };

    const act = (event: HostActionEvent) => emitAction(event, undefined);

    const changeScreen = (patch: ScreenSettingsPatch) => emitAction(EVENTS.hostSettings, withCardNameRule(patch));

    const rotate = () => {
        if (!window.confirm(t("streamer.panel.rotateConfirm"))) return;
        setRotated(false);
        // The ack may come only after the server's queue turn and key write (rotateAckOutcome);
        // no answer in time, or no readable key, leaves the key unknown and the panel asks for a new one.
        emitAction(EVENTS.hostRotateKey, undefined, (reply) => {
            const outcome = rotateAckOutcome(null, reply);
            if (outcome.kind !== "rotated") {
                onKeyUnknown();
                return;
            }
            onViewKey(outcome.viewKey);
            setRotated(true);
        }, onKeyUnknown);
    };

    const end = async () => {
        if (busy || !window.confirm(t("streamer.panel.endConfirm"))) return;
        endingRef.current = true;
        setPending("end");
        setFailure(null);
        await runRequest(
            async () => {
                const response = await fetch("/api/streamer/sessions/current/end", { method: "POST" });
                const body: unknown = await response.json().catch(() => null);
                if (!response.ok) throw body ?? {};
                return body as EndStreamSessionResponse;
            },
            {
                apply: (body) => finish({ kind: "ended", summary: body.session?.summary ?? summaryFromSnapshot(lastRef.current) }),
                fail: (error) => {
                    // Already over (another tab, the idle timer): the last snapshot is the summary.
                    if (endedRef.current || errorCodeOf(error) === PlayerErrorCode.STREAMER_SESSION_NOT_FOUND) {
                        finish({ kind: "ended", summary: summaryFromSnapshot(lastRef.current) });
                        return;
                    }
                    setFailure({ payload: error });
                },
                settle: () => {
                    endingRef.current = false;
                    setPending(null);
                },
            }
        );
    };

    const phase = snapshot?.phase ?? "ready";
    const connectionKey = connectionLabel(connection);
    const failureText = failure ? resolveApiErrorMessage(locale, failure.payload, t("streamer.panel.actionFailed")) : null;
    const disabled = !joined || busy;

    const logText = (entry: LogEntry): string => {
        switch (entry.kind) {
            case "roundStarted":
                return t("streamer.panel.logRoundStarted", { round: entry.round });
            case "correct":
                return entry.word
                    ? t("streamer.panel.logCorrect", { name: entry.name ?? "", word: entry.word })
                    : t("streamer.panel.logCorrectNoWord", { name: entry.name ?? "" });
            case "passed":
                return t("streamer.panel.logPassed", { round: entry.round, word: entry.word ?? "" });
            case "timeout":
                return t("streamer.panel.logTimeout", { round: entry.round, word: entry.word ?? "" });
            case "paused":
                return t("streamer.panel.logPaused");
            case "resumed":
                return t("streamer.panel.logResumed");
            case "ended":
                return t("streamer.panel.logEnded");
        }
    };

    return (
        <div className="space-y-6">
            <DashboardSection
                title={t("streamer.panel.gameTitle")}
                action={
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
                            {t(`streamer.panel.phases.${phase}`)}
                        </span>
                        {connectionKey ? (
                            <span
                                role="status"
                                className={`rounded-full px-3 py-1 text-xs font-bold ${
                                    joined
                                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                }`}
                            >
                                {t(connectionKey)}
                            </span>
                        ) : null}
                    </div>
                }
            >
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                    <div className="space-y-4">
                        {snapshot ? (
                            <StreamerCardView state={snapshot} hidden={cardHidden} onToggleHidden={onToggleCard} />
                        ) : (
                            <p className="rounded-3xl border border-slate-200 p-5 text-base font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
                                {t("streamer.panel.connecting")}
                            </p>
                        )}
                        <div className="flex items-end justify-between gap-4 rounded-3xl bg-slate-900 px-5 py-4 text-white dark:bg-slate-800">
                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-white/60">
                                    {t("streamer.panel.round", { round: snapshot?.round ?? 1 })}
                                </p>
                                <p className="text-xs font-semibold text-white/60">{t("streamer.panel.remaining")}</p>
                            </div>
                            <p className="text-5xl font-black tabular-nums" aria-live="off">
                                {snapshot ? t("streamer.panel.seconds", { count: phase === "ready" ? snapshot.duration : snapshot.remaining }) : "–"}
                            </p>
                        </div>
                        <div data-testid="streamer-controls" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {phase === "ready" ? (
                                <button type="button" disabled={disabled} onClick={() => act(EVENTS.hostStart)} className={`${buttonClass("primary")} col-span-2`}>
                                    {t("streamer.panel.start")}
                                </button>
                            ) : null}
                            {phase === "running" ? (
                                <button type="button" disabled={disabled} onClick={() => act(EVENTS.hostPause)} className={buttonClass("plain")}>
                                    {t("streamer.panel.pause")}
                                </button>
                            ) : null}
                            {phase === "paused" ? (
                                <button type="button" disabled={disabled} onClick={() => act(EVENTS.hostResume)} className={buttonClass("primary")}>
                                    {t("streamer.panel.resume")}
                                </button>
                            ) : null}
                            {isLivePhase(phase) ? (
                                <button type="button" disabled={disabled} onClick={() => act(EVENTS.hostPass)} className={buttonClass("plain")}>
                                    {t("streamer.panel.pass")}
                                </button>
                            ) : null}
                            {phase === "finished" ? (
                                <button type="button" disabled={disabled} onClick={() => act(EVENTS.hostNext)} className={`${buttonClass("primary")} col-span-2`}>
                                    {t("streamer.panel.next")}
                                </button>
                            ) : null}
                            {phase !== "ended" ? (
                                <button type="button" disabled={busy} onClick={() => void end()} className={buttonClass("danger")}>
                                    {pending === "end" ? t("streamer.panel.ending") : t("streamer.panel.end")}
                                </button>
                            ) : null}
                        </div>
                        {failureText ? (
                            <p role="alert" className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                                {failureText}
                            </p>
                        ) : null}
                        {signedOut ? (
                            <div
                                role="alert"
                                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30"
                            >
                                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">{t("streamer.panel.signedOut")}</p>
                                {/* A full page load, so the new sign-in starts from fresh cookies. */}
                                <a
                                    href="/login?callbackUrl=/streamer"
                                    className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-black leading-[2.75rem] text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                                >
                                    {t("streamer.panel.signIn")}
                                </a>
                            </div>
                        ) : null}
                        {modeOff ? (
                            <p
                                role="alert"
                                data-testid="streamer-mode-off"
                                className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
                            >
                                {t("streamer.panel.modeDisabled")}
                            </p>
                        ) : null}
                    </div>

                    <div className="space-y-4">
                        <section data-testid="streamer-scores" className="space-y-3">
                            <div className="flex items-baseline justify-between gap-2">
                                <h3 className="text-sm font-black text-slate-800 dark:text-slate-100">{t("streamer.panel.scoresTitle")}</h3>
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                    {t("streamer.panel.participants", { count: snapshot?.participants ?? 0 })}
                                </span>
                            </div>
                            {snapshot && snapshot.players.length > 0 ? (
                                <ScoreList scores={snapshot.players} />
                            ) : (
                                <p className="text-sm text-slate-500 dark:text-slate-400">{t("streamer.panel.scoresEmpty")}</p>
                            )}
                            {snapshot?.lastCorrect ? (
                                <div className="rounded-2xl bg-emerald-50 px-4 py-3 dark:bg-emerald-950/30">
                                    <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                                        {t("streamer.panel.lastCorrect")}
                                    </p>
                                    <p className="text-lg font-black text-slate-900 dark:text-white">{snapshot.lastCorrect.name}</p>
                                    <p className="text-xs text-slate-600 dark:text-slate-300">
                                        {t("streamer.panel.lastCorrectDetail", {
                                            round: snapshot.lastCorrect.round,
                                            seconds: seconds(snapshot.lastCorrect.solveMs, locale),
                                        })}
                                    </p>
                                </div>
                            ) : null}
                        </section>
                        <section data-testid="streamer-log" className="space-y-2">
                            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100">{t("streamer.panel.logTitle")}</h3>
                            {log.length === 0 ? (
                                <p className="text-sm text-slate-500 dark:text-slate-400">{t("streamer.panel.logEmpty")}</p>
                            ) : (
                                <ul role="log" className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                                    {log.map((entry) => (
                                        <li
                                            key={entry.id}
                                            className={`rounded-lg px-3 py-1.5 text-sm ${
                                                entry.kind === "correct"
                                                    ? "bg-emerald-50 font-bold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                                                    : "bg-slate-50 text-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
                                            }`}
                                        >
                                            {logText(entry)}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    </div>
                </div>
            </DashboardSection>

            <div className="grid gap-6 lg:grid-cols-2">
                <StreamerObsBox
                    viewKey={viewKey}
                    camera={snapshot?.camera ?? session.settings?.camera ?? "none"}
                    cameraSize={snapshot?.cameraSize ?? session.settings?.cameraSize ?? "m"}
                    onRotate={rotate}
                    rotating={pending === EVENTS.hostRotateKey}
                    disabled={disabled}
                    rotated={rotated}
                    keyUnknown={keyUnknown}
                />
                {snapshot ? (
                    <DashboardSection title={t("streamer.panel.screenTitle")} description={t("streamer.panel.screenHelp")}>
                        <ScreenSettingsFields
                            value={{
                                theme: snapshot.theme,
                                camera: snapshot.camera,
                                cameraSize: snapshot.cameraSize,
                                clock: snapshot.clock,
                                cardBack: snapshot.cardBack ? { itemId: snapshot.cardBack.itemId } : null,
                                showCardName: snapshot.showCardName,
                            }}
                            cardBacks={cardBacks}
                            disabled={disabled || phase === "ended"}
                            onChange={changeScreen}
                        />
                    </DashboardSection>
                ) : null}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- the panel

function ChannelHeader({ channels }: { channels: StreamerPanelChannel[] }) {
    const { t } = useI18n();
    return (
        <section className="rounded-[28px] border border-white/60 bg-white/80 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur-xl md:p-8 dark:border-slate-800/70 dark:bg-slate-900/60">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-600 dark:text-violet-300">{t("streamer.gateTitle")}</p>
                    {/* No active link: the gate let a live session through so it can still be ended. */}
                    <h1 className="mt-3 text-2xl font-black text-slate-900 dark:text-white">
                        {channels.length > 0 ? t("streamer.ready") : t("streamer.reconnect")}
                    </h1>
                    {channels.map((channel) => (
                        <p key={channel.platform} className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                            {t("streamer.panel.channelLine", { name: channel.displayName, platform: channel.label })}
                        </p>
                    ))}
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t("streamer.panel.privateNote")}</p>
                </div>
                <Link
                    href="/dashboard"
                    className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                >
                    {t("streamer.backToDashboard")}
                </Link>
            </div>
        </section>
    );
}

export function StreamerPanel({ initial }: { initial: StreamerPanelInitial }) {
    const { t } = useI18n();
    const [data, setData] = useState<StreamSessionResponse>(initial.data);
    // The stream screen key: in memory only, from the create or rotate answer. Never stored.
    const [viewKey, setViewKey] = useState<string | null>(null);
    // A rotation got no readable answer: the key was dropped and a new one is asked for.
    const [keyIsUnknown, setKeyUnknown] = useState(false);
    // "Kartı gizle": above the live view's remount, so a rejoin keeps it. In memory only: a reload
    // shows the card again.
    const [cardHidden, setCardHidden] = useState(false);
    const toggleCard = () => setCardHidden((current) => !current);
    const [summary, setSummary] = useState<PanelSummary | null>(null);
    // The session was closed by the idle timer or stopped by the service.
    const [notice, setNotice] = useState<"idle" | "stopped" | null>(null);
    // A re-read of the current session (after a refused join, a create that found one open, or
    // an end) that failed is shown with a retry; the live view's socket has stopped by then.
    const [reread, setReread] = useState<RereadStatus>("idle");
    // The channel link needs a reconnect: kept until the page is left, the session keeps running.
    const [needsReconnect, setNeedsReconnect] = useState(initial.needsReconnect);
    // The live view is mounted per session and generation: a rejoin starts a new generation, so a
    // fresh socket joins the host room again.
    const [generation, setGeneration] = useState(0);
    // Rejoins kept failing: the host is asked to reload the page.
    const [stale, setStale] = useState(false);
    // The session whose host join was just refused, and how many rejoins in a row it has had.
    const goneRef = useRef<string | null>(null);
    const rejoinsRef = useRef(0);
    // Overlapping re-reads: only the newest answer is applied. One that followed a refused join
    // and finds the same session still live joins it again. Made on first use (from a handler).
    const rereaderRef = useRef<SessionRereader | null>(null);
    const rereader = (): SessionRereader => {
        rereaderRef.current ??= createSessionRereader(() => fetch("/api/streamer/sessions", { cache: "no-store" }), {
            apply: (next) => {
                const action = goneRereadAction(goneRef.current, rejoinsRef.current, next);
                goneRef.current = null;
                setData(next);
                if (action === "rejoin") {
                    rejoinsRef.current += 1;
                    setGeneration((current) => current + 1);
                } else if (action === "reload") setStale(true);
            },
            status: setReread,
        });
        return rereaderRef.current;
    };

    const session = data.session;
    const mode = summary
        ? "summary"
        : notice
          ? notice
          : session?.interrupted
            ? "interrupted"
            : session?.status === "active"
              ? "live"
              : "setup";

    const refresh = () => {
        void rereader().run();
    };

    // The server may have stored a new key: the one on the page may be dead. It is dropped, the
    // session is re-read (still live?) and the OBS box asks for a new key.
    const keyUnknown = () => {
        setViewKey(null);
        setKeyUnknown(true);
        refresh();
    };

    const newKey = (key: string) => {
        setKeyUnknown(false);
        setViewKey(key);
    };

    const created = (body: CreateStreamSessionResponse) => {
        // A re-read still on its way read the state before this session: it must not replace it.
        rereader().cancel();
        setReread("idle");
        goneRef.current = null;
        rejoinsRef.current = 0;
        setStale(false);
        setKeyUnknown(false);
        setViewKey(body.viewKey);
        setSummary(null);
        setNotice(null);
        setData((current) => ({ ...current, session: body.session, lastSettings: body.session.settings ?? current.lastSettings }));
    };

    const closedSession = (outcome: ClosedOutcome) => {
        setViewKey(null);
        setKeyUnknown(false);
        if (outcome.kind === "interrupted") {
            setData((current) =>
                current.session ? { ...current, session: { ...current.session, status: "interrupted", interrupted: true } } : current
            );
            return;
        }
        if (outcome.kind === "ended") setSummary(outcome.summary);
        else setNotice(outcome.kind);
        setData((current) => ({ ...current, session: null }));
        // Stopped by the service (mode off, or an account action): a re-read would only fail or
        // find the mode off, so the notice stands alone.
        if (outcome.kind === "stopped") return;
        // The next form is prefilled from the stored settings, live look changes included.
        refresh();
    };

    const startOver = () => {
        setReread("idle");
        setStale(false);
        setSummary(null);
        setNotice(null);
        setViewKey(null);
        setKeyUnknown(false);
        setData((current) => ({ ...current, session: null }));
    };

    const hostNotice = (received: StreamerHostNoticePayload) => {
        if (received.kind === "connection-needs-reconnect") setNeedsReconnect(true);
    };

    const liveGone = (sessionId: string) => {
        goneRef.current = sessionId;
        refresh();
    };

    const joinedLive = () => {
        rejoinsRef.current = 0;
        setStale(false);
    };

    return (
        <div data-testid="streamer-panel" className="mx-auto max-w-6xl space-y-6">
            <ChannelHeader channels={initial.channels} />
            {needsReconnect ? (
                <div
                    role="alert"
                    data-testid="streamer-reconnect-warning"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30"
                >
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">{t("streamer.panel.reconnectWarning")}</p>
                    <a href="/dashboard?tab=settings" className="text-sm font-black text-amber-900 underline dark:text-amber-100">
                        {t("streamer.goSettings")}
                    </a>
                </div>
            ) : null}
            {stale ? (
                <p
                    role="alert"
                    data-testid="streamer-stale"
                    className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200"
                >
                    {t("streamer.panel.connectionClosed")}
                </p>
            ) : null}
            {reread === "failed" ? (
                <div
                    role="alert"
                    data-testid="streamer-reread-failed"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/30"
                >
                    <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">{t("streamer.panel.rereadFailed")}</p>
                    <button type="button" onClick={refresh} className={buttonClass("plain")}>
                        {t("streamer.panel.retry")}
                    </button>
                </div>
            ) : null}
            {mode === "summary" && summary ? <SessionSummary summary={summary} onNew={startOver} /> : null}
            {mode === "idle" ? <Notice title={t("streamer.panel.idleTitle")} help={t("streamer.panel.idleHelp")} onNew={startOver} /> : null}
            {mode === "stopped" ? (
                <Notice title={t("streamer.panel.stoppedTitle")} help={t("streamer.panel.stoppedHelp")} onNew={startOver} />
            ) : null}
            {mode === "interrupted" ? (
                <Notice title={t("streamer.panel.interruptedTitle")} help={t("streamer.panel.interruptedHelp")} onNew={startOver} />
            ) : null}
            {mode === "live" && session ? (
                <LiveSession
                    key={`${session.id}#${generation}`}
                    session={session}
                    viewKey={viewKey}
                    keyUnknown={keyIsUnknown}
                    cardBacks={data.cardBacks}
                    onViewKey={newKey}
                    onKeyUnknown={keyUnknown}
                    cardHidden={cardHidden}
                    onToggleCard={toggleCard}
                    onClosed={closedSession}
                    onGone={liveGone}
                    onJoined={joinedLive}
                    onNotice={hostNotice}
                />
            ) : null}
            {mode === "setup" ? (
                <StreamerSetupForm
                    channels={initial.channels}
                    categories={initial.categories}
                    lastSettings={data.lastSettings}
                    cardBacks={data.cardBacks}
                    defaultLanguage={initial.locale === "en" ? "en" : "tr"}
                    onCreated={created}
                    onAlreadyActive={refresh}
                />
            ) : null}
        </div>
    );
}
