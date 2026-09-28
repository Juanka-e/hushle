import { createHash, randomUUID } from "node:crypto";
import {
    Prisma,
    prisma,
    type PaymentWebhookEvent,
} from "@hushle/platform-db";
import { z } from "zod";
import type { PaymentProviderId } from "./contracts";

export const PAYMENT_WEBHOOK_OUTCOMES = [
    "payment_succeeded",
    "payment_failed",
    "refund",
    "chargeback",
    "ignored",
] as const;
export type PaymentWebhookOutcome = (typeof PAYMENT_WEBHOOK_OUTCOMES)[number];

const metadataValueSchema = z.union([
    z.string().trim().max(256),
    z.number().finite(),
    z.boolean(),
    z.null(),
]);

export const verifiedPaymentWebhookSchema = z.object({
    providerEventId: z.string().trim().min(1).max(191),
    eventType: z.string().trim().min(1).max(120),
    outcome: z.enum(PAYMENT_WEBHOOK_OUTCOMES),
    signatureVersion: z.string().trim().min(1).max(32).optional(),
    providerOrderReference: z.string().trim().min(1).max(191).optional(),
    providerPaymentReference: z.string().trim().min(1).max(191).optional(),
    amountMinor: z.number().int().min(0).max(2_147_483_647).optional(),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/).optional(),
    metadata: z.record(z.string().trim().min(1).max(80), metadataValueSchema)
        .refine((value) => Object.keys(value).length <= 32)
        .optional(),
    occurredAt: z.date().optional(),
});

export type VerifiedPaymentWebhook = z.infer<typeof verifiedPaymentWebhookSchema>;

export interface PaymentWebhookVerifier {
    provider: PaymentProviderId;
    acknowledgement: {
        status: number;
        contentType: string;
        body: string;
    };
    verify(input: {
        rawBody: Uint8Array;
        headers: Readonly<Record<string, string>>;
    }): Promise<VerifiedPaymentWebhook>;
}

export class PaymentWebhookError extends Error {
    constructor(
        public readonly code:
            | "invalid_signature"
            | "invalid_event"
            | "event_identity_conflict"
            | "metadata_too_large"
    ) {
        super(code);
        this.name = "PaymentWebhookError";
    }
}

export class PaymentWebhookProcessingError extends Error {
    constructor(
        public readonly code: string,
        public readonly retryable = true
    ) {
        super(code);
        this.name = "PaymentWebhookProcessingError";
    }
}

export async function ingestVerifiedPaymentWebhook(input: {
    provider: PaymentProviderId;
    rawBody: Uint8Array;
    headers: Readonly<Record<string, string>>;
    verifier: PaymentWebhookVerifier;
    receivedAt?: Date;
}): Promise<{ event: PaymentWebhookEvent; duplicate: boolean }> {
    if (input.verifier.provider !== input.provider) {
        throw new PaymentWebhookError("invalid_signature");
    }

    let unparsed: VerifiedPaymentWebhook;
    try {
        unparsed = await input.verifier.verify({
            rawBody: input.rawBody,
            headers: input.headers,
        });
    } catch (error) {
        if (error instanceof PaymentWebhookError) throw error;
        throw new PaymentWebhookError("invalid_signature");
    }
    const parsed = verifiedPaymentWebhookSchema.safeParse(unparsed);
    if (!parsed.success) throw new PaymentWebhookError("invalid_event");
    const verified = parsed.data;

    const metadataJson = verified.metadata
        ? JSON.stringify(verified.metadata)
        : null;
    if (metadataJson && Buffer.byteLength(metadataJson, "utf8") > 4_096) {
        throw new PaymentWebhookError("metadata_too_large");
    }

    const receivedAt = input.receivedAt ?? new Date();
    const bodySha256 = createHash("sha256").update(input.rawBody).digest("hex");
    const candidateId = randomUUID();
    const inserted = await prisma.paymentWebhookEvent.createMany({
        data: [{
            id: candidateId,
            provider: input.provider,
            providerEventId: verified.providerEventId,
            eventType: verified.eventType,
            outcome: verified.outcome,
            bodySha256,
            signatureVersion: verified.signatureVersion,
            providerOrderReference: verified.providerOrderReference,
            providerPaymentReference: verified.providerPaymentReference,
            amountMinor: verified.amountMinor,
            currency: verified.currency?.toUpperCase(),
            metadata: verified.metadata as Prisma.InputJsonValue | undefined,
            occurredAt: verified.occurredAt,
            availableAt: receivedAt,
            lastReceivedAt: receivedAt,
            createdAt: receivedAt,
        }],
        skipDuplicates: true,
    });

    const event = await prisma.paymentWebhookEvent.findUniqueOrThrow({
        where: {
            provider_providerEventId: {
                provider: input.provider,
                providerEventId: verified.providerEventId,
            },
        },
    });
    if (event.bodySha256 !== bodySha256 || event.eventType !== verified.eventType) {
        throw new PaymentWebhookError("event_identity_conflict");
    }
    if (inserted.count === 0) {
        await prisma.paymentWebhookEvent.update({
            where: { id: event.id },
            data: {
                deliveryCount: { increment: 1 },
                lastReceivedAt: receivedAt,
            },
        });
    }

    return { event, duplicate: inserted.count === 0 };
}

