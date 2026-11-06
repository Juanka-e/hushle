import type { StatusReason, StreamerConnectionRecord, StreamerConnectionStore } from "./connection-store";
import { brandError, hasErrorBrand } from "./error-brand";
import { StreamerPlatformError, type StreamerPlatformClient, type TokenHint, type TokenSet } from "./platform-client";
import { connectionAad, decryptToken, encryptToken, TokenDecryptError, type TokenKeyring } from "./token-crypto";

// "Bir kez bağla; duran token yaşamaz": refresh near expiry, and on any sign that the
// platform no longer honours the tokens, delete them at once and ask for a reconnect.
// A refresh that loses a race against a disconnect never resurrects tokens: the fresh
// ones are revoked instead. A refresh that loses a race against another refresh never
// breaks the connection: the tokens the winner stored are used. One that loses to a relink to
// another channel revokes its fresh tokens of the old channel and is refused; a relink of the same
// channel may share the platform authorization, so its tokens are used and ours only dropped. A
// reconnect mark is conditional on the refresh token it judged.

export const REFRESH_LEEWAY_MS = 60_000;

export interface TokenServiceDeps {
    store: StreamerConnectionStore;
    client: StreamerPlatformClient;
    keyring: TokenKeyring;
    now?: () => Date;
}

interface AccessResult {
    accessToken: string;
    connection: StreamerConnectionRecord;
}

// One platform refresh per connection at a time in this process: concurrent callers share it.
// On globalThis, as the custom server and the Next route bundles each load this module.
const globalForRefreshes = globalThis as typeof globalThis & { __hushleStreamerTokenRefreshes?: Map<string, Promise<AccessResult>> };
const refreshes = (globalForRefreshes.__hushleStreamerTokenRefreshes ??= new Map<string, Promise<AccessResult>>());

const STREAMER_RECONNECT_REQUIRED_BRAND = Symbol.for("hushle.platform-streamer.reconnect-required");

export class StreamerReconnectRequired extends Error {
    readonly connectionId: string;
    readonly reason: StatusReason;

    constructor(connectionId: string, reason: StatusReason) {
        super(`streamer connection ${connectionId} needs a reconnect (${reason})`);
        this.name = "StreamerReconnectRequired";
        this.connectionId = connectionId;
        this.reason = reason;
        brandError(this, STREAMER_RECONNECT_REQUIRED_BRAND);
    }
}

/**
 * A StreamerReconnectRequired from any copy of this package (see error-brand.ts): a refresh shared
 * across bundles (the in-flight map is on globalThis) rejects with the copy that started it.
 */
export function isStreamerReconnectRequired(error: unknown): error is StreamerReconnectRequired {
    return hasErrorBrand(error, STREAMER_RECONNECT_REQUIRED_BRAND);
}

function clock(deps: TokenServiceDeps): Date {
    return deps.now ? deps.now() : new Date();
}

function aadFor(connection: StreamerConnectionRecord): string {
    return connectionAad(connection.platform, connection.platformUserId);
}

async function reconnect(deps: TokenServiceDeps, connection: StreamerConnectionRecord, reason: StatusReason): Promise<never> {
    // Only over the refresh token this caller judged: a relink that landed meanwhile is kept.
    await deps.store.markNeedsReconnect(connection.id, reason, clock(deps), connection.refreshTokenEnc);
    throw new StreamerReconnectRequired(connection.id, reason);
}

function decryptOrNull(deps: TokenServiceDeps, connection: StreamerConnectionRecord, encoded: string): string | null {
    try {
        return decryptToken(encoded, deps.keyring, aadFor(connection));
    } catch (error) {
        if (error instanceof TokenDecryptError) return null;
        throw error;
    }
}

// Best effort: a platform error here is swallowed, the caller decides what the row says.
export async function revokeAtPlatform(client: StreamerPlatformClient, tokens: Array<[string | null | undefined, TokenHint]>): Promise<boolean> {
    for (const [token, hint] of tokens) {
        if (!token) continue;
        try {
            await client.revoke(token, hint);
            return true;
        } catch (error) {
            if (!(error instanceof StreamerPlatformError)) throw error;
        }
    }
    return false;
}

/**
 * The tokens another writer stored after `connection` was read: the row is still this active
 * connection, for the same channel (a relink may keep the row and change the channel: channel B's
 * token is never handed to a caller holding channel A), and holds a refresh token other than the
 * one read. Null when there are none.
 */
