import { createStreamSession } from "@hushle/domain-streamer";
import type { StreamerConnectionStore } from "@hushle/platform-streamer";
import { createSessionInputSchema, toScreenSettings, type CreateSessionInput } from "./session-settings";
import { StreamerSessionError, type StreamerSessionRuntime } from "./session-runtime";
import type { StreamSessionRecord, StreamSessionStore, StreamSessionSummary } from "./session-store";
import { createViewKey } from "./view-key";

// What the /streamer routes do with a session: open one on an active channel link, read the
// current one, end it, rotate its stream-screen key and prefill the next form. Live state is the
// runtime's; this layer only decides who may open what and keeps the rows truthful.

export { StreamerSessionError, type StreamerSessionErrorCode } from "./session-runtime";
export { createSessionInputSchema, type CreateSessionInput } from "./session-settings";

export interface StreamerSessionServiceDeps {
    sessions: StreamSessionStore;
    connections: Pick<StreamerConnectionStore, "findByUserAndPlatform">;
    runtime: StreamerSessionRuntime;
    now?: () => number;
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
// resume: it is interrupted, exactly as boot reconciliation would have done.
async function interruptStale(deps: StreamerSessionServiceDeps, row: StreamSessionRecord): Promise<StreamSessionRecord> {
    return deps.sessions.update(row.id, { status: "interrupted", endedAt: new Date(clock(deps)) });
}

const MAX_STALE_ROWS = 10;

export async function createSession(
    deps: StreamerSessionServiceDeps,
    input: { userId: number; settings: CreateSessionInput },
): Promise<{ session: StreamSessionRecord; viewKey: string }> {
    const settings = createSessionInputSchema.parse(input.settings);
    const { userId } = input;
    return withUserLock(userId, async () => {
        if (deps.runtime.forUser(userId)) throw new StreamerSessionError("session_active");
        for (let attempt = 0; attempt < MAX_STALE_ROWS; attempt++) {
            const active = await deps.sessions.findActiveByUser(userId);
            if (!active) break;
            if (deps.runtime.get(active.id)) throw new StreamerSessionError("session_active");
            await interruptStale(deps, active);
        }
        const connection = await deps.connections.findByUserAndPlatform(userId, settings.platform);
        if (!connection || connection.status !== "active") throw new StreamerSessionError("connection_required");

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
        const state = createStreamSession(toScreenSettings(settings, { platform: connection.platform, name: connection.login }), now);
        try {
            deps.runtime.open(session, state);
        } catch (error) {
            // Never leave an `active` row nobody runs.
            await interruptStale(deps, session);
            throw error;
        }
        return { session, viewKey };
    });
}

/**
 * The user's newest session while it is live, or once it was interrupted (the panel offers a new
 * one then); null when there is none or the newest has ended.
 */
export async function currentSession(deps: StreamerSessionServiceDeps, userId: number): Promise<StreamSessionRecord | null> {
    return withUserLock(userId, async () => {
        const [latest] = await deps.sessions.listRecent(userId, 1);
        if (!latest || latest.status === "ended") return null;
        if (latest.status === "active" && !deps.runtime.get(latest.id)) return interruptStale(deps, latest);
        return latest;
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
