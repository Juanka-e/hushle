import { brandError, hasErrorBrand } from "./error-brand";

// The one shape every streaming platform adapter fills in. Game code never sees platform
// payloads: it gets token sets, identities and classified errors.

export const STREAMER_PLATFORMS = ["twitch", "kick"] as const;
export type StreamerPlatform = (typeof STREAMER_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<StreamerPlatform, string> = { twitch: "Twitch", kick: "Kick" };

export function isStreamerPlatform(value: unknown): value is StreamerPlatform {
    return typeof value === "string" && (STREAMER_PLATFORMS as readonly string[]).includes(value);
}

export interface TokenSet {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    scopes: string[];
}

export interface PlatformIdentity {
    platformUserId: string;
    login: string;
    displayName: string;
    avatarUrl: string | null;
    channelUrl: string;
}

export type TokenHint = "access_token" | "refresh_token";

export interface StreamerPlatformClient {
    readonly platform: StreamerPlatform;
    readonly isFake: boolean;
    readonly requiresPkce: boolean;
    readonly scopes: readonly string[];
    authorizationUrl(input: { state: string; redirectUri: string; codeChallenge?: string }): string;
    exchangeCode(input: { code: string; redirectUri: string; codeVerifier?: string }): Promise<TokenSet>;
    refresh(refreshToken: string): Promise<TokenSet>;
    revoke(token: string, hint: TokenHint): Promise<void>;
    fetchIdentity(accessToken: string): Promise<PlatformIdentity>;
    validate?(accessToken: string): Promise<{ ok: boolean; expiresInSeconds: number | null }>;
}

export type StreamerPlatformErrorKind = "invalid_grant" | "unauthorized" | "rate_limited" | "network" | "unexpected";

const STREAMER_PLATFORM_ERROR_BRAND = Symbol.for("hushle.platform-streamer.platform-error");

export class StreamerPlatformError extends Error {
    readonly platform: StreamerPlatform;
    readonly operation: string;
    readonly kind: StreamerPlatformErrorKind;
    readonly status: number | null;

    constructor(platform: StreamerPlatform, operation: string, kind: StreamerPlatformErrorKind, status: number | null) {
        // Deliberately terse: platform response bodies never travel in error messages.
        super(`${platform} ${operation} failed (${kind}, ${status ?? "no status"})`);
        this.name = "StreamerPlatformError";
        this.platform = platform;
        this.operation = operation;
        this.kind = kind;
        this.status = status;
        brandError(this, STREAMER_PLATFORM_ERROR_BRAND);
    }
}

/** A StreamerPlatformError from any copy of this package (see error-brand.ts). */
export function isStreamerPlatformError(error: unknown): error is StreamerPlatformError {
    return hasErrorBrand(error, STREAMER_PLATFORM_ERROR_BRAND);
}

// ---------------------------------------------------------------- shared HTTP helpers

export type FetchLike = typeof fetch;

function kindForStatus(status: number, operation: "refresh" | "exchange" | "other", body: unknown): StreamerPlatformErrorKind {
    if (status === 401) return "unauthorized";
    if (status === 429) return "rate_limited";
    if (status === 400 && (operation === "refresh" || operation === "exchange")) {
        // RFC 6749 §5.2: only invalid_grant means the user's grant is dead. invalid_client
        // (our secret), invalid_request and friends are deployment problems and must not
        // cost the streamer their connection.
        const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
        if (error === "invalid_grant") return "invalid_grant";
    }
    return "unexpected";
}

async function readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return null;
    }
}

/** Every platform call is bounded: past it the call fails as a transient `network` error. */
export const PLATFORM_REQUEST_TIMEOUT_MS = 10_000;

export interface PlatformHttpOptions {
    /** Default PLATFORM_REQUEST_TIMEOUT_MS. */
    timeoutMs?: number;
    /** Makes the signal that ends a call (default `AbortSignal.timeout`); tests abort it by hand. */
    timeoutSignal?: (ms: number) => AbortSignal;
}

export interface JsonRequest {
    platform: StreamerPlatform;
    operation: string;
    classify?: "refresh" | "exchange" | "other";
    url: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    form?: Record<string, string>;
    expectJson?: boolean;
}

/**
 * One platform call, bounded by `http.timeoutMs`: the fetch gets the bound's signal, and the call
 * also stops waiting on its own when the signal fires (a fetch or a body that ignores it). A
 * timeout, like any failure to get or read an answer, is a `network` error: transient, never
 * `invalid_grant`, so it never costs the streamer their connection.
 */
export async function platformRequest(fetchImpl: FetchLike, request: JsonRequest, http: PlatformHttpOptions = {}): Promise<unknown> {
    const headers: Record<string, string> = { accept: "application/json", ...request.headers };
    let body: string | undefined;
    if (request.form) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(request.form).toString();
    }
    const timeoutMs = http.timeoutMs ?? PLATFORM_REQUEST_TIMEOUT_MS;
    const signal = http.timeoutSignal ? http.timeoutSignal(timeoutMs) : AbortSignal.timeout(timeoutMs);
    const networkError = () => new StreamerPlatformError(request.platform, request.operation, "network", null);
    const timedOut = new Promise<never>((_, reject) => {
        if (signal.aborted) reject(networkError());
        else signal.addEventListener("abort", () => reject(networkError()), { once: true });
    });
    timedOut.catch(() => undefined);
    let response: Response;
    let json: unknown;
    try {
        response = await Promise.race([fetchImpl(request.url, { method: request.method ?? (request.form ? "POST" : "GET"), headers, body, signal }), timedOut]);
        json = await Promise.race([readJson(response), timedOut]);
    } catch {
        throw networkError();
    }
    if (!response.ok) {
        throw new StreamerPlatformError(
            request.platform,
            request.operation,
            kindForStatus(response.status, request.classify ?? "other", json),
            response.status
        );
    }
    if (request.expectJson !== false && (json === null || typeof json !== "object")) {
        throw new StreamerPlatformError(request.platform, request.operation, "unexpected", response.status);
    }
    return json;
}

export function tokenSetFromResponse(platform: StreamerPlatform, operation: string, payload: unknown, now = Date.now()): TokenSet {
    const data = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
    const accessToken = typeof data.access_token === "string" ? data.access_token : "";
    if (!accessToken) throw new StreamerPlatformError(platform, operation, "unexpected", 200);
    const refreshToken = typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : null;
    const expiresIn = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : null;
    const scopes = Array.isArray(data.scope)
        ? data.scope.filter((value): value is string => typeof value === "string")
        : typeof data.scope === "string"
          ? data.scope.split(/\s+/).filter(Boolean)
          : [];
    return { accessToken, refreshToken, expiresAt: expiresIn ? new Date(now + expiresIn * 1000) : null, scopes };
}

export function requireString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : typeof value === "number" ? String(value) : null;
}
