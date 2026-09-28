import { Prisma, prisma } from "@hushle/platform-db";
import { getOrSetJsonCache } from "@hushle/platform-cache";
import { setTimeout as delay } from "node:timers/promises";
import {
    DEFAULT_PAYMENT_CHECKOUT_CONTROL,
    evaluatePaymentCheckoutAccess,
    getPaymentRuntimeReadiness,
    isPaymentRolloutSeedConfigured,
    paymentCheckoutControlSchema,
    type PaymentCheckoutAccess,
    type PaymentCheckoutControl,
} from "@hushle/platform-payments";
import {
    APPLICATION_CACHE_KEYS,
    invalidatePaymentCheckoutControlCache,
} from "@/lib/cache/application-cache";
import { getIyzicoOwnerSurfaceReadiness, getPublicPaymentOrigin } from "@/lib/payments/iyzico-owner-surface";
import { getPaymentLegalReadiness } from "@/lib/payments/legal";

const CONTROL_KEY = "payment_checkout_control";
const CONTROL_CACHE_TTL_MS = 3_000;

export interface PaymentCheckoutControlState {
    control: PaymentCheckoutControl;
    available: boolean;
    source: "default" | "stored" | "invalid";
    updatedAt: string | null;
    updatedBy: { id: number; username: string } | null;
}

export class PaymentCheckoutControlConflictError extends Error {
    constructor() {
        super("Payment checkout control changed. Refresh and review the latest state.");
        this.name = "PaymentCheckoutControlConflictError";
    }
}

function defaultState(source: "default" | "invalid" = "default"): PaymentCheckoutControlState {
    return {
        control: DEFAULT_PAYMENT_CHECKOUT_CONTROL,
        available: source !== "invalid",
        source,
        updatedAt: null,
        updatedBy: null,
    };
}

async function loadControlState(): Promise<PaymentCheckoutControlState> {
    const row = await prisma.systemSetting.findUnique({
        where: { key: CONTROL_KEY },
        select: {
            value: true,
            updatedAt: true,
            updatedBy: { select: { id: true, username: true } },
        },
    });
    if (!row) return defaultState();
    const parsed = paymentCheckoutControlSchema.safeParse(row.value);
    if (!parsed.success) return defaultState("invalid");
    return {
        control: parsed.data,
        available: true,
        source: "stored",
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedBy,
    };
}

export async function getPaymentCheckoutControl(options?: { fresh?: boolean }): Promise<PaymentCheckoutControlState> {
    if (process.env.SKIP_DATABASE_DURING_BUILD === "true") return defaultState();
    if (options?.fresh) return loadControlState();
    const result = await getOrSetJsonCache<PaymentCheckoutControlState>({
        key: APPLICATION_CACHE_KEYS.paymentCheckoutControl,
        ttlMs: CONTROL_CACHE_TTL_MS,
        loader: loadControlState,
    });
    return result.value;
}

function providerSurfaceReady(activeProvider: string | null): boolean {
    if (activeProvider !== "iyzico") return true;
    const surface = getIyzicoOwnerSurfaceReadiness();
    return surface.sessionEnabled && Boolean(getPublicPaymentOrigin());
}

export function getPaymentCheckoutActivationReadiness() {
    const runtime = getPaymentRuntimeReadiness();
    const legal = getPaymentLegalReadiness();
    return {
        activeProvider: runtime.activeProvider,
        runtimeReady: runtime.ready,
        legalReady: legal.ready,
        providerSurfaceReady: providerSurfaceReady(runtime.activeProvider),
        rolloutSeedConfigured: isPaymentRolloutSeedConfigured(process.env.PAYMENT_ROLLOUT_SEED),
    };
}

