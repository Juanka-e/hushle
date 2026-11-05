import type { CameraSize, CameraSlot, HostStreamSnapshot, StreamPhase } from "@hushle/domain-streamer";
import { cameraRect } from "@/components/stream/stream-renderer";
import type { StreamUrls } from "@/types/streamer-session";

// The host panel's pure parts: the event log read off host snapshots (no server event exists for
// it), the summary when only a snapshot is left, the stream addresses and the camera hole's
// measurements. No DOM and no React here, so scripts/test-streamer-panel.ts runs them under node.

export type LogKind = "roundStarted" | "correct" | "passed" | "timeout" | "paused" | "resumed" | "ended";

export interface LogEntry {
    id: number;
    kind: LogKind;
    round: number;
    name?: string;
    word?: string;
}

export type LogDraft = Omit<LogEntry, "id">;

export interface PanelSummary {
    scores: Array<{ name: string; points: number; rank: number; tied: boolean }>;
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

/** The same shape as the server's buildStreamUrls (lib/streamer/session-http.ts). */
export function streamUrlsFor(origin: string, viewKey: string): StreamUrls {
    const full = `${origin}/stream/${viewKey}`;
    return { full, half: `${full}?layout=half`, stripTop: `${full}?overlay=top`, stripBottom: `${full}?overlay=bottom` };
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
