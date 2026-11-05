import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isStreamerPlatform, StreamerConfigError, type StreamerPlatform } from "@hushle/platform-streamer";

// The OAuth `state` lives in a signed, short-lived, httpOnly cookie scoped to the connect
// routes. The callback accepts it only for the same user, the same platform, the same
// state value and within ten minutes; the route then deletes it, so it is single use.

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

export function requireConnectStateSecret(env: { [key: string]: string | undefined; STREAMER_CONNECT_SECRET?: string; AUTH_SECRET?: string }): string {
    const secret = env.STREAMER_CONNECT_SECRET?.trim() || env.AUTH_SECRET?.trim() || "";
    if (secret.length < MIN_SECRET_LENGTH) {
        throw new StreamerConfigError(`STREAMER_CONNECT_SECRET or AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
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
