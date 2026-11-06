import type { Server, Socket } from "socket.io";
import { z } from "zod";
import type { HostStreamSnapshot, StreamCardBack } from "@hushle/domain-streamer";
import { reportError } from "@hushle/platform-observability";
import { PlayerErrorCode } from "@/lib/errors/player-error-codes";
import { getSocketClientIp } from "@/lib/security/client-ip";
import { consumeDistributedRequestRateLimit } from "@/lib/security/request-rate-limit";
import { resolveCardBackSelection, type CardBackFeatures } from "@/lib/streamer/card-backs";
import { storeFailure } from "@/lib/streamer/session-persistence";
import {
    isStreamerSessionError,
    StreamerSessionError,
    type LiveStreamSession,
    type StreamerSessionErrorCode,
    type StreamerSessionRuntime,
} from "@/lib/streamer/session-runtime";
import { screenSettingsPatchSchema, type ResolvedScreenPatch } from "@/lib/streamer/session-settings";
import type { StreamSessionStore } from "@/lib/streamer/session-store";
import { STREAMER_SOCKET_EVENTS, type StreamerEndedPayload } from "@/lib/streamer/socket-contract";
import { getStreamerModeState, type StreamerModeState } from "@/lib/streamer/streamer-mode";
import { hashViewKey, STREAMER_VIEW_KEY_LIMIT, VIEW_KEY_BYTES } from "@/lib/streamer/view-key";
import { getSystemSettings } from "@/lib/system-settings/service";
import { getSocketAuthState, isTrustedSocketOrigin } from "./game-socket";
import { emitPlayerError, playerErrorAck } from "./player-error-emit";
import { assertNoSecret, StreamerSecretLeakError } from "./streamer-leak-guard";
import { joinUserSessionRoom } from "./user-session-control";

// Streamer mode over Socket.IO (phase 2). The owner's host room carries the secret card; the
// public room (the stream screen, opened with the view key) never does. One process runs every
// live session (ADR-003): the runtime pushes each state change here and this layer fans it out.

export const STREAMER_HOST_ACTION_BURST = { windowMs: 10_000, maxRequests: 10 } as const;
export const STREAMER_HOST_JOIN_BURST = { windowMs: 10_000, maxRequests: 10 } as const;
export const STREAMER_PUBLIC_JOIN_LIMIT = { bucket: "streamer-public-join", windowMs: 60_000, maxRequests: 30 } as const;

/** Distinct (round, rule) pairs a session's blocked-state reports remember before starting over. */
const MAX_BLOCKED_REPORTS_PER_SESSION = 256;
/** Sessions whose blocked-state reports are remembered at once; past it the oldest is forgotten. */
const MAX_BLOCKED_REPORT_SESSIONS = 1_000;

// base64url of 32 random bytes, without padding.
const VIEW_KEY_LENGTH = Math.ceil((VIEW_KEY_BYTES * 4) / 3);

export function streamerHostRoom(sessionId: string): string {
    return `streamer:host:${sessionId}`;
}

export function streamerPublicRoom(sessionId: string): string {
    return `streamer:public:${sessionId}`;
}

export interface StreamerSocketUser {
    userId: number | null;
    isSuspended: boolean;
}

/** Seams for tests; production uses the cookie session, the shared limiter and the real catalogue. */
export interface StreamerSocketOptions {
    resolveUser?: (socket: Socket) => Promise<StreamerSocketUser>;
    rateLimit?: typeof consumeDistributedRequestRateLimit;
    features?: () => Promise<CardBackFeatures>;
    /** The authoritative streamer-mode switch (streamer-mode.ts); only "off" refuses. */
    streamerMode?: () => Promise<StreamerModeState>;
    resolveCardBack?: (userId: number, itemId: number, features: CardBackFeatures) => Promise<StreamCardBack>;
    /** Clock of the per-socket host burst windows. */
    now?: () => number;
    /** Burst windows held at most (default MAX_BURST_WINDOWS). */
    maxBurstWindows?: number;
    onError?: (event: string, error: unknown) => void;
}

