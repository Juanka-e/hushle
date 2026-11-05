# Streamer Session, Host Panel and Stream Screen (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A streamer opens a session from `/streamer`, gets an OBS browser-source URL, runs rounds (word drawn server-side, timer, pass, solve, end) while the public stream screen renders the approved V4 design from a projection that never carries the secret word before the round ends.

**Architecture:** `packages/domain-streamer` holds the pure session state machine, guess normalization, ranking and the two projections (host/public), ported from the prototype's `session.mjs`. The web process keeps active sessions in memory (single-writer topology) in `lib/streamer/session-runtime.ts`, draws words through the existing word pool, ticks once a second and broadcasts snapshots over the existing Socket.IO server to two rooms per session (`streamer:host:<id>` with the card, `streamer:public:<id>` without). HTTP routes create/end sessions, rotate the view key and (fake platform only) inject test guesses. The stream screen is the prototype's CSS/markup/renderer ported to React under `/stream/[viewKey]`; the host panel replaces the `/streamer` gate.

**Tech Stack:** Next.js 16 app router + custom server, Socket.IO 4.8 (default namespace, `/api/socketio`), Prisma 7 + MySQL, zod 4, `next/font`, tsx test scripts, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-streamer-session-and-screens-design.md`

## Global Constraints

- Branch `feature/streamer-session-foundation` created from `feature/streamer-platform-connections` (PR #180) in worktree `D:\gemini_tabu_test\hv`; PR targets `develop` after #180 merges (rebase onto develop then). Owner approves before any PR.
- The secret word never appears in: `publicSnapshot`, `streamer:public:state`, the `/stream/[viewKey]` HTML, or any public HTTP response. Tests assert this with string searches on serialized output.
- Prototype behaviour is the design: the ported CSS layout table, themes (oyun-gecesi, studyo, gece-altini, sakura, sade), camera slots (none, tl, tr, bl, br, left, right), sizes (s 480×270, m 560×315, l 640×360), clocks (hourglass, candle, bulbs, incense, ring, counter), reveal sequencing (stamp at t0, flip +420 ms, secondary +1200 ms), low-time ≤ 10 s, finale, text floors, stay as in `scripts/design-prototypes/hushle-streamer-studio` (V4, committed in Task 1).
- Snapshot schema: `schemaVersion: 4` exactly as the prototype (`type, schemaVersion, revision, phase, remaining, duration, round, passedRound, theme, camera, cameraSize, clock, showCardName, channel{platform,name}, passed{round,target}, connected, participants, pack, scores[≤3]{name,points,rank,tied}, lastCorrect{eventId,name,round,solveMs}, cardBack{collection,variant}, reveal{target,taboos,solved} only when phase === "finished"`).
- Constants: round duration 30–120 s (default 60), tick 1000 ms, transition none (host presses Next), guess dedupe memory 256 message ids, session idle timeout 6 h (auto end), host event burst 10 / 10 s, session create 10 / 15 min per user, public join 30 / min per IP, view key 32 random bytes shown once per rotation, `stream_sessions.summary` keeps top 10 scores.
- Guess normalization: NFC → `toLocaleLowerCase("tr")` → strip punctuation `[^\p{L}\p{N}\s]` → collapse whitespace; `normal` tolerance additionally folds ı→i, ş→s, ğ→g, ç→c, ö→o, ü→u on both sides; `strict` does not fold.
- Socket events (zod `.strict()`): client→server `streamer:host:join {sessionId:string(uuid)}`, `streamer:host:start`, `streamer:host:pause`, `streamer:host:resume`, `streamer:host:pass`, `streamer:host:next`, `streamer:host:end`, `streamer:host:settings {theme?, camera?, cameraSize?, clock?, cardBack?: {collection:int}|null, showCardName?}`, `streamer:public:join {viewKey:string(43)}`; server→client `streamer:host:state`, `streamer:public:state`, `streamer:ended {reason}`, `hata` (existing). Acks follow `{ ok: true } | playerErrorAck(code)`.
- Showcase switch: `features.streamerShowcaseAllCosmetics` (zod default false, admin ToggleField "Yayın vitrini", audit metadata); `GET /api/streamer/sessions` returns `cardBacks: { collection: number; name: string; owned: boolean; selectable: boolean }[]` and `createSession`/`streamer:host:settings` reject a non-selectable collection with `STREAMER_CARD_NOT_ALLOWED`.
- New player error codes (append-only, tr+en): `STREAMER_CARD_NOT_ALLOWED`, `STREAMER_SESSION_NOT_FOUND`, `STREAMER_SESSION_ACTIVE`, `STREAMER_SESSION_NOT_OWNED`, `STREAMER_CONNECTION_REQUIRED`, `STREAMER_VIEW_KEY_INVALID`, `STREAMER_ACTION_INVALID_PHASE`.
- Mixed-EOL files (`prisma/schema.prisma`, `package.json`, `ci.yml`, `game-socket.ts`, `dictionaries.ts`, `player-error-codes.ts`, `server-runtime.ts`) are edited byte-exactly.
- Prisma: `prisma migrate deploy` only, against the throwaway `tabu_test` (127.0.0.1:3317); never `hushle_dev`.
- Fonts: Bricolage Grotesque, Kalam, Big Shoulders Display, Cormorant Garamond, Shippori Mincho via `next/font/google` (self-hosted at build), Inter already present.
- Commit identity `git -c user.name=Juanka-e -c user.email=24526444+Juanka-e@users.noreply.github.com`; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

- A second browser (not the owner) sends `streamer:host:join` with a guessed session id → `STREAMER_SESSION_NOT_OWNED`, no room membership, no state. Test in Task 6.
- The public screen connects with a rotated-out view key, or one from an ended session → `STREAMER_VIEW_KEY_INVALID`; sockets already in the room get `streamer:ended {reason:"view-key-rotated"}`. Test in Task 6.
- The word pool runs dry (all words of the chosen categories drawn) → the next round still starts (pool cycles), never a crash or an empty card. Test in Task 4.
- The web process restarts during a round → the session row becomes `interrupted`, `/streamer` shows the "oturum kesildi" state, the public screen shows the offline state, no stray timers. Test in Task 4 (boot reconciliation) and Task 8 (page state).
- The streamer's connection becomes `needs_reconnect` mid-session (hygiene/refresh failure) → the running session keeps running (no platform call is needed in phase 2); creating a new session is refused with `STREAMER_CONNECTION_REQUIRED`. Test in Task 4.

---

### Task 1: Branch, worktree and the V4 prototype

**Files:** copy the 13 files of `scripts/design-prototypes/hushle-streamer-studio` (incl. untracked `themes.html`) from `D:\gemini_tabu_test\hm` (branch `design/stream-screen-themes`, uncommitted V4) into the new worktree.

- [ ] `git -C D:\gemini_tabu_test\hs worktree add D:\gemini_tabu_test\hv -b feature/streamer-session-foundation feature/streamer-platform-connections`; `npm ci`; `npx prisma generate`; `.env` copied from `hs` (points at the 3317 test DB).
- [ ] Copy the V4 prototype files; run `node scripts/design-prototypes/hushle-streamer-studio/test-session.mjs` (16 checks) and `test-server.mjs` → PASS.
- [ ] Commit `design(streamer): V4 stream screen prototype (five themes, six timers, camera anywhere)`.
- [ ] Copy this plan and the spec into `hv` (they live in `hs` docs) and commit `docs(streamer): phase 2 spec and plan`.

### Task 2: `packages/domain-streamer`

**Files:**
- Create: `packages/domain-streamer/package.json` (`@hushle/domain-streamer`, no deps), `tsconfig.json`, `src/index.ts`, `src/session.ts`, `src/guess.ts`, `src/snapshot.ts`, `src/types.ts`
- Modify: `Dockerfile`, `scripts/test-package-boundaries.ts`, `apps/web/package.json`, root `package.json` (script `test:domain-streamer`)
- Test: `scripts/test-domain-streamer.ts` (port of `test-session.mjs` plus the normalization table)

**Produces:**
- `type StreamPhase = "ready" | "running" | "paused" | "finished" | "ended"`; `type GuessTolerance = "strict" | "normal"`.
- `interface StreamCard { wordId: number; target: string; taboos: string[] }`; `interface ChatGuess { platform: "twitch" | "kick" | "fake"; platformUserId: string; name: string; text: string; messageId: string; sentAt: number }`.
- `interface StreamSessionState` (the prototype's session fields + `card: StreamCard | null`, `passedCard`, `tolerance`, `settings: StreamScreenSettings`, `players: Map<string, {id, name, points}>`, `participants: Set<string>`, `seenMessages: string[]`, `lastCorrect`, `eventCounter`).
- `interface StreamScreenSettings { theme; camera; cameraSize; clock: ClockStyle | null; cardBack: {collection:number}|null; showCardName: boolean; duration: number; language: "tr"|"en"; channel: {platform, name} | null }` with `BROADCAST_THEMES`, `CAMERA_SLOTS`, `CAMERA_SIZES`, `TIMER_STYLES` constants.
- `createStreamSession(settings, now): StreamSessionState`; `beginRound(state, card, now): boolean`; `tick(state, now): boolean`; `pause/resume(state, now): boolean`; `skipRound(state, now): { passed: StreamCard } | null`; `endSession(state, now): boolean`; `acceptGuess(state, guess, now): "closed"|"stale"|"duplicate"|"invalid"|"wrong"|"correct"`; `ranking(state)`.
- `normalizeGuess(text, tolerance): string`; `guessMatches(text, target, tolerance): boolean`.
- `publicSnapshot(state, revision): PublicStreamSnapshot` (v4), `hostSnapshot(state, revision): HostStreamSnapshot` (= public + `card`, `tolerance`, `pool: {drawn, eligible}` optional, `players: full ranking`).

- [ ] Write the failing test (port every `test-session.mjs` case; add: normalization table `["Buzdolabı!!!","buzdolabı"]`, `["BUZDOLABI","buzdolabi"]` matches under normal not strict, `"buz dolabı"` matches, emoji-only guess → invalid, 257th message id evicts the oldest; publicSnapshot while running contains no `target`/`taboos` keys at all; hostSnapshot does). Run → FAIL.
- [ ] Implement; `npx tsc -p packages/domain-streamer/tsconfig.json`; run → PASS; `test:package-boundaries` → PASS. Commit `feat(streamer): domain-streamer package (session, guesses, snapshots)`.

### Task 3: Schema and migration

**Files:** Modify `prisma/schema.prisma`; create `prisma/migrations/20261106120000_stream_sessions/migration.sql`; test `scripts/test-streamer-session-foundation.ts` (static; grows later).

**Produces:** enums `StreamSessionStatus { active ended interrupted }`, `StreamRoundOutcome { solved timeout passed }`; model `StreamSession` (`id Char(36) uuid`, `userId` Cascade, `connectionId Char(36)` → `StreamerConnection` SetNull nullable, `platform StreamerPlatform`, `status`, `settings Json`, `viewKeyHash Char(64)`, `startedAt`, `endedAt?`, `roundCount Int default 0`, `summary Json?`, `createdAt`, `updatedAt`; `@@index([userId, status])`, `@@unique([viewKeyHash])`); model `StreamRoundResult` (`id Int autoincrement`, `sessionId` Cascade, `round Int`, `wordId Int?`, `outcome`, `winnerPlatformUserId VarChar(64)?`, `winnerName VarChar(100)?`, `solveMs Int?`, `startedAt`, `endedAt`; `@@unique([sessionId, round])`). `User.streamSessions`, `StreamerConnection.sessions` relations.

- [ ] Failing static test (model/enum/unique/index regexes, migration file contents, `OAuthAccount` untouched). Implement byte-exactly; `prisma validate`; `migrate diff --from-config-datasource --to-schema --script`; review; `migrate deploy` on 3317; `test:prisma-migrations`; static test → PASS. Commit `feat(streamer): stream_sessions and stream_round_results tables`.

### Task 4: Session store, runtime and service

**Files:**
- Create: `apps/web/src/lib/streamer/session-store.ts` (Prisma + memory stores), `apps/web/src/lib/streamer/session-runtime.ts`, `apps/web/src/lib/streamer/session-service.ts`, `apps/web/src/lib/streamer/view-key.ts`
- Modify: `apps/web/server-runtime.ts` (call `startStreamerSessionRuntime()` after `setupGameSocket`, stop on shutdown)
- Test: `scripts/test-streamer-session-service.ts` (memory store, fake word source, fake clock), `scripts/test-streamer-session-store-integration.ts` (3317, env-gated like phase 1)

**Interfaces:**
- Consumes: Task 2 domain, phase-1 `StreamerConnectionStore`, `getNextWord`/`clearWordPool` (`lib/socket/word-service.ts`), `hashOpaqueToken` (`@hushle/platform-auth`).
- Produces:
  - `createViewKey(): { viewKey: string; hash: string }` (32 bytes base64url, sha256 hex); `hashViewKey(viewKey): string`.
  - `interface StreamSessionStore { create(row); findActiveByUser(userId); findById(id); findByViewKeyHash(hash); update(id, patch); markInterruptedAll(now): Promise<number>; addRoundResult(result); listRecent(userId, limit) }`.
  - `interface WordSource { next(poolKey, settings: {categoryIds; difficulties; locale}): Promise<StreamCard>; clear(poolKey): void }` with `wordPoolSource` (real) and tests' fake.
  - `createStreamerSessionRuntime(deps: { store; wordSource; now?; emit: (sessionId, kind: "host"|"public", payload) => void; onEnded: (sessionId, reason) => void; tickMs?: number })` returning `{ open(row, state); get(sessionId); forUser(userId); start(sessionId); pause; resume; pass; next; end(sessionId, reason); applySettings(sessionId, patch); guess(sessionId, chatGuess); rotateViewKey(sessionId); stop() }`. The runtime owns the 1 s tick per session, round result persistence, idle timeout (6 h), pool key `streamer:<sessionId>`, and `revision` counters; every mutation re-emits both snapshots.
  - `session-service.ts`: `createSession(deps, { userId, settings: CreateSessionInput })` → `{ session, viewKey }` (refuses when an active session exists: `STREAMER_SESSION_ACTIVE`; requires an `active` streamer connection for the chosen platform: `STREAMER_CONNECTION_REQUIRED`); `currentSession(deps, userId)`; `endCurrent(deps, userId)`; `rotateViewKey(deps, userId)` → `{ viewKey }`; `lastSettings(deps, userId)` → prefill. `CreateSessionInput` zod: `platform`, `language`, `categoryIds: int[] ≤ 20`, `difficulties: (1|2|3)[]`, `duration 30–120`, `tolerance`, screen settings.
  - `startStreamerSessionRuntime()` in `server-runtime.ts`: on boot `store.markInterruptedAll(now)` (no in-memory sessions survive), then wires emit → Socket.IO rooms (Task 6 supplies the emitter; until then a no-op).

- [ ] Failing service tests: create refuses without active connection / with an active session; start draws a card, host snapshot has it, public does not; tick to zero → `finished` with `reveal`, round result `timeout` persisted; correct guess → `finished`, result `solved` with `solveMs`, scores updated, second correct guess `closed`; pass → `passed` result and the passed word in the next public snapshot; `next` after finished → new round, `reveal` gone; end → summary (top 10, participants), pool cleared, status `ended`; idle 6 h → auto end reason `idle`; pool exhaustion (fake source cycling) → rounds continue; rotate view key → new hash, old lookup null; `markInterruptedAll` flips `active` rows. Run → FAIL.
- [ ] Implement; run → PASS; integration test against 3317 (create/find/interrupt/round results); tsc clean. Commit `feat(streamer): session runtime, store and service`.

### Task 4b: Showcase switch and card-back catalogue

**Files:** Modify `apps/web/src/lib/system-settings/schema.ts`, `types/system-settings.ts`, admin system-settings page (ToggleField "Yayın vitrini: bütün kart arkaları"), admin route audit metadata; create `apps/web/src/lib/streamer/card-backs.ts` (`listCardBacksForUser(userId, settings): Promise<CardBackOption[]>` — collections come from the existing cosmetic catalogue/inventory services used by `CardBackPanel`; `assertCardBackSelectable(option, settings)`).
Test: `scripts/test-system-settings.ts` (+ default false, round-trip) and `scripts/test-streamer-session-service.ts` (+ owned-only vs all; reject non-selectable).
- [ ] Failing tests → implement → PASS. Commit `feat(streamer): showcase switch and card-back catalogue`.

### Task 5: HTTP routes

**Files:** Create `apps/web/src/app/api/streamer/sessions/route.ts` (POST create, GET current+lastSettings), `apps/web/src/app/api/streamer/sessions/current/end/route.ts` (POST), `apps/web/src/app/api/streamer/sessions/current/view-key/route.ts` (POST rotate), `apps/web/src/app/api/streamer/sessions/current/test-guess/route.ts` (POST; 404 unless fake platform), `apps/web/src/types/streamer-session.ts`; modify `player-error-codes.ts`, `dictionaries.ts` (codes), `proxy.ts` matcher (`/api/streamer/:path*` is already outside the login-401 list; keep).
Test: extend `scripts/test-streamer-session-foundation.ts` (route order: origin → session → rate limit; no `target` in GET response shape), plus `test:player-error-codes` and `test:i18n-content-locales`.

- [ ] Failing static assertions; implement routes over `session-service`; responses: create `201 { session: StreamSessionView, viewKey, urls: { full, half, stripTop, stripBottom } }` where URLs are built with `publicOriginFor`; GET `{ session | null, lastSettings }`; view-key rotate `{ viewKey, urls }`; test-guess `{ result }`. Run all → PASS. Commit `feat(streamer): session HTTP routes`.

### Task 6: Socket layer

**Files:** Create `apps/web/src/lib/socket/streamer-socket.ts` (`setupStreamerSocket(io, runtime, store)`), modify `game-socket.ts` (export `getSocketAuthState`), `server-runtime.ts` (call after `setupGameSocket`, pass the runtime), `docs/socket-events.md` (new tables).
Test: `scripts/test-streamer-socket-integration.ts` — in-process `http.createServer` + Socket.IO + `socket.io-client`, memory store, fake word source, a stub auth resolver injected via `setupStreamerSocket(io, runtime, store, { resolveUser })`.

**Produces:** rooms `streamer:host:<id>` / `streamer:public:<id>`; join handlers with acks; host actions call runtime methods and ack `{ ok: true }` or `playerErrorAck(...)`; runtime `emit` broadcasts `streamer:host:state` / `streamer:public:state`; `streamer:ended` on end and on view-key rotation (`reason: "ended" | "idle" | "view-key-rotated" | "interrupted"`); burst limit via `consumeSocketActionBurstLimit`-style window (10 / 10 s) and public join limit `streamer-public-join` 30 / min per IP (distributed limiter).

- [ ] Failing integration tests: owner joins host room and receives a host state with the card; stranger's join → `STREAMER_SESSION_NOT_OWNED` ack and no state; public join with the right key → public state without `target` (string search on the JSON); wrong/ended/rotated key → `STREAMER_VIEW_KEY_INVALID`; rotation pushes `streamer:ended {reason:"view-key-rotated"}` to old public sockets; host `start` → both rooms get states, public lacks the word, host has it; 11th host action in 10 s → `RATE_LIMITED` ack; `end` → `streamer:ended {reason:"ended"}` to both rooms. Run → FAIL. Implement → PASS. Commit `feat(streamer): host and public socket rooms`.

### Task 7: Public stream screen `/stream/[viewKey]`

**Files:** Create `apps/web/src/app/stream/[viewKey]/page.tsx` (server shell: no data, just the client component and `robots: noindex`), `apps/web/src/components/stream/stream-screen.tsx` (markup from `public.html`), `apps/web/src/components/stream/stream-screen.css` (from `public.css`, scoped under `.hushle-stream`), `apps/web/src/components/stream/stream-renderer.ts` (from `public.js`: `readSnapshot`, layout, fit helpers, reveal sequencing, petals, demo states behind `?demo=` when fake platform is on), `apps/web/src/components/stream/stream-fonts.ts` (`next/font/google` loaders exposing CSS variables the stylesheet uses), `apps/web/src/components/stream/stream-transport.ts` (socket connect with `streamer:public:join`, reconnect, revision guard, offline state after 5 s without a state).
Test: `tests/streamer-stream-screen.spec.ts` (Playwright; fake platform; screenshots of `?demo=` states for the 5 themes at 1920×1080 saved under `test-results/stream-screen/`; assertions that the demo `running` page source contains no `MANDALİNA`, that `?layout=half` and `?overlay=top` render, and that a bogus view key shows the offline/invalid state).

- [ ] Port in three commits: (1) CSS + markup renders the `?demo=running` scene statically; (2) renderer logic (all demo states incl. `play` loop) — compare screenshots by eye against `scratchpad/filtercheck/v5` references; (3) transport. Each step runs the spec; final run → PASS. Lint/tsc clean. Commit messages `feat(stream-screen): …`.

### Task 8: Host panel `/streamer`

**Files:** Replace `apps/web/src/app/streamer/page.tsx` (server: gate states stay; when `enabled` and an active connection exists, render `<StreamerPanel initial={…}/>`), create `apps/web/src/components/streamer/streamer-panel.tsx` (setup form, OBS box, game controls, private card, live scores, log, summary; uses `useI18n`, `run-request`, socket via `io({ path: "/api/socketio", auth: SOCKET_CLIENT_AUTH })`), `streamer-obs-box.tsx` (URLs + `cameraRect` numbers for 1080p/720p + copy buttons + rotate key with confirm), `streamer-setup-form.tsx` (categories from `/api/game/categories`-equivalent used by rooms — reuse the existing categories endpoint), `streamer-card-view.tsx`; i18n keys `streamer.panel.*` (tr+en).
Test: `tests/streamer-session.spec.ts` (Playwright, fake platform): link a channel (phase-1 flow), open `/streamer`, create a session (duration 30), copy OBS URL, open it in a second page, start → public page shows the round with no word in the DOM while the panel shows it; inject `test-guess` → public shows "Bildi!" stamp with the viewer name and the panel log; pass; end → summary on the panel and finale on the public page; restart the dev server is NOT tested here (unit-level in Task 4).

- [ ] i18n keys first (parity test). Failing e2e (section absent). Implement; e2e → PASS; `test:player-error-codes`, lint, tsc clean. Commit `feat(streamer): host panel`.

### Task 9: Docs, env, CI, guide

**Files:** `docs/stream/platform-connections-guide.md` (new §"Yayın oturumu ve OBS": create session, URLs, camera numbers, view key rotation, interrupted state), `docs/socket-events.md` (streamer tables), `docs/stream/README.md` link, `.github/workflows/ci.yml` (lint job: `test:domain-streamer`, `test:streamer-session-service`, `test:streamer-session-foundation`, `test:streamer-socket-integration`; build job: `test:streamer-session-store-integration`; e2e: `test:streamer-stream-screen-e2e`, `test:streamer-session-e2e` with the phase-1 env), root `package.json` scripts.
- [ ] Foundation test asserts CI/docs wiring; implement; run `test:release-ops-docs`, `test:web-launch-readiness:core` (46 checks + new ones), `npx tsc --noEmit`, `npm run lint`. Commit `chore(streamer): phase 2 docs and CI`.

### Task 10: Branch review and hand-off

- [ ] Full suite (phase 1 + phase 2 scripts, both e2e specs on the 3201 smoke server after `npm run build`); leak greps (`target`, `taboos` outside domain/runtime/host files; `console.log` in packages).
- [ ] Fresh reviewer on the whole branch with the spec's security checklist and the Review Focus list; one fix pass with TDD.
- [ ] Report to the owner; ask before pushing/opening the PR (stacked on #180 or rebased onto develop once #180 merges).
