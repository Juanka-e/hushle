import {
    connectionAad,
    encryptToken,
    isStreamerPlatform,
    StreamerPlatformError,
    type StreamerConnectionStore,
    type StreamerPlatform,
    type StreamerPlatformClient,
    type TokenKeyring,
} from "@hushle/platform-streamer";
import { ConnectStateError, CONNECT_STATE_TTL_MS, createConnectState, readConnectState } from "./connect-state";
import { settingsRedirect, type StreamerRedirectCode } from "./redirects";

// The connect flow as pure decisions over injected dependencies. Route handlers only
// translate HTTP in and out; the tests drive this module with fakes.

export interface ConnectFlowUser {
    id: number;
    role: string;
}

export interface ConnectRateLimitResult {
    allowed: boolean;
    limit: number;
    remaining: number;
    retryAfterSeconds: number;
}

export interface ConnectAuditEntry {
    actor: { id: number | null; role: string };
    action: string;
    resourceType: string;
    resourceId?: string | null;
    summary?: string;
    metadata?: Record<string, string | number | boolean | null>;
}

export interface ConnectFlowDeps {
    store: StreamerConnectionStore;
    keyring: TokenKeyring;
    secret: string;
    now?: () => Date;
    isStreamerModeEnabled(): Promise<boolean>;
    isPlatformConfigured(platform: StreamerPlatform): boolean;
    clientFor(platform: StreamerPlatform): StreamerPlatformClient;
    consumeRateLimit(options: { bucket: string; key: string; windowMs: number; maxRequests: number }): Promise<ConnectRateLimitResult>;
    writeAudit(entry: ConnectAuditEntry): Promise<void>;
    emitEvent(event: { event: string; level: "info" | "warn" | "error"; context?: Record<string, unknown> }): Promise<void>;
}

export const CONNECT_RATE_LIMITS = {
    start: { bucket: "streamer-connect-start", windowMs: 15 * 60_000, maxRequests: 10 },
    callback: { bucket: "streamer-connect-callback", windowMs: 15 * 60_000, maxRequests: 10 },
} as const;

export const AUDIT_RESOURCE_TYPE = "streamer_connection";

export function callbackUri(origin: string, platform: StreamerPlatform): string {
    return `${origin.replace(/\/+$/, "")}/api/streamer/connect/${platform}/callback`;
}

function now(deps: ConnectFlowDeps): Date {
    return deps.now ? deps.now() : new Date();
}

function fail(platform: string, code: StreamerRedirectCode): { redirectTo: string } {
    return { redirectTo: settingsRedirect("error", platform, code) };
}

async function safely(task: Promise<void>): Promise<void> {
    try {
        await task;
    } catch {
        // Audit and telemetry never decide the user's outcome.
    }
}

export async function startConnect(
    deps: ConnectFlowDeps,
    input: { user: ConnectFlowUser | null; platform: string; requestIp: string; origin: string }
): Promise<{ redirectTo: string; setCookie?: { value: string; maxAgeSeconds: number } }> {
    const platform = input.platform;
    if (!isStreamerPlatform(platform)) return fail(platform, "platform_invalid");
    if (!input.user) return fail(platform, "unauthenticated");
    if (!(await deps.isStreamerModeEnabled())) return fail(platform, "disabled");
    if (!deps.isPlatformConfigured(platform)) return fail(platform, "platform_unavailable");
    const limit = await deps.consumeRateLimit({ ...CONNECT_RATE_LIMITS.start, key: `user:${input.user.id}` });
    if (!limit.allowed) return fail(platform, "rate_limited");

    const client = deps.clientFor(platform);
    const created = createConnectState({ userId: input.user.id, platform, requiresPkce: client.requiresPkce, secret: deps.secret, now: now(deps) });
    const redirectTo = client.authorizationUrl({ state: created.state, redirectUri: callbackUri(input.origin, platform), codeChallenge: created.codeChallenge });
    return { redirectTo, setCookie: { value: created.cookieValue, maxAgeSeconds: CONNECT_STATE_TTL_MS / 1000 } };
}

