# Dependency Security Refresh - July 2026

## Scope

This refresh updates vulnerable direct dependencies without introducing
unrelated major framework migrations.

Baseline:

- full dependency audit: 21 findings
- production audit: 17 findings
- production critical findings: 2

## Applied Changes

- Next.js `16.2.6` to `16.2.12`
- Auth.js `5.0.0-beta.30` to `5.0.0-beta.32`
- PostCSS `8.5.x` to `8.5.23`
- Playwright `1.51.1` to `1.62.0`
- matching `eslint-config-next` refresh
- Socket.IO transitive patches:
  - `engine.io` `6.6.9`
  - `engine.io-client` `6.6.6`
  - `socket.io-adapter` `2.5.8`
  - `ws` `8.21.1`
- safe parser and build-tool updates within existing dependency ranges

The following unused runtime dependencies were removed:

- `multer`
- `dompurify`
- `isomorphic-dompurify`
- the stale `undici` override that existed only for the removed jsdom chain

Uploads use Web `FormData`; announcement content uses the dedicated,
regression-tested sanitizer under `apps/web/src/lib/security/announcements.ts`.

## Result

After the refresh:

- production critical findings: 0
- production audit findings: 4
- installed package count: 600, down from 661

The four production records are one residual dependency chain:

- `next`
- `next-auth`, reported because it depends on `next`
- Next's bundled PostCSS
- Next's optional Sharp dependency

Next `16.2.12` pins PostCSS `8.4.31` and supports Sharp `^0.34.5`. npm suggests
an invalid downgrade to Next `9.3.3`; overriding Sharp to `0.35.x` would cross
Next's supported pre-1.0 minor range. A PostCSS override was tested and rejected
because npm retained the bundled copy and marked the tree invalid.

These records must be re-evaluated when a stable Next release supports patched
Sharp and PostCSS versions. Do not use `npm audit fix --force` or unsupported
overrides to hide them.

The full audit count is higher because npm expands one development-only
`brace-expansion` advisory through ESLint and TypeScript-ESLint parent packages.
Current compatible ESLint tooling does not expose a non-breaking resolution.

## Validation

- ESLint
- full TypeScript typecheck
- platform package typechecks
- Auth redirect and admin access gateway smoke tests
- request security and content security policy smoke tests
- announcement sanitizer smoke test
- branding asset upload smoke test
- Redis and distributed coordination smoke tests
- gameplay Playwright smoke suite
- production Next.js build
