# Payment Rollout and Emergency Pause

## Safety Boundary

Payment activation has two independent layers:

1. Deployment gates prove runtime, provider, legal and scheduler readiness.
2. The operator control decides whether new checkout sessions may be created and
   which deterministic registered-user cohort may create them.

The database control can only reduce access granted by deployment configuration. It
cannot enable payments when `PAYMENTS_ENABLED`, provider, legal evidence or rollout
seed readiness is missing.

The safe default is:

```text
paused=true
rolloutPercent=0
```

Missing, malformed or unreadable control state denies checkout. Public responses do
not reveal the rollout percentage or a user's cohort bucket.

## Stable Rollout Seed

Generate a deployment secret with at least 16 safe characters and store it in the
production secret manager:

```dotenv
PAYMENT_ROLLOUT_SEED=<stable-random-value>
```

The seed and registered `userId` produce a stable bucket from 0 through 99. The seed
is not sent to clients and is mounted only into the web application. Changing it
reshuffles all cohorts, so do not rotate it during a normal rollout. If exposure is
suspected, pause checkout first, rotate the seed through deployment, then restart the
rollout from a low percentage.

## Operator Workflow

Use **Admin > Ödeme Operasyonları > Checkout yayın kontrolü**.

- Expanding access or reopening checkout requires the exact confirmation
  `ODEMEYI AC` and a bounded operation note.
- Reducing the percentage does not require the expansion phrase.
- **Acil durdur** immediately blocks authoritative checkout POST checks.
- Every successful change increments a revision and writes the setting plus audit
  record in one database transaction.
- A stale revision is rejected instead of overwriting another admin's decision.

Recommended first rollout:

1. Start paused at 0% and confirm all four readiness indicators.
2. Open 1%, then observe provider failures, dead letters, open cases and fulfillment.
3. Move through 5%, 10%, 25%, 50% and 100% only after an explicit review interval.
4. Do not automate percentage increases before real production behavior is known.

## Rollback Semantics

Emergency pause blocks only new checkout session creation. It intentionally does not
disable:

- provider callbacks,
- signed webhook intake and processing,
- reconciliation,
- fulfillment for already verified payments,
- refunds, reversals or admin review.

Disabling those paths during an incident could strand money already accepted by the
provider. After pausing, keep payment workers healthy, inspect pending orders and use
the existing reconciliation/manual-review tools. Deployment rollback must preserve
the database and continue using backward-compatible migrations.

The protected health endpoint exposes only control availability, paused state,
percentage and revision. Operator changes also emit PII-free central observability
events; the full reason remains in admin audit history.