function usableNewerTokens(deps: TokenServiceDeps, connection: StreamerConnectionRecord, current: StreamerConnectionRecord | null): AccessResult | null {
    if (!current || current.id !== connection.id || current.status !== "active" || !current.accessTokenEnc) return null;
    if (current.platformUserId !== connection.platformUserId) return null;
    if (current.refreshTokenEnc === connection.refreshTokenEnc) return null;
    const accessToken = decryptOrNull(deps, current, current.accessTokenEnc);
    return accessToken === null ? null : { accessToken, connection: current };
}

async function newerStoredTokens(deps: TokenServiceDeps, connection: StreamerConnectionRecord): Promise<AccessResult | null> {
    return usableNewerTokens(deps, connection, await deps.store.findByUserAndPlatform(connection.userId, connection.platform));
}

/** A relink moved the row to another channel since `connection` was read: its tokens are nobody's now. */
function channelChangedSince(connection: StreamerConnectionRecord, current: StreamerConnectionRecord): boolean {
    return current.platformUserId !== connection.platformUserId;
}

/** Revokes tokens nobody will use, best effort: whatever the platform answers, the caller goes on. */
async function revokeQuietly(client: StreamerPlatformClient, tokens: TokenSet): Promise<void> {
    try {
        await revokeAtPlatform(client, [
            [tokens.refreshToken, "refresh_token"],
            [tokens.accessToken, "access_token"],
        ]);
    } catch {
        // Best effort: an expiring token is the worst case.
    }
}

async function storeTokens(
    deps: TokenServiceDeps,
    connection: StreamerConnectionRecord,
    tokens: TokenSet,
    previousRefreshToken: string | null
): Promise<AccessResult> {
    const aad = aadFor(connection);
    // The refresh token is always re-encrypted under the current key, even when the
    // platform kept the old one, so a dropped previous key never strands a row.
    const refreshToken = tokens.refreshToken ?? previousRefreshToken;
    const updated = await deps.store.updateTokens(connection.id, {
        accessTokenEnc: encryptToken(tokens.accessToken, deps.keyring, aad),
        refreshTokenEnc: refreshToken ? encryptToken(refreshToken, deps.keyring, aad) : null,
        tokenKeyVersion: deps.keyring.current.version,
        accessTokenExpiresAt: tokens.expiresAt,
        now: clock(deps),
        // Compare-and-set over the refresh token this refresh replaces.
        previousRefreshTokenEnc: connection.refreshTokenEnc,
    });
    if (updated) return { accessToken: tokens.accessToken, connection: updated };
    // Lost the race to another writer.
    const current = await deps.store.findByUserAndPlatform(connection.userId, connection.platform);
    if (current && current.id === connection.id && current.status === "active") {
        // A relink to another channel won: ours belong to the old channel, nobody will use them,
        // they are revoked (best effort). A concurrent refresh, or a relink of the same channel,
        // won: ours are dropped, not revoked, as both may share one platform authorization and
        // revoking ours could revoke the winner's.
        if (channelChangedSince(connection, current)) await revokeQuietly(deps.client, tokens);
        // Newer tokens of the same channel stand and are used.
        const winner = usableNewerTokens(deps, connection, current);
        if (winner) return winner;
        // Still active but nothing usable to hand out: refuse this call, never mark the row.
        throw new StreamerReconnectRequired(connection.id, "refresh_failed");
    }
    // The row was disconnected meanwhile. The tokens we just obtained must not outlive that
    // decision.
    await revokeAtPlatform(deps.client, [
        [tokens.refreshToken, "refresh_token"],
        [tokens.accessToken, "access_token"],
    ]);
    throw new StreamerReconnectRequired(connection.id, (current?.statusReason as StatusReason | null) ?? "refresh_failed");
}

