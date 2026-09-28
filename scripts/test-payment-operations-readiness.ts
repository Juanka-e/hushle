import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    getRedisKey,
    readOperationalHeartbeat,
    resetRedisTestClient,
    setRedisTestClient,
    writeOperationalHeartbeat,
    type RedisLikeClient,
} from "@hushle/platform-cache";
import {
    evaluatePaymentSchedulerHealth,
    getPaymentSchedulerHealth,
} from "../apps/web/src/lib/payments/scheduler-health";
import { reportPaymentOperationalThresholds } from "../apps/jobs/src/payment-operations";

async function run(): Promise<void> {
    const values = new Map<string, string>();
    const client: RedisLikeClient = {
        async ping() { return "PONG"; },
        async get(key) { return values.get(key) ?? null; },
        async set(key, value, options) {
            if (options?.NX && values.has(key)) return null;
            values.set(key, value);
            return "OK";
        },
        async del(key) { return values.delete(key) ? 1 : 0; },
        async incr() { return 1; },
        async pExpire() { return 1; },
        async pTTL() { return 60_000; },
        async eval() { return 0; },
    };
    setRedisTestClient(client);
    try {
        const completedAt = new Date("2026-08-10T08:00:00.000Z");
        await writeOperationalHeartbeat({ name: "payment-webhook", completedAt, durationMs: 41.6 });
        assert.deepEqual(await readOperationalHeartbeat("payment-webhook"), {
            available: true,
            heartbeat: {
                schemaVersion: 1,
                name: "payment-webhook",
                completedAt: completedAt.toISOString(),
                durationMs: 42,
            },
        });
        assert.deepEqual(await readOperationalHeartbeat("payment-reconciliation"), {
            available: true,
            heartbeat: null,
        });
        values.set(getRedisKey("operational-heartbeat", "payment-reconciliation"), "{broken");
        assert.deepEqual(await readOperationalHeartbeat("payment-reconciliation"), {
            available: true,
            heartbeat: null,
        });
        await assert.rejects(
            writeOperationalHeartbeat({ name: "INVALID NAME", completedAt, durationMs: 1 }),
            /Invalid operational heartbeat name/
        );

        const healthyRead = await readOperationalHeartbeat("payment-webhook");
        assert.equal(evaluatePaymentSchedulerHealth({
            job: "payment-webhook", configured: true, maxAgeSeconds: 180,
            read: healthyRead, now: new Date("2026-08-10T08:02:00.000Z"),
        }).status, "healthy");
        assert.equal(evaluatePaymentSchedulerHealth({
            job: "payment-webhook", configured: true, maxAgeSeconds: 60,
            read: healthyRead, now: new Date("2026-08-10T08:02:00.000Z"),
        }).status, "stale");
        assert.equal(evaluatePaymentSchedulerHealth({
            job: "payment-webhook", configured: false, maxAgeSeconds: 180, read: healthyRead,
        }).status, "not_configured");
        assert.equal(evaluatePaymentSchedulerHealth({
            job: "payment-webhook", configured: true, maxAgeSeconds: 180,
            read: { available: true, heartbeat: null },
        }).status, "missing");
        assert.equal(evaluatePaymentSchedulerHealth({
            job: "payment-webhook", configured: true, maxAgeSeconds: 180,
            read: { available: false, heartbeat: null },
        }).status, "unavailable");

        const health = await getPaymentSchedulerHealth({
            PAYMENT_WEBHOOK_SCHEDULE_CONFIGURED: "true",
            PAYMENT_RECONCILIATION_SCHEDULE_CONFIGURED: "false",
            PAYMENT_WEBHOOK_SCHEDULE_MAX_AGE_SECONDS: "180",
        }, new Date("2026-08-10T08:02:00.000Z"));
        assert.equal(health[0]?.status, "healthy");
        assert.equal(health[1]?.status, "not_configured");
    } finally {
        resetRedisTestClient();
    }

    const previousDeadLetterThreshold = process.env.PAYMENT_DEAD_LETTER_ALERT_THRESHOLD;
    const previousOpenCaseThreshold = process.env.PAYMENT_OPEN_CASE_ALERT_THRESHOLD;
    process.env.PAYMENT_DEAD_LETTER_ALERT_THRESHOLD = "2";
    process.env.PAYMENT_OPEN_CASE_ALERT_THRESHOLD = "3";
    const warnings: Array<{ event?: string; context?: Record<string, unknown> }> = [];
    const cooldowns = new Set<string>();
    const dependencies = {
        async countDeadLetters() { return 2; },
        async countOpenCases() { return 3; },
        async acquireCooldown(name: string) {
            if (cooldowns.has(name)) return false;
            cooldowns.add(name);
            return true;
        },
        async warn(input: { event: string; context?: Record<string, unknown> }) {
            warnings.push(input);
        },
    };
    try {
        await reportPaymentOperationalThresholds("payment-webhook", dependencies);
        await reportPaymentOperationalThresholds("payment-webhook", dependencies);
        await reportPaymentOperationalThresholds("payment-reconciliation", dependencies);
        await reportPaymentOperationalThresholds("payment-reconciliation", dependencies);
        assert.deepEqual(warnings.map((warning) => warning.event), [
            "payment.webhook.dead_letter_threshold_exceeded",
            "payment.reconciliation.open_case_threshold_exceeded",
        ]);
        assert.deepEqual(warnings[0]?.context, { count: 2, threshold: 2 });
        assert.deepEqual(warnings[1]?.context, { count: 3, threshold: 3 });
    } finally {
        if (previousDeadLetterThreshold === undefined) delete process.env.PAYMENT_DEAD_LETTER_ALERT_THRESHOLD;
        else process.env.PAYMENT_DEAD_LETTER_ALERT_THRESHOLD = previousDeadLetterThreshold;
        if (previousOpenCaseThreshold === undefined) delete process.env.PAYMENT_OPEN_CASE_ALERT_THRESHOLD;
        else process.env.PAYMENT_OPEN_CASE_ALERT_THRESHOLD = previousOpenCaseThreshold;
    }
    const serverRuntime = readFileSync("apps/web/server-runtime.ts", "utf8");
    assert.match(serverRuntime, /getPaymentSchedulerHealth/);
    assert.match(serverRuntime, /paymentSchedulersDegraded/);
    assert.match(serverRuntime, /schedulers: paymentSchedulers/);
    console.log("payment operational heartbeat and scheduler health checks passed");
}

void run();