export type PaymentWebhookProcessor = (
    event: PaymentWebhookEvent
) => Promise<"processed" | "ignored">;

function boundedErrorCode(error: unknown): { code: string; retryable: boolean } {
    if (error instanceof PaymentWebhookProcessingError) {
        return {
            code: /^[a-z0-9_.-]{1,80}$/i.test(error.code)
                ? error.code
                : "processor_error",
            retryable: error.retryable,
        };
    }
    return { code: "processor_error", retryable: true };
}

export async function processPaymentWebhookInbox(input: {
    processor: PaymentWebhookProcessor;
    batchSize: number;
    maxAttempts: number;
    claimTtlMs: number;
    now?: Date;
}): Promise<{ claimed: number; processed: number; retried: number; deadLettered: number }> {
    const now = input.now ?? new Date();
    const candidates = await prisma.paymentWebhookEvent.findMany({
        where: {
            OR: [
                { status: { in: ["pending", "retry"] }, availableAt: { lte: now } },
                { status: "processing", claimExpiresAt: { lte: now } },
            ],
        },
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
        take: Math.max(1, Math.min(input.batchSize, 100)),
    });
    const result = { claimed: 0, processed: 0, retried: 0, deadLettered: 0 };

    for (const candidate of candidates) {
        const claimToken = randomUUID();
        const claimed = await prisma.paymentWebhookEvent.updateMany({
            where: {
                id: candidate.id,
                OR: [
                    { status: { in: ["pending", "retry"] }, availableAt: { lte: now } },
                    { status: "processing", claimExpiresAt: { lte: now } },
                ],
            },
            data: {
                status: "processing",
                claimToken,
                claimedAt: now,
                claimExpiresAt: new Date(now.getTime() + input.claimTtlMs),
                lastAttemptAt: now,
                attemptCount: { increment: 1 },
            },
        });
        if (claimed.count === 0) continue;
        result.claimed += 1;
        const event = await prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: { id: candidate.id },
        });

        try {
            await input.processor(event);
            const completed = await prisma.paymentWebhookEvent.updateMany({
                where: { id: event.id, claimToken },
                data: {
                    status: "processed",
                    processedAt: now,
                    claimToken: null,
                    claimedAt: null,
                    claimExpiresAt: null,
                    lastErrorCode: null,
                },
            });
            if (completed.count === 1) result.processed += 1;
        } catch (error) {
            const failure = boundedErrorCode(error);
            const deadLetter = !failure.retryable || event.attemptCount >= input.maxAttempts;
            const released = await prisma.paymentWebhookEvent.updateMany({
                where: { id: event.id, claimToken },
                data: {
                    status: deadLetter ? "dead_letter" : "retry",
                    availableAt: deadLetter
                        ? now
                        : new Date(now.getTime() + Math.min(60, 2 ** event.attemptCount) * 60_000),
                    claimToken: null,
                    claimedAt: null,
                    claimExpiresAt: null,
                    lastErrorCode: failure.code,
                },
            });
            if (released.count === 1) {
                if (deadLetter) result.deadLettered += 1;
                else result.retried += 1;
            }
        }
    }

    return result;
}
