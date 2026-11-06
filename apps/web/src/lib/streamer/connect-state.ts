import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getRedisClient, getRedisKey, type RedisLikeClient } from "@hushle/platform-cache";
import { isStreamerPlatform, StreamerConfigError, type StreamerPlatform } from "@hushle/platform-streamer";

// The OAuth `state` lives in a signed, short-lived, httpOnly cookie scoped to the connect
// routes. The callback accepts it only for the same user, the same platform, the same
// state value and within ten minutes; the route then deletes it. The cookie alone could still
// be replayed with its state for those ten minutes, so each state is also recorded on the
// server (its sha256, never the value) and the callback consumes that record exactly once.

export const CONNECT_STATE_COOKIE = "hushle_streamer_connect";
export const CONNECT_STATE_COOKIE_PATH = "/api/streamer/connect";
export const CONNECT_STATE_TTL_MS = 10 * 60_000;
const MIN_SECRET_LENGTH = 32;
const PAYLOAD_VERSION = 1;

export type ConnectStateErrorCode = "state_missing" | "state_invalid" | "state_expired" | "state_mismatch";

export class ConnectStateError extends Error {
    readonly code: ConnectStateErrorCode;

    constructor(code: ConnectStateErrorCode) {
        super(`streamer connect state rejected (${code})`);
        this.name = "ConnectStateError";
        this.code = code;
    }
}

interface StatePayload {
    v: number;
    s: string;
    u: number;
    p: StreamerPlatform;
    c?: string;
    t: number;
}

