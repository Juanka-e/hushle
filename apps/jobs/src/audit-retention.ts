import { Prisma, prisma } from "@hushle/platform-db";
import type { AuditRetentionConfig } from "./config";

interface AuditCandidate {
    id: number;
    createdAt: Date;
}

export interface AuditRetentionResult {
    dryRun: boolean;
    cutoff: string;
    candidateCount: number;
    archivedCount: number;
    deletedCount: number;
    batchesProcessed: number;
    hasMore: boolean;
}

export interface AuditRetentionStore {
    findCandidates(cutoff: Date, limit: number): Promise<AuditCandidate[]>;
    archiveAndDelete(ids: number[], cutoff: Date): Promise<{
        archivedCount: number;
        deletedCount: number;
    }>;
}

export const prismaAuditRetentionStore: AuditRetentionStore = {
    findCandidates(cutoff, limit) {
        return prisma.auditLog.findMany({
            where: { createdAt: { lt: cutoff } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: limit,
            select: { id: true, createdAt: true },
        });
    },
    async archiveAndDelete(ids, cutoff) {
        if (ids.length === 0) {
            return { archivedCount: 0, deletedCount: 0 };
        }

        return prisma.$transaction(async (tx) => {
            await tx.$executeRaw(
                Prisma.sql`
                    INSERT INTO audit_log_archives (
                        original_audit_log_id,
                        actor_user_id,
                        actor_username,
                        actor_role,
                        action,
                        resource_type,
                        resource_id,
                        ip_address,
                        user_agent,
                        summary,
                        metadata,
                        original_created_at,
                        archived_at
                    )
                    SELECT
                        audit.id,
                        audit.actor_user_id,
                        actor.username,
                        audit.actor_role,
                        audit.action,
                        audit.resource_type,
                        audit.resource_id,
                        audit.ip_address,
                        audit.user_agent,
                        audit.summary,
                        audit.metadata,
                        audit.created_at,
                        NOW()
                    FROM audit_logs AS audit
                    LEFT JOIN users AS actor ON actor.id = audit.actor_user_id
                    WHERE audit.id IN (${Prisma.join(ids)})
                      AND audit.created_at < ${cutoff}
                    ON DUPLICATE KEY UPDATE
                        original_audit_log_id = VALUES(original_audit_log_id)
                `
            );

            const archivedRows = await tx.auditLogArchive.findMany({
                where: { originalAuditLogId: { in: ids } },
                select: { originalAuditLogId: true },
            });
            const archivedIds = archivedRows.map((row) => row.originalAuditLogId);
            const deleted =
                archivedIds.length === 0
                    ? { count: 0 }
                    : await tx.auditLog.deleteMany({
                          where: {
                              id: { in: archivedIds },
                              createdAt: { lt: cutoff },
                          },
                      });

            return {
                archivedCount: archivedIds.length,
                deletedCount: deleted.count,
            };
        });
    },
};

export async function runAuditRetention(input: {
    config: AuditRetentionConfig;
    dryRun: boolean;
    now?: Date;
    store?: AuditRetentionStore;
}): Promise<AuditRetentionResult> {
    const now = input.now ?? new Date();
    const cutoff = new Date(
        now.getTime() - input.config.hotDays * 24 * 60 * 60 * 1_000
    );
    const store = input.store ?? prismaAuditRetentionStore;

    if (input.dryRun) {
        const candidates = await store.findCandidates(
            cutoff,
            input.config.batchSize
        );
        return {
            dryRun: true,
            cutoff: cutoff.toISOString(),
            candidateCount: candidates.length,
            archivedCount: 0,
            deletedCount: 0,
            batchesProcessed: 0,
            hasMore: candidates.length === input.config.batchSize,
        };
    }

    let candidateCount = 0;
    let archivedCount = 0;
    let deletedCount = 0;
    let batchesProcessed = 0;
    let hasMore = false;

    for (
        let batch = 0;
        batch < input.config.maxBatches;
        batch += 1
    ) {
        const candidates = await store.findCandidates(
            cutoff,
            input.config.batchSize
        );
        if (candidates.length === 0) {
            hasMore = false;
            break;
        }

        const result = await store.archiveAndDelete(
            candidates.map((candidate) => candidate.id),
            cutoff
        );
        candidateCount += candidates.length;
        archivedCount += result.archivedCount;
        deletedCount += result.deletedCount;
        batchesProcessed += 1;
        hasMore = candidates.length === input.config.batchSize;

        if (!hasMore) break;
        if (result.deletedCount === 0) {
            throw new Error("Audit retention made no progress; aborting");
        }
    }

    return {
        dryRun: false,
        cutoff: cutoff.toISOString(),
        candidateCount,
        archivedCount,
        deletedCount,
        batchesProcessed,
        hasMore,
    };
}
