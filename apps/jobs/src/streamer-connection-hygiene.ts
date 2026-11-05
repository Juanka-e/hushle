import { prisma } from "@hushle/platform-db";
import {
    createStreamerPlatformClient,
    loadTokenKeyring,
    prismaStreamerConnectionStore,
    revokeConnectionTokens,
    StreamerConfigError,
    type StreamerConnectionStore,
    type StreamerPlatform,
    type StreamerPlatformClient,
    type TokenKeyring,
} from "@hushle/platform-streamer";
import type { StreamerHygieneConfig } from "./config";

// "Duran token yaşamaz": a connection that opened no stream for `dormantDays` is revoked at
// the platform (best effort) and loses its tokens here. The row stays, so the streamer sees
// "yeniden bağla" instead of a vanished channel.

export interface StreamerHygieneAuditEntry {
    action: "streamer.connection.dormant_revoked";
    resourceId: string | null;
    metadata: Record<string, string | number | boolean | null> | null;
}

export type StreamerHygieneAuditWriter = (entry: StreamerHygieneAuditEntry) => Promise<void>;

export interface StreamerHygieneResult {
    dryRun: boolean;
    cutoff: string;
    candidateCount: number;
    revokedCount: number;
    platformRevokeFailures: number;
    hasMore: boolean;
}

const prismaAuditWriter: StreamerHygieneAuditWriter = async (entry) => {
    await prisma.auditLog.create({
        data: {
            actorUserId: null,
            actorRole: "system",
            action: entry.action,
            resourceType: "streamer_connection",
            resourceId: entry.resourceId,
            summary: "Dormant streamer connection revoked",
            metadata: entry.metadata ?? undefined,
        },
    });
};

export async function runStreamerConnectionHygiene(input: {
    dryRun: boolean;
    config: StreamerHygieneConfig;
    store?: StreamerConnectionStore;
    clients?: (platform: StreamerPlatform) => StreamerPlatformClient;
    keyring?: TokenKeyring;
    audit?: StreamerHygieneAuditWriter;
    now?: () => Date;
}): Promise<StreamerHygieneResult> {
    const now = input.now ?? (() => new Date());
    const store = input.store ?? prismaStreamerConnectionStore;
    const audit = input.audit ?? prismaAuditWriter;
    const cutoff = new Date(now().getTime() - input.config.dormantDays * 24 * 60 * 60_000);
    const candidates = await store.findDormant(cutoff, input.config.batchSize);

    let revokedCount = 0;
    let platformRevokeFailures = 0;
    if (!input.dryRun && candidates.length > 0) {
        const keyring = input.keyring ?? loadTokenKeyring(process.env);
        const clientCache = new Map<StreamerPlatform, StreamerPlatformClient | null>();
        const clientFor = (platform: StreamerPlatform): StreamerPlatformClient | null => {
            if (!clientCache.has(platform)) {
                try {
                    clientCache.set(platform, input.clients ? input.clients(platform) : createStreamerPlatformClient(platform, process.env));
                } catch (error) {
                    if (!(error instanceof StreamerConfigError)) throw error;
                    clientCache.set(platform, null);
                }
            }
            return clientCache.get(platform) ?? null;
        };

        for (const connection of candidates) {
            const client = clientFor(connection.platform);
            if (client) {
                const outcome = await revokeConnectionTokens({ store, client, keyring, now }, connection, "dormant", "needs_reconnect");
                if (!outcome.revokedAtPlatform) platformRevokeFailures += 1;
            } else {
                // Platform not configured on this deployment: the tokens still must not linger.
                await store.markNeedsReconnect(connection.id, "dormant", now());
                platformRevokeFailures += 1;
            }
            revokedCount += 1;
            await audit({
                action: "streamer.connection.dormant_revoked",
                resourceId: connection.id,
                metadata: { platform: connection.platform, reason: "dormant" },
            });
        }
    }

    return {
        dryRun: input.dryRun,
        cutoff: cutoff.toISOString(),
        candidateCount: candidates.length,
        revokedCount,
        platformRevokeFailures,
        hasMore: candidates.length === input.config.batchSize,
    };
}
