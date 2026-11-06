# Streamer Platform Connections (Twitch + Kick) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-in user links their Twitch or Kick channel from Settings; Hushle stores the channel identity and encrypted tokens, keeps them fresh, revokes dead or dormant ones, and gates the `/streamer` page on an active connection.

**Architecture:** A new workspace package `@hushle/platform-streamer` holds the pure parts (AES-256-GCM token crypto with a versioned keyring, one `StreamerPlatformClient` interface with Twitch, Kick and Fake implementations, a Prisma-backed connection store, the token-refresh service). The web app adds thin route handlers over an injectable `connect-flow` module (HMAC-signed state cookie, start/callback/disconnect), a `streamerModeEnabled` feature switch, a Settings section and the `/streamer` gate. `apps/jobs` gets a daily `streamer-connection-hygiene` job that revokes dormant connections through the same package.

**Tech Stack:** Next.js 16 app router route handlers, Auth.js session via `getSessionUser`, Prisma 6 + MySQL 8.4, zod, node `crypto`, `tsx` scripts with `node:assert/strict`, Playwright (smoke server on 127.0.0.1:3201).

**Spec:** `docs/superpowers/specs/2026-11-05-streamer-platform-connections-design.md`

## Global Constraints

- Branch `feature/streamer-platform-connections` from `develop`, in a new short-path worktree `D:\gemini_tabu_test\hs`. PR targets `develop`; the owner approves before any PR is opened and before merge.
- Never touch `OAuthAccount`, `oauth-providers.ts`, `auth.ts` or Auth.js config: Twitch/Kick are not login providers.
- Tokens: stored only as `access_token_enc` / `refresh_token_enc` ciphertext; never in API responses, UI, logs, observability events, audit `metadata` or error messages. Platform response bodies are never echoed to users or logs (status code and a fixed `kind` only).
- Scopes: Twitch `[]` (none), Kick `["user:read", "channel:read"]`. Nothing else in this phase.
- Constants: state cookie TTL 10 min, name `hushle_streamer_connect`, path `/api/streamer/connect`; refresh when `accessTokenExpiresAt - now < 60 s`; dormant after 90 days (`STREAMER_CONNECTION_DORMANT_DAYS`, 1–365); hygiene batch 100; rate limits: start 10 / 15 min per user, callback 10 / 15 min per IP, disconnect 5 / 15 min per user; distributed buckets `streamer-connect-start`, `streamer-connect-callback`, `streamer-disconnect`.
- Fake platform only when `STREAMER_FAKE_PLATFORM=1` **and** `NODE_ENV !== "production"`; production preflight hard-fails if `STREAMER_FAKE_PLATFORM=1`.
- Env names: `STREAMER_TWITCH_CLIENT_ID`, `STREAMER_TWITCH_CLIENT_SECRET`, `STREAMER_KICK_CLIENT_ID`, `STREAMER_KICK_CLIENT_SECRET`, `STREAMER_TOKEN_KEY` (base64, exactly 32 bytes), `STREAMER_TOKEN_KEY_VERSION` (int ≥ 1, default 1), `STREAMER_TOKEN_KEY_PREVIOUS` + `STREAMER_TOKEN_KEY_PREVIOUS_VERSION` (optional, rotation), `STREAMER_OAUTH_PUBLIC_ORIGIN` (defaults to `NEXT_PUBLIC_SITE_URL` / request origin in dev), `STREAMER_FAKE_PLATFORM`, `STREAMER_CONNECTION_DORMANT_DAYS`, `STREAMER_HYGIENE_BATCH_SIZE`, `STREAMER_HYGIENE_LEASE_TTL_MS`.
- Redirect URIs are fixed: `<origin>/api/streamer/connect/twitch/callback` and `.../kick/callback`. Settings redirects go to `/dashboard?tab=settings&streamer=<linked|error>&platform=<p>&code=<c>` with `code` from a fixed allowlist.
- Mixed-EOL files (`prisma/schema.prisma`, `package.json`, `ci.yml`, `docker-compose.yml`, `Dockerfile`) are edited byte-exactly (python helper in scratchpad, as in earlier plans).
- Prisma: only `prisma migrate deploy` against `tabu_test`; never `migrate dev`/`db push`/`migrate reset`/`format`; never `hushle_dev`.
- Audit action names: `streamer.connection.linked`, `streamer.connection.relinked`, `streamer.connection.link_rejected`, `streamer.connection.disconnected`, `streamer.connection.refresh_failed`, `streamer.connection.dormant_revoked`; `resourceType "streamer_connection"`, `resourceId` = connection id; metadata only `{platform, reason?}`.
- Player error codes are append-only in `player-error-codes.ts`, each with tr and en text.
- i18n: every new key in both `tr` and `en` (`scripts/test-i18n-and-content-locales.ts` enforces parity).
- Commit identity: `git -c user.name=Juanka-e -c user.email=24526444+Juanka-e@users.noreply.github.com commit ...`; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

