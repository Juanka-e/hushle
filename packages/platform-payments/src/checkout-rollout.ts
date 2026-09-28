import { createHash } from "node:crypto";
import { z } from "zod";

export const PAYMENT_CHECKOUT_CONTROL_SCHEMA_VERSION = 1;

export const paymentCheckoutControlSchema = z.object({
    schemaVersion: z.literal(PAYMENT_CHECKOUT_CONTROL_SCHEMA_VERSION),
    paused: z.boolean(),
    rolloutPercent: z.number().int().min(0).max(100),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    lastChangeReason: z.string().trim().min(3).max(300),
}).strict();

export type PaymentCheckoutControl = z.infer<typeof paymentCheckoutControlSchema>;

export const DEFAULT_PAYMENT_CHECKOUT_CONTROL: PaymentCheckoutControl = {
    schemaVersion: PAYMENT_CHECKOUT_CONTROL_SCHEMA_VERSION,
    paused: true,
    rolloutPercent: 0,
    revision: 0,
    lastChangeReason: "Checkout has not been activated by an operator.",
};

export type PaymentCheckoutAccessReason =
    | "available"
    | "runtime_not_ready"
    | "legal_not_ready"
    | "provider_surface_not_ready"
    | "control_unavailable"
    | "checkout_paused"
    | "rollout_closed"
    | "rollout_seed_missing"
    | "outside_rollout";

export interface PaymentCheckoutAccess {
    available: boolean;
    reason: PaymentCheckoutAccessReason;
    cohortBucket: number | null;
}

export function isPaymentRolloutSeedConfigured(value: string | undefined): boolean {
    const seed = value?.trim() ?? "";
    return seed.length >= 16
        && seed.length <= 128
        && /^[A-Za-z0-9._:-]+$/.test(seed)
        && !/replace|change.?me|example|placeholder|your[_-]/i.test(seed);
}

export function getPaymentRolloutBucket(userId: number, seed: string): number {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new Error("Payment rollout requires a positive user id.");
    }
    if (!isPaymentRolloutSeedConfigured(seed)) {
        throw new Error("Payment rollout seed is not configured.");
    }
    const digest = createHash("sha256").update(`${seed.trim()}:user:${userId}`).digest();
    return digest.readUInt32BE(0) % 100;
}

export function evaluatePaymentCheckoutAccess(input: {
    userId: number;
    control: PaymentCheckoutControl;
    controlAvailable?: boolean;
    runtimeReady: boolean;
    legalReady: boolean;
    providerSurfaceReady: boolean;
    rolloutSeed?: string;
}): PaymentCheckoutAccess {
    if (!input.runtimeReady) return { available: false, reason: "runtime_not_ready", cohortBucket: null };
    if (!input.legalReady) return { available: false, reason: "legal_not_ready", cohortBucket: null };
    if (!input.providerSurfaceReady) {
        return { available: false, reason: "provider_surface_not_ready", cohortBucket: null };
    }
    if (input.controlAvailable === false) {
        return { available: false, reason: "control_unavailable", cohortBucket: null };
    }
    if (input.control.paused) return { available: false, reason: "checkout_paused", cohortBucket: null };
    if (input.control.rolloutPercent === 0) {
        return { available: false, reason: "rollout_closed", cohortBucket: null };
    }
    if (!isPaymentRolloutSeedConfigured(input.rolloutSeed)) {
        return { available: false, reason: "rollout_seed_missing", cohortBucket: null };
    }
    const cohortBucket = getPaymentRolloutBucket(input.userId, input.rolloutSeed!);
    if (cohortBucket >= input.control.rolloutPercent) {
        return { available: false, reason: "outside_rollout", cohortBucket };
    }
    return { available: true, reason: "available", cohortBucket };
}
