import { runAuditRetention } from "./audit-retention";
import { getAuditRetentionConfig } from "./config";
import { getMobileAuthRetentionConfig } from "./config";
import { runMobileAuthRetention } from "./mobile-auth-retention";
import {
    getEmailDeliveryConfig,
    getEmailRetentionConfig,
} from "./config";
import { runEmailDelivery } from "./email-delivery";
import { runEmailRetention } from "./email-retention";
import { getPaymentWebhookConfig } from "./config";
import { runPaymentWebhook } from "./payment-webhook";
import { getPaymentReconciliationConfig } from "./config";
import { runPaymentReconciliationJob } from "./payment-reconciliation";

export const JOB_NAMES = [
    "audit-retention",
    "mobile-auth-retention",
    "email-delivery",
    "email-retention",
    "payment-webhook",
    "payment-reconciliation",
] as const;
export type JobName = (typeof JOB_NAMES)[number];

export interface JobDefinition {
    leaseTtlMs: number;
    run(options: { dryRun: boolean }): Promise<object>;
}

export function isJobName(value: string): value is JobName {
    return JOB_NAMES.includes(value as JobName);
}

export function getJobDefinition(job: JobName): JobDefinition {
    switch (job) {
        case "audit-retention": {
            const config = getAuditRetentionConfig();
            return {
                leaseTtlMs: config.leaseTtlMs,
                run: ({ dryRun }) => runAuditRetention({ config, dryRun }),
            };
        }
        case "mobile-auth-retention": {
            const config = getMobileAuthRetentionConfig();
            return {
                leaseTtlMs: config.leaseTtlMs,
                run: ({ dryRun }) =>
                    runMobileAuthRetention({ config, dryRun }),
            };
        }
        case "email-delivery": {
            const config = getEmailDeliveryConfig();
            return {
                leaseTtlMs: config.leaseTtlMs,
                run: ({ dryRun }) =>
                    runEmailDelivery({ config, dryRun }),
            };
        }
        case "email-retention": {
            const config = getEmailRetentionConfig();
            return {
                leaseTtlMs: config.leaseTtlMs,
                run: ({ dryRun }) =>
                    runEmailRetention({ config, dryRun }),
            };
        }
        case "payment-webhook": {
            const config = getPaymentWebhookConfig();
            return {
                leaseTtlMs: config.leaseTtlMs,
                run: ({ dryRun }) => runPaymentWebhook({ config, dryRun }),
            };
        }
        case "payment-reconciliation": {
            const config = getPaymentReconciliationConfig();
            return {
                leaseTtlMs: config.leaseTtlMs,
                run: ({ dryRun }) => runPaymentReconciliationJob({ config, dryRun }),
            };
        }
    }
}
