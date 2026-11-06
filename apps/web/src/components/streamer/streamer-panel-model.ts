import type { CameraSize, CameraSlot, HostStreamSnapshot, StreamPhase } from "@hushle/domain-streamer";
import type { StreamerPlatform } from "@hushle/platform-streamer";
import { cameraRect } from "@/components/stream/camera-rects";
import { PlayerErrorCode } from "@/lib/errors/player-error-codes";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { ScreenSettingsPatch } from "@/lib/streamer/session-settings";
import type { StreamerEndedReason, StreamerHostNoticePayload } from "@/lib/streamer/socket-contract";
import type { StreamSessionResponse, StreamSessionView, StreamUrls } from "@/types/streamer-session";

// The host panel's pure parts: the event log read off host snapshots (no server event exists for
// it), the summary when only a snapshot is left, the stream addresses (and their masked form),
// the camera hole's measurements, the gate decision of /streamer, what a closed room or a host
// notice means, and the error-path decisions (a refused host join or action, a re-read of the
// session). No DOM and no React here, so scripts/test-streamer-panel.ts runs them under node.

export type LogKind = "roundStarted" | "correct" | "passed" | "timeout" | "paused" | "resumed" | "ended";

export interface LogEntry {
    id: number;
    kind: LogKind;
    round: number;
    name?: string;
    word?: string;
}

export type LogDraft = Omit<LogEntry, "id">;

export interface ScoreEntry {
    /** The host snapshot's player id; the stored summary has none. */
    id?: string;
    name: string;
    points: number;
    rank: number;
    tied: boolean;
}

export interface PanelSummary {
    scores: ScoreEntry[];
    participants: number;
    /** Finished rounds; unknown when the summary was read off the last snapshot. */
    rounds: number | null;
}

export const LOG_LIMIT = 50;
const SUMMARY_SCORE_LIMIT = 10;

export function isLivePhase(phase: StreamPhase): boolean {
    return phase === "running" || phase === "paused";
}

export function isHostSnapshot(value: unknown): value is HostStreamSnapshot {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return record.type === "host-state" && Number.isInteger(record.revision) && Array.isArray(record.players);
}

/**
 * What happened between two host snapshots, oldest first. A rejoin after a gap compares the last
 * state seen with the new one, so missed steps fold into what is visible from the difference.
 */
export function describeTransition(prev: HostStreamSnapshot, next: HostStreamSnapshot): LogDraft[] {
    const drafts: LogDraft[] = [];
    // The finished round's word: only while that round is the one on the card.
    const word = next.phase === "finished" ? (next.reveal?.target ?? next.card?.target) : undefined;
    if (next.passed && next.passed.round !== prev.passed?.round) {
        drafts.push({ kind: "passed", round: next.passed.round, word: next.passed.target });
    }
    if (next.lastCorrect && next.lastCorrect.eventId !== prev.lastCorrect?.eventId) {
        const solved = next.lastCorrect.round === next.round ? word : undefined;
        drafts.push({ kind: "correct", round: next.lastCorrect.round, name: next.lastCorrect.name, word: solved });
    } else if (next.phase === "finished" && prev.phase !== "finished") {
        drafts.push({ kind: "timeout", round: next.round, word });
    }
    if (isLivePhase(next.phase) && (!isLivePhase(prev.phase) || next.round !== prev.round)) {
        drafts.push({ kind: "roundStarted", round: next.round });
    } else if (prev.phase === "running" && next.phase === "paused") {
        drafts.push({ kind: "paused", round: next.round });
    } else if (prev.phase === "paused" && next.phase === "running") {
        drafts.push({ kind: "resumed", round: next.round });
    }
    if (next.phase === "ended" && prev.phase !== "ended") drafts.push({ kind: "ended", round: next.round });
    return drafts;
}

/** The log is newest first and capped; one step's drafts get ids from `firstId` up. Pure: safe in a state updater. */
export function appendLog(log: LogEntry[], drafts: LogDraft[], firstId: number): LogEntry[] {
    if (drafts.length === 0) return log;
    const entries = drafts.map((draft, index) => ({ ...draft, id: firstId + index }));
    return [...entries.reverse(), ...log].slice(0, LOG_LIMIT);
}

export function summaryFromSnapshot(state: HostStreamSnapshot | null): PanelSummary {
    return {
        scores: (state?.players ?? [])
            .slice(0, SUMMARY_SCORE_LIMIT)
            .map(({ name, points, rank, tied }) => ({ name, points, rank, tied })),
        participants: state?.participants ?? 0,
        rounds: null,
    };
}

