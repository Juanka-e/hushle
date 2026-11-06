import type { Server, Socket } from "socket.io";
import { z } from "zod";
import {
    normalizeGuess,
    PASSED_TARGET_MAX,
    type BroadcastTheme,
    type CameraSize,
    type CameraSlot,
    type ChannelPlatform,
    type ClockStyle,
    type HostStreamSnapshot,
    type LastCorrect,
    type PassedCard,
    type PublicStreamSnapshot,
    type ResolvedCardThemeLike,
    type StreamCardBack,
    type StreamPhase,
} from "@hushle/domain-streamer";
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
import { getStreamerModeState, type StreamerModeState } from "@/lib/streamer/streamer-mode";
import { hashViewKey, STREAMER_VIEW_KEY_LIMIT, VIEW_KEY_BYTES } from "@/lib/streamer/view-key";
import { getSystemSettings } from "@/lib/system-settings/service";
import type { CosmeticMotionPreset, CosmeticPattern } from "@/types/economy";
import { getSocketAuthState, isTrustedSocketOrigin } from "./game-socket";
import { emitPlayerError, playerErrorAck } from "./player-error-emit";
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
    onError?: (event: string, error: unknown) => void;
}

// ---------------------------------------------------------------- leak guard

/** Which rule refused a public state: tests and reports name the rule, never the text it matched. */
export type StreamerLeakRule =
    | "not-public"
    | "host-field"
    | "early-reveal"
    | "no-reference"
    | "no-target"
    | "target"
    | "taboo"
    | "passed-target";

export class StreamerSecretLeakError extends Error {
    readonly rule: StreamerLeakRule;

    constructor(rule: StreamerLeakRule, reason: string) {
        super(`public state blocked (${rule}): ${reason}`);
        this.name = "StreamerSecretLeakError";
        this.rule = rule;
    }
}

const HOST_ONLY_FIELDS = ["card", "players", "tolerance", "pool"] as const;

// A path is a list of segments: an object key (a string, whatever it holds) or an array index
// (a number). A pattern matches segment by segment; INDEX matches any array index and nothing
// else, so a key spelt "*", "channel.name" or "reveal.x" never forges an exempt path.
type PathSegment = string | number;
const INDEX = Symbol("array index");
type Pattern = ReadonlyArray<string | typeof INDEX>;

function matches(pattern: Pattern, path: readonly PathSegment[]): boolean {
    return pattern.length === path.length && pattern.every((segment, at) => (segment === INDEX ? typeof path[at] === "number" : segment === path[at]));
}

// Fields filled from a fixed vocabulary: a member carries no card data, even when a taboo is
// spelt the same (the taboo "Candle" and the candle clock). Any other value there is compared.
// Each vocabulary is an exhaustive record of its union: a new member fails tsc until listed here.
const TYPES: Record<PublicStreamSnapshot["type"], true> = { "public-state": true };
const PHASES: Record<StreamPhase, true> = { ready: true, running: true, paused: true, finished: true, ended: true };
const THEMES: Record<BroadcastTheme, true> = { "oyun-gecesi": true, studyo: true, "gece-altini": true, sakura: true, sade: true };
const CAMERAS: Record<CameraSlot, true> = { none: true, tl: true, tr: true, bl: true, br: true, left: true, right: true };
const CAMERA_SIZES: Record<CameraSize, true> = { s: true, m: true, l: true };
const CLOCKS: Record<ClockStyle, true> = { hourglass: true, candle: true, bulbs: true, incense: true, ring: true, counter: true };
const PACKS: Record<PublicStreamSnapshot["pack"], true> = { TR: true, EN: true };
const CHANNEL_PLATFORMS: Record<ChannelPlatform, true> = { twitch: true, kick: true, youtube: true };
const PATTERNS: Record<CosmeticPattern, true> = { none: true, grid: true, dots: true, diagonal: true, chevrons: true, rings: true, noise: true };
const MOTIONS: Record<CosmeticMotionPreset, true> = { none: true, pulse: true, drift: true, shimmer: true };

