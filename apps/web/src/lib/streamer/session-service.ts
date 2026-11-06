import { createStreamSession } from "@hushle/domain-streamer";
import { reportError } from "@hushle/platform-observability";
import type { StreamerConnectionStore, StreamerPlatform } from "@hushle/platform-streamer";
import { resolveCardBackSelection, type CardBackLoaders } from "./card-backs";
import { createSessionInputSchema, toScreenSettings, type CreateSessionInput } from "./session-settings";
import { StreamerSessionError, type StreamerErrorReporter, type StreamerSessionRuntime } from "./session-runtime";
import {
    streamSessionSummarySchema,
    type StreamSessionRecord,
    type StreamSessionStatusValue,
    type StreamSessionStore,
    type StreamSessionSummary,
} from "./session-store";
import { createViewKey } from "./view-key";

// What the /streamer routes do with a session: open one on an active channel link, read the
// current one, end it, rotate its stream-screen key and prefill the next form. Live state is the
// runtime's; this layer only decides who may open what and keeps the rows truthful.

export { isStreamerSessionError, StreamerSessionError, type StreamerSessionErrorCode } from "./session-runtime";
export { createSessionInputSchema, type CreateSessionInput } from "./session-settings";

/** What a session row may show outside the service: never the view key hash, owner or link ids. */
export interface StreamSessionView {
    id: string;
    status: StreamSessionStatusValue;
    /** The process that ran it went away; the panel offers a new session. */
    interrupted: boolean;
    platform: StreamerPlatform;
    /** The stored input; null when it no longer reads as one. */
    settings: CreateSessionInput | null;
    startedAt: string;
    endedAt: string | null;
    roundCount: number;
    summary: StreamSessionSummary | null;
}

/** An interrupted session stays on the panel this long after it ended; then the panel offers a new one. */
export const INTERRUPTED_NOTICE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The observability path for streamer session failures. The session id travels as `streamId`:
 * the observability sanitizer drops context keys that name a session as sensitive.
 */
export const reportStreamerSessionError: StreamerErrorReporter = (event, error, context) => {
    void reportError({ service: "hushle-web", event, error, ...(context ? { context: { streamId: context.sessionId } } : {}) }).catch(
        () => undefined,
    );
};

// Rows already reported as unreadable (once per row and process); the oldest are forgotten past
// the bound. On globalThis, as the custom server and the route bundles each load this module.
const MAX_REPORTED_ROWS = 1_000;
const globalForReports = globalThis as typeof globalThis & { __hushleStreamerUnreadableRows?: Set<string> };
const reportedRows = (globalForReports.__hushleStreamerUnreadableRows ??= new Set<string>());

function reportUnreadable(record: StreamSessionRecord, fields: string[], onError: StreamerErrorReporter): void {
    if (reportedRows.has(record.id)) return;
    if (reportedRows.size >= MAX_REPORTED_ROWS) reportedRows.delete(reportedRows.values().next().value as string);
    reportedRows.add(record.id);
    try {
        // The field names only: never the stored values.
        onError("streamer_session.row_unreadable", new Error(`stream session row: unreadable ${fields.join(", ")}`), { sessionId: record.id });
    } catch {
        // Reading a row never fails because its report did.
    }
}

/** The outside view of a row; a stored settings or summary that no longer parses reads as null and is reported once. */
export function toSessionView(record: StreamSessionRecord, onError: StreamerErrorReporter = reportStreamerSessionError): StreamSessionView {
    const settings = createSessionInputSchema.safeParse(record.settings);
    // The summary is written when the session ends: none yet is nothing unreadable.
    const summary = record.summary === null || record.summary === undefined ? null : streamSessionSummarySchema.safeParse(record.summary);
    const unreadable = [...(settings.success ? [] : ["settings"]), ...(summary && !summary.success ? ["summary"] : [])];
    if (unreadable.length > 0) reportUnreadable(record, unreadable, onError);
    return {
        id: record.id,
        status: record.status,
        interrupted: record.status === "interrupted",
        platform: record.platform,
        settings: settings.success ? settings.data : null,
        startedAt: record.startedAt.toISOString(),
        endedAt: record.endedAt ? record.endedAt.toISOString() : null,
        roundCount: record.roundCount,
        summary: summary?.success ? summary.data : null,
    };
}

