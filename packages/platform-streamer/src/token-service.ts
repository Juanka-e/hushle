import type { StatusReason, StreamerConnectionRecord, StreamerConnectionStore } from "./connection-store";
import { StreamerPlatformError, type StreamerPlatformClient, type TokenHint, type TokenSet } from "./platform-client";
import { connectionAad, decryptToken, encryptToken, TokenDecryptError, type TokenKeyring } from "./token-crypto";

// "Bir kez bağla; duran token yaşamaz": refresh near expiry, and on any sign that the
// platform no longer honours the tokens, delete them at once and ask for a reconnect.

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

function decryptOrReconnect(deps: TokenServiceDeps, connection: StreamerConnectionRecord, encoded: string): string | null {
    try {
        return decryptToken(encoded, deps.keyring, aadFor(connection));
    } catch (error) {
        if (error instanceof TokenDecryptError) return null;
        throw error;
    }
}

async function storeTokens(deps: TokenServiceDeps, connection: StreamerConnectionRecord, tokens: TokenSet): Promise<StreamerConnectionRecord> {
    const aad = aadFor(connection);
    return deps.store.updateTokens(connection.id, {
        accessTokenEnc: encryptToken(tokens.accessToken, deps.keyring, aad),
        refreshTokenEnc: tokens.refreshToken ? encryptToken(tokens.refreshToken, deps.keyring, aad) : connection.refreshTokenEnc,
        tokenKeyVersion: deps.keyring.current.version,
        accessTokenExpiresAt: tokens.expiresAt,
        now: clock(deps),
    });
}

async function refreshOrReconnect(deps: TokenServiceDeps, connection: StreamerConnectionRecord): Promise<{ accessToken: string; connection: StreamerConnectionRecord }> {
    const refreshToken = connection.refreshTokenEnc ? decryptOrReconnect(deps, connection, connection.refreshTokenEnc) : null;
    if (!refreshToken) return reconnect(deps, connection, "refresh_failed");
    let tokens: TokenSet;
    try {
        tokens = await deps.client.refresh(refreshToken);
    } catch (error) {
        if (error instanceof StreamerPlatformError && (error.kind === "invalid_grant" || error.kind === "unauthorized")) {
            return reconnect(deps, connection, "refresh_failed");
        }
        throw error;
    }
    const updated = await storeTokens(deps, connection, tokens);
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
    const accessToken = decryptOrReconnect(deps, connection, connection.accessTokenEnc);
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
    let revokedAtPlatform = false;
    const candidates: Array<[string | null, TokenHint]> = [
        [connection.refreshTokenEnc, "refresh_token"],
        [connection.accessTokenEnc, "access_token"],
    ];
    for (const [encoded, hint] of candidates) {
        if (!encoded) continue;
        const token = decryptOrReconnect(deps, connection, encoded);
        if (!token) continue;
        try {
            await deps.client.revoke(token, hint);
            revokedAtPlatform = true;
            break;
        } catch (error) {
            if (!(error instanceof StreamerPlatformError)) throw error;
        }
    }
    const now = clock(deps);
    if (status === "revoked") await deps.store.markRevoked(connection.id, reason, now);
    else await deps.store.markNeedsReconnect(connection.id, reason, now);
    return { revokedAtPlatform };
}