// ---------------------------------------------------------------- payloads and replies

const hostJoinSchema = z.object({ sessionId: z.string().uuid() }).strict();
const noPayloadSchema = z.union([z.undefined(), z.object({}).strict()]);
const endSchema = z.union([z.undefined(), z.object({ reason: z.literal("ended").optional() }).strict()]);
const settingsSchema = screenSettingsPatchSchema.refine((patch) => Object.keys(patch).length > 0);
const publicJoinSchema = z
    .object({ viewKey: z.string().length(VIEW_KEY_LENGTH).regex(/^[A-Za-z0-9_-]+$/) })
    .strict();

const SESSION_ERROR_CODES: Record<StreamerSessionErrorCode, PlayerErrorCode> = {
    session_active: PlayerErrorCode.STREAMER_SESSION_ACTIVE,
    connection_required: PlayerErrorCode.STREAMER_CONNECTION_REQUIRED,
    not_found: PlayerErrorCode.STREAMER_SESSION_NOT_FOUND,
    invalid_phase: PlayerErrorCode.STREAMER_ACTION_INVALID_PHASE,
    invalid_settings: PlayerErrorCode.INVALID_REQUEST,
    word_source_empty: PlayerErrorCode.STREAMER_WORD_POOL_EMPTY,
    card_not_allowed: PlayerErrorCode.STREAMER_CARD_NOT_ALLOWED,
    card_catalogue_unavailable: PlayerErrorCode.STREAMER_CARD_CATALOGUE_UNAVAILABLE,
    busy: PlayerErrorCode.SERVER_BUSY,
};

/** An expected refusal: answered with its code, never reported. */
class Refusal extends Error {
    constructor(readonly code: PlayerErrorCode) {
        super(code);
        this.name = "Refusal";
    }
}

function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
    const result = schema.safeParse(payload);
    if (!result.success) throw new Refusal(PlayerErrorCode.INVALID_REQUEST);
    return result.data;
}

interface StreamerSocketData {
    streamerHostSessionId?: string;
    streamerHostUserId?: number;
    streamerPublicSessionId?: string;
}

function dataOf(socket: Socket): StreamerSocketData {
    return socket.data as StreamerSocketData;
}

/** Burst windows held before the expired ones are swept (per socket and per user). */
const BURST_SWEEP_FROM = 1_000;
/**
 * Burst windows held at most. A full map gives no new window to a socket that joined no host room
 * (its events answer RATE_LIMITED); an owner's windows (a socket in a host room, `user:<id>`) still
 * open, and a key whose own window ended reuses its slot.
 */
export const MAX_BURST_WINDOWS = 10_000;

export interface BurstLimiterOptions {
    /** Default MAX_BURST_WINDOWS. */
    maxWindows?: number;
    /** Called on each sweep (tests count them). */
    onSweep?: () => void;
}

/**
 * Fixed windows per key. Expired windows are swept once the map holds BURST_SWEEP_FROM of them
 * (or is full), at most once per window length, so a consume stays O(1) amortised however many
 * keys there are.
 */
export function createBurstLimiter(now: () => number, options: BurstLimiterOptions = {}) {
    const maxWindows = options.maxWindows ?? MAX_BURST_WINDOWS;
    const sweepFrom = Math.min(BURST_SWEEP_FROM, maxWindows);
    const windows = new Map<string, { startedAt: number; count: number; windowMs: number }>();
    let sweptAt = Number.NEGATIVE_INFINITY;
    return {
        /** `trusted`: the key belongs to a signed-in owner, so a full map still opens it. */
        consume(key: string, limit: { windowMs: number; maxRequests: number }, trusted = false): boolean {
            const at = now();
            // A clock that went back sweeps too, rather than never again.
            if (windows.size >= sweepFrom && (at - sweptAt >= limit.windowMs || at < sweptAt)) {
                sweptAt = at;
                options.onSweep?.();
                for (const [stale, window] of windows) if (at - window.startedAt >= window.windowMs) windows.delete(stale);
            }
            const current = windows.get(key);
            if (!current || at - current.startedAt >= limit.windowMs) {
                if (!current && !trusted && windows.size >= maxWindows) return false;
                windows.set(key, { startedAt: at, count: 1, windowMs: limit.windowMs });
                return true;
            }
            if (current.count >= limit.maxRequests) return false;
            current.count += 1;
            return true;
        },
        forget(socketId: string): void {
            windows.delete(`${socketId}:host-action`);
            windows.delete(`${socketId}:host-join`);
        },
        /** Windows held now. */
        size: () => windows.size,
    };
}