function vocabulary(pattern: Pattern, members: Record<string, true>): readonly [Pattern, ReadonlySet<string>] {
    return [pattern, new Set(Object.keys(members))];
}

const VOCABULARY_FIELDS = [
    vocabulary(["type"], TYPES),
    vocabulary(["phase"], PHASES),
    vocabulary(["theme"], THEMES),
    vocabulary(["camera"], CAMERAS),
    vocabulary(["cameraSize"], CAMERA_SIZES),
    vocabulary(["clock"], CLOCKS),
    vocabulary(["pack"], PACKS),
    vocabulary(["channel", "platform"], CHANNEL_PLATFORMS),
    vocabulary(["cardBack", "theme", "pattern"], PATTERNS),
    vocabulary(["cardBack", "theme", "motionPreset"], MOTIONS),
];

// The card-back colours: skipped only while they hold a hex colour (`#DECADE` is no taboo
// "Decade"); any other value there is compared.
const COLOUR_KEYS: Record<Extract<keyof ResolvedCardThemeLike, `${string}Color`>, true> = {
    surfaceColor: true,
    borderColor: true,
    accentColor: true,
    secondaryColor: true,
    titleColor: true,
    detailColor: true,
    glowColor: true,
};
const COLOUR_FIELDS: Pattern[] = Object.keys(COLOUR_KEYS).map((key) => ["cardBack", "theme", key]);
const HEX_COLOUR = /^#[0-9a-f]{3,8}$/i;

// Viewer, channel and card-back names are chat or catalogue text, never card data: a viewer
// whose name equals a taboo word is no leak, so those fields are not compared.
const NAME_FIELDS: Pattern[] = [["scores", INDEX, "name"], ["lastCorrect", "name"], ["channel", "name"], ["cardBack", "name"]];

// The previous pass's word stays on the stream screen. A taboo of the live card may be spelt the
// same (viewers never see the taboos); only the live word itself is a leak there.
const PASSED_WORD_FIELD: Pattern = ["passed", "target"];

// The projection's own keys, per object path: never compared. Any other key is card data until
// shown otherwise and is compared like a value. Exhaustive records again: a new projection field
// fails tsc until it is listed.
type Snapshot = PublicStreamSnapshot;
const ROOT_KEYS: Record<keyof Snapshot, true> = {
    type: true, schemaVersion: true, revision: true, phase: true, remaining: true, duration: true, round: true, passedRound: true,
    theme: true, camera: true, cameraSize: true, clock: true, showCardName: true, channel: true, passed: true, participants: true,
    pack: true, scores: true, lastCorrect: true, cardBack: true, connected: true, reveal: true,
};
const PASSED_KEYS: Record<keyof PassedCard, true> = { round: true, target: true };
const SCORE_KEYS: Record<keyof Snapshot["scores"][number], true> = { name: true, points: true, rank: true, tied: true };
const LAST_CORRECT_KEYS: Record<keyof LastCorrect, true> = { eventId: true, name: true, round: true, pointsGranted: true, solveMs: true };
const CHANNEL_KEYS: Record<keyof NonNullable<Snapshot["channel"]>, true> = { platform: true, name: true };
const CARD_BACK_KEYS: Record<keyof StreamCardBack, true> = { itemId: true, name: true, theme: true, imageUrl: true };
const THEME_KEYS: Record<keyof ResolvedCardThemeLike, true> = {
    renderSpecVersion: true, requestedRenderSpecVersion: true, usedRenderSpecFallback: true, surfaceColor: true, borderColor: true,
    accentColor: true, secondaryColor: true, titleColor: true, detailColor: true, pattern: true, patternOpacity: true, patternScale: true,
    motionPreset: true, motionSpeedMs: true, glowColor: true, glowBlur: true, glowOpacity: true, overlayImageUrl: true, overlayOpacity: true,
};
const REVEAL_KEYS: Record<keyof NonNullable<Snapshot["reveal"]>, true> = { target: true, taboos: true, solved: true };