- Callback reached with a valid cookie but a **different logged-in user** than the one who started (shared computer, session switch) → no link is written, redirect `code=state_mismatch`. Test in Task 5.
- The platform account is **already linked to another Hushle user** → rejected with `code=already_linked_elsewhere`, audit `link_rejected`, no data of the other user leaks. Test in Task 5.
- Refresh fails while the user is on `/streamer` → tokens deleted immediately, status `needs_reconnect`, page shows "yeniden bağla", nothing crashes. Test in Task 4 (service) and Task 9 (page states).
- `STREAMER_TOKEN_KEY` rotated: rows encrypted with the previous version still decrypt; a row with an unknown version fails closed (`needs_reconnect` on next use, never a crash loop). Test in Task 2 and Task 4.
- Platform returns `?error=access_denied` (user cancelled) or the callback is replayed with the same code → first: `code=denied`, no row; second: cookie already cleared → `code=state_missing`. Test in Task 5.

---

### Task 1: Worktree, schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (enums + model + `User.streamerConnections`)
- Create: `prisma/migrations/20261105120000_streamer_connections/migration.sql`
- Test: `scripts/test-streamer-connection-foundation.ts` (static contract checks; grows in later tasks)

**Produces:** Prisma enums `StreamerPlatform { twitch kick }`, `StreamerConnectionStatus { active needs_reconnect revoked }`; model `StreamerConnection` (`@@map("streamer_connections")`): `id String @default(uuid()) @db.Char(36)`, `userId Int` (Cascade), `platform StreamerPlatform`, `platformUserId VarChar(64)`, `login VarChar(64)`, `displayName VarChar(100)`, `avatarUrl VarChar(500)?`, `channelUrl VarChar(255)`, `scopes VarChar(255)` (space-separated, may be empty), `accessTokenEnc Text?`, `refreshTokenEnc Text?`, `tokenKeyVersion Int?`, `accessTokenExpiresAt DateTime?`, `status StreamerConnectionStatus @default(active)`, `statusReason VarChar(32)?`, `lastValidatedAt`, `lastUsedAt`, `connectedAt @default(now())`, `revokedAt`, `createdAt`, `updatedAt`; `@@unique([platform, platformUserId])`, `@@unique([userId, platform])`, `@@index([status, lastUsedAt])`.