// Signed with AUTH_SECRET under its own domain prefix (see `sign`), so no extra secret to rotate.
export function requireConnectStateSecret(env: { [key: string]: string | undefined; AUTH_SECRET?: string }): string {
    const secret = env.AUTH_SECRET?.trim() || "";
    if (secret.length < MIN_SECRET_LENGTH) {
        throw new StreamerConfigError(`AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
    }
    return secret;
}

export function pkceChallenge(verifier: string): string {
    return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

const SIGNING_DOMAIN = "hushle.streamer-connect.v1.";

function sign(encodedPayload: string, secret: string): string {
    return createHmac("sha256", secret).update(SIGNING_DOMAIN + encodedPayload).digest("base64url");
}

export function createConnectState(input: {
    userId: number;
    platform: StreamerPlatform;
    requiresPkce: boolean;
    secret: string;
    now?: Date;
}): { cookieValue: string; state: string; codeChallenge?: string } {
    const state = randomBytes(32).toString("base64url");
    const verifier = input.requiresPkce ? randomBytes(48).toString("base64url") : undefined;
    const payload: StatePayload = {
        v: PAYLOAD_VERSION,
        s: state,
        u: input.userId,
        p: input.platform,
        ...(verifier ? { c: verifier } : {}),
        t: (input.now ?? new Date()).getTime(),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return {
        cookieValue: `${encodedPayload}.${sign(encodedPayload, input.secret)}`,
        state,
        ...(verifier ? { codeChallenge: pkceChallenge(verifier) } : {}),
    };
}

function parsePayload(encodedPayload: string): StatePayload {
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    } catch {
        throw new ConnectStateError("state_invalid");
    }
    const data = parsed as Partial<StatePayload> | null;
    if (
        !data ||
        typeof data !== "object" ||
        data.v !== PAYLOAD_VERSION ||
        typeof data.s !== "string" ||
        !Number.isInteger(data.u) ||
        !isStreamerPlatform(data.p) ||
        (data.c !== undefined && typeof data.c !== "string") ||
        typeof data.t !== "number" ||
        !Number.isFinite(data.t)
    ) {
        throw new ConnectStateError("state_invalid");
    }
    return data as StatePayload;
}

export function readConnectState(
    cookieValue: string | undefined,
    expect: { userId: number; platform: StreamerPlatform; state: string | null; secret: string; now?: Date }
): { codeVerifier?: string } {
    if (!cookieValue) throw new ConnectStateError("state_missing");
    const parts = cookieValue.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new ConnectStateError("state_invalid");
    const [encodedPayload, signature] = parts;
    const expectedSignature = sign(encodedPayload, expect.secret);
    const given = Buffer.from(signature, "utf8");
    const wanted = Buffer.from(expectedSignature, "utf8");
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) throw new ConnectStateError("state_invalid");

    const payload = parsePayload(encodedPayload);
    const now = (expect.now ?? new Date()).getTime();
    if (payload.t > now + 60_000) throw new ConnectStateError("state_invalid");
    if (now - payload.t > CONNECT_STATE_TTL_MS) throw new ConnectStateError("state_expired");
    if (payload.u !== expect.userId || payload.p !== expect.platform) throw new ConnectStateError("state_mismatch");
    if (typeof expect.state !== "string" || expect.state.length !== payload.s.length) throw new ConnectStateError("state_mismatch");
    if (!timingSafeEqual(Buffer.from(expect.state, "utf8"), Buffer.from(payload.s, "utf8"))) throw new ConnectStateError("state_mismatch");
    return { codeVerifier: payload.c };
}

// ---------------------------------------------------------------- single use, server side

/** What the server records for a state: its sha256 (hex), never the value itself. */
export function hashConnectState(state: string): string {
    return createHash("sha256").update(state, "utf8").digest("hex");
}

export interface ConnectStateStore {
    /** Records a state hash for `ttlMs`; false when that hash is already recorded. */
    record(stateHash: string, ttlMs: number): Promise<boolean>;
    /** Takes a recorded, unexpired state hash: true the first time, false afterwards or when unknown. */
    consume(stateHash: string): Promise<boolean>;
}

const MAX_IN_PROCESS_STATES = 10_000;

/**
 * The in-process record (one web replica, ADR-003): hash → expiry, oldest first. Expired
 * entries are pruned as new ones arrive; past the cap the oldest goes first.
 */
export function createMemoryConnectStateStore(options: { now?: () => number; maxEntries?: number } = {}): ConnectStateStore {
    const now = options.now ?? Date.now;
    const maxEntries = options.maxEntries ?? MAX_IN_PROCESS_STATES;
    const entries = new Map<string, number>();
    return {
        async record(stateHash, ttlMs) {
            const at = now();
            for (const [hash, expiresAt] of entries) {
                if (expiresAt <= at) entries.delete(hash);
            }
            if (entries.has(stateHash)) return false;
            while (entries.size >= maxEntries) entries.delete(entries.keys().next().value as string);
            entries.set(stateHash, at + ttlMs);
            return true;
        },
        async consume(stateHash) {
            const expiresAt = entries.get(stateHash);
            if (expiresAt === undefined) return false;
            entries.delete(stateHash);
            return expiresAt > now();
        },
    };
}

function redisStateKey(stateHash: string): string {
    return getRedisKey("streamer", "connect-state", stateHash);
}

/**
 * Redis when it is configured and answering (`SET … NX PX` to record, the `DEL` count to
 * consume: both atomic), else the in-process `fallback`. A consume that finds nothing in Redis
 * also asks the fallback, for a state recorded while Redis was away; each record is taken once
 * either way.
 */
export function createConnectStateStore(
    options: { redis?: () => Promise<RedisLikeClient | null>; fallback?: ConnectStateStore } = {},
): ConnectStateStore {
    const connect = options.redis ?? getRedisClient;
    const fallback = options.fallback ?? inProcessConnectStates();
    const client = async () => {
        try {
            return await connect();
        } catch {
            return null;
        }
    };
    return {
        async record(stateHash, ttlMs) {
            const redis = await client();
            if (redis) {
                try {
                    return (await redis.set(redisStateKey(stateHash), "1", { NX: true, PX: ttlMs })) === "OK";
                } catch {
                    // Redis failed mid-call: the in-process record stands in.
                }
            }
            return fallback.record(stateHash, ttlMs);
        },
        async consume(stateHash) {
            const redis = await client();
            if (redis) {
                try {
                    if ((await redis.del(redisStateKey(stateHash))) === 1) {
                        // A SET whose answer was lost after it landed was recorded in process too:
                        // that twin is taken with it, or a replay would find it there.
                        await fallback.consume(stateHash);
                        return true;
                    }
                } catch {
                    // Redis failed mid-call: only the in-process record can still answer.
                }
            }
            return fallback.consume(stateHash);
        },
    };
}

// On globalThis: the start and callback routes are separate bundles (and the custom server loads
// this module too); one in-process record must serve them all.
const globalForConnectStates = globalThis as typeof globalThis & {
    __hushleStreamerConnectStates?: ConnectStateStore;
    __hushleStreamerConnectStatesInProcess?: ConnectStateStore;
};

function inProcessConnectStates(): ConnectStateStore {
    return (globalForConnectStates.__hushleStreamerConnectStatesInProcess ??= createMemoryConnectStateStore());
}

/** The app's record of OAuth states: Redis when configured, the in-process map otherwise. */
export function defaultConnectStateStore(): ConnectStateStore {
    return (globalForConnectStates.__hushleStreamerConnectStates ??= createConnectStateStore());
}
