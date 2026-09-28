# Jobs

One-shot operational jobs that are invoked by cron, a container scheduler, or an
operator. The runtime does not run inside the web request process.

Audit retention is dry-run by default:

```bash
npm run jobs:audit-retention
```

Execution requires both an explicit flag and environment gate:

```bash
JOBS_ENABLED=true npm run jobs:run -- audit-retention execute
```

Live mutation also requires Redis so only one runtime can own the job lease.
The jobs container uses a separate, low database connection limit so one-shot
maintenance cannot consume the web process pool.

Payment recovery is a separate bounded job:

```bash
npm run jobs:run -- payment-reconciliation dry-run
JOBS_ENABLED=true npm run jobs:run -- payment-reconciliation execute
```

It queries bounded old PayTR and explicitly enabled iyzico candidates, stores a
minimal provider snapshot, and uses a Redis global lease. iyzico execution requires
`IYZICO_CHECKOUT_MODE=sandbox` and `IYZICO_RECONCILIATION_MODE=sandbox`. Missing
iyzico session tokens stay in manual review and never trigger a blind initialize
retry. Provider mismatches and detected returns open an admin review case; they
never trigger a provider refund automatically.

Shopier execution additionally requires `SHOPIER_CHECKOUT_MODE=live`,
`SHOPIER_WEBHOOK_MODE=live`, and `SHOPIER_RECONCILIATION_MODE=live`. The jobs
container needs the PAT and webhook token. An uncertain listing is recovered only
from one exact Product API match; missing or ambiguous matches never trigger a
second create request.

The admin audit page has separate active and archive views. Production
scheduling still remains an explicit operator decision after the retention
window and archive view are accepted in the target environment.

Successful execute runs write a PII-free Redis operational heartbeat and emit a
bounded `job.run.completed` observability event. Dry-runs and lease-held invocations
do not count as scheduler health. Payment dead-letter/open-case warnings use a
15-minute Redis cooldown; Redis remains coordination/health state, while MySQL is
the payment source of truth.
