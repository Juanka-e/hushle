# ADR-002: Platform Package Boundaries

## Status

Accepted

## Context

The application needs reusable database and Redis infrastructure before web,
API, and jobs runtimes can be separated. Keeping those implementations under
`apps/web/src/lib` would make every future runtime depend on the current Next.js app.

The project still benefits from direct Prisma usage and does not yet need a
repository layer.

## Decision

Create two private npm workspace packages:

- `@hushle/platform-db`
- `@hushle/platform-cache`

Domain sözleşmeleri concrete infrastructure paketlerinden ayrılır. Sürümlü ekonomik
grant/effect şeması `@hushle/domain-economy` altında saf kalır; Prisma, Redis, payment
provider veya Next.js import etmez. `platform-payments` bu sözleşmeyi kullanır ve
mevcut wallet/inventory executor'larına adapte eder.

Payment fulfillment çalışması ortak wallet transaction primitive'ini de
`@hushle/platform-wallet` paketine taşır. Web'deki eski wallet service yolu
compatibility re-export olarak kalır; yeni payment/jobs kodu web runtime'a
bağımlı olmaz.

`platform-db` owns the Prisma client lifecycle and re-exports generated Prisma
types and enums. `platform-cache` owns Redis connectivity, retry, health, key
construction, and test-client contracts.

Existing `apps/web/src/lib/prisma.ts` and `apps/web/src/lib/redis.ts` files remain temporary
compatibility re-exports. New code must import platform dependencies through the
workspace packages.

## Rationale

1. Web, API, and jobs runtimes will need the same infrastructure clients.
2. Moving concrete implementations first creates a useful boundary without
   introducing repositories or service-to-service networking.
3. Compatibility re-exports keep the migration incremental.
4. A boundary smoke test prevents new direct infrastructure imports.

## Trade-offs

- The repository temporarily has both package imports and compatibility paths.
- Workspace source is transpiled by Next.js rather than published as compiled
  JavaScript.
- Prisma remains directly visible to application services.

## Consequences

### Positive

- Infrastructure code no longer belongs to the web application.
- Docker and local npm installs resolve the same package graph.
- Future `apps/web`, `apps/api`, and `apps/jobs` moves can reuse these packages.

### Negative

- Docker must copy workspace manifests before `npm ci`.
- Package versions and root dependency declarations must remain synchronized.

### Mitigation

- Keep package versions private and lockfile-managed.
- Run package typechecks and package-boundary smoke tests in CI.
- Remove compatibility re-exports after all Prisma imports move to package paths.

## Revisit Trigger

Revisit direct Prisma exposure only when tests require data-source substitution,
queries need a stable domain-facing contract, or a second persistence technology
is introduced.