async function refreshOrReconnect(deps: TokenServiceDeps, connection: StreamerConnectionRecord): Promise<AccessResult> {
    const refreshToken = connection.refreshTokenEnc ? decryptOrNull(deps, connection, connection.refreshTokenEnc) : null;
    if (!refreshToken) return reconnect(deps, connection, "refresh_failed");
    let tokens: TokenSet;
    try {
        tokens = await deps.client.refresh(refreshToken);
    } catch (error) {
        // Only the platform saying "this grant is dead" ends the connection. A 401 from the
        // token endpoint is our client credentials, a network error is transient: both
        // leave the row untouched.
        if (error instanceof StreamerPlatformError && error.kind === "invalid_grant") {
            // A refresh token the row no longer holds was rotated away by a refresh elsewhere:
            // a lost race, not a dead grant. The newer tokens are used.
            const winner = await newerStoredTokens(deps, connection);
            if (winner) return winner;
            return reconnect(deps, connection, "refresh_failed");
        }
        throw error;
    }
    return storeTokens(deps, connection, tokens, refreshToken);
}

/** Refreshes the connection's tokens, sharing a refresh already running for it in this process. */
function sharedRefresh(deps: TokenServiceDeps, connection: StreamerConnectionRecord): Promise<AccessResult> {
    const running = refreshes.get(connection.id);
    if (running) return running;
    const flight: Promise<AccessResult> = refreshOrReconnect(deps, connection).finally(() => {
        if (refreshes.get(connection.id) === flight) refreshes.delete(connection.id);
    });
    refreshes.set(connection.id, flight);
    return flight;
}

export async function getAccessToken(
    deps: TokenServiceDeps,
    connection: StreamerConnectionRecord
): Promise<{ accessToken: string; connection: StreamerConnectionRecord }> {
    if (connection.status !== "active") {
        throw new StreamerReconnectRequired(connection.id, (connection.statusReason as StatusReason | null) ?? "refresh_failed");
    }
    if (!connection.accessTokenEnc) return sharedRefresh(deps, connection);
    const accessToken = decryptOrNull(deps, connection, connection.accessTokenEnc);
    if (accessToken === null) return reconnect(deps, connection, "refresh_failed");
    const expiresAt = connection.accessTokenExpiresAt?.getTime() ?? null;
    if (expiresAt !== null && expiresAt - clock(deps).getTime() < REFRESH_LEEWAY_MS) {
        return sharedRefresh(deps, connection);
    }
    return { accessToken, connection };
}

export async function callWithToken<T>(
    deps: TokenServiceDeps,
    connection: StreamerConnectionRecord,
    fn: (accessToken: string) => Promise<T>
): Promise<T> {
    const first = await getAccessToken(deps, connection);
    let result: T;
    try {
        result = await fn(first.accessToken);
    } catch (error) {
        if (!(error instanceof StreamerPlatformError) || error.kind !== "unauthorized") throw error;
        const second = await sharedRefresh(deps, first.connection);
        try {
            result = await fn(second.accessToken);
        } catch (retryError) {
            if (retryError instanceof StreamerPlatformError && retryError.kind === "unauthorized") {
                return reconnect(deps, second.connection, "refresh_failed");
            }
            throw retryError;
        }
    }
    await deps.store.touchUsed(connection.id, clock(deps));
    return result;
}

export async function revokeConnectionTokens(
    deps: TokenServiceDeps,
    connection: StreamerConnectionRecord,
    reason: StatusReason,
    status: "needs_reconnect" | "revoked"
): Promise<{ revokedAtPlatform: boolean }> {
    const refreshToken = connection.refreshTokenEnc ? decryptOrNull(deps, connection, connection.refreshTokenEnc) : null;
    const accessToken = connection.accessTokenEnc ? decryptOrNull(deps, connection, connection.accessTokenEnc) : null;
    let revokedAtPlatform = await revokeAtPlatform(deps.client, [
        [accessToken, "access_token"],
        [refreshToken, "refresh_token"],
    ]);
    if (!revokedAtPlatform && refreshToken) {
        // Twitch revokes access tokens; a stored one is usually stale. Mint a fresh one just
        // to revoke it, which also invalidates the grant behind it.
        try {
            const fresh = await deps.client.refresh(refreshToken);
            revokedAtPlatform = await revokeAtPlatform(deps.client, [
                [fresh.accessToken, "access_token"],
                [fresh.refreshToken, "refresh_token"],
            ]);
        } catch (error) {
            if (!(error instanceof StreamerPlatformError)) throw error;
        }
    }
    const now = clock(deps);
    if (status === "revoked") await deps.store.markRevoked(connection.id, reason, now);
    else await deps.store.markNeedsReconnect(connection.id, reason, now);
    return { revokedAtPlatform };
}
