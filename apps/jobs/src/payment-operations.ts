import { getRedisClient, getRedisKey } from "@hushle/platform-cache";
import { prisma } from "@hushle/platform-db";
import { reportWarning } from "@hushle/platform-observability";

const ALERT_COOLDOWN_MS = 15 * 60_000;

function threshold(name: string, fallback: number): number {
    const raw = process.env[name]?.trim() ?? "";
    if (!/^[1-9]\d*$/.test(raw)) return fallback;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value <= 10_000 ? value : fallback;
}

async function acquireAlertCooldown(name: string): Promise<boolean> {
    const client = await getRedisClient();
    if (!client) return false;
    return (await client.set(getRedisKey("operational-alert-cooldown", name), "1", {
        PX: ALERT_COOLDOWN_MS,
        NX: true,
    })) === "OK";
}

interface PaymentOperationalDependencies {
    countDeadLetters(): Promise<number>;
    countOpenCases(): Promise<number>;
    acquireCooldown(name: string): Promise<boolean>;
    warn(input: Parameters<typeof reportWarning>[0]): Promise<void>;
}

const defaultDependencies: PaymentOperationalDependencies = {
    countDeadLetters: () => prisma.paymentWebhookEvent.count({ where: { status: "dead_letter" } }),
    countOpenCases: () => prisma.paymentReconciliationCase.count({ where: { status: "open" } }),
    acquireCooldown: acquireAlertCooldown,
    warn: reportWarning,
};

export async function reportPaymentOperationalThresholds(
    job: string,
    dependencies: PaymentOperationalDependencies = defaultDependencies
): Promise<void> {
    if (job === "payment-webhook") {
        const count = await dependencies.countDeadLetters();
        const limit = threshold("PAYMENT_DEAD_LETTER_ALERT_THRESHOLD", 10);
        if (count >= limit && await dependencies.acquireCooldown("payment-webhook-dead-letter")) {
            await dependencies.warn({
                service: "hushle-jobs",
                event: "payment.webhook.dead_letter_threshold_exceeded",
                message: "Payment webhook dead-letter threshold exceeded",
                context: { count, threshold: limit },
            });
        }
    }
    if (job === "payment-reconciliation") {
        const count = await dependencies.countOpenCases();
        const limit = threshold("PAYMENT_OPEN_CASE_ALERT_THRESHOLD", 25);
        if (count >= limit && await dependencies.acquireCooldown("payment-reconciliation-open-case")) {
            await dependencies.warn({
                service: "hushle-jobs",
                event: "payment.reconciliation.open_case_threshold_exceeded",
                message: "Payment reconciliation open-case threshold exceeded",
                context: { count, threshold: limit },
            });
        }
    }
}
