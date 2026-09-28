import { prisma } from "@hushle/platform-db";
import type { EmailRetentionConfig } from "./config";

export interface EmailRetentionStore {
    findOutboxIds(input: {
        sentCutoff: Date;
        deadLetterCutoff: Date;
        limit: number;
    }): Promise<string[]>;
    deleteOutbox(ids: string[]): Promise<number>;
    findDeliveryEventIds?(cutoff: Date, limit: number): Promise<string[]>;
    deleteDeliveryEvents?(ids: string[]): Promise<number>;
    findTokenIds(cutoff: Date, limit: number): Promise<string[]>;
    deleteTokens(ids: string[]): Promise<number>;
    findPasswordResetTokenIds?(cutoff: Date, limit: number): Promise<string[]>;
    deletePasswordResetTokens?(ids: string[]): Promise<number>;
    findEmailChangeTokenIds?(cutoff: Date, limit: number): Promise<string[]>;
    deleteEmailChangeTokens?(ids: string[]): Promise<number>;
    findStalePendingEmailUserIds?(cutoff: Date, limit: number): Promise<number[]>;
    clearStalePendingEmails?(ids: number[], cutoff: Date): Promise<number>;
    findPendingAccountIds(cutoff: Date, limit: number): Promise<number[]>;
    deletePendingAccounts(ids: number[]): Promise<number>;
}

