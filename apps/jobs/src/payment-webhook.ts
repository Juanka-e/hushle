import { prisma } from "@hushle/platform-db";
import {
    getPaymentWebhookProcessor,
    processPaymentWebhookInbox,
} from "@hushle/platform-payments";
import type { PaymentWebhookConfig } from "./config";

export async function runPaymentWebhook(input: {
    config: PaymentWebhookConfig;
    dryRun: boolean;
    now?: Date;
}) {
    const now = input.now ?? new Date();
    if (input.dryRun) {
        const candidateCount = await prisma.paymentWebhookEvent.count({
            where: {
                OR: [
                    { status: { in: ["pending", "retry"] }, availableAt: { lte: now } },
                    { status: "processing", claimExpiresAt: { lte: now } },
                ],
            },
        });
        return {
            dryRun: true,
            processorReady: true,
            candidateCount: Math.min(candidateCount, input.config.batchSize),
        };
    }

    const processor = getPaymentWebhookProcessor();
    return {
        dryRun: false,
        ...(await processPaymentWebhookInbox({
            processor,
            batchSize: input.config.batchSize,
            maxAttempts: input.config.maxAttempts,
            claimTtlMs: input.config.claimTtlMs,
            now,
        })),
    };
}