export interface StreamerSessionServiceDeps {
    sessions: StreamSessionStore;
    connections: Pick<StreamerConnectionStore, "findByUserAndPlatform">;
    runtime: StreamerSessionRuntime;
    /** The owner switches that decide what a session may choose. */
    getFeatureFlags(): Promise<{ streamerShowcaseAllCosmetics: boolean }>;
    /** Inventory and catalogue loaders for card backs; the real ones when absent (tests inject fakes). */
    cardBackLoaders?: CardBackLoaders;
    now?: () => number;
    /** Where unreadable rows are reported; the observability path when absent. */
    onError?: StreamerErrorReporter;
}

function clock(deps: StreamerSessionServiceDeps): number {
    return deps.now ? deps.now() : Date.now();
}

// One session per user (spec karar 6): an application lock instead of a partial unique index.
// It lives on globalThis so the custom server and the Next route bundles share it.
const globalForLocks = globalThis as typeof globalThis & {
    __hushleStreamerSessionLocks?: Map<number, Promise<unknown>>;
};
const userLocks = (globalForLocks.__hushleStreamerSessionLocks ??= new Map<number, Promise<unknown>>());

async function withUserLock<T>(userId: number, task: () => Promise<T>): Promise<T> {
    const result = (userLocks.get(userId) ?? Promise.resolve()).then(task);
    const tail = result.catch(() => undefined);
    userLocks.set(userId, tail);
    try {
        return await result;
    } finally {
        if (userLocks.get(userId) === tail) userLocks.delete(userId);
    }
}

// An `active` row this process does not run (a failed end write, a lost runtime) can never
// resume: it is interrupted, exactly as boot reconciliation would have done. The write is
// conditional: null means the row stopped being active meanwhile (an end write just landed).
async function interruptStale(deps: StreamerSessionServiceDeps, row: StreamSessionRecord): Promise<StreamSessionRecord | null> {
    return deps.sessions.markInterrupted(row.id, new Date(clock(deps)));
}

/** Stale rows read per pass; passes repeat until none is left. */
const STALE_ROW_BATCH = 10;

/**
 * Interrupts every `active` row of the user, batch by batch, until none is left: called when no
 * live session of theirs runs here, so each is a leftover. A row that stops being active on its
 * own (an end write landing) drops out of the next batch. One that comes back still active after
 * its interrupt is refused rather than looped on or left beside a new session.
 */
async function interruptStaleRows(deps: StreamerSessionServiceDeps, userId: number): Promise<void> {
    const tried = new Set<string>();
    for (;;) {
        const batch = await deps.sessions.listActiveByUser(userId, STALE_ROW_BATCH);
        if (batch.length === 0) return;
        for (const row of batch) {
            if (deps.runtime.get(row.id)) throw new StreamerSessionError("session_active");
            if (tried.has(row.id)) throw new Error("streamer session: a stale active row could not be interrupted");
            tried.add(row.id);
            await interruptStale(deps, row);
        }
    }
}

/** An interrupted row is shown on the panel for a while after it ended (its start, when no end was written). */
function noticeExpired(deps: StreamerSessionServiceDeps, row: StreamSessionRecord): boolean {
    if (row.status !== "interrupted") return false;
    const at = (row.endedAt ?? row.startedAt).getTime();
    return clock(deps) - at > INTERRUPTED_NOTICE_TTL_MS;
}