// ---------------------------------------------------------------- defaults

async function resolveSocketUser(socket: Socket): Promise<StreamerSocketUser> {
    const state = await getSocketAuthState(socket);
    return { userId: state.userId, isSuspended: state.isSuspended };
}

async function showcaseFeatures(): Promise<CardBackFeatures> {
    const { features } = await getSystemSettings();
    return { streamerShowcaseAllCosmetics: features.streamerShowcaseAllCosmetics === true };
}

/** What an unexpected handler failure is reported as, beside its error name and Prisma code. */
const SOCKET_FAILURE_MESSAGE = "streamer socket event failed";

function reportStreamerSocketError(event: string, error: unknown): void {
    void reportError({ service: "hushle-web", event, error }).catch(() => undefined);
}

// ---------------------------------------------------------------- wiring

export function setupStreamerSocket(
    io: Server,
    runtime: StreamerSessionRuntime,
    store: Pick<StreamSessionStore, "findByViewKeyHash">,
    options: StreamerSocketOptions = {},
): void {
    const resolveUser = options.resolveUser ?? resolveSocketUser;
    const rateLimit = options.rateLimit ?? consumeDistributedRequestRateLimit;
    const features = options.features ?? showcaseFeatures;
    const readMode = options.streamerMode ?? getStreamerModeState;
    const resolveCardBack: NonNullable<StreamerSocketOptions["resolveCardBack"]> =
        options.resolveCardBack ?? ((userId, itemId, flags) => resolveCardBackSelection(userId, itemId, flags));
    const reporter = options.onError ?? reportStreamerSocketError;
    const burst = createBurstLimiter(options.now ?? Date.now, { maxWindows: options.maxBurstWindows });
    const EVENTS = STREAMER_SOCKET_EVENTS;

    // A reporter that throws never costs a caller its answer, nor the runtime its emit.
    function report(event: string, error: unknown): void {
        try {
            reporter(event, error);
        } catch {
            // Reporting is best effort.
        }
    }

    // A blocked state is reported once per session, round and rule: a projection that keeps
    // tripping the guard (each tick, each join) would otherwise flood observability.
    const blockedReports = new Map<string, Set<string>>();
    function reportBlocked(sessionId: string, round: unknown, error: StreamerSecretLeakError): void {
        // Nothing to check against means no live session: no end would ever clean that entry up.
        if (error.rule === "no-reference") {
            report("streamer_socket.public_state_blocked", error);
            return;
        }
        let seen = blockedReports.get(sessionId);
        if (!seen) {
            if (blockedReports.size >= MAX_BLOCKED_REPORT_SESSIONS) blockedReports.delete(blockedReports.keys().next().value as string);
            blockedReports.set(sessionId, (seen = new Set()));
        }
        const key = `${typeof round === "number" ? round : "?"}:${error.rule}`;
        if (seen.has(key)) return;
        if (seen.size >= MAX_BLOCKED_REPORTS_PER_SESSION) seen.clear();
        seen.add(key);
        report("streamer_socket.public_state_blocked", error);
    }

    // ------------------------------------------------------------ runtime -> rooms

    // The host projection of the change being emitted (it always precedes the public one): the
    // guard's reference once a closing session is gone from the runtime.
    const pendingHost = new Map<string, HostStreamSnapshot>();

    runtime.setEmitter((sessionId, kind, payload) => {
        if (kind === "host") {
            pendingHost.set(sessionId, payload as HostStreamSnapshot);
            io.to(streamerHostRoom(sessionId)).emit(EVENTS.hostState, payload);
            return;
        }
        const host = pendingHost.get(sessionId);
        pendingHost.delete(sessionId);
        const reference = runtime.get(sessionId) ?? (host ? { hostSnapshot: () => host } : null);
        let checked: Record<string, unknown>;
        try {
            if (!reference) throw new StreamerSecretLeakError("no-reference", "no host projection to check against");
            checked = assertNoSecret(payload, reference);
        } catch (error) {
            const round = host ? host.round : (payload as { round?: unknown }).round;
            if (error instanceof StreamerSecretLeakError) reportBlocked(sessionId, round, error);
            else report("streamer_socket.public_state_blocked", error);
            return;
        }
        // The checked copy goes out, never the payload: nothing is read from it after the check.
        io.to(streamerPublicRoom(sessionId)).emit(EVENTS.publicState, checked);
    });

    runtime.setOnEnded((sessionId, reason) => {
        pendingHost.delete(sessionId);
        blockedReports.delete(sessionId);
        const rooms = [streamerHostRoom(sessionId), streamerPublicRoom(sessionId)];
        const ended: StreamerEndedPayload = { reason };
        io.to(rooms).emit(EVENTS.ended, ended);
        io.in(rooms).socketsLeave(rooms);
    });

    // Host room only: what the streamer should act on beside the game (a link needing a reconnect).
    runtime.setOnHostNotice((sessionId, notice) => {
        io.to(streamerHostRoom(sessionId)).emit(EVENTS.hostNotice, notice);
    });

    // The old stream screens go dark; the host keeps its room and gets the new key in its ack.
    runtime.setOnViewKeyRotated((sessionId) => {
        const room = streamerPublicRoom(sessionId);
        const ended: StreamerEndedPayload = { reason: "view-key-rotated" };
        io.to(room).emit(EVENTS.ended, ended);
        io.in(room).socketsLeave(room);
    });

    // ------------------------------------------------------------ helpers

    function failureCode(event: string, error: unknown): PlayerErrorCode {
        if (error instanceof Refusal) return error.code;
        if (isStreamerSessionError(error)) return SESSION_ERROR_CODES[error.code] ?? PlayerErrorCode.UNKNOWN_ERROR;
        if (error instanceof StreamerSecretLeakError) return PlayerErrorCode.UNKNOWN_ERROR;
        // Sanitized: a database or limiter error can echo its call (a view-key hash, an address).
        report(`streamer_socket.${event.slice("streamer:".length).replaceAll(":", "_")}_failed`, storeFailure(error, SOCKET_FAILURE_MESSAGE));
        return PlayerErrorCode.UNKNOWN_ERROR;
    }

    /**
     * Runs a handler with one optional payload; acks `{ ok: true, ...result }` or `playerErrorAck(code)`
     * (`hata` without an ack). The answer leaves exactly once, from `finally`, whatever fails on the way.
     */
    function handle(socket: Socket, event: string, run: (payload: unknown) => Promise<Record<string, unknown> | void>): void {
        socket.on(event, async (...args: unknown[]) => {
            const ack = typeof args[args.length - 1] === "function" ? (args.pop() as (reply: unknown) => void) : null;
            let reply: unknown = playerErrorAck(PlayerErrorCode.UNKNOWN_ERROR);
            let failed: PlayerErrorCode | null = PlayerErrorCode.UNKNOWN_ERROR;
            try {
                if (args.length > 1) throw new Refusal(PlayerErrorCode.INVALID_REQUEST);
                reply = { ok: true, ...(await run(args[0])) };
                failed = null;
            } catch (error) {
                failed = failureCode(event, error);
                reply = playerErrorAck(failed);
            } finally {
                try {
                    if (ack) ack(reply);
                    else if (failed) emitPlayerError(socket, failed);
                } catch {
                    // The socket went away: there is nobody left to answer.
                }
            }
        });
    }

    /** The live session of the host room this socket joined; refused otherwise. */
    function joinedSession(socket: Socket): LiveStreamSession {
        const data = dataOf(socket);
        const sessionId = data.streamerHostSessionId;
        // The room, not the field: an ended session's rooms are emptied while the field stays.
        if (!sessionId || !socket.rooms.has(streamerHostRoom(sessionId))) throw new Refusal(PlayerErrorCode.STREAMER_SESSION_NOT_FOUND);
        const live = runtime.get(sessionId);
        if (!live) throw new Refusal(PlayerErrorCode.STREAMER_SESSION_NOT_FOUND);
        if (live.userId !== data.streamerHostUserId) throw new Refusal(PlayerErrorCode.STREAMER_SESSION_NOT_OWNED);
        return live;
    }

    /**
     * While the admin has streamer mode off, nothing but ending is served (the kill switch ends
     * the rest). Only an authoritative "off" refuses: "unknown" (the database away) keeps the live
     * sessions working.
     */
    async function streamerModeOn(): Promise<boolean> {
        return (await readMode()) !== "off";
    }

    async function cardBackFor(userId: number, itemId: number): Promise<StreamCardBack> {
        let flags: CardBackFeatures;
        try {
            flags = await features();
        } catch (error) {
            report("streamer_socket.features_failed", storeFailure(error, SOCKET_FAILURE_MESSAGE));
            throw new StreamerSessionError("card_catalogue_unavailable");
        }
        return resolveCardBack(userId, itemId, flags);
    }

    // ------------------------------------------------------------ connections

    io.on("connection", (socket: Socket) => {
        if (!isTrustedSocketOrigin(socket)) {
            // In the app the game handler has already refused and dropped it; alone, this one does.
            if (socket.connected) {
                emitPlayerError(socket, PlayerErrorCode.ORIGIN_REJECTED);
                socket.disconnect(true);
            }
            return;
        }

        // Per socket, and once the socket joined a host room per user as well (`user:<id>`, the
        // same 10 / 10 s): a second tab of the owner shares the user's window instead of doubling it.
        // A socket that joined a host room is its owner's: a full burst map still opens its windows.
        function hostBurstAllowed(): boolean {
            const userId = dataOf(socket).streamerHostUserId;
            if (!burst.consume(`${socket.id}:host-action`, STREAMER_HOST_ACTION_BURST, userId !== undefined)) return false;
            return userId === undefined || burst.consume(`user:${userId}:host-action`, STREAMER_HOST_ACTION_BURST, true);
        }

        function hostAction<T>(
            event: string,
            schema: z.ZodType<T>,
            run: (live: LiveStreamSession, payload: T) => Promise<Record<string, unknown> | void>,
            gate: "mode" | "always" = "mode",
        ): void {
            handle(socket, event, async (raw) => {
                if (!hostBurstAllowed()) throw new Refusal(PlayerErrorCode.RATE_LIMITED);
                if (gate === "mode" && !(await streamerModeOn())) throw new Refusal(PlayerErrorCode.STREAMER_MODE_DISABLED);
                const payload = parse(schema, raw);
                return run(joinedSession(socket), payload);
            });
        }

        handle(socket, EVENTS.hostJoin, async (raw) => {
            if (!burst.consume(`${socket.id}:host-join`, STREAMER_HOST_JOIN_BURST)) throw new Refusal(PlayerErrorCode.RATE_LIMITED);
            const { sessionId } = parse(hostJoinSchema, raw);
            if (!(await streamerModeOn())) throw new Refusal(PlayerErrorCode.STREAMER_MODE_DISABLED);
            const user = await resolveUser(socket);
            if (!user.userId || user.isSuspended) throw new Refusal(PlayerErrorCode.AUTH_REQUIRED);
            const live = runtime.get(sessionId);
            if (!live) throw new Refusal(PlayerErrorCode.STREAMER_SESSION_NOT_FOUND);
            if (live.userId !== user.userId) throw new Refusal(PlayerErrorCode.STREAMER_SESSION_NOT_OWNED);
            const data = dataOf(socket);
            if (data.streamerHostSessionId && data.streamerHostSessionId !== sessionId) {
                void socket.leave(streamerHostRoom(data.streamerHostSessionId));
            }
            data.streamerHostSessionId = sessionId;
            data.streamerHostUserId = user.userId;
            void socket.join(streamerHostRoom(sessionId));
            // As the game's room join does: a password reset or email change drops this socket too.
            joinUserSessionRoom(socket, user.userId);
            return { state: live.hostSnapshot() };
        });

        hostAction(EVENTS.hostStart, noPayloadSchema, (live) => runtime.start(live.id));
        hostAction(EVENTS.hostPause, noPayloadSchema, (live) => runtime.pause(live.id));
        hostAction(EVENTS.hostResume, noPayloadSchema, (live) => runtime.resume(live.id));
        hostAction(EVENTS.hostPass, noPayloadSchema, (live) => runtime.pass(live.id));
        hostAction(EVENTS.hostNext, noPayloadSchema, (live) => runtime.next(live.id));
        // Ending takes the owner's own stream off the air: always allowed, whatever the switch says.
        hostAction(
            EVENTS.hostEnd,
            endSchema,
            async (live) => {
                await runtime.end(live.id, "ended");
            },
            "always",
        );
        hostAction(EVENTS.hostSettings, settingsSchema, async (live, { cardBack, ...fields }) => {
            const patch: ResolvedScreenPatch = { ...fields };
            if (cardBack !== undefined) patch.cardBack = cardBack === null ? null : await cardBackFor(live.userId, cardBack.itemId);
            await runtime.applySettings(live.id, patch);
        });
        // The new key goes back in this ack only; the rotation hook above closes the old screens.
        // Past the per-socket burst, the owner's view-key limit applies: the bucket the HTTP route uses.
        hostAction(EVENTS.hostRotateKey, noPayloadSchema, async (live) => {
            const limit = await rateLimit({ ...STREAMER_VIEW_KEY_LIMIT, key: `user:${live.userId}` });
            if (!limit.allowed) throw new Refusal(PlayerErrorCode.RATE_LIMITED);
            const { viewKey } = await runtime.rotateViewKey(live.id);
            return { viewKey };
        });

        handle(socket, EVENTS.publicJoin, async (raw) => {
            const { viewKey } = parse(publicJoinSchema, raw);
            const limit = await rateLimit({ ...STREAMER_PUBLIC_JOIN_LIMIT, key: `ip:${getSocketClientIp(socket)}` });
            if (!limit.allowed) throw new Refusal(PlayerErrorCode.RATE_LIMITED);
            // Streamer mode off: the same opaque answer as a wrong key, nothing about the switch.
            if (!(await streamerModeOn())) throw new Refusal(PlayerErrorCode.STREAMER_VIEW_KEY_INVALID);
            const hash = hashViewKey(viewKey);
            const row = await store.findByViewKeyHash(hash);
            // A row still `active` that no live runtime runs was interrupted: its key opens nothing.
            const live = row?.status === "active" ? runtime.get(row.id) : null;
            if (!live || live.viewKeyHash !== hash) throw new Refusal(PlayerErrorCode.STREAMER_VIEW_KEY_INVALID);
            const snapshot = live.publicSnapshot();
            let state: Record<string, unknown>;
            try {
                state = assertNoSecret(snapshot, live);
            } catch (error) {
                if (error instanceof StreamerSecretLeakError) reportBlocked(live.id, snapshot.round, error);
                throw error;
            }
            const data = dataOf(socket);
            if (data.streamerPublicSessionId && data.streamerPublicSessionId !== live.id) {
                void socket.leave(streamerPublicRoom(data.streamerPublicSessionId));
            }
            data.streamerPublicSessionId = live.id;
            // Same tick as the snapshot: every later state reaches this socket, none is missed.
            void socket.join(streamerPublicRoom(live.id));
            return { state };
        });

        socket.on("disconnect", () => burst.forget(socket.id));
    });
}
