import {
    readOperationalHeartbeat,
    type OperationalHeartbeatReadResult,
} from "@hushle/platform-cache";

type Environment = Readonly<Record<string, string | undefined>>;
export type PaymentSchedulerStatus = "healthy" | "stale" | "missing" | "not_configured" | "unavailable";

export interface PaymentSchedulerHealth {
    job: "payment-webhook" | "payment-reconciliation";
    status: PaymentSchedulerStatus;
    lastCompletedAt: string | null;
    durationMs: number | null;
    maxAgeSeconds: number;
}

function boundedSeconds(value: string | undefined, fallback: number, min: number, max: number): number {
    const raw = value?.trim() ?? "";
    if (!/^[1-9]\d*$/.test(raw)) return fallback;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function evaluatePaymentSchedulerHealth(input: {
    job: PaymentSchedulerHealth["job"];
    configured: boolean;
    maxAgeSeconds: number;
    read: OperationalHeartbeatReadResult;
    now?: Date;
}): PaymentSchedulerHealth {
    const base = {
        job: input.job,
        maxAgeSeconds: input.maxAgeSeconds,
        lastCompletedAt: input.read.heartbeat?.completedAt ?? null,
        durationMs: input.read.heartbeat?.durationMs ?? null,
    };
    if (!input.configured) return { ...base, status: "not_configured" };
    if (!input.read.available) return { ...base, status: "unavailable" };
    if (!input.read.heartbeat) return { ...base, status: "missing" };
    const ageMs = (input.now ?? new Date()).getTime() - Date.parse(input.read.heartbeat.completedAt);
    return {
        ...base,
        status: ageMs >= 0 && ageMs <= input.maxAgeSeconds * 1_000 ? "healthy" : "stale",
    };
}

export async function getPaymentSchedulerHealth(
    environment: Environment = process.env,
    now = new Date(),
    reader: typeof readOperationalHeartbeat = readOperationalHeartbeat
): Promise<PaymentSchedulerHealth[]> {
    const webhookMaxAge = boundedSeconds(
        environment.PAYMENT_WEBHOOK_SCHEDULE_MAX_AGE_SECONDS,
        180,
        60,
        3_600
    );
    const reconciliationMaxAge = boundedSeconds(
        environment.PAYMENT_RECONCILIATION_SCHEDULE_MAX_AGE_SECONDS,
        1_800,
        300,
        86_400
    );
    const [webhook, reconciliation] = await Promise.all([
        reader("payment-webhook"),
        reader("payment-reconciliation"),
    ]);
    return [
        evaluatePaymentSchedulerHealth({
            job: "payment-webhook",
            configured: environment.PAYMENT_WEBHOOK_SCHEDULE_CONFIGURED?.trim().toLowerCase() === "true",
            maxAgeSeconds: webhookMaxAge,
            read: webhook,
            now,
        }),
        evaluatePaymentSchedulerHealth({
            job: "payment-reconciliation",
            configured: environment.PAYMENT_RECONCILIATION_SCHEDULE_CONFIGURED?.trim().toLowerCase() === "true",
            maxAgeSeconds: reconciliationMaxAge,
            read: reconciliation,
            now,
        }),
    ];
}
