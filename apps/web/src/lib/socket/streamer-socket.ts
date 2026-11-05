import type { Server, Socket } from "socket.io";
import { z } from "zod";
import type { HostStreamSnapshot, StreamCardBack } from "@hushle/domain-streamer";
import { reportError } from "@hushle/platform-observability";
import { PlayerErrorCode } from "@/lib/errors/player-error-codes";
import { getSocketClientIp } from "@/lib/security/client-ip";
import { consumeDistributedRequestRateLimit } from "@/lib/security/request-rate-limit";
import { resolveCardBackSelection, type CardBackFeatures } from "@/lib/streamer/card-backs";
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
import { hashViewKey, VIEW_KEY_BYTES } from "@/lib/streamer/view-key";
import { getSystemSettings } from "@/lib/system-settings/service";
import { getSocketAuthState, isTrustedSocketOrigin } from "./game-socket";
import { emitPlayerError, playerErrorAck } from "./player-error-emit";

// Streamer mode over Socket.IO (phase 2). The owner's host room carries the secret card; the
// public room (the stream screen, opened with the view key) never does. One process runs every
// live session (ADR-003): the runtime pushes each state change here and this layer fans it out.

export const STREAMER_HOST_ACTION_BURST = { windowMs: 10_000, maxRequests: 10 } as const;
export const STREAMER_HOST_JOIN_BURST = { windowMs: 10_000, maxRequests: 10 } as const;
export const STREAMER_PUBLIC_JOIN_LIMIT = { bucket: "streamer-public-join", windowMs: 60_000, maxRequests: 30 } as const;

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
    resolveCardBack?: (userId: number, itemId: number, features: CardBackFeatures) => Promise<StreamCardBack>;
    /** Clock of the per-socket host burst windows. */
    now?: () => number;
    onError?: (event: string, error: unknown) => void;
}

// ---------------------------------------------------------------- leak guard

export class StreamerSecretLeakError extends Error {
    constructor(reason: string) {
        super(`public state blocked: ${reason}`);
        this.name = "StreamerSecretLeakError";
    }
}

