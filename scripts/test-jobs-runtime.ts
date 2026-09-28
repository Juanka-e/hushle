import assert from "node:assert/strict";
import {
    runAuditRetention,
    type AuditRetentionStore,
} from "../apps/jobs/src/audit-retention";
import {
    areJobsEnabled,
    getAuditRetentionConfig,
    getEmailDeliveryConfig,
    getEmailRetentionConfig,
    getMobileAuthRetentionConfig,
    getPaymentWebhookConfig,
    getPaymentReconciliationConfig,
} from "../apps/jobs/src/config";
import {
    runEmailRetention,
    type EmailRetentionStore,
} from "../apps/jobs/src/email-retention";
import {
    runMobileAuthRetention,
    type MobileAuthRetentionStore,
} from "../apps/jobs/src/mobile-auth-retention";
import { acquireJobLease } from "../apps/jobs/src/lease";
import {
    getJobDefinition,
    isJobName,
    JOB_NAMES,
} from "../apps/jobs/src/registry";
import {
    resetRedisTestClient,
    setRedisTestClient,
    type RedisLikeClient,
} from "@hushle/platform-cache";

const config = getAuditRetentionConfig({
    AUDIT_HOT_RETENTION_DAYS: "90",
    AUDIT_ARCHIVE_BATCH_SIZE: "10",
    AUDIT_ARCHIVE_MAX_BATCHES: "2",
    AUDIT_ARCHIVE_LEASE_TTL_MS: "60000",
});
assert.deepEqual(config, {
    hotDays: 90,
    batchSize: 10,
    maxBatches: 2,
    leaseTtlMs: 60_000,
});
assert.equal(areJobsEnabled(undefined), false);
assert.equal(areJobsEnabled("true"), true);
assert.throws(() => areJobsEnabled("yes"), /must be true or false/);
assert.deepEqual(JOB_NAMES, [
    "audit-retention",
    "mobile-auth-retention",
    "email-delivery",
    "email-retention",
    "payment-webhook",
    "payment-reconciliation",
]);
assert.equal(isJobName("audit-retention"), true);
assert.equal(isJobName("mobile-auth-retention"), true);
assert.equal(isJobName("email-delivery"), true);
assert.equal(isJobName("email-retention"), true);
assert.equal(isJobName("payment-webhook"), true);
assert.equal(isJobName("payment-reconciliation"), true);
assert.equal(isJobName("unknown-job"), false);
assert.equal(getJobDefinition("audit-retention").leaseTtlMs, 900_000);
assert.deepEqual(
    getPaymentWebhookConfig({
        PAYMENT_WEBHOOK_BATCH_SIZE: "25",
        PAYMENT_WEBHOOK_MAX_ATTEMPTS: "8",
        PAYMENT_WEBHOOK_CLAIM_TTL_MS: "300000",
        PAYMENT_WEBHOOK_JOB_LEASE_TTL_MS: "300000",
    }),
    {
        batchSize: 25,
        maxAttempts: 8,
        claimTtlMs: 300_000,
        leaseTtlMs: 300_000,
    }
);
assert.deepEqual(
    getPaymentReconciliationConfig({
        PAYMENT_RECONCILIATION_BATCH_SIZE: "25",
        PAYMENT_RECONCILIATION_MIN_AGE_MINUTES: "30",
        PAYMENT_RECONCILIATION_RETRY_DELAY_MINUTES: "15",
        PAYMENT_RECONCILIATION_MAX_ATTEMPTS: "12",
        PAYMENT_RECONCILIATION_JOB_LEASE_TTL_MS: "300000",
    }),
    {
        batchSize: 25,
        minAgeMinutes: 30,
        retryDelayMinutes: 15,
        maxAttempts: 12,
        leaseTtlMs: 300_000,
    }
);
assert.deepEqual(
    getMobileAuthRetentionConfig({
        MOBILE_AUTH_RETENTION_DAYS: "30",
        MOBILE_AUTH_REUSE_EVIDENCE_DAYS: "7",
        MOBILE_AUTH_RETENTION_BATCH_SIZE: "500",
        MOBILE_AUTH_RETENTION_LEASE_TTL_MS: "300000",
    }),
    {
        retentionDays: 30,
        reuseEvidenceDays: 7,
        batchSize: 500,
        leaseTtlMs: 300_000,
    }
);
assert.deepEqual(
    getEmailDeliveryConfig({
        EMAIL_DELIVERY_BATCH_SIZE: "25",
        EMAIL_DELIVERY_LEASE_TTL_MS: "900000",
    }),
    {
        batchSize: 25,
        leaseTtlMs: 900_000,
    }
);
assert.deepEqual(
    getEmailRetentionConfig({
        EMAIL_SENT_RETENTION_DAYS: "30",
        EMAIL_DEAD_LETTER_RETENTION_DAYS: "90",
        EMAIL_TOKEN_RETENTION_DAYS: "7",
        EMAIL_PENDING_ACCOUNT_RETENTION_DAYS: "7",
        EMAIL_RETENTION_BATCH_SIZE: "500",
        EMAIL_RETENTION_LEASE_TTL_MS: "300000",
    }),
    {
        sentRetentionDays: 30,
        deadLetterRetentionDays: 90,
        tokenRetentionDays: 7,
        pendingAccountRetentionDays: 7,
        batchSize: 500,
        leaseTtlMs: 300_000,
    }
);

