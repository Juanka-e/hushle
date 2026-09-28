import {
    createSmtpEmailProvider,
    getEmailProviderReadiness,
    processEmailOutbox,
} from "@hushle/platform-email";
import { prisma } from "@hushle/platform-db";
import type { EmailDeliveryConfig } from "./config";

export async function runEmailDelivery(input: {
    config: EmailDeliveryConfig;
    dryRun: boolean;
    now?: Date;
}) {
    const now = input.now ?? new Date();
    if (input.dryRun) {
        const candidateCount = await prisma.emailOutboxMessage.count({
            where: {
                OR: [
                    { status: "pending", availableAt: { lte: now } },
                    { status: "processing", claimExpiresAt: { lte: now } },
                ],
            },
        });
        return {
            dryRun: true,
            provider: getEmailProviderReadiness().provider,
            providerReady: getEmailProviderReadiness().configured,
            candidateCount: Math.min(
                candidateCount,
                input.config.batchSize
            ),
        };
    }

    const readiness = getEmailProviderReadiness();
    if (!readiness.configured) {
        throw new Error(
            `Email delivery is not configured: ${readiness.issues.join(", ")}`
        );
    }
    const provider = createSmtpEmailProvider();
    try {
        return {
            dryRun: false,
            provider: readiness.provider,
            ...(await processEmailOutbox({
                provider,
                batchSize: input.config.batchSize,
                now,
            })),
        };
    } finally {
        await provider.close?.();
    }
}