- [ ] `git -C D:\gemini_tabu_test\hm fetch origin develop` → `git worktree add D:\gemini_tabu_test\hs -b feature/streamer-platform-connections origin/develop`; `npm ci` in `hs`; `npm run db:generate`.
- [ ] Write the failing static test: `scripts/test-streamer-connection-foundation.ts` asserts with `readFileSync` that `schema.prisma` contains `model StreamerConnection`, both `@@unique` lines and `streamerConnections StreamerConnection[]` on `User`, and that the migration SQL creates `streamer_connections` with both unique indexes. Run `npx tsx scripts/test-streamer-connection-foundation.ts` → FAIL.
- [ ] Add enums, model and relation byte-exactly (keep `OAuthAccount` block untouched). `npx prisma validate && npm run db:generate`.
- [ ] Generate SQL: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <tabu_test> --script > prisma/migrations/20261105120000_streamer_connections/migration.sql`; review it by eye (two unique indexes, FK cascade).
- [ ] `DATABASE_URL=<tabu_test> npx prisma migrate deploy` then `npm run test:prisma-migrations`; run the static test → PASS.
- [ ] Add `"test:streamer-connection-foundation": "tsx scripts/test-streamer-connection-foundation.ts"` to root `package.json` (byte-exact). Commit `feat(streamer): add streamer_connections table`.

### Task 2: Package skeleton and token crypto

**Files:**
- Create: `packages/platform-streamer/package.json` (`@hushle/platform-streamer`, deps `@hushle/platform-db`), `packages/platform-streamer/src/index.ts`, `packages/platform-streamer/src/token-crypto.ts`
- Modify: `Dockerfile` (copy `packages/platform-streamer/package.json` beside the other packages), `scripts/test-package-boundaries.ts` (assert the Dockerfile line), `apps/web/package.json` and `apps/jobs/package.json` (dependency `"@hushle/platform-streamer": "0.1.0"`)
- Test: `scripts/test-streamer-token-crypto.ts`

**Produces:**
- `type TokenKeyring = { current: { version: number; key: Buffer }; previous?: { version: number; key: Buffer } }`
- `loadTokenKeyring(env: NodeJS.ProcessEnv): TokenKeyring` — throws `StreamerConfigError("STREAMER_TOKEN_KEY must be 32 bytes base64")` on missing/short/undecodable key; version from `STREAMER_TOKEN_KEY_VERSION` (default 1); previous only when both previous vars set and version differs.
- `encryptToken(plain: string, keyring: TokenKeyring, aad: string): string` — AES-256-GCM, 12-byte random IV, output `v<version>.<iv>.<tag>.<ciphertext>` base64url.
- `decryptToken(encoded: string, keyring: TokenKeyring, aad: string): string` — throws `TokenDecryptError` with `reason: "unknown_version" | "tampered" | "malformed"`; never includes plaintext or key material in the message.
- `connectionAad(platform: string, platformUserId: string): string` = `` `streamer:${platform}:${platformUserId}` ``.

- [ ] Write failing tests: roundtrip; different IV per call; tampered ciphertext → `tampered`; wrong aad → `tampered`; `v9.` prefix → `unknown_version`; garbage → `malformed`; decrypt with keyring whose `previous` is the old key succeeds and `encryptToken` always uses `current`; `loadTokenKeyring` rejects 16-byte key and accepts a generated 32-byte one. Run → FAIL (module missing).
- [ ] Create the package files and implement; `npm install` (workspace link) ; run the test → PASS.
- [ ] Update `Dockerfile` and `scripts/test-package-boundaries.ts`; run `npm run test:package-boundaries` → PASS. Add `"test:streamer-token-crypto"` script. Commit `feat(streamer): platform-streamer package with token crypto`.

### Task 3: Platform clients (Twitch, Kick, Fake)

**Files:**
- Create: `packages/platform-streamer/src/platform-client.ts` (types + errors), `twitch-client.ts`, `kick-client.ts`, `fake-client.ts`, `client-factory.ts`
- Test: `scripts/test-streamer-platform-clients.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type StreamerPlatform = "twitch" | "kick"`; `STREAMER_PLATFORMS: readonly StreamerPlatform[]`; `PLATFORM_LABELS = { twitch: "Twitch", kick: "Kick" }`.
  - `interface TokenSet { accessToken: string; refreshToken: string | null; expiresAt: Date | null; scopes: string[] }`
  - `interface PlatformIdentity { platformUserId: string; login: string; displayName: string; avatarUrl: string | null; channelUrl: string }`
  - `interface StreamerPlatformClient { platform; requiresPkce: boolean; scopes: readonly string[]; authorizationUrl(input: { state: string; redirectUri: string; codeChallenge?: string }): string; exchangeCode(input: { code: string; redirectUri: string; codeVerifier?: string }): Promise<TokenSet>; refresh(refreshToken: string): Promise<TokenSet>; revoke(token: string, hint: "access_token" | "refresh_token"): Promise<void>; fetchIdentity(accessToken: string): Promise<PlatformIdentity>; validate?(accessToken: string): Promise<{ ok: boolean; expiresInSeconds: number | null }> }`
  - `class StreamerPlatformError extends Error { kind: "invalid_grant" | "unauthorized" | "rate_limited" | "network" | "unexpected"; status: number | null }` — message is `` `${platform} ${operation} failed (${kind}, ${status})` `` only.
  - `createStreamerPlatformClient(platform, env, fetchImpl = fetch): StreamerPlatformClient` — Fake when allowed (see constraints), otherwise real; throws `StreamerConfigError` if client id/secret missing. `isFakePlatformEnabled(env): boolean`.
  - Fake client: `authorizationUrl` → `${env.STREAMER_FAKE_AUTHORIZE_URL ?? "/api/streamer/connect/fake/authorize"}?platform=..&state=..&redirect_uri=..`; `exchangeCode` accepts `fake-code-<login>` and returns tokens `fake-access-<login>-<n>` / `fake-refresh-<login>`, `expiresAt = now + 1 h`; `refresh("fake-refresh-expired")` throws `invalid_grant`; `fetchIdentity` maps login → identity (`platformUserId = "fake-" + login`); `revoke` records calls on `fake.revoked: string[]`.
- Twitch endpoints: authorize `https://id.twitch.tv/oauth2/authorize` (`response_type=code`, `client_id`, `redirect_uri`, `scope` empty string, `state`, `force_verify=true`); token `POST https://id.twitch.tv/oauth2/token` form (`grant_type`, `client_id`, `client_secret`, `code`, `redirect_uri`); refresh same with `grant_type=refresh_token`; revoke `POST https://id.twitch.tv/oauth2/revoke` (`client_id`, `token`); identity `GET https://api.twitch.tv/helix/users` with `Authorization: Bearer` + `Client-Id`, map `data[0]` → `{id, login, display_name, profile_image_url, channelUrl: https://twitch.tv/<login>}`; validate `GET https://id.twitch.tv/oauth2/validate` with `Authorization: OAuth <token>`.
- Kick endpoints: authorize `https://id.kick.com/oauth/authorize` (`client_id`, `response_type=code`, `redirect_uri`, `state`, `scope="user:read channel:read"`, `code_challenge`, `code_challenge_method=S256`); token `POST https://id.kick.com/oauth/token` form (`grant_type`, `client_id`, `client_secret`, `code`, `redirect_uri`, `code_verifier`); refresh `grant_type=refresh_token`; revoke `POST https://id.kick.com/oauth/revoke` (`token`, `token_hint_type`); identity: `GET https://api.kick.com/public/v1/users` → `data[0].{user_id,name,profile_picture}` and `GET https://api.kick.com/public/v1/channels` → `data[0].slug`; `channelUrl = https://kick.com/<slug>`, `login = slug`.
- Error mapping: HTTP 400 with body `error=invalid_grant` (or any 400 on refresh) → `invalid_grant`; 401 → `unauthorized`; 429 → `rate_limited`; fetch throw → `network`; other → `unexpected`. `expiresAt = now + expires_in * 1000` when `expires_in` is a positive number, else null.