async function main(): Promise<void> {
    const leaseValues = new Map<string, string>();
    const leaseClient: RedisLikeClient = {
        async ping() {
            return "PONG";
        },
        async get(key) {
            return leaseValues.get(key) ?? null;
        },
        async set(key, value, options) {
            if (options?.NX && leaseValues.has(key)) return null;
            leaseValues.set(key, value);
            return "OK";
        },
        async del(key) {
            return leaseValues.delete(key) ? 1 : 0;
        },
        async incr() {
            return 1;
        },
        async pExpire() {
            return 1;
        },
        async pTTL() {
            return 60_000;
        },
        async eval(_script, options) {
            const key = options.keys[0];
            const token = options.arguments[0];
            if (!key || leaseValues.get(key) !== token) return 0;
            return leaseValues.delete(key) ? 1 : 0;
        },
    };
    setRedisTestClient(leaseClient);
    try {
        const firstLease = await acquireJobLease("audit-retention", 60_000);
        assert.ok(firstLease);
        assert.equal(
            await acquireJobLease("audit-retention", 60_000),
            null
        );
        await firstLease.release();
        const nextLease = await acquireJobLease("audit-retention", 60_000);
        assert.ok(nextLease);
        await nextLease.release();
    } finally {
        resetRedisTestClient();
    }

    let findCalls = 0;
    let mutationCalls = 0;
    const dryRunStore: AuditRetentionStore = {
        async findCandidates() {
            findCalls += 1;
            return [{ id: 1, createdAt: new Date("2025-01-01T00:00:00.000Z") }];
        },
        async archiveAndDelete() {
            mutationCalls += 1;
            return { archivedCount: 1, deletedCount: 1 };
        },
    };
    const dryRunResult = await runAuditRetention({
        config,
        dryRun: true,
        now: new Date("2026-07-27T00:00:00.000Z"),
        store: dryRunStore,
    });
    assert.equal(findCalls, 1);
    assert.equal(mutationCalls, 0);
    assert.equal(dryRunResult.candidateCount, 1);
    assert.equal(dryRunResult.deletedCount, 0);

    let batch = 0;
    const executeStore: AuditRetentionStore = {
        async findCandidates() {
            batch += 1;
            if (batch === 1) {
                return Array.from({ length: 10 }, (_, index) => ({
                    id: index + 1,
                    createdAt: new Date("2025-01-01T00:00:00.000Z"),
                }));
            }
            return [];
        },
        async archiveAndDelete(ids) {
            return { archivedCount: ids.length, deletedCount: ids.length };
        },
    };
    const executeResult = await runAuditRetention({
        config,
        dryRun: false,
        now: new Date("2026-07-27T00:00:00.000Z"),
        store: executeStore,
    });
    assert.equal(executeResult.batchesProcessed, 1);
    assert.equal(executeResult.archivedCount, 10);
    assert.equal(executeResult.deletedCount, 10);
    assert.equal(executeResult.hasMore, false);

    await assert.rejects(
        runAuditRetention({
            config,
            dryRun: false,
            store: {
                async findCandidates() {
                    return Array.from({ length: 10 }, (_, index) => ({
                        id: index + 1,
                        createdAt: new Date("2025-01-01T00:00:00.000Z"),
                    }));
                },
                async archiveAndDelete() {
                    return { archivedCount: 0, deletedCount: 0 };
                },
            },
        }),
        /made no progress/
    );

    let retentionDeletes = 0;
    const mobileAuthStore: MobileAuthRetentionStore = {
        async findCandidateIds() {
            return ["session-1"];
        },
        async deleteCandidates(ids) {
            retentionDeletes += ids.length;
            return ids.length;
        },
        async deleteTokenEvidence() {
            return 2;
        },
    };
    const retentionDryRun = await runMobileAuthRetention({
        config: getMobileAuthRetentionConfig(),
        dryRun: true,
        store: mobileAuthStore,
    });
    assert.equal(retentionDryRun.candidateCount, 1);
    assert.equal(retentionDryRun.deletedCount, 0);
    assert.equal(retentionDeletes, 0);
    const retentionExecute = await runMobileAuthRetention({
        config: getMobileAuthRetentionConfig(),
        dryRun: false,
        store: mobileAuthStore,
    });
    assert.equal(retentionExecute.deletedCount, 1);
    assert.equal(retentionExecute.deletedTokenCount, 2);
    assert.equal(retentionDeletes, 1);

    const emailRetentionCalls = {
        outbox: 0,
        deliveryEvents: 0,
        tokens: 0,
        passwordResetTokens: 0,
        emailChangeTokens: 0,
        pendingEmails: 0,
        accounts: 0,
    };
    const emailRetentionStore: EmailRetentionStore = {
        async findOutboxIds() {
            return ["outbox-1"];
        },
        async deleteOutbox(ids) {
            emailRetentionCalls.outbox += ids.length;
            return ids.length;
        },
        async findDeliveryEventIds() {
            return ["delivery-event-1"];
        },
        async deleteDeliveryEvents(ids) {
            emailRetentionCalls.deliveryEvents += ids.length;
            return ids.length;
        },
        async findTokenIds() {
            return ["token-1"];
        },
        async deleteTokens(ids) {
            emailRetentionCalls.tokens += ids.length;
            return ids.length;
        },
        async findPasswordResetTokenIds() {
            return ["password-reset-1"];
        },
        async deletePasswordResetTokens(ids) {
            emailRetentionCalls.passwordResetTokens += ids.length;
            return ids.length;
        },
        async findEmailChangeTokenIds() {
            return ["email-change-1"];
        },
        async deleteEmailChangeTokens(ids) {
            emailRetentionCalls.emailChangeTokens += ids.length;
            return ids.length;
        },
        async findStalePendingEmailUserIds() {
            return [72];
        },
        async clearStalePendingEmails(ids) {
            emailRetentionCalls.pendingEmails += ids.length;
            return ids.length;
        },
        async findPendingAccountIds() {
            return [91];
        },
        async deletePendingAccounts(ids) {
            emailRetentionCalls.accounts += ids.length;
            return ids.length;
        },
    };
    const emailRetentionDryRun = await runEmailRetention({
        config: getEmailRetentionConfig(),
        dryRun: true,
        store: emailRetentionStore,
    });
    assert.equal(emailRetentionDryRun.pendingAccountCandidateCount, 1);
    assert.equal(emailRetentionDryRun.deliveryEventCandidateCount, 1);
    assert.deepEqual(emailRetentionCalls, {
        outbox: 0,
        deliveryEvents: 0,
        tokens: 0,
        passwordResetTokens: 0,
        emailChangeTokens: 0,
        pendingEmails: 0,
        accounts: 0,
    });
    const emailRetentionExecute = await runEmailRetention({
        config: getEmailRetentionConfig(),
        dryRun: false,
        store: emailRetentionStore,
    });
    assert.equal(emailRetentionExecute.deletedOutboxCount, 1);
    assert.equal(emailRetentionExecute.deletedDeliveryEventCount, 1);
    assert.equal(emailRetentionExecute.deletedTokenCount, 1);
    assert.equal(emailRetentionExecute.deletedPasswordResetTokenCount, 1);
    assert.equal(emailRetentionExecute.deletedEmailChangeTokenCount, 1);
    assert.equal(emailRetentionExecute.clearedStalePendingEmailCount, 1);
    assert.equal(emailRetentionExecute.deletedPendingAccountCount, 1);
    assert.deepEqual(emailRetentionCalls, {
        outbox: 1,
        deliveryEvents: 1,
        tokens: 1,
        passwordResetTokens: 1,
        emailChangeTokens: 1,
        pendingEmails: 1,
        accounts: 1,
    });

    console.log("jobs runtime smoke test passed");
}

void main();
