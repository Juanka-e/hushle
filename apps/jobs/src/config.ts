export interface AuditRetentionConfig {
    hotDays: number;
    batchSize: number;
    maxBatches: number;
    leaseTtlMs: number;
}

export interface MobileAuthRetentionConfig {
    retentionDays: number;
    reuseEvidenceDays: number;
    batchSize: number;
    leaseTtlMs: number;
}

export interface EmailDeliveryConfig {
    batchSize: number;
    leaseTtlMs: number;
}

export interface EmailRetentionConfig {
    sentRetentionDays: number;
    deadLetterRetentionDays: number;
    tokenRetentionDays: number;
    pendingAccountRetentionDays: number;
    batchSize: number;
    leaseTtlMs: number;
}

export interface PaymentWebhookConfig {
    batchSize: number;
    maxAttempts: number;
    claimTtlMs: number;
    leaseTtlMs: number;
}

export interface PaymentReconciliationConfig {
    batchSize: number;
    minAgeMinutes: number;
    retryDelayMinutes: number;
    maxAttempts: number;
    leaseTtlMs: number;
}

interface JobsEnvironment {
    [key: string]: string | undefined;
    AUDIT_HOT_RETENTION_DAYS?: string;
    AUDIT_ARCHIVE_BATCH_SIZE?: string;
    AUDIT_ARCHIVE_MAX_BATCHES?: string;
    AUDIT_ARCHIVE_LEASE_TTL_MS?: string;
    MOBILE_AUTH_RETENTION_DAYS?: string;
    MOBILE_AUTH_REUSE_EVIDENCE_DAYS?: string;
    MOBILE_AUTH_RETENTION_BATCH_SIZE?: string;
    MOBILE_AUTH_RETENTION_LEASE_TTL_MS?: string;
    EMAIL_DELIVERY_BATCH_SIZE?: string;
    EMAIL_DELIVERY_LEASE_TTL_MS?: string;
    EMAIL_SENT_RETENTION_DAYS?: string;
    EMAIL_DEAD_LETTER_RETENTION_DAYS?: string;
    EMAIL_TOKEN_RETENTION_DAYS?: string;
    EMAIL_PENDING_ACCOUNT_RETENTION_DAYS?: string;
    EMAIL_RETENTION_BATCH_SIZE?: string;
    EMAIL_RETENTION_LEASE_TTL_MS?: string;
    PAYMENT_WEBHOOK_BATCH_SIZE?: string;
    PAYMENT_WEBHOOK_MAX_ATTEMPTS?: string;
    PAYMENT_WEBHOOK_CLAIM_TTL_MS?: string;
    PAYMENT_WEBHOOK_JOB_LEASE_TTL_MS?: string;
    PAYMENT_RECONCILIATION_BATCH_SIZE?: string;
    PAYMENT_RECONCILIATION_MIN_AGE_MINUTES?: string;
    PAYMENT_RECONCILIATION_RETRY_DELAY_MINUTES?: string;
    PAYMENT_RECONCILIATION_MAX_ATTEMPTS?: string;
    PAYMENT_RECONCILIATION_JOB_LEASE_TTL_MS?: string;
}