- [ ] Write failing tests with a stub `fetchImpl` that records requests: Twitch authorize URL contains `force_verify=true` and empty scope; Twitch exchange posts the five form fields; Twitch identity sends both headers and maps fields; Twitch 401 → `unauthorized`; Kick authorize URL contains `code_challenge_method=S256`; Kick exchange includes `code_verifier` and `client_secret`; Kick identity merges users + channels; Kick refresh 400 → `invalid_grant`; `StreamerPlatformError.message` does not contain the stub response body text (`"SECRET_BODY"`); factory returns Fake only with `STREAMER_FAKE_PLATFORM=1` and `NODE_ENV=test`, throws `StreamerConfigError` without client id in production mode; Fake roundtrip (`exchangeCode("fake-code-deniz")` → identity login `deniz`). Run → FAIL.
- [ ] Implement the four files; run → PASS. Add `"test:streamer-platform-clients"`. Commit `feat(streamer): twitch, kick and fake platform clients`.

### Task 4: Connection store and token service

**Files:**
- Create: `packages/platform-streamer/src/connection-store.ts` (interface + `prismaStreamerConnectionStore` + `createMemoryStreamerConnectionStore()` for tests), `packages/platform-streamer/src/token-service.ts`
- Test: `scripts/test-streamer-token-service.ts` (memory store + fake client), `scripts/test-streamer-connection-store-integration.ts` (tabu_test, only when `STREAMER_INTEGRATION_DATABASE_URL` is set)

**Interfaces:**
- Consumes: Task 2 crypto, Task 3 clients.
- Produces:
  - `type StreamerConnectionRecord` = the Prisma row shape (all columns).
  - `interface StreamerConnectionStore { findByUser(userId): Promise<StreamerConnectionRecord[]>; findByUserAndPlatform(userId, platform); findByPlatformUser(platform, platformUserId); upsertLinked(input: { userId; platform; identity: PlatformIdentity; scopes: string[]; accessTokenEnc; refreshTokenEnc | null; tokenKeyVersion; accessTokenExpiresAt: Date | null; now: Date }): Promise<{ record; relinked: boolean }>; updateTokens(id, { accessTokenEnc; refreshTokenEnc; tokenKeyVersion; accessTokenExpiresAt; now }); markNeedsReconnect(id, reason: StatusReason, now); markRevoked(id, reason, now); touchUsed(id, now); touchValidated(id, now); findDormant(cutoff: Date, limit: number): Promise<StreamerConnectionRecord[]> }` where `type StatusReason = "refresh_failed" | "dormant" | "user_disconnected" | "account_closed" | "scope_change"`. `markNeedsReconnect`/`markRevoked` set both `*TokenEnc` to null and `tokenKeyVersion` to null.
  - `upsertLinked` on an existing `(userId, platform)` row refreshes identity, tokens, scopes, sets `status active`, `statusReason null`, `revokedAt null` and returns `relinked: true`. The `(platform, platformUserId)` conflict with another user is **not** handled here (the flow checks first); on P2002 it rethrows.
  - `class StreamerReconnectRequired extends Error { connectionId: string; reason: StatusReason }`
  - `getAccessToken(deps: { store; client; keyring; now?: () => Date }, connection: StreamerConnectionRecord): Promise<{ accessToken: string; connection: StreamerConnectionRecord }>` — decrypt (unknown version/tampered → `markNeedsReconnect(id, "refresh_failed")` and throw `StreamerReconnectRequired`); refresh when within 60 s of expiry or `expiresAt` null and `client.platform === "twitch"` never (Twitch gives expiry); refresh `invalid_grant`/`unauthorized` → same reconnect path; `network`/`rate_limited`/`unexpected` → rethrow the `StreamerPlatformError` without touching the row.
  - `callWithToken<T>(deps, connection, fn: (accessToken) => Promise<T>): Promise<T>` — runs `fn`; on `StreamerPlatformError.kind === "unauthorized"` refreshes once and retries; touches `lastUsedAt` on success.
  - `revokeConnectionTokens(deps, connection, reason, status: "needs_reconnect" | "revoked"): Promise<{ revokedAtPlatform: boolean }>` — best-effort `client.revoke` for refresh (preferred) or access token, then `markRevoked`/`markNeedsReconnect`; platform errors are swallowed and reported through the returned flag.

