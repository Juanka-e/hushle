# Payment Scheduler Deployment

## Scope

Payment webhook processing and reconciliation remain one-shot jobs. Production uses
two systemd timers to start short-lived Compose `jobs` containers. MySQL remains the
payment source of truth; Redis provides the cross-host lease and PII-free heartbeat.

| Job | Timer | Freshness threshold |
| --- | --- | --- |
| `payment-webhook` | every 60 seconds | 180 seconds |
| `payment-reconciliation` | every 15 minutes | 1800 seconds |

Systemd prevents overlap for the same local service. The Redis global lease protects
against a second host or manual invocation, and the database claim/idempotency layer
remains the final event-level protection.

The production deploy script rebuilds the `jobs` image on every release. Payment jobs
take a shared schema-operation lock, while migration, backup and restore use the same
lock exclusively. Webhook and reconciliation may overlap with each other but cannot
run against a schema being migrated.

## Host Prerequisites

1. The release is installed at `/srv/hushle/app` and owned for normal operation by
   the `hushle` user.
2. `hushle` can invoke Docker Compose, normally through membership of the `docker`
   group. Docker socket access is privileged and must not be granted to application
   users that do not already operate deployments.
3. `.env.production` is mode `0600` and contains `JOBS_ENABLED=true`.
4. Both `PAYMENT_*_SCHEDULE_CONFIGURED` flags stay `false` until the units are
   installed and reviewed.

The wrapper does not source the environment file as shell code. It validates only
the required gates and passes the file to Docker Compose. Only the two allowlisted
payment job names are accepted. Each run has a bounded timeout and uses `--no-deps`,
so a scheduler cannot silently create a second database or Redis stack.

## Installation

After deploy and production preflight:

```bash
sudo APP_DIR=/srv/hushle/app \
  /srv/hushle/app/scripts/ops/install-payment-schedulers.sh
```

Review the installed units, then set these values in `.env.production`:

```dotenv
JOBS_ENABLED=true
PAYMENT_WEBHOOK_SCHEDULE_CONFIGURED=true
PAYMENT_RECONCILIATION_SCHEDULE_CONFIGURED=true
PAYMENT_WEBHOOK_SCHEDULE_MAX_AGE_SECONDS=180
PAYMENT_RECONCILIATION_SCHEDULE_MAX_AGE_SECONDS=1800
```

Run preflight again and explicitly enable the timers:

```bash
npm run ops:preflight -- --env-file .env.production
sudo APP_DIR=/srv/hushle/app \
  /srv/hushle/app/scripts/ops/install-payment-schedulers.sh --enable
systemctl list-timers 'hushle-payment-*'
```

Do not mark schedule flags `true` when timers are absent. The flags are a deployment
assertion, not a scheduler implementation.

The normal deploy command acquires the exclusive side of the same lock before schema
migration. No manual timer stop/start step is required. If deploy or post-deploy
health checks fail, disable the timers until database and jobs image compatibility is
known.

## Acceptance

Force one run of each service and inspect its bounded journal:

```bash
sudo systemctl start hushle-payment-webhook.service
sudo systemctl start hushle-payment-reconciliation.service
sudo journalctl -u hushle-payment-webhook.service -n 100 --no-pager
sudo journalctl -u hushle-payment-reconciliation.service -n 100 --no-pager
```

The admin payment screen must show both workers as healthy. A monitor outside the
application host must also run:

```bash
HEALTHCHECK_URL=https://hushle.com/api/health \
HEALTHCHECK_TOKEN='replace_with_32_plus_character_secret' \
./scripts/ops/check-payment-health.sh
```

The probe requires `curl` and `jq`, rejects non-HTTPS URLs by default, keeps the
health token out of curl process arguments, and fails unless the aggregate status is
`ok` and both payment schedulers are `healthy`. The monitor secret must contain 32-256
characters without line breaks. Running this only on the application host is
insufficient because a dead host cannot alert about itself.

## Failure and Rollback

```bash
sudo systemctl disable --now \
  hushle-payment-webhook.timer \
  hushle-payment-reconciliation.timer
```

Disabling timers stops new worker runs but does not delete inbox events, payment
orders, cases, heartbeats, or ledger data. Keep provider webhook verification
available while checkout is disabled so already-sent callbacks remain durable.

If a service times out or fails, inspect the journal and admin payment cases. Never
blindly repeat an uncertain provider initialize operation; the reconciliation path
is the recovery mechanism.