const HOST_ONLY_FIELDS = ["card", "players", "tolerance", "pool"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Viewer, channel and card-back names are chat or catalogue text, never card data: a viewer
// whose name equals a taboo word is no leak, so those fields are not searched.
function withoutNames(state: Record<string, unknown>): Record<string, unknown> {
    const blank = (value: unknown) => (isRecord(value) ? { ...value, name: "" } : value);
    return {
        ...state,
        scores: Array.isArray(state.scores) ? state.scores.map(blank) : state.scores,
        lastCorrect: blank(state.lastCorrect),
        channel: blank(state.channel),
        cardBack: blank(state.cardBack),
    };
}

/**
 * Throws unless `payload` may go to the public room of `live`: a public projection with no
 * host-only field, no reveal while the round is not over, and no string equal to the live card's
 * word or one of its taboos (an exact match on the serialized payload, names aside). Once a
 * round is finished its card is on the stream screen by design, so the words are not searched.
 */
export function assertNoSecret(payload: unknown, live: Pick<LiveStreamSession, "hostSnapshot">): void {
    if (!isRecord(payload) || payload.type !== "public-state") throw new StreamerSecretLeakError("not a public state");
    for (const field of HOST_ONLY_FIELDS) {
        if (field in payload) throw new StreamerSecretLeakError(`host-only field "${field}"`);
    }
    const host = live.hostSnapshot();
    if (host.phase === "finished") return;
    if (payload.reveal !== null && payload.reveal !== undefined) throw new StreamerSecretLeakError("reveal before the round is over");
    const card = host.card;
    if (!card) return;
    const serialized = JSON.stringify(withoutNames(payload));
    for (const word of [card.target, ...card.taboos]) {
        if (typeof word === "string" && word.trim() !== "" && serialized.includes(JSON.stringify(word))) {
            throw new StreamerSecretLeakError("a secret word in the payload");
        }
    }
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
    word_source_empty: PlayerErrorCode.STREAMER_WORD_POOL_EMPTY,
    card_not_allowed: PlayerErrorCode.STREAMER_CARD_NOT_ALLOWED,
    card_catalogue_unavailable: PlayerErrorCode.STREAMER_CARD_CATALOGUE_UNAVAILABLE,
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

function createBurstLimiter(now: () => number) {
    const windows = new Map<string, { startedAt: number; count: number }>();
    return {
        consume(key: string, limit: { windowMs: number; maxRequests: number }): boolean {
            const at = now();
            const current = windows.get(key);
            if (!current || at - current.startedAt >= limit.windowMs) {
                windows.set(key, { startedAt: at, count: 1 });
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
    const resolveCardBack: NonNullable<StreamerSocketOptions["resolveCardBack"]> =
        options.resolveCardBack ?? ((userId, itemId, flags) => resolveCardBackSelection(userId, itemId, flags));
    const report = options.onError ?? reportStreamerSocketError;
    const burst = createBurstLimiter(options.now ?? Date.now);
    const EVENTS = STREAMER_SOCKET_EVENTS;

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
        try {
            if (!reference) throw new StreamerSecretLeakError("no host projection to check against");
            assertNoSecret(payload, reference);
        } catch (error) {
            report("streamer_socket.public_state_blocked", error);
            return;
        }
        io.to(streamerPublicRoom(sessionId)).emit(EVENTS.publicState, payload);
    });

    runtime.setOnEnded((sessionId, reason) => {
        pendingHost.delete(sessionId);
        const rooms = [streamerHostRoom(sessionId), streamerPublicRoom(sessionId)];
        const ended: StreamerEndedPayload = { reason };
        io.to(rooms).emit(EVENTS.ended, ended);
        io.in(rooms).socketsLeave(rooms);
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
        if (error instanceof StreamerSecretLeakError) {
            report("streamer_socket.public_state_blocked", error);
            return PlayerErrorCode.UNKNOWN_ERROR;
        }
        report(`streamer_socket.${event.slice("streamer:".length).replaceAll(":", "_")}_failed`, error);
        return PlayerErrorCode.UNKNOWN_ERROR;
    }

    /** Runs a handler with one optional payload; acks `{ ok: true, ...result }` or `playerErrorAck(code)` (`hata` without an ack). */
    function handle(socket: Socket, event: string, run: (payload: unknown) => Promise<Record<string, unknown> | void>): void {
        socket.on(event, async (...args: unknown[]) => {
            const ack = typeof args[args.length - 1] === "function" ? (args.pop() as (reply: unknown) => void) : null;
            let reply: { ok: boolean };
            try {
                if (args.length > 1) throw new Refusal(PlayerErrorCode.INVALID_REQUEST);
                reply = { ok: true, ...(await run(args[0])) };
            } catch (error) {
                const code = failureCode(event, error);
                reply = playerErrorAck(code);
                if (!ack) emitPlayerError(socket, code);
            }
            ack?.(reply);
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

    async function cardBackFor(userId: number, itemId: number): Promise<StreamCardBack> {
        let flags: CardBackFeatures;
        try {
            flags = await features();
        } catch (error) {
            report("streamer_socket.features_failed", error);
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

        function hostAction<T>(
            event: string,
            schema: z.ZodType<T>,
            run: (live: LiveStreamSession, payload: T) => Promise<Record<string, unknown> | void>,
        ): void {
            handle(socket, event, async (raw) => {
                if (!burst.consume(`${socket.id}:host-action`, STREAMER_HOST_ACTION_BURST)) throw new Refusal(PlayerErrorCode.RATE_LIMITED);
                const payload = parse(schema, raw);
                return run(joinedSession(socket), payload);
            });
        }

        handle(socket, EVENTS.hostJoin, async (raw) => {
            if (!burst.consume(`${socket.id}:host-join`, STREAMER_HOST_JOIN_BURST)) throw new Refusal(PlayerErrorCode.RATE_LIMITED);
            const { sessionId } = parse(hostJoinSchema, raw);
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
            return { state: live.hostSnapshot() };
        });

        hostAction(EVENTS.hostStart, noPayloadSchema, (live) => runtime.start(live.id));
        hostAction(EVENTS.hostPause, noPayloadSchema, (live) => runtime.pause(live.id));
        hostAction(EVENTS.hostResume, noPayloadSchema, (live) => runtime.resume(live.id));
        hostAction(EVENTS.hostPass, noPayloadSchema, (live) => runtime.pass(live.id));
        hostAction(EVENTS.hostNext, noPayloadSchema, (live) => runtime.next(live.id));
        hostAction(EVENTS.hostEnd, endSchema, async (live) => {
            await runtime.end(live.id, "ended");
        });
        hostAction(EVENTS.hostSettings, settingsSchema, async (live, { cardBack, ...fields }) => {
            const patch: ResolvedScreenPatch = { ...fields };
            if (cardBack !== undefined) patch.cardBack = cardBack === null ? null : await cardBackFor(live.userId, cardBack.itemId);
            await runtime.applySettings(live.id, patch);
        });
        // The new key goes back in this ack only; the rotation hook above closes the old screens.
        hostAction(EVENTS.hostRotateKey, noPayloadSchema, async (live) => {
            const { viewKey } = await runtime.rotateViewKey(live.id);
            return { viewKey };
        });

        handle(socket, EVENTS.publicJoin, async (raw) => {
            const { viewKey } = parse(publicJoinSchema, raw);
            const limit = await rateLimit({ ...STREAMER_PUBLIC_JOIN_LIMIT, key: `ip:${getSocketClientIp(socket)}` });
            if (!limit.allowed) throw new Refusal(PlayerErrorCode.RATE_LIMITED);
            const hash = hashViewKey(viewKey);
            const row = await store.findByViewKeyHash(hash);
            // A row still `active` that no live runtime runs was interrupted: its key opens nothing.
            const live = row?.status === "active" ? runtime.get(row.id) : null;
            if (!live || live.viewKeyHash !== hash) throw new Refusal(PlayerErrorCode.STREAMER_VIEW_KEY_INVALID);
            const state = live.publicSnapshot();
            assertNoSecret(state, live);
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