- [ ] Write failing service tests (memory store, fake client, fixed clock): fresh token returned without refresh; token expiring in 30 s → refreshed, row updated, new ciphertext ≠ old; refresh `invalid_grant` → row `needs_reconnect`, `statusReason refresh_failed`, token columns null, `StreamerReconnectRequired` thrown and its message has no token; `network` error → row unchanged, error rethrown; `callWithToken` retries once on 401 and `lastUsedAt` set; ciphertext with unknown key version → reconnect path; `revokeConnectionTokens` with a throwing revoke still nulls tokens and returns `revokedAtPlatform: false`. Run → FAIL.
- [ ] Implement store (memory + prisma) and service; run → PASS.
- [ ] Integration test against `tabu_test`: create a user, `upsertLinked` twice (second → `relinked: true`, same id), second user with same `platformUserId` → P2002 rethrown, `findDormant` picks only `active` rows older than cutoff ordered by `lastUsedAt` then `connectedAt`; cleanup in `finally`. Run with the env var → PASS.
- [ ] Add scripts `"test:streamer-token-service"`, `"test:streamer-connection-store-integration"`. Commit `feat(streamer): connection store and token refresh service`.

### Task 5: Connect state cookie and start/callback flow

**Files:**
- Create: `apps/web/src/lib/streamer/connect-state.ts`, `apps/web/src/lib/streamer/connect-flow.ts`, `apps/web/src/lib/streamer/redirects.ts`, `apps/web/src/lib/streamer/deps.ts` (wires real deps: prisma store, keyring from env, client factory, `getSystemSettings`, `consumeDistributedRequestRateLimit`, `writeAuditLog`), `apps/web/src/app/api/streamer/connect/[platform]/start/route.ts`, `apps/web/src/app/api/streamer/connect/[platform]/callback/route.ts`, `apps/web/src/app/api/streamer/connect/fake/authorize/route.ts` (404 unless fake enabled; otherwise 302 to `redirect_uri?code=fake-code-<login>&state=<state>` where `login` comes from `?login=` default `denizoynuyor`)
- Modify: `apps/web/src/lib/errors/player-error-codes.ts` (+ `STREAMER_MODE_DISABLED`, `STREAMER_CONNECTION_NOT_FOUND`, `STREAMER_PLATFORM_UNAVAILABLE`), `apps/web/src/lib/errors/player-error.ts` texts
- Test: `scripts/test-streamer-connect-state.ts`, `scripts/test-streamer-connect-flow.ts`

**Interfaces:**
- Consumes: Task 3 `createStreamerPlatformClient`, Task 4 store/service.
- Produces:
  - `createConnectState(input: { userId: number; platform: StreamerPlatform; requiresPkce: boolean; secret: string; now?: Date }): { cookieValue: string; state: string; codeChallenge?: string }` — payload `{ v: 1, s: state(32 bytes base64url), u: userId, p: platform, c?: verifier(43 chars), t: iat ms }`, encoded `base64url(json) + "." + base64url(hmacSha256(secret, json))`.
  - `readConnectState(cookieValue: string | undefined, expect: { userId: number; platform: StreamerPlatform; state: string | null; secret: string; now?: Date }): { codeVerifier?: string }` — throws `ConnectStateError(code)` with code ∈ `"state_missing" | "state_invalid" | "state_expired" | "state_mismatch"` (user or platform or state value differ → `state_mismatch`; bad signature/shape → `state_invalid`; `now - t > 600000` → `state_expired`).
  - `const STREAMER_REDIRECT_CODES = [...]` and `settingsRedirect(status: "linked" | "error", platform, code?): string` producing `/dashboard?tab=settings&streamer=…` only.
  - `startConnect(deps, input: { user: SessionUser | null; platform: string; requestIp: string; origin: string }): Promise<{ redirectTo: string; setCookie?: { value: string; maxAgeSeconds: 600 } }>` — order: platform valid (`else redirect code=platform_invalid`), user (`unauthenticated`), `features.streamerModeEnabled` (`disabled`), client configured (`platform_unavailable`), rate limit (`rate_limited`), create state, `redirectTo = client.authorizationUrl(...)`.
  - `completeConnect(deps, input: { user; platform; query: URLSearchParams; cookieValue; requestIp; origin }): Promise<{ redirectTo: string; clearCookie: true }>` — order: platform valid, user, rate limit (IP), cookie/state (`readConnectState`), `query.error` → `denied`, missing `code` → `state_invalid`, `exchangeCode`, `fetchIdentity`, `findByPlatformUser` → if another user: audit `link_rejected` + `already_linked_elsewhere`; `upsertLinked` with encrypted tokens; audit `linked`/`relinked`; `redirectTo = settingsRedirect("linked", platform)`. Any `StreamerPlatformError` → `platform_error` (kind logged via observability event, never the body).
  - Route handlers: `GET start` → `NextResponse.redirect(redirectTo, 302)` + `Set-Cookie` (httpOnly, `secure` when `NODE_ENV==="production"`, `sameSite: "lax"`, `path: "/api/streamer/connect"`, `maxAge 600`); `GET callback` → redirect + cookie cleared (`maxAge 0`). Secret for HMAC: `process.env.STREAMER_TOKEN_KEY` is **not** reused; use `AUTH_SECRET` via a `requireTokenSecret`-style check (≥ 32 chars).