const prismaEmailRetentionStore: EmailRetentionStore = {
    async findOutboxIds(input) {
        const rows = await prisma.emailOutboxMessage.findMany({
            where: {
                OR: [
                    {
                        status: "sent",
                        sentAt: { lt: input.sentCutoff },
                    },
                    {
                        status: "dead_letter",
                        updatedAt: { lt: input.deadLetterCutoff },
                    },
                ],
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: input.limit,
            select: { id: true },
        });
        return rows.map((row) => row.id);
    },
    async deleteOutbox(ids) {
        const result = await prisma.emailOutboxMessage.deleteMany({
            where: { id: { in: ids } },
        });
        return result.count;
    },
    async findDeliveryEventIds(cutoff, limit) {
        const rows = await prisma.emailDeliveryEvent.findMany({
            where: { occurredAt: { lt: cutoff } },
            orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
            take: limit,
            select: { id: true },
        });
        return rows.map((row) => row.id);
    },
    async deleteDeliveryEvents(ids) {
        const result = await prisma.emailDeliveryEvent.deleteMany({
            where: { id: { in: ids } },
        });
        return result.count;
    },
    async findTokenIds(cutoff, limit) {
        const rows = await prisma.emailVerificationToken.findMany({
            where: {
                expiresAt: { lt: cutoff },
            },
            orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
            take: limit,
            select: { id: true },
        });
        return rows.map((row) => row.id);
    },
    async deleteTokens(ids) {
        const result = await prisma.emailVerificationToken.deleteMany({
            where: { id: { in: ids } },
        });
        return result.count;
    },
    async findPasswordResetTokenIds(cutoff, limit) {
        const rows = await prisma.passwordResetToken.findMany({
            where: { expiresAt: { lt: cutoff } },
            orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
            take: limit,
            select: { id: true },
        });
        return rows.map((row) => row.id);
    },
    async deletePasswordResetTokens(ids) {
        const result = await prisma.passwordResetToken.deleteMany({
            where: { id: { in: ids } },
        });
        return result.count;
    },
    async findEmailChangeTokenIds(cutoff, limit) {
        const rows = await prisma.emailChangeToken.findMany({
            where: { expiresAt: { lt: cutoff } },
            orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
            take: limit,
            select: { id: true },
        });
        return rows.map((row) => row.id);
    },
    async deleteEmailChangeTokens(ids) {
        const result = await prisma.emailChangeToken.deleteMany({
            where: { id: { in: ids } },
        });
        return result.count;
    },
    async findStalePendingEmailUserIds(cutoff, limit) {
        const rows = await prisma.user.findMany({
            where: {
                pendingEmail: { not: null },
                pendingEmailRequestedAt: { lt: cutoff },
            },
            orderBy: [{ pendingEmailRequestedAt: "asc" }, { id: "asc" }],
            take: limit,
            select: { id: true },
        });
        return rows.map((row) => row.id);
    },
    async clearStalePendingEmails(ids, cutoff) {
        const result = await prisma.user.updateMany({
            where: {
                id: { in: ids },
                pendingEmail: { not: null },
                pendingEmailRequestedAt: { lt: cutoff },
            },
            data: {
                pendingEmail: null,
                pendingNormalizedEmail: null,
                pendingEmailRequestedAt: null,
            },
        });
        return result.count;
    },
    async findPendingAccountIds(cutoff, limit) {
        const rows = await prisma.user.findMany({
            where: {
                accountStatus: "pending_email_verification",
                emailVerifiedAt: null,
                emailVerificationRequiredAt: { lt: cutoff },
            },
            orderBy: [
                { emailVerificationRequiredAt: "asc" },
                { id: "asc" },
            ],
            take: limit,
            select: { id: true },
        });
        return rows.map((row) => row.id);
    },
    async deletePendingAccounts(ids) {
        const result = await prisma.user.deleteMany({
            where: {
                id: { in: ids },
                accountStatus: "pending_email_verification",
                emailVerifiedAt: null,
            },
        });
        return result.count;
    },
};

export async function runEmailRetention(input: {
    config: EmailRetentionConfig;
    dryRun: boolean;
    now?: Date;
    store?: EmailRetentionStore;
}) {
    const now = input.now ?? new Date();
    const dayMs = 24 * 60 * 60_000;
    const sentCutoff = new Date(
        now.getTime() - input.config.sentRetentionDays * dayMs
    );
    const deadLetterCutoff = new Date(
        now.getTime() - input.config.deadLetterRetentionDays * dayMs
    );
    const tokenCutoff = new Date(
        now.getTime() - input.config.tokenRetentionDays * dayMs
    );
    const pendingAccountCutoff = new Date(
        now.getTime() - input.config.pendingAccountRetentionDays * dayMs
    );
    const stalePendingEmailCutoff = new Date(now.getTime() - 2 * dayMs);
    const store = input.store ?? prismaEmailRetentionStore;
    const [
        outboxIds,
        deliveryEventIds,
        tokenIds,
        passwordResetTokenIds,
        emailChangeTokenIds,
        stalePendingEmailUserIds,
        pendingAccountIds,
    ] = await Promise.all([
        store.findOutboxIds({
            sentCutoff,
            deadLetterCutoff,
            limit: input.config.batchSize,
        }),
        store.findDeliveryEventIds?.(
            deadLetterCutoff,
            input.config.batchSize
        ) ?? [],
        store.findTokenIds(tokenCutoff, input.config.batchSize),
        store.findPasswordResetTokenIds?.(
            tokenCutoff,
            input.config.batchSize
        ) ?? [],
        store.findEmailChangeTokenIds?.(
            tokenCutoff,
            input.config.batchSize
        ) ?? [],
        store.findStalePendingEmailUserIds?.(
            stalePendingEmailCutoff,
            input.config.batchSize
        ) ?? [],
        store.findPendingAccountIds(
            pendingAccountCutoff,
            input.config.batchSize
        ),
    ]);

    const [
        deletedOutboxCount,
        deletedDeliveryEventCount,
        deletedTokenCount,
        deletedPasswordResetTokenCount,
        deletedEmailChangeTokenCount,
        clearedStalePendingEmailCount,
        deletedPendingAccountCount,
    ] = input.dryRun
        ? [0, 0, 0, 0, 0, 0, 0]
        : await Promise.all([
              outboxIds.length > 0 ? store.deleteOutbox(outboxIds) : 0,
              deliveryEventIds.length > 0 && store.deleteDeliveryEvents
                  ? store.deleteDeliveryEvents(deliveryEventIds)
                  : 0,
              tokenIds.length > 0 ? store.deleteTokens(tokenIds) : 0,
              passwordResetTokenIds.length > 0 &&
              store.deletePasswordResetTokens
                  ? store.deletePasswordResetTokens(passwordResetTokenIds)
                  : 0,
              emailChangeTokenIds.length > 0 &&
              store.deleteEmailChangeTokens
                  ? store.deleteEmailChangeTokens(emailChangeTokenIds)
                  : 0,
              stalePendingEmailUserIds.length > 0 &&
              store.clearStalePendingEmails
                  ? store.clearStalePendingEmails(
                        stalePendingEmailUserIds,
                        stalePendingEmailCutoff
                    )
                  : 0,
              pendingAccountIds.length > 0
                  ? store.deletePendingAccounts(pendingAccountIds)
                  : 0,
          ]);

    return {
        dryRun: input.dryRun,
        outboxCandidateCount: outboxIds.length,
        deliveryEventCandidateCount: deliveryEventIds.length,
        tokenCandidateCount: tokenIds.length,
        passwordResetTokenCandidateCount: passwordResetTokenIds.length,
        emailChangeTokenCandidateCount: emailChangeTokenIds.length,
        stalePendingEmailCandidateCount: stalePendingEmailUserIds.length,
        pendingAccountCandidateCount: pendingAccountIds.length,
        deletedOutboxCount,
        deletedDeliveryEventCount,
        deletedTokenCount,
        deletedPasswordResetTokenCount,
        deletedEmailChangeTokenCount,
        clearedStalePendingEmailCount,
        deletedPendingAccountCount,
        hasMore:
            outboxIds.length === input.config.batchSize ||
            deliveryEventIds.length === input.config.batchSize ||
            tokenIds.length === input.config.batchSize ||
            passwordResetTokenIds.length === input.config.batchSize ||
            emailChangeTokenIds.length === input.config.batchSize ||
            stalePendingEmailUserIds.length === input.config.batchSize ||
            pendingAccountIds.length === input.config.batchSize,
    };
}