export function getPaymentReconciliationConfig(
    env: JobsEnvironment = process.env
): PaymentReconciliationConfig {
    return {
        batchSize: parseBoundedInteger({
            name: "PAYMENT_RECONCILIATION_BATCH_SIZE",
            value: env.PAYMENT_RECONCILIATION_BATCH_SIZE,
            fallback: 25,
            min: 1,
            max: 100,
        }),
        minAgeMinutes: parseBoundedInteger({
            name: "PAYMENT_RECONCILIATION_MIN_AGE_MINUTES",
            value: env.PAYMENT_RECONCILIATION_MIN_AGE_MINUTES,
            fallback: 30,
            min: 5,
            max: 1_440,
        }),
        retryDelayMinutes: parseBoundedInteger({
            name: "PAYMENT_RECONCILIATION_RETRY_DELAY_MINUTES",
            value: env.PAYMENT_RECONCILIATION_RETRY_DELAY_MINUTES,
            fallback: 15,
            min: 5,
            max: 1_440,
        }),
        maxAttempts: parseBoundedInteger({
            name: "PAYMENT_RECONCILIATION_MAX_ATTEMPTS",
            value: env.PAYMENT_RECONCILIATION_MAX_ATTEMPTS,
            fallback: 12,
            min: 1,
            max: 100,
        }),
        leaseTtlMs: parseBoundedInteger({
            name: "PAYMENT_RECONCILIATION_JOB_LEASE_TTL_MS",
            value: env.PAYMENT_RECONCILIATION_JOB_LEASE_TTL_MS,
            fallback: 5 * 60_000,
            min: 60_000,
            max: 30 * 60_000,
        }),
    };
}

export function getPaymentWebhookConfig(
    env: JobsEnvironment = process.env
): PaymentWebhookConfig {
    return {
        batchSize: parseBoundedInteger({
            name: "PAYMENT_WEBHOOK_BATCH_SIZE",
            value: env.PAYMENT_WEBHOOK_BATCH_SIZE,
            fallback: 25,
            min: 1,
            max: 100,
        }),
        maxAttempts: parseBoundedInteger({
            name: "PAYMENT_WEBHOOK_MAX_ATTEMPTS",
            value: env.PAYMENT_WEBHOOK_MAX_ATTEMPTS,
            fallback: 8,
            min: 1,
            max: 25,
        }),
        claimTtlMs: parseBoundedInteger({
            name: "PAYMENT_WEBHOOK_CLAIM_TTL_MS",
            value: env.PAYMENT_WEBHOOK_CLAIM_TTL_MS,
            fallback: 5 * 60_000,
            min: 30_000,
            max: 30 * 60_000,
        }),
        leaseTtlMs: parseBoundedInteger({
            name: "PAYMENT_WEBHOOK_JOB_LEASE_TTL_MS",
            value: env.PAYMENT_WEBHOOK_JOB_LEASE_TTL_MS,
            fallback: 5 * 60_000,
            min: 60_000,
            max: 30 * 60_000,
        }),
    };
}

export function getEmailDeliveryConfig(
    env: JobsEnvironment = process.env
): EmailDeliveryConfig {
    return {
        batchSize: parseBoundedInteger({
            name: "EMAIL_DELIVERY_BATCH_SIZE",
            value: env.EMAIL_DELIVERY_BATCH_SIZE,
            fallback: 25,
            min: 1,
            max: 100,
        }),
        leaseTtlMs: parseBoundedInteger({
            name: "EMAIL_DELIVERY_LEASE_TTL_MS",
            value: env.EMAIL_DELIVERY_LEASE_TTL_MS,
            fallback: 15 * 60_000,
            min: 60_000,
            max: 60 * 60_000,
        }),
    };
}

export function getEmailRetentionConfig(
    env: JobsEnvironment = process.env
): EmailRetentionConfig {
    return {
        sentRetentionDays: parseBoundedInteger({
            name: "EMAIL_SENT_RETENTION_DAYS",
            value: env.EMAIL_SENT_RETENTION_DAYS,
            fallback: 30,
            min: 7,
            max: 365,
        }),
        deadLetterRetentionDays: parseBoundedInteger({
            name: "EMAIL_DEAD_LETTER_RETENTION_DAYS",
            value: env.EMAIL_DEAD_LETTER_RETENTION_DAYS,
            fallback: 90,
            min: 30,
            max: 730,
        }),
        tokenRetentionDays: parseBoundedInteger({
            name: "EMAIL_TOKEN_RETENTION_DAYS",
            value: env.EMAIL_TOKEN_RETENTION_DAYS,
            fallback: 7,
            min: 1,
            max: 90,
        }),
        pendingAccountRetentionDays: parseBoundedInteger({
            name: "EMAIL_PENDING_ACCOUNT_RETENTION_DAYS",
            value: env.EMAIL_PENDING_ACCOUNT_RETENTION_DAYS,
            fallback: 7,
            min: 1,
            max: 90,
        }),
        batchSize: parseBoundedInteger({
            name: "EMAIL_RETENTION_BATCH_SIZE",
            value: env.EMAIL_RETENTION_BATCH_SIZE,
            fallback: 500,
            min: 10,
            max: 5_000,
        }),
        leaseTtlMs: parseBoundedInteger({
            name: "EMAIL_RETENTION_LEASE_TTL_MS",
            value: env.EMAIL_RETENTION_LEASE_TTL_MS,
            fallback: 5 * 60_000,
            min: 60_000,
            max: 60 * 60_000,
        }),
    };
}