- [ ] Write failing state tests: roundtrip; tamper one char of signature → `state_invalid`; `now + 601 s` → `state_expired`; other userId → `state_mismatch`; other platform → `state_mismatch`; other state value → `state_mismatch`; undefined cookie → `state_missing`; PKCE challenge equals `base64url(sha256(verifier))`. Run → FAIL.
- [ ] Implement `connect-state.ts`; run → PASS.
- [ ] Write failing flow tests with fake deps (memory store, fake client, settings `{streamerModeEnabled: true}`, recording audit + rate limiter stubs): start without user → `unauthenticated`; mode disabled → `disabled`; start sets cookie and authorization URL carries the state; callback with correct cookie links a row with `status active`, encrypted tokens decrypt to the fake tokens, audit `linked` with metadata exactly `{platform}`; same again → `relinked`; callback as a different user with the same cookie → `state_mismatch` and no row; `?error=access_denied` → `denied`; second callback with the same code and no cookie → `state_missing`; platform user already linked to user 2 → user 1 gets `already_linked_elsewhere`, audit `link_rejected`, rows unchanged; rate limiter denial → `rate_limited`; `exchangeCode` throwing `network` → `platform_error` and the redirect URL contains no error text. Run → FAIL.
- [ ] Implement `connect-flow.ts`, `redirects.ts`, `deps.ts`, the three routes, error codes; run → PASS; `npx tsc --noEmit -p apps/web` clean.
- [ ] Add scripts `"test:streamer-connect-state"`, `"test:streamer-connect-flow"`. Commit `feat(streamer): twitch/kick connect start and callback flow`.

### Task 6: Connections API and disconnect

**Files:**
- Create: `apps/web/src/app/api/streamer/connections/route.ts` (GET), `apps/web/src/app/api/streamer/connections/[platform]/disconnect/route.ts` (POST), `apps/web/src/lib/streamer/connections-view.ts`, `apps/web/src/types/streamer.ts`
- Test: extend `scripts/test-streamer-connect-flow.ts`; add static route-order assertions to `scripts/test-streamer-connection-foundation.ts`

**Interfaces:**
- Produces:
  - `interface StreamerConnectionView { platform: StreamerPlatform; label: string; configured: boolean; connection: { login: string; displayName: string; avatarUrl: string | null; channelUrl: string; status: "active" | "needs_reconnect" | "revoked"; statusReason: string | null; connectedAt: string } | null }`
  - `interface StreamerConnectionsResponse { enabled: boolean; platforms: StreamerConnectionView[] }`
  - `listConnectionsView(deps, userId): Promise<StreamerConnectionsResponse>` — never includes token columns (test asserts `JSON.stringify(view)` has no `TokenEnc`).
  - `disconnect(deps, input: { user; platform; requestIp }): Promise<{ ok: true } | { error: "not_found" }>` — `revokeConnectionTokens(..., "user_disconnected", "revoked")`, audit `disconnected`.
  - `GET` route: session (401 `AUTH_REQUIRED` via `playerError`), returns the view. `POST disconnect` route order: `isTrustedStateChangeRequest` (403 `ORIGIN_REJECTED`), session (401), distributed limit `streamer-disconnect` 5/15 min (429 with `buildRateLimitHeaders`), platform param (400), `disconnect` (404 `STREAMER_CONNECTION_NOT_FOUND`), 200 `{ ok: true }`; audit `.catch(console.error)`; 500 fallback.

- [ ] Write failing tests: view hides tokens and reports `configured` from the client factory; disconnect on `active` row → `revoked`, `user_disconnected`, tokens null, fake `revoked` list has the refresh token; disconnect twice → second `not_found`; static test asserts the POST route source has `isTrustedStateChangeRequest` before `getSessionUser` and the rate-limit bucket name. Run → FAIL.
- [ ] Account closure: add `revokeAllForUser(deps, userId, reason: "account_closed"): Promise<number>` (revoke at platform best-effort, then `markRevoked`) and call it from the existing account-deletion path (locate with `rg -n "accountStatus" apps/web/src/lib --glob "*.ts" | rg "deleted|closed"`; if no server-side deletion flow exists yet, record in the guide that the DB cascade covers deletion and the hygiene job covers platform revocation). Test: memory-store case with two platforms → both `revoked`, reason `account_closed`.
- [ ] Implement; run → PASS; tsc clean. Commit `feat(streamer): connections view and disconnect endpoint`.