/**
 * React keys for a score list: the player id where the snapshot has one (two tied players may
 * share a name), the position otherwise (the stored summary is a fixed list without ids).
 */
export function scoreKeys(entries: ScoreEntry[]): string[] {
    return entries.map((entry, index) => entry.id ?? `#${index}`);
}

/** The same shape as the server's buildStreamUrls (lib/streamer/session-http.ts). */
export function streamUrlsFor(origin: string, viewKey: string): StreamUrls {
    const full = `${origin}/stream/${viewKey}`;
    return { full, half: `${full}?layout=half`, stripTop: `${full}?overlay=top`, stripBottom: `${full}?overlay=bottom` };
}

export const MASKED_VIEW_KEY = "••••••";

/** A stream address as the panel shows it by default: the key masked, the layout query kept. */
export function maskStreamUrl(url: string): string {
    return url.replace(/\/stream\/[^/?#]+/, `/stream/${MASKED_VIEW_KEY}`);
}

/** The card name belongs to a card back: choosing none switches the name off in the same patch. */
export function withCardNameRule(patch: ScreenSettingsPatch): ScreenSettingsPatch {
    return patch.cardBack === null ? { ...patch, showCardName: false } : patch;
}

export interface CameraHole {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** The camera hole on the 1920x1080 canvas (the stream screen's own geometry) and scaled to 720p; null without one. */
export function cameraMeasurements(slot: CameraSlot, size: CameraSize): { p1080: CameraHole; p720: CameraHole } | null {
    const rect = cameraRect(slot, size);
    if (!rect) return null;
    const scale = (value: number) => Math.round((value * 2) / 3);
    return { p1080: rect, p720: { x: scale(rect.x), y: scale(rect.y), w: scale(rect.w), h: scale(rect.h) } };
}

// ---------------------------------------------------------------- the gate of /streamer

export type StreamerGateState = "coming-soon" | "ready" | "live-reconnect" | "reconnect" | "not-linked";

/** A session the host can still drive (and must be able to end). */
export function isLiveSession(session: StreamSessionView | null): boolean {
    return session !== null && session.status === "active" && !session.interrupted;
}

/**
 * Which state /streamer shows. A session that is still live always opens the panel, so End
 * stays reachable: `ready` when its own platform's link is active, `live-reconnect` (with the
 * reconnect warning) when it is not, even if another platform's link is. Without a live session
 * any active link opens the panel; otherwise the link that needs a reconnect, or none, points to
 * the settings.
 */
export function streamerGateState(input: {
    enabled: boolean;
    activePlatforms: readonly StreamerPlatform[];
    brokenChannel: boolean;
    liveSession: StreamSessionView | null;
}): StreamerGateState {
    if (!input.enabled) return "coming-soon";
    const live = input.liveSession;
    if (live && isLiveSession(live)) return input.activePlatforms.includes(live.platform) ? "ready" : "live-reconnect";
    if (input.activePlatforms.length > 0) return "ready";
    return input.brokenChannel ? "reconnect" : "not-linked";
}

// ---------------------------------------------------------------- the host room

export type ClosedKind = "ended" | "idle" | "interrupted" | "stopped";

// Keyed by the contract's type: a reason added there fails the typecheck until it is listed.
const CLOSED_KINDS: Record<StreamerEndedReason, ClosedKind | null> = {
    ended: "ended",
    idle: "idle",
    interrupted: "interrupted",
    stopped: "stopped",
    // Only the stream screens are closed by a rotation; the host room stays.
    "view-key-rotated": null,
};

/** What a `streamer:ended` does to the panel: null keeps the host room; an unreadable reason reads as "ended". */
export function closedKindOf(payload: unknown): ClosedKind | null {
    const reason = payload && typeof payload === "object" ? (payload as { reason?: unknown }).reason : undefined;
    if (typeof reason === "string" && Object.hasOwn(CLOSED_KINDS, reason)) return CLOSED_KINDS[reason as StreamerEndedReason];
    return "ended";
}

/** A host notice the panel knows; anything else is ignored. */
export function hostNoticeOf(payload: unknown): StreamerHostNoticePayload | null {
    if (typeof payload !== "object" || payload === null) return null;
    const { kind, platform } = payload as Record<string, unknown>;
    if (kind !== "connection-needs-reconnect") return null;
    if (platform !== "twitch" && platform !== "kick") return null;
    return { kind, platform };
}

export type ConnectionState = "connecting" | "joined" | "reconnecting" | "closed" | "gone" | "off";

/**
 * The live view's connection badge. A gone session has none: the panel's re-read (or its retry
 * banner) speaks. Streamer mode off has none either: its own notice says what to do.
 */
export function connectionLabel(state: ConnectionState): TranslationKey | null {
    switch (state) {
        case "joined":
            return "streamer.panel.connected";
        case "connecting":
            return "streamer.panel.connecting";
        case "reconnecting":
            return "streamer.panel.reconnecting";
        case "closed":
            return "streamer.panel.connectionClosed";
        case "gone":
        case "off":
            return null;
    }
}

/** Rejoins of one session in a row (no join got through in between) before the panel asks for a reload. */
export const MAX_REJOINS_IN_A_ROW = 2;

/**
 * What the panel does with a re-read that followed a refused host join (`goneSessionId`). The
 * same session still live: join it again with a fresh connection (the live view stopped its
 * socket), unless that already failed a few times in a row; then the host is told to reload.
 * Anything else (another session, an interrupted or no session) is simply what the view shows.
 */
export function goneRereadAction(goneSessionId: string | null, rejoinsInARow: number, data: StreamSessionResponse): "rejoin" | "reload" | "none" {
    if (goneSessionId === null) return "none";
    const session = data.session;
    if (!session || session.id !== goneSessionId || !isLiveSession(session)) return "none";
    return rejoinsInARow < MAX_REJOINS_IN_A_ROW ? "rejoin" : "reload";
}

// ---------------------------------------------------------------- error paths

export type JoinRefusalAction = "gone" | "signedOut" | "disabled" | "retry";

/**
 * What a refused host join does: a session that is gone (or not this user's) is re-read, a
 * sign-out (or a suspension) or streamer mode switched off stops for good since no retry can
 * pass, anything else (rate limit, server error, no answer) is asked again shortly.
 */
export function joinRefusalAction(code: unknown): JoinRefusalAction {
    if (code === PlayerErrorCode.STREAMER_SESSION_NOT_FOUND || code === PlayerErrorCode.STREAMER_SESSION_NOT_OWNED) return "gone";
    if (code === PlayerErrorCode.AUTH_REQUIRED) return "signedOut";
    if (code === PlayerErrorCode.STREAMER_MODE_DISABLED) return "disabled";
    return "retry";
}

/** A refused round action: streamer mode switched off stops the panel; anything else is shown. */
export function actionRefusalAction(code: unknown): "disabled" | "failed" {
    return code === PlayerErrorCode.STREAMER_MODE_DISABLED ? "disabled" : "failed";
}

export type RereadStatus = "idle" | "loading" | "failed";

export interface RereadHandlers {
    apply(data: StreamSessionResponse): void;
    status(status: RereadStatus): void;
}

function isSessionResponse(value: unknown): value is StreamSessionResponse {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return typeof record.enabled === "boolean" && "session" in record && "lastSettings" in record && Array.isArray(record.cardBacks);
}

/**
 * Re-reads GET /api/streamer/sessions (`load` does the request). Every failure (network, a
 * non-OK answer, an unreadable body) ends in "failed" so the panel can offer a retry; nothing is
 * applied then.
 */
export async function rereadSession(load: () => Promise<Response>, handlers: RereadHandlers): Promise<void> {
    handlers.status("loading");
    let data: StreamSessionResponse;
    try {
        const response = await load();
        if (!response.ok) throw new Error(`session view failed (${response.status})`);
        const body: unknown = await response.json();
        if (!isSessionResponse(body)) throw new Error("session view unreadable");
        data = body;
    } catch {
        handlers.status("failed");
        return;
    }
    handlers.apply(data);
    handlers.status("idle");
}

export interface SessionRereader {
    run(): Promise<void>;
    /** Drops every answer still on its way (the panel just set a newer state itself). */
    cancel(): void;
}

/**
 * rereadSession with a sequence guard: when re-reads overlap, only the newest one applies its
 * answer or reports its status, so an older (slower) answer never overwrites a newer one.
 */
export function createSessionRereader(load: () => Promise<Response>, handlers: RereadHandlers): SessionRereader {
    let sequence = 0;
    return {
        run: () => {
            const mine = ++sequence;
            return rereadSession(load, {
                apply: (data) => {
                    if (mine === sequence) handlers.apply(data);
                },
                status: (status) => {
                    if (mine === sequence) handlers.status(status);
                },
            });
        },
        cancel: () => {
            sequence += 1;
        },
    };
}
