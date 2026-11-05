import {
    isStreamerPlatform,
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

function tokenDeps(deps: ConnectFlowDeps, platform: StreamerPlatform) {
    return { store: deps.store, client: deps.clientFor(platform), keyring: deps.keyring, now: deps.now };
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
    await revokeConnectionTokens(tokenDeps(deps, input.platform), record, "user_disconnected", "revoked");
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
        await revokeConnectionTokens(tokenDeps(deps, record.platform), record, reason, "revoked");
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