### Task 7: `streamerModeEnabled` system setting

**Files:**
- Modify: `apps/web/src/lib/system-settings/schema.ts` (`featureSettingsSchema.streamerModeEnabled: z.boolean().default(false)`), `apps/web/src/types/system-settings.ts`, `apps/web/src/app/admin/(dashboard)/system-settings/page.tsx` (ToggleField in the features block, label "Yayıncı modu"), `apps/web/src/app/api/admin/system-settings/route.ts` (audit metadata list)
- Test: extend `scripts/test-system-settings.ts` (default false; write with true round-trips) and `scripts/test-streamer-connection-foundation.ts` (page source contains `streamerModeEnabled`)

- [ ] Write the failing assertions; run `npm run test:system-settings` → FAIL.
- [ ] Implement; run `test:system-settings`, `test:system-settings-hardening`, foundation test → PASS. Commit `feat(streamer): streamer mode feature switch`.

### Task 8: Hygiene job (dormant connections)

**Files:**
- Create: `apps/jobs/src/streamer-connection-hygiene.ts`
- Modify: `apps/jobs/src/config.ts` (`StreamerHygieneConfig { dormantDays; batchSize; leaseTtlMs }`, `getStreamerHygieneConfig(env)` with `parseBoundedInteger`: dormantDays 1–365 default 90, batchSize 1–1000 default 100, leaseTtlMs default 300000), `apps/jobs/src/registry.ts` (`JOB_NAMES` + case `"streamer-connection-hygiene"`), `docker-compose.yml` jobs env (`STREAMER_*` passthrough), `infra/systemd/hushle-streamer-hygiene.timer` + `.service` (daily `03:40`, mirrors the payment-webhook pair), `scripts/ops/install-payment-schedulers.sh` (register the new pair) or a sibling installer if that script is payment-specific
- Test: `scripts/test-streamer-hygiene-job.ts`; extend `scripts/test-jobs-runtime.ts` (job name registered, dry-run default)

**Interfaces:**
- Produces: `runStreamerConnectionHygiene(options: { dryRun: boolean; config; store?: StreamerConnectionStore; clients?: (platform) => StreamerPlatformClient; keyring?: TokenKeyring; now?: () => Date }): Promise<{ dryRun; cutoff: string; candidateCount; revokedCount; platformRevokeFailures; hasMore }>` — for each `findDormant(cutoff, batchSize)` row: `revokeConnectionTokens(..., "dormant", "needs_reconnect")`; writes audit rows directly via prisma (`actorUserId null`, `actorRole "system"`, action `streamer.connection.dormant_revoked`, metadata `{platform, reason: "dormant"}`); dry run only counts.

- [ ] Write failing tests with memory store + fake client + fixed clock: row `active` with `lastUsedAt` 91 days ago → revoked at platform, `needs_reconnect`, `statusReason dormant`, tokens null; row 89 days → untouched; `needs_reconnect` row → untouched; revoke throwing → still cleared, `platformRevokeFailures 1`; dry run → counts only, rows unchanged; `hasMore` true when `candidateCount === batchSize`. Run → FAIL.
- [ ] Implement job, config, registry, compose env, systemd files; run the test and `npm run test:jobs-runtime` → PASS; `npm run jobs:run -- streamer-connection-hygiene` (dry run, needs Redis? dry run takes no lease) prints a JSON summary. Commit `feat(streamer): dormant connection hygiene job`.

### Task 9: Settings section, `/streamer` gate, i18n, e2e

**Files:**
- Create: `apps/web/src/components/game/dashboard-pages/streamer-connections-section.tsx`, `apps/web/src/app/streamer/page.tsx` (server component) + `apps/web/src/app/streamer/streamer-gate.tsx`
- Modify: `apps/web/src/components/game/dashboard-pages/settings-content.tsx` (render the section after "Bağlı Hesaplar"; read `?streamer`, `?platform`, `?code` once and show the matching message), `apps/web/src/lib/i18n/dictionaries.ts` (`settings.streamer.*`, `streamer.gate.*`, error texts for each redirect code, both locales), `apps/web/src/proxy.ts` (add `pathname.startsWith("/streamer")` to the login-redirect list)
- Test: `tests/streamer-connect.spec.ts` (Playwright, skipped unless `STREAMER_FAKE_PLATFORM=1`), `npm run test:i18n-and-content-locales`

