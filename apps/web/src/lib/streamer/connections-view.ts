import {
    getAccessToken,
    isStreamerConfigError,
    isStreamerPlatform,
    isStreamerPlatformError,
    isStreamerReconnectRequired,
    PLATFORM_LABELS,
    revokeConnectionTokens,
    STREAMER_PLATFORMS,
    type StatusReason,
    type StreamerConnectionRecord,
    type StreamerPlatform,
} from "@hushle/platform-streamer";
import type { StreamerConnectionsResponse, StreamerConnectionSummary } from "@/types/streamer";
import { AUDIT_RESOURCE_TYPE, type ConnectFlowDeps, type ConnectFlowUser } from "./connect-flow";

// What the settings page and the /streamer gate may know about a connection: identity,
// status and dates. Token columns never leave the store layer.

export function summarizeConnection(record: StreamerConnectionRecord): StreamerConnectionSummary {
    return {
        login: record.login,
        displayName: record.displayName,
        avatarUrl: record.avatarUrl,
        channelUrl: record.channelUrl,
        status: record.status,
        statusReason: record.statusReason,
        connectedAt: record.connectedAt.toISOString(),
    };
}

export async function listConnectionsView(deps: ConnectFlowDeps, userId: number): Promise<StreamerConnectionsResponse> {
    const [enabled, records] = await Promise.all([deps.isStreamerModeEnabled(), deps.store.findByUser(userId)]);
    return {
        enabled,
        platforms: STREAMER_PLATFORMS.map((platform) => {
            const record = records.find((entry) => entry.platform === platform) ?? null;
            return {
                platform,
                label: PLATFORM_LABELS[platform],
                configured: deps.isPlatformConfigured(platform),
                connection: record ? summarizeConnection(record) : null,
            };
        }),
    };
}

/** What validating a connection needs: the store, the token key and the platform clients. */
export type ConnectionCheckDeps = Pick<ConnectFlowDeps, "store" | "keyring" | "clientFor" | "now">;

function tokenDeps(deps: ConnectionCheckDeps, platform: StreamerPlatform) {
    return { store: deps.store, client: deps.clientFor(platform), keyring: deps.keyring, now: deps.now };
}

function clock(deps: Pick<ConnectFlowDeps, "now">): Date {
    return deps.now ? deps.now() : new Date();
}

// Revoke at the platform when a client can be built; clear the row regardless, so a
// deployment without platform credentials never traps a user in a linked state.
async function revokeRecord(deps: ConnectFlowDeps, record: StreamerConnectionRecord, reason: StatusReason, status: "revoked" | "needs_reconnect"): Promise<void> {
    let platformDeps;
    try {
        platformDeps = tokenDeps(deps, record.platform);
    } catch (error) {
        if (!isStreamerConfigError(error)) throw error;
        if (status === "revoked") await deps.store.markRevoked(record.id, reason, clock(deps));
        else await deps.store.markNeedsReconnect(record.id, reason, clock(deps));
        return;
    }
    await revokeConnectionTokens(platformDeps, record, reason, status);
}

/** Whether the row is still the active one: a refusal or a skipped mark leaves it to the next check. */
async function stillActive(deps: ConnectionCheckDeps, record: StreamerConnectionRecord): Promise<ConnectionValidation> {
    const current = await deps.store.findByUserAndPlatform(record.userId, record.platform);
    return current && current.id === record.id && current.status === "active" ? "unavailable" : "needs_reconnect";
}

/** What validating a connection found: still good, now `needs_reconnect`, or no answer this time. */
export type ConnectionValidation = "valid" | "needs_reconnect" | "unavailable";

/**
 * One active connection proves it still works: its token (refreshed when due) passes the
 * platform's validate. A dead grant becomes `needs_reconnect`; a good one is stamped
 * `lastValidatedAt`. A platform that does not answer (or is not configured here) changes nothing.
 */