async function featureFlagsOf(deps: StreamerSessionServiceDeps): Promise<{ streamerShowcaseAllCosmetics: boolean }> {
    try {
        return await deps.getFeatureFlags();
    } catch {
        throw new StreamerSessionError("card_catalogue_unavailable");
    }
}

export async function createSession(
    deps: StreamerSessionServiceDeps,
    input: { userId: number; settings: CreateSessionInput },
): Promise<{ session: StreamSessionView; viewKey: string }> {
    const settings = createSessionInputSchema.parse(input.settings);
    const { userId } = input;
    return withUserLock(userId, async () => {
        if (deps.runtime.forUser(userId)) throw new StreamerSessionError("session_active");
        await interruptStaleRows(deps, userId);
        const connection = await deps.connections.findByUserAndPlatform(userId, settings.platform);
        if (!connection || connection.status !== "active") throw new StreamerSessionError("connection_required");

        // The availability window is judged by the service clock, the one every other check here uses.
        const cardBack = settings.cardBack
            ? await resolveCardBackSelection(userId, settings.cardBack.itemId, await featureFlagsOf(deps), deps.cardBackLoaders, () => clock(deps))
            : null;

        const now = clock(deps);
        const { viewKey, hash } = createViewKey();
        const session = await deps.sessions.create({
            userId,
            connectionId: connection.id,
            platform: settings.platform,
            settings,
            viewKeyHash: hash,
            startedAt: new Date(now),
        });
        const state = createStreamSession(toScreenSettings(settings, { platform: connection.platform, name: connection.login }, cardBack), now);
        try {
            deps.runtime.open(session, state);
        } catch (error) {
            // Never leave an `active` row nobody runs.
            await interruptStale(deps, session);
            throw error;
        }
        return { session: toSessionView(session, deps.onError), viewKey };
    });
}

/**
 * The user's newest session while it is live, or once it was interrupted, for
 * INTERRUPTED_NOTICE_TTL_MS after it ended (the panel offers a new one then); null when there is
 * none, the newest has ended, or its interruption is older than that.
 */
export async function currentSession(deps: StreamerSessionServiceDeps, userId: number): Promise<StreamSessionView | null> {
    return withUserLock(userId, async () => {
        const shown = (row: StreamSessionRecord | null) =>
            row && row.status !== "ended" && !noticeExpired(deps, row) ? toSessionView(row, deps.onError) : null;
        const [latest] = await deps.sessions.listRecent(userId, 1);
        if (!latest || latest.status === "ended") return null;
        if (latest.status !== "active" || deps.runtime.get(latest.id)) return shown(latest);
        const interrupted = await interruptStale(deps, latest);
        if (interrupted) return shown(interrupted);
        // No longer active: an end landed in between (or another reconcile won); read what it is now.
        return shown(await deps.sessions.findById(latest.id));
    });
}

function liveSessionOf(deps: StreamerSessionServiceDeps, userId: number) {
    const live = deps.runtime.forUser(userId);
    if (!live) throw new StreamerSessionError("not_found");
    return live;
}

export async function endCurrent(
    deps: StreamerSessionServiceDeps,
    userId: number,
): Promise<{ sessionId: string; summary: StreamSessionSummary }> {
    const live = liveSessionOf(deps, userId);
    const summary = await deps.runtime.end(live.id, "ended");
    return { sessionId: live.id, summary };
}

export async function rotateViewKey(deps: StreamerSessionServiceDeps, userId: number): Promise<{ viewKey: string }> {
    const live = liveSessionOf(deps, userId);
    return deps.runtime.rotateViewKey(live.id);
}

/** The newest session's settings, to prefill the next one; null when absent or no longer valid. */
export async function lastSettings(deps: StreamerSessionServiceDeps, userId: number): Promise<CreateSessionInput | null> {
    const [latest] = await deps.sessions.listRecent(userId, 1);
    if (!latest) return null;
    const parsed = createSessionInputSchema.safeParse(latest.settings);
    return parsed.success ? parsed.data : null;
}
