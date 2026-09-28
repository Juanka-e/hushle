import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string): string => readFileSync(path, "utf8");
const compose = read("docker-compose.yml");
const deploy = read("scripts/ops/deploy.sh");
const deployWorkflow = read(".github/workflows/deploy-production.yml");
const runner = read("scripts/ops/run-payment-job.sh");
const installer = read("scripts/ops/install-payment-schedulers.sh");
const probe = read("scripts/ops/check-payment-health.sh");
const schemaLock = read("scripts/ops/lib/schema-ops-lock.sh");
const webhookService = read("infra/systemd/hushle-payment-webhook.service");
const webhookTimer = read("infra/systemd/hushle-payment-webhook.timer");
const reconciliationService = read("infra/systemd/hushle-payment-reconciliation.service");
const reconciliationTimer = read("infra/systemd/hushle-payment-reconciliation.timer");
const guide = read("docs/deploy/payment-scheduler-deployment.md");
const shellBehaviorTest = read("scripts/test-payment-scheduler-deployment.sh");

const jobsEnvironment = compose.match(/\n  jobs:[\s\S]*?\n  migrate:/)?.[0] ?? "";
const appEnvironment = compose.match(/\n  app:[\s\S]*?\n  mysql:/)?.[0] ?? "";
for (const key of [
    "PAYTR_CHECKOUT_MODE",
    "SHOPIER_PERSONAL_ACCESS_TOKEN",
    "SHOPIER_RECONCILIATION_MODE",
    "SHOPIER_REFUND_MODE",
    "IYZICO_API_KEY",
    "IYZICO_SECRET_KEY",
    "IYZICO_CHECKOUT_MODE",
    "IYZICO_WEBHOOK_MODE",
    "IYZICO_RECONCILIATION_MODE",
    "PAYMENT_WEBHOOK_BATCH_SIZE",
    "PAYMENT_WEBHOOK_JOB_LEASE_TTL_MS",
    "PAYMENT_DEAD_LETTER_ALERT_THRESHOLD",
    "PAYMENT_OPEN_CASE_ALERT_THRESHOLD",
]) {
    assert.match(jobsEnvironment, new RegExp(`${key}:`), `jobs env missing ${key}`);
}
for (const key of [
    "SHOPIER_RECONCILIATION_MODE",
    "SHOPIER_REFUND_MODE",
    "IYZICO_API_KEY",
    "IYZICO_SECRET_KEY",
    "IYZICO_MERCHANT_ID",
    "IYZICO_CHECKOUT_MODE",
    "IYZICO_WEBHOOK_MODE",
    "IYZICO_RECONCILIATION_MODE",
    "PAYMENT_WEBHOOK_SCHEDULE_CONFIGURED",
    "PAYMENT_WEBHOOK_SCHEDULE_MAX_AGE_SECONDS",
    "PAYMENT_RECONCILIATION_SCHEDULE_CONFIGURED",
    "PAYMENT_RECONCILIATION_SCHEDULE_MAX_AGE_SECONDS",
]) {
    assert.match(appEnvironment, new RegExp(`${key}:`), `app env missing ${key}`);
}

assert.match(runner, /case "\$JOB" in/);
assert.match(runner, /payment-webhook\)/);
assert.match(runner, /payment-reconciliation\)/);
assert.match(runner, /Unsupported payment job/);
assert.match(runner, /JOBS_ENABLED=.*true/);
assert.match(runner, /--profile jobs run --rm --no-deps jobs/);
assert.match(runner, /timeout --signal=TERM --kill-after=30s/);
assert.match(runner, /acquire_schema_ops_shared_lock/);
assert.doesNotMatch(runner, /source\s+.*ENV_FILE/);
assert.match(deploy, /--profile jobs build jobs/);
assert.match(deploy, /PAYMENT_EVIDENCE_DIR/);
assert.match(deploy, /evidence_dir:\$evidence_dir:ro/);
assert.match(deploy, /PAYMENTS_ENABLED=\[\[:space:\]\]\*true/);
assert.match(schemaLock, /flock_args=\(-s/);
assert.match(schemaLock, /acquire_schema_ops_shared_lock/);

assert.match(installer, /EUID != 0/);
assert.match(installer, /systemctl daemon-reload/);
assert.match(installer, /systemctl enable --now/);
assert.match(installer, /--enable/);
assert.match(installer, /! -x .*run-payment-job\.sh/);
assert.match(deployWorkflow, /chmod \+x[\s\S]*run-payment-job\.sh/);

assert.match(webhookService, /User=hushle/);
assert.match(webhookService, /run-payment-job\.sh payment-webhook/);
assert.match(webhookTimer, /OnCalendar=\*-\*-\* \*:\*:00/);
assert.match(webhookTimer, /Persistent=true/);
assert.match(reconciliationService, /run-payment-job\.sh payment-reconciliation/);
assert.match(reconciliationTimer, /OnCalendar=\*-\*-\* \*:00\/15:00/);
assert.match(reconciliationTimer, /Persistent=true/);

assert.match(probe, /HEALTHCHECK_URL[\s\S]*https:\/\//);
assert.match(probe, /curl_config="\$\(mktemp\)"/);
assert.match(probe, /header = "x-health-token:/);
assert.match(probe, /all\(\.status == "healthy"\)/);
assert.doesNotMatch(probe, /curl[^\n]*HEALTHCHECK_TOKEN/);
assert.match(guide, /outside the\s+application host/);
assert.match(guide, /Never\s+blindly repeat an uncertain provider initialize operation/i);
assert.match(shellBehaviorTest, /systemd-analyze verify/);

console.log("Payment scheduler deployment contract checks passed.");
