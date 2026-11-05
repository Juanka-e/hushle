import type { StatusReason, StreamerConnectionRecord, StreamerConnectionStore } from "./connection-store";
import { StreamerPlatformError, type StreamerPlatformClient, type TokenHint, type TokenSet } from "./platform-client";
import { connectionAad, decryptToken, encryptToken, TokenDecryptError, type TokenKeyring } from "./token-crypto";

// "Bir kez bağla; duran token yaşamaz": refresh near expiry, and on any sign that the
// platform no longer honours the tokens, delete them at once and ask for a reconnect.
// A refresh that loses a race against a disconnect never resurrects tokens: the fresh
// ones are revoked instead.

export const REFRESH_LEEWAY_MS = 60_000;

export interface TokenServiceDeps {
    store: StreamerConnectionStore;
    client: StreamerPlatformClient;
    keyring: TokenKeyring;
    now?: () => Date;
}

export class StreamerReconnectRequired extends Error {
    readonly connectionId: string;
    readonly reason: StatusReason;

    constructor(connectionId: string, reason: StatusReason) {
        super(`streamer connection ${connectionId} needs a reconnect (${reason})`);
        this.name = "StreamerReconnectRequired";
        this.connectionId = connectionId;
        this.reason = reason;
    }
}

function clock(deps: TokenServiceDeps): Date {
    return deps.now ? deps.now() : new Date();
}

function aadFor(connection: StreamerConnectionRecord): string {
    return connectionAad(connection.platform, connection.platformUserId);
}

async function reconnect(deps: TokenServiceDeps, connection: StreamerConnectionRecord, reason: StatusReason): Promise<never> {
    await deps.store.markNeedsReconnect(connection.id, reason, clock(deps));
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

async function storeTokens(
    deps: TokenServiceDeps,
    connection: StreamerConnectionRecord,
    tokens: TokenSet,
    previousRefreshToken: string | null
): Promise<StreamerConnectionRecord> {
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
    });
    if (updated) return updated;
    // Lost the race: the row was disconnected or relinked meanwhile. The tokens we just
    // obtained must not outlive that decision.
    await revokeAtPlatform(deps.client, [
        [tokens.refreshToken, "refresh_token"],
        [tokens.accessToken, "access_token"],
    ]);
    const current = await deps.store.findByUserAndPlatform(connection.userId, connection.platform);
    throw new StreamerReconnectRequired(connection.id, (current?.statusReason as StatusReason | null) ?? "refresh_failed");
}

async function refreshOrReconnect(deps: TokenServiceDeps, connection: StreamerConnectionRecord): Promise<{ accessToken: string; connection: StreamerConnectionRecord }> {
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
            return reconnect(deps, connection, "refresh_failed");
        }
        throw error;
    }
    const updated = await storeTokens(deps, connection, tokens, refreshToken);
    return { accessToken: tokens.accessToken, connection: updated };
}

export async function getAccessToken(
    deps: TokenServiceDeps,
    connection: StreamerConnectionRecord
): Promise<{ accessToken: string; connection: StreamerConnectionRecord }> {
    if (connection.status !== "active") {
        throw new StreamerReconnectRequired(connection.id, (connection.statusReason as StatusReason | null) ?? "refresh_failed");
    }
    if (!connection.accessTokenEnc) return refreshOrReconnect(deps, connection);
    const accessToken = decryptOrNull(deps, connection, connection.accessTokenEnc);
    if (accessToken === null) return reconnect(deps, connection, "refresh_failed");
    const expiresAt = connection.accessTokenExpiresAt?.getTime() ?? null;
    if (expiresAt !== null && expiresAt - clock(deps).getTime() < REFRESH_LEEWAY_MS) {
        return refreshOrReconnect(deps, connection);
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
        const second = await refreshOrReconnect(deps, first.connection);
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
    const revokedAtPlatform = await revokeAtPlatform(deps.client, [
        [refreshToken, "refresh_token"],
        [accessToken, "access_token"],
    ]);
    const now = clock(deps);
    if (status === "revoked") await deps.store.markRevoked(connection.id, reason, now);
    else await deps.store.markNeedsReconnect(connection.id, reason, now);
    return { revokedAtPlatform };
}
