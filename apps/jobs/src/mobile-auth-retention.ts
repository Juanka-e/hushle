import { prisma } from "@hushle/platform-db";
import type { MobileAuthRetentionConfig } from "./config";

export interface MobileAuthRetentionStore {
    findCandidateIds(cutoff: Date, limit: number): Promise<string[]>;
    deleteCandidates(ids: string[], cutoff: Date): Promise<number>;
    deleteTokenEvidence(cutoff: Date, limit: number): Promise<number>;
}

export interface MobileAuthRetentionResult {
    dryRun: boolean;
    cutoff: string;
    candidateCount: number;
    deletedCount: number;
    deletedTokenCount: number;
    hasMore: boolean;
}

const prismaMobileAuthRetentionStore: MobileAuthRetentionStore = {
    async findCandidateIds(cutoff, limit) {
        const candidates = await prisma.mobileAuthSession.findMany({
            where: {
                OR: [
                    { revokedAt: { lt: cutoff } },
                    { refreshExpiresAt: { lt: cutoff } },
                ],
            },
            orderBy: [{ refreshExpiresAt: "asc" }, { id: "asc" }],
            take: limit,
            select: { id: true },
        });
        return candidates.map((candidate) => candidate.id);
    },
    async deleteCandidates(ids, cutoff) {
        const result = await prisma.mobileAuthSession.deleteMany({
            where: {
                id: { in: ids },
                OR: [
                    { revokedAt: { lt: cutoff } },
                    { refreshExpiresAt: { lt: cutoff } },
                ],
            },
        });
        return result.count;
    },
    async deleteTokenEvidence(cutoff, limit) {
        const candidates = await prisma.mobileAuthToken.findMany({
            where: {
                OR: [
                    { consumedAt: { lt: cutoff } },
                    { kind: "access", expiresAt: { lt: cutoff } },
                ],
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: limit,
            select: { id: true },
        });
        if (candidates.length === 0) return 0;
        const result = await prisma.mobileAuthToken.deleteMany({
            where: {
                id: { in: candidates.map((candidate) => candidate.id) },
            },
        });
        return result.count;
    },
};

export async function runMobileAuthRetention(input: {
    config: MobileAuthRetentionConfig;
    dryRun: boolean;
    now?: Date;
    store?: MobileAuthRetentionStore;
}): Promise<MobileAuthRetentionResult> {
    const now = input.now ?? new Date();
    const cutoff = new Date(
        now.getTime() - input.config.retentionDays * 24 * 60 * 60_000
    );
    const tokenCutoff = new Date(
        now.getTime() -
            input.config.reuseEvidenceDays * 24 * 60 * 60_000
    );
    const store = input.store ?? prismaMobileAuthRetentionStore;
    const candidateIds = await store.findCandidateIds(
        cutoff,
        input.config.batchSize
    );

    const deleted =
        input.dryRun || candidateIds.length === 0
            ? 0
            : await store.deleteCandidates(candidateIds, cutoff);
    const deletedTokenCount = input.dryRun
        ? 0
        : await store.deleteTokenEvidence(
              tokenCutoff,
              input.config.batchSize
          );

    return {
        dryRun: input.dryRun,
        cutoff: cutoff.toISOString(),
        candidateCount: candidateIds.length,
        deletedCount: deleted,
        deletedTokenCount,
        hasMore: candidateIds.length === input.config.batchSize,
    };
}