export async function getPaymentCheckoutAccess(
    userId: number,
    options?: { fresh?: boolean }
): Promise<PaymentCheckoutAccess> {
    const activation = getPaymentCheckoutActivationReadiness();
    try {
        const state = await getPaymentCheckoutControl({ fresh: options?.fresh });
        return evaluatePaymentCheckoutAccess({
            userId,
            control: state.control,
            controlAvailable: state.available,
            runtimeReady: activation.runtimeReady,
            legalReady: activation.legalReady,
            providerSurfaceReady: activation.providerSurfaceReady,
            rolloutSeed: process.env.PAYMENT_ROLLOUT_SEED,
        });
    } catch {
        return {
            available: false,
            reason: "control_unavailable",
            cohortBucket: null,
        };
    }
}

export async function updatePaymentCheckoutControl(input: {
    paused: boolean;
    rolloutPercent: number;
    expectedRevision: number;
    reason: string;
    updatedByUserId: number;
    actorRole: string;
    ipAddress: string | null;
    userAgent: string | null;
}): Promise<PaymentCheckoutControlState> {
    const reason = input.reason.trim();
    const write = () => prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ key: string }>>(Prisma.sql`
            SELECT \`key\` FROM system_settings
            WHERE \`key\` = ${CONTROL_KEY}
            FOR UPDATE
        `);
        if (locked.length === 0) {
            await tx.systemSetting.create({
                data: {
                    key: CONTROL_KEY,
                    value: DEFAULT_PAYMENT_CHECKOUT_CONTROL as Prisma.InputJsonValue,
                },
            });
        }
        const row = await tx.systemSetting.findUniqueOrThrow({ where: { key: CONTROL_KEY } });
        const current = paymentCheckoutControlSchema.safeParse(row.value);
        if (!current.success || current.data.revision !== input.expectedRevision) {
            throw new PaymentCheckoutControlConflictError();
        }
        const next = paymentCheckoutControlSchema.parse({
            schemaVersion: 1,
            paused: input.paused,
            rolloutPercent: input.rolloutPercent,
            revision: current.data.revision + 1,
            lastChangeReason: reason,
        });
        await tx.systemSetting.update({
            where: { key: CONTROL_KEY },
            data: {
                value: next as Prisma.InputJsonValue,
                updatedByUserId: input.updatedByUserId,
            },
        });
        await tx.auditLog.create({
            data: {
                actorUserId: input.updatedByUserId,
                actorRole: input.actorRole.slice(0, 20),
                action: "admin.payment.checkout-control.update",
                resourceType: "payment_checkout_control",
                resourceId: CONTROL_KEY,
                ipAddress: input.ipAddress?.slice(0, 64) ?? null,
                userAgent: input.userAgent?.slice(0, 255) ?? null,
                summary: next.paused
                    ? "Paused new payment checkout sessions"
                    : "Updated payment checkout rollout",
                metadata: {
                    previousPaused: current.data.paused,
                    previousRolloutPercent: current.data.rolloutPercent,
                    nextPaused: next.paused,
                    nextRolloutPercent: next.rolloutPercent,
                    previousRevision: current.data.revision,
                    nextRevision: next.revision,
                    reason,
                },
            },
        });
        return next;
    });
    let updated: PaymentCheckoutControl | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            updated = await write();
            break;
        } catch (error) {
            if (!isRetryablePaymentControlTransactionError(error) || attempt === 2) throw error;
            await delay((attempt + 1) * 15);
        }
    }
    if (!updated) throw new Error("Payment checkout control update did not complete.");
    await invalidatePaymentCheckoutControlCache();
    const state = await getPaymentCheckoutControl({ fresh: true });
    if (state.control.revision !== updated.revision) throw new PaymentCheckoutControlConflictError();
    return state;
}

function isRetryablePaymentControlTransactionError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const candidate = error as { code?: unknown; meta?: { code?: unknown } };
    return candidate.code === "P2034"
        || (candidate.code === "P2010" && String(candidate.meta?.code ?? "") === "1213");
}

export function isPaymentCheckoutExpansion(
    current: PaymentCheckoutControl,
    next: Pick<PaymentCheckoutControl, "paused" | "rolloutPercent">
): boolean {
    return !next.paused && (current.paused || next.rolloutPercent > current.rolloutPercent);
}
