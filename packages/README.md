# Shared Packages

This directory is reserved for runtime-independent domain and platform packages.

The current application still runs from the repository root. Code will move here
before the Next.js runtime is physically moved into `apps/web`.

Planned first boundaries:

- `api-contracts` (implemented)
- `platform-db` (implemented)
- `platform-cache` (implemented)
- `platform-auth`
- `domain-game`
- `domain-economy`
- `domain-player`

Redis remains a disposable cache, counter, lock, and coordination layer. MySQL
remains the source of truth.

See `docs/architecture/adr-002-platform-package-boundaries.md` for the import and
ownership rules.