const KNOWN_KEYS = [
    vocabulary([], ROOT_KEYS),
    vocabulary(["passed"], PASSED_KEYS),
    vocabulary(["scores", INDEX], SCORE_KEYS),
    vocabulary(["lastCorrect"], LAST_CORRECT_KEYS),
    vocabulary(["channel"], CHANNEL_KEYS),
    vocabulary(["cardBack"], CARD_BACK_KEYS),
    vocabulary(["cardBack", "theme"], THEME_KEYS),
    vocabulary(["reveal"], REVEAL_KEYS),
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Folded as the domain drops a recycled pass (normal tolerance: ı/i, ş/s, ğ/g, ç/c, ö/o, ü/u).
function comparable(word: string): string {
    return normalizeGuess(word, "normal");
}

/**
 * Calls `visit` with every string value and its path, and `visitKey` with every object key that is
 * not one of the projection's own at that path (with the path of the object holding it).
 */
function eachString(
    value: unknown,
    path: PathSegment[],
    visit: (path: readonly PathSegment[], text: string) => void,
    visitKey: (path: readonly PathSegment[], key: string) => void,
): void {
    if (typeof value === "string") visit(path, value);
    else if (Array.isArray(value)) value.forEach((item, index) => eachString(item, [...path, index], visit, visitKey));
    else if (isRecord(value)) {
        const known = KNOWN_KEYS.find(([pattern]) => matches(pattern, path))?.[1];
        for (const [key, child] of Object.entries(value)) {
            if (!known?.has(key)) visitKey(path, key);
            eachString(child, [...path, key], visit, visitKey);
        }
    }
}

// Socket.IO sends these as binary attachments, beside the JSON the guard reads: never sent.
function isBinary(value: unknown): boolean {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
    if (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) return true;
    if (typeof Blob !== "undefined" && value instanceof Blob) return true;
    // What a Buffer's toJSON leaves (its bytes as numbers): refused too, however it got there.
    return isRecord(value) && value.type === "Buffer" && Array.isArray(value.data);
}

/**
 * The JSON copy of `payload` the guard checks and the caller then sends: fails closed when it
 * cannot be sent as JSON or holds a binary value. The replacer looks at each value before and
 * after its toJSON.
 */
function onTheWire(payload: unknown): Record<string, unknown> {
    let wire: unknown;
    try {
        const json = JSON.stringify(payload, function (this: unknown, key: string, value: unknown) {
            if (isBinary(value) || (typeof this === "object" && this !== null && isBinary((this as Record<string, unknown>)[key]))) throw new StreamerSecretLeakError("not-public", "a binary value");
            return value;
        });
        wire = json === undefined ? undefined : JSON.parse(json);
    } catch {
        throw new StreamerSecretLeakError("not-public", "the payload does not serialize as plain JSON");
    }
    if (!isRecord(wire) || wire.type !== "public-state") throw new StreamerSecretLeakError("not-public", "not a public state");
    return wire;
}

/**
 * Returns the JSON copy of `payload` that may go to the public room of `live`, and throws
 * otherwise. The copy is what is checked and what the caller sends (nothing is read from the
 * payload again): a public projection with no host-only field, no binary value, no reveal while
 * the round is not over, and no string value, nor key outside the projection's own, equal to the
 * live card's word or one of its taboos once both are folded (normal tolerance). Names, a field's
 * fixed vocabulary and a card-back hex colour are not compared. The passed card's word is
 * compared with the live word only. A finished round's reveal is on the stream screen by design,
 * so it is not compared; the rest of that payload is. Fails closed when the live card has no word
 * to compare against. Each refusal names its rule (`StreamerSecretLeakError.rule`).
 */
export function assertNoSecret(payload: unknown, live: Pick<LiveStreamSession, "hostSnapshot">): Record<string, unknown> {
    const wire = onTheWire(payload);
    for (const field of HOST_ONLY_FIELDS) {
        if (field in wire) throw new StreamerSecretLeakError("host-field", `host-only field "${field}"`);
    }
    const host = live.hostSnapshot();
    const finished = host.phase === "finished";
    if (!finished && wire.reveal !== null && wire.reveal !== undefined) throw new StreamerSecretLeakError("early-reveal", "reveal before the round is over");
    const card = host.card;
    if (!card) return wire;
    const target = typeof card.target === "string" ? comparable(card.target) : "";
    if (!target) throw new StreamerSecretLeakError("no-target", "the live card has no word to compare against");
    // The passed card cuts its word: the live word cut the same way is the same leak.
    const shownTarget = comparable(card.target.slice(0, PASSED_TARGET_MAX));
    const taboos = new Set((Array.isArray(card.taboos) ? card.taboos : []).filter((word) => typeof word === "string").map(comparable).filter(Boolean));
    const secret = (text: string, where: string) => {
        const word = comparable(text);
        if (!word) return;
        if (word === target) throw new StreamerSecretLeakError("target", `the live word ${where}`);
        if (taboos.has(word)) throw new StreamerSecretLeakError("taboo", `a taboo of the live card ${where}`);
    };
    eachString(
        wire,
        [],
        (path, text) => {
            if (NAME_FIELDS.some((pattern) => matches(pattern, path))) return;
            if (finished && path[0] === "reveal") return;
            if (VOCABULARY_FIELDS.some(([pattern, members]) => members.has(text) && matches(pattern, path))) return;
            if (HEX_COLOUR.test(text) && COLOUR_FIELDS.some((pattern) => matches(pattern, path))) return;
            if (matches(PASSED_WORD_FIELD, path)) {
                const word = comparable(text);
                if (word && (word === target || word === shownTarget)) throw new StreamerSecretLeakError("passed-target", "the live word in the passed card");
                return;
            }
            secret(text, "in the payload");
        },
        (path, key) => {
            if (finished && path[0] === "reveal") return;
            secret(key, "as a key of the payload");
        },
    );
    return wire;
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

/** Burst windows kept before the expired ones are swept (per socket and per user). */
const MAX_BURST_WINDOWS = 1_000;

function createBurstLimiter(now: () => number) {
    const windows = new Map<string, { startedAt: number; count: number; windowMs: number }>();
    return {
        consume(key: string, limit: { windowMs: number; maxRequests: number }): boolean {
            const at = now();
            if (windows.size >= MAX_BURST_WINDOWS) {
                for (const [stale, window] of windows) if (at - window.startedAt >= window.windowMs) windows.delete(stale);
            }
            const current = windows.get(key);
            if (!current || at - current.startedAt >= limit.windowMs) {
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
    const readMode = options.streamerMode ?? getStreamerModeState;
    const resolveCardBack: NonNullable<StreamerSocketOptions["resolveCardBack"]> =
        options.resolveCardBack ?? ((userId, itemId, flags) => resolveCardBackSelection(userId, itemId, flags));
    const reporter = options.onError ?? reportStreamerSocketError;
    const burst = createBurstLimiter(options.now ?? Date.now);
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
        report(`streamer_socket.${event.slice("streamer:".length).replaceAll(":", "_")}_failed`, error);
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

        // Per socket, and once the socket joined a host room per user as well (`user:<id>`, the
        // same 10 / 10 s): a second tab of the owner shares the user's window instead of doubling it.
        function hostBurstAllowed(): boolean {
            if (!burst.consume(`${socket.id}:host-action`, STREAMER_HOST_ACTION_BURST)) return false;
            const userId = dataOf(socket).streamerHostUserId;
            return userId === undefined || burst.consume(`user:${userId}:host-action`, STREAMER_HOST_ACTION_BURST);
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