export function getMobileAuthRetentionConfig(
    env: JobsEnvironment = process.env
): MobileAuthRetentionConfig {
    return {
        retentionDays: parseBoundedInteger({
            name: "MOBILE_AUTH_RETENTION_DAYS",
            value: env.MOBILE_AUTH_RETENTION_DAYS,
            fallback: 30,
            min: 7,
            max: 365,
        }),
        reuseEvidenceDays: parseBoundedInteger({
            name: "MOBILE_AUTH_REUSE_EVIDENCE_DAYS",
            value: env.MOBILE_AUTH_REUSE_EVIDENCE_DAYS,
            fallback: 7,
            min: 1,
            max: 30,
        }),
        batchSize: parseBoundedInteger({
            name: "MOBILE_AUTH_RETENTION_BATCH_SIZE",
            value: env.MOBILE_AUTH_RETENTION_BATCH_SIZE,
            fallback: 500,
            min: 10,
            max: 5_000,
        }),
        leaseTtlMs: parseBoundedInteger({
            name: "MOBILE_AUTH_RETENTION_LEASE_TTL_MS",
            value: env.MOBILE_AUTH_RETENTION_LEASE_TTL_MS,
            fallback: 5 * 60_000,
            min: 60_000,
            max: 60 * 60_000,
        }),
    };
}

function parseBoundedInteger(input: {
    name: string;
    value: string | undefined;
    fallback: number;
    min: number;
    max: number;
}): number {
    if (!input.value?.trim()) return input.fallback;

    const parsed = Number.parseInt(input.value, 10);
    if (!Number.isInteger(parsed) || parsed < input.min || parsed > input.max) {
        throw new Error(
            `${input.name} must be an integer between ${input.min} and ${input.max}`
        );
    }
    return parsed;
}

export function getAuditRetentionConfig(
    env: JobsEnvironment = process.env
): AuditRetentionConfig {
    return {
        hotDays: parseBoundedInteger({
            name: "AUDIT_HOT_RETENTION_DAYS",
            value: env.AUDIT_HOT_RETENTION_DAYS,
            fallback: 90,
            min: 30,
            max: 3_650,
        }),
        batchSize: parseBoundedInteger({
            name: "AUDIT_ARCHIVE_BATCH_SIZE",
            value: env.AUDIT_ARCHIVE_BATCH_SIZE,
            fallback: 500,
            min: 10,
            max: 5_000,
        }),
        maxBatches: parseBoundedInteger({
            name: "AUDIT_ARCHIVE_MAX_BATCHES",
            value: env.AUDIT_ARCHIVE_MAX_BATCHES,
            fallback: 10,
            min: 1,
            max: 100,
        }),
        leaseTtlMs: parseBoundedInteger({
            name: "AUDIT_ARCHIVE_LEASE_TTL_MS",
            value: env.AUDIT_ARCHIVE_LEASE_TTL_MS,
            fallback: 15 * 60_000,
            min: 60_000,
            max: 60 * 60_000,
        }),
    };
}

export function areJobsEnabled(
    value = process.env.JOBS_ENABLED
): boolean {
    if (value === undefined || value.trim() === "") return false;
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    throw new Error("JOBS_ENABLED must be true or false");
}
