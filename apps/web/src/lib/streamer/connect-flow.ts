import { getUniqueConstraintTarget } from "@hushle/platform-db";
import {
    connectionAad,
    decryptToken,
    encryptToken,
    isStreamerPlatform,
    isStreamerPlatformError,
    isTokenDecryptError,
    revokeAtPlatform,
    type StreamerConnectionRecord,
    type StreamerConnectionStore,
    type StreamerPlatform,
    type StreamerPlatformClient,
    type TokenKeyring,
    type TokenSet,
} from "@hushle/platform-streamer";
import {
    ConnectStateError,
    CONNECT_STATE_TTL_MS,
    createConnectState,
    defaultConnectStateStore,
    hashConnectState,
    readConnectState,
    type ConnectStateStore,
} from "./connect-state";
import { settingsRedirect, type StreamerRedirectCode } from "./redirects";

// The connect flow as pure decisions over injected dependencies. Route handlers only
// translate HTTP in and out; the tests drive this module with fakes.

export interface ConnectFlowUser {
    id: number;
    role: string;
    /** `active` links; `pending_email_verification` (and anything else) does not. */
    accountStatus: string;
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
    /** Where each OAuth state is recorded for single use; the app's Redis-or-in-process record when absent. */
    stateStore?: ConnectStateStore;
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

function stateStoreOf(deps: ConnectFlowDeps): ConnectStateStore {
    return deps.stateStore ?? defaultConnectStateStore();
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

function decryptStored(deps: ConnectFlowDeps, record: StreamerConnectionRecord, encoded: string | null): string | null {
    if (!encoded) return null;
    try {
        return decryptToken(encoded, deps.keyring, connectionAad(record.platform, record.platformUserId));
    } catch (error) {
        if (isTokenDecryptError(error)) return null;
        throw error;
    }
}

export async function startConnect(
    deps: ConnectFlowDeps,
    input: { user: ConnectFlowUser | null; platform: string; requestIp: string; origin: string }
): Promise<{ redirectTo: string; setCookie?: { value: string; maxAgeSeconds: number } }> {
    const platform = input.platform;
    if (!isStreamerPlatform(platform)) return fail(platform, "platform_invalid");
    if (!input.user) return fail(platform, "unauthenticated");
    if (input.user.accountStatus !== "active") return fail(platform, "account_not_active");
    if (!(await deps.isStreamerModeEnabled())) return fail(platform, "disabled");
    if (!deps.isPlatformConfigured(platform)) return fail(platform, "platform_unavailable");
    const limit = await deps.consumeRateLimit({ ...CONNECT_RATE_LIMITS.start, key: `user:${input.user.id}` });
    if (!limit.allowed) return fail(platform, "rate_limited");

    const client = deps.clientFor(platform);
    const created = createConnectState({ userId: input.user.id, platform, requiresPkce: client.requiresPkce, secret: deps.secret, now: now(deps) });
    // Recorded on the server (its sha256 only) so the callback can take it exactly once.
    if (!(await stateStoreOf(deps).record(hashConnectState(created.state), CONNECT_STATE_TTL_MS))) return fail(platform, "internal_error");
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
    if (user.accountStatus !== "active") return fail(platform, "account_not_active");
    const limit = await deps.consumeRateLimit({ ...CONNECT_RATE_LIMITS.callback, key: `ip:${input.requestIp}` });
    if (!limit.allowed) return fail(platform, "rate_limited");
    if (!(await deps.isStreamerModeEnabled())) return fail(platform, "disabled");

    const state = input.query.get("state");
    let codeVerifier: string | undefined;
    try {
        ({ codeVerifier } = readConnectState(input.cookieValue, {
            userId: user.id,
            platform,
            state,
            secret: deps.secret,
            now: now(deps),
        }));
    } catch (error) {
        if (error instanceof ConnectStateError) return fail(platform, error.code);
        throw error;
    }
    // Single use: the server-side record is taken before anything else happens (a denial uses
    // it up too); a replayed cookie and state, or a state the server no longer holds, find nothing.
    if (state === null || !(await stateStoreOf(deps).consume(hashConnectState(state)))) return fail(platform, "state_invalid");
    if (input.query.get("error")) return fail(platform, "denied");
    const code = input.query.get("code");
    if (!code) return fail(platform, "state_invalid");

    const client = deps.clientFor(platform);
    let tokens: TokenSet | null = null;
    try {
        tokens = await client.exchangeCode({ code, redirectUri: callbackUri(input.origin, platform), codeVerifier });
        const identity = await client.fetchIdentity(tokens.accessToken);

        const rejectElsewhere = async () => {
            await revokeAtPlatform(client, [[tokens?.refreshToken, "refresh_token"], [tokens?.accessToken, "access_token"]]);
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
        };

        const holder = await deps.store.findByPlatformUser(platform, identity.platformUserId);
        if (holder && holder.userId !== user.id) {
            // Someone else holds this channel. Only a row they explicitly disconnected
            // (`revoked`) yields to fresh proof of ownership; active or merely broken
            // (`needs_reconnect`) links stay theirs.
            if (holder.status !== "revoked") return await rejectElsewhere();
            await deps.store.deleteById(holder.id);
        }

        // The user's previous link on this platform: its tokens are revoked once the new
        // ones are safely stored, so an old refresh token never lingers at the platform.
        const previous = await deps.store.findByUserAndPlatform(user.id, platform);
        const aad = connectionAad(platform, identity.platformUserId);
        let upserted: { record: StreamerConnectionRecord; relinked: boolean };
        try {
            upserted = await deps.store.upsertLinked({
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
        } catch (error) {
            // Two callbacks raced for the same channel; the unique index decided.
            if (getUniqueConstraintTarget(error) !== null) return await rejectElsewhere();
            throw error;
        }
        tokens = null; // stored; no longer ours to revoke on failure
        const { record, relinked } = upserted;
        if (previous && previous.status === "active") {
            await revokeAtPlatform(client, [
                [decryptStored(deps, previous, previous.refreshTokenEnc), "refresh_token"],
                [decryptStored(deps, previous, previous.accessTokenEnc), "access_token"],
            ]);
        }
        const channelChanged = Boolean(previous && previous.platformUserId !== identity.platformUserId);
        await safely(
            deps.writeAudit({
                actor: { id: user.id, role: user.role },
                action: relinked ? "streamer.connection.relinked" : "streamer.connection.linked",
                resourceType: AUDIT_RESOURCE_TYPE,
                resourceId: record.id,
                summary: relinked ? (channelChanged ? "Streamer channel changed" : "Streamer channel relinked") : "Streamer channel linked",
                metadata: channelChanged ? { platform, reason: "channel_changed" } : { platform },
            })
        );
        return { redirectTo: settingsRedirect("linked", platform) };
    } catch (error) {
        if (tokens) {
            // Nothing was stored: do not leave a live grant behind.
            await revokeAtPlatform(client, [[tokens.refreshToken, "refresh_token"], [tokens.accessToken, "access_token"]]).catch(() => undefined);
        }
        if (isStreamerPlatformError(error)) {
            await safely(deps.emitEvent({ event: "streamer.connect.platform_error", level: "warn", context: { platform, operation: error.operation, kind: error.kind, status: error.status } }));
            return fail(platform, "platform_error");
        }
        await safely(deps.emitEvent({ event: "streamer.connect.failed", level: "error", context: { platform, error: error instanceof Error ? error.name : "unknown" } }));
        return fail(platform, "internal_error");
    }
}