export async function validateConnection(deps: ConnectionCheckDeps, record: StreamerConnectionRecord): Promise<ConnectionValidation> {
    if (record.status !== "active") return "needs_reconnect";
    let platformDeps;
    try {
        platformDeps = tokenDeps(deps, record.platform);
    } catch (error) {
        if (isStreamerConfigError(error)) return "unavailable";
        throw error;
    }
    try {
        const { accessToken, connection } = await getAccessToken(platformDeps, record);
        if (platformDeps.client.validate) {
            const result = await platformDeps.client.validate(accessToken);
            if (!result.ok) {
                // Conditional on the tokens validated: a relink that landed meanwhile is not wiped.
                const marked = await deps.store.markNeedsReconnect(connection.id, "refresh_failed", clock(deps), connection.refreshTokenEnc);
                return marked ? "needs_reconnect" : stillActive(deps, connection);
            }
        }
        await deps.store.touchValidated(connection.id, clock(deps));
        return "valid";
    } catch (error) {
        // Usually already marked by the token service (a lost race is not); transient platform
        // errors leave the row alone.
        if (isStreamerReconnectRequired(error)) return stillActive(deps, record);
        if (isStreamerPlatformError(error)) return "unavailable";
        throw error;
    }
}

/**
 * The hourly check of the link a live session was opened on: the row must still be that link
 * (same id), for the same channel (a relink may keep the row and change the channel), and active;
 * then it is validated as the panel does. Gone, replaced, another channel or not active is
 * `needs_reconnect` for this session, without any platform call and without touching the row.
 */
export async function checkSessionConnection(
    deps: ConnectionCheckDeps,
    link: { id: string; userId: number; platform: StreamerPlatform; platformUserId: string }
): Promise<ConnectionValidation> {
    const record = await deps.store.findByUserAndPlatform(link.userId, link.platform);
    if (!record || record.id !== link.id || record.platformUserId !== link.platformUserId || record.status !== "active") return "needs_reconnect";
    return validateConnection(deps, record);
}

// Panel open: every active connection proves it still works (spec karar 6). A dead grant
// turns into `needs_reconnect` here, not when the first stream fails.
export async function verifyActiveConnections(deps: ConnectFlowDeps, userId: number): Promise<StreamerConnectionsResponse> {
    const records = await deps.store.findByUser(userId);
    for (const record of records) {
        if (record.status === "active") await validateConnection(deps, record);
    }
    return listConnectionsView(deps, userId);
}

async function safely(task: Promise<void>): Promise<void> {
    try {
        await task;
    } catch {
        // audit failures never change the outcome
    }
}

export async function disconnectPlatform(
    deps: ConnectFlowDeps,
    input: { user: ConnectFlowUser; platform: string; requestIp: string }
): Promise<{ ok: true } | { error: "not_found" }> {
    if (!isStreamerPlatform(input.platform)) return { error: "not_found" };
    const record = await deps.store.findByUserAndPlatform(input.user.id, input.platform);
    if (!record || record.status === "revoked") return { error: "not_found" };
    await revokeRecord(deps, record, "user_disconnected", "revoked");
    await safely(
        deps.writeAudit({
            actor: { id: input.user.id, role: input.user.role },
            action: "streamer.connection.disconnected",
            resourceType: AUDIT_RESOURCE_TYPE,
            resourceId: record.id,
            summary: "Streamer channel disconnected",
            metadata: { platform: input.platform, reason: "user_disconnected" },
        })
    );
    return { ok: true };
}

// Account closure or suspension: every platform of the user is revoked, best effort at
// the platform, always in our rows. Returns how many connections were revoked.
export async function revokeAllForUser(deps: ConnectFlowDeps, userId: number, reason: Extract<StatusReason, "account_closed">): Promise<number> {
    const records = await deps.store.findByUser(userId);
    let revoked = 0;
    for (const record of records) {
        if (record.status === "revoked") continue;
        await revokeRecord(deps, record, reason, "revoked");
        revoked += 1;
        await safely(
            deps.writeAudit({
                actor: { id: null, role: "system" },
                action: "streamer.connection.disconnected",
                resourceType: AUDIT_RESOURCE_TYPE,
                resourceId: record.id,
                summary: "Streamer channel revoked on account closure",
                metadata: { platform: record.platform, reason },
            })
        );
    }
    return revoked;
}

// Admin suspension / account closure entry point: best effort, never fails the caller.
export async function revokeStreamerConnectionsForUser(userId: number, request: Request | null): Promise<number> {
    const { createConnectFlowDeps } = await import("./deps");
    try {
        return await revokeAllForUser(createConnectFlowDeps(request), userId, "account_closed");
    } catch (error) {
        if (isStreamerConfigError(error)) return 0;
        console.error("streamer connections could not be revoked for a closed account", error instanceof Error ? error.name : error);
        return 0;
    }
}