export async function completeConnect(
    deps: ConnectFlowDeps,
    input: { user: ConnectFlowUser | null; platform: string; query: URLSearchParams; cookieValue: string | undefined; requestIp: string; origin: string }
): Promise<{ redirectTo: string; clearCookie: true }> {
    const result = await decideCallback(deps, input);
    return { ...result, clearCookie: true };
}

async function decideCallback(
    deps: ConnectFlowDeps,
    input: { user: ConnectFlowUser | null; platform: string; query: URLSearchParams; cookieValue: string | undefined; requestIp: string; origin: string }
): Promise<{ redirectTo: string }> {
    const platform = input.platform;
    if (!isStreamerPlatform(platform)) return fail(platform, "platform_invalid");
    const user = input.user;
    if (!user) return fail(platform, "unauthenticated");
    const limit = await deps.consumeRateLimit({ ...CONNECT_RATE_LIMITS.callback, key: `ip:${input.requestIp}` });
    if (!limit.allowed) return fail(platform, "rate_limited");

    let codeVerifier: string | undefined;
    try {
        ({ codeVerifier } = readConnectState(input.cookieValue, {
            userId: user.id,
            platform,
            state: input.query.get("state"),
            secret: deps.secret,
            now: now(deps),
        }));
    } catch (error) {
        if (error instanceof ConnectStateError) return fail(platform, error.code);
        throw error;
    }
    if (input.query.get("error")) return fail(platform, "denied");
    const code = input.query.get("code");
    if (!code) return fail(platform, "state_invalid");

    const client = deps.clientFor(platform);
    try {
        const tokens = await client.exchangeCode({ code, redirectUri: callbackUri(input.origin, platform), codeVerifier });
        const identity = await client.fetchIdentity(tokens.accessToken);

        const existing = await deps.store.findByPlatformUser(platform, identity.platformUserId);
        if (existing && existing.userId !== user.id) {
            await safely(
                deps.writeAudit({
                    actor: { id: user.id, role: user.role },
                    action: "streamer.connection.link_rejected",
                    resourceType: AUDIT_RESOURCE_TYPE,
                    resourceId: null,
                    summary: "Streamer channel already linked to another account",
                    metadata: { platform, reason: "already_linked_elsewhere" },
                })
            );
            return fail(platform, "already_linked_elsewhere");
        }

        const aad = connectionAad(platform, identity.platformUserId);
        const { record, relinked } = await deps.store.upsertLinked({
            userId: user.id,
            platform,
            identity,
            scopes: tokens.scopes.length ? tokens.scopes : [...client.scopes],
            accessTokenEnc: encryptToken(tokens.accessToken, deps.keyring, aad),
            refreshTokenEnc: tokens.refreshToken ? encryptToken(tokens.refreshToken, deps.keyring, aad) : null,
            tokenKeyVersion: deps.keyring.current.version,
            accessTokenExpiresAt: tokens.expiresAt,
            now: now(deps),
        });
        await safely(
            deps.writeAudit({
                actor: { id: user.id, role: user.role },
                action: relinked ? "streamer.connection.relinked" : "streamer.connection.linked",
                resourceType: AUDIT_RESOURCE_TYPE,
                resourceId: record.id,
                summary: relinked ? "Streamer channel relinked" : "Streamer channel linked",
                metadata: { platform },
            })
        );
        return { redirectTo: settingsRedirect("linked", platform) };
    } catch (error) {
        if (error instanceof StreamerPlatformError) {
            await safely(deps.emitEvent({ event: "streamer.connect.platform_error", level: "warn", context: { platform, operation: error.operation, kind: error.kind, status: error.status } }));
            return fail(platform, "platform_error");
        }
        await safely(deps.emitEvent({ event: "streamer.connect.failed", level: "error", context: { platform, error: error instanceof Error ? error.name : "unknown" } }));
        return fail(platform, "internal_error");
    }
}