**Interfaces:**
- Consumes: Task 6 `StreamerConnectionsResponse`, Task 7 setting.
- Produces: section fetches `GET /api/streamer/connections`; hidden entirely when `enabled === false`; per platform row: avatar/initial, label, `displayName`/`login` or "Bağlı değil", status pill (`active` → "Hazır", `needs_reconnect` → "Yeniden bağla"), primary action = `<a href="/api/streamer/connect/<platform>/start">` (text "Bağla" / "Yeniden bağla"), secondary "Kaldır" (confirm, then `POST .../disconnect`, re-fetch). `/streamer` page states: not logged in → proxy redirects to login; setting off → "Yayıncı modu yakında"; no active connection → explanation + link to settings; `needs_reconnect` → warning + link; `active` → "Kanal hazır: <displayName> (<platform>)" and a note that the panel arrives in the next phase.

- [ ] Add i18n keys (tr+en) and run `npm run test:i18n-and-content-locales` → PASS before UI work.
- [ ] Write the Playwright spec (follows the registration/login helper used in `tests/account-recovery.spec.ts`): with `STREAMER_FAKE_PLATFORM=1` and the setting enabled through the admin API (reuse `loginAdmin` pattern from `tests/connection-pause-panel.spec.ts`): settings shows the Twitch row "Bağlı değil"; click "Bağla" → lands back on settings with the success message and "denizoynuyor"; `/streamer` shows "Kanal hazır"; "Kaldır" → "Bağlı değil"; `/streamer` shows the explanation; with the setting disabled the section is absent and `/streamer` says "yakında". Run `npx playwright test tests/streamer-connect.spec.ts` → FAIL.
- [ ] Implement section, page, proxy change; run the spec → PASS; `npm run lint`, `tsc` clean. Add `"test:streamer-connect-e2e": "playwright test tests/streamer-connect.spec.ts"`. Commit `feat(streamer): settings channel linking and /streamer gate`.

### Task 10: Env, preflight, compose, docs, CI

**Files:**
- Modify: `.env.example`, `.env.production.example` (STREAMER block with comments: how to create the Twitch app at dev.twitch.tv/console and the Kick app at kick.com → Settings → Developer, redirect URIs, `openssl rand -base64 32` for the key), `docker-compose.yml` (app env passthrough), `scripts/lib/production-preflight.mjs` (if any `STREAMER_TWITCH_*`/`STREAMER_KICK_*` set: both id+secret present per platform, `STREAMER_TOKEN_KEY` decodes to 32 bytes and differs from `AUTH_SECRET`; `STREAMER_FAKE_PLATFORM=1` → hard fail always), `.github/workflows/ci.yml` (run `test:streamer-token-crypto`, `test:streamer-platform-clients`, `test:streamer-token-service`, `test:streamer-connect-state`, `test:streamer-connect-flow`, `test:streamer-hygiene-job`, `test:streamer-connection-foundation` in `lint-typecheck`; `test:streamer-connection-store-integration` and the e2e spec in `build` with `STREAMER_FAKE_PLATFORM=1`)
- Create: `docs/stream/platform-connections-guide.md` (setup, env, switch, hygiene schedule, key rotation: set previous = old, current = new, bump version, deploy; rows re-encrypt lazily on next refresh; after 90 days previous can be dropped), link it from `docs/stream/README.md`
- Test: `scripts/test-production-preflight.ts` (+ cases: fake flag in production fails; 16-byte key fails; valid block passes), `scripts/test-streamer-connection-foundation.ts` (+ `.env.example` contains every `STREAMER_` name from Global Constraints, `docker-compose.yml` passes `STREAMER_TOKEN_KEY` to both app and jobs, ci.yml lists the scripts)

- [ ] Write the failing preflight and foundation assertions; run → FAIL.
- [ ] Implement; run `npm run test:production-preflight`, foundation test, `npm run test:release-ops-docs` → PASS. Commit `chore(streamer): env, preflight, scheduler and docs`.

### Task 11: Branch review and hand-off

- [ ] Run the full set: `npm run lint`, `npx tsc --noEmit` (web + jobs), all `test:streamer-*`, `test:package-boundaries`, `test:system-settings*`, `test:i18n-and-content-locales`, `test:jobs-runtime`, `test:prisma-migrations`, the Playwright spec on the 3201 smoke server. Paste outputs in the PR body section "Doğrulama".
- [ ] Grep the branch for leaks: `rg -n "TokenEnc|accessToken|refreshToken" apps/web/src/app apps/web/src/components` must only show the store/service/view files; `rg -n "console.log" packages/platform-streamer` must be empty.
- [ ] Fresh reviewer (code-review skill) on the whole branch with the spec's security checklist as the brief; fix findings; re-run.
- [ ] Ask the owner before opening the PR to `develop` (Turkish body: özet, güvenlik kontrol listesi madde madde "doğrulandı / nasıl", yapılmayanlar: gerçek Twitch/Kick kabul testi, sohbet, panel).
