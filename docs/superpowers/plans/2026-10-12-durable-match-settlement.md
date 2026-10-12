# Durable Match Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record and settle every finished match server-side so rewards and history survive closed browsers, early lobby resets and process restarts.

**Architecture:** `finishGame` captures an immutable snapshot and enqueues it. A settlement service writes it idempotently to `match_settlements`, claims it with a token and settles each registered participant in its own transaction using the existing reward pipeline. An in-process worker retries due/expired rows, flushes an in-memory buffer used when the DB is briefly unavailable, and purges old settled rows. The finalize endpoint becomes a read/nudge.

**Tech Stack:** Next.js 16 custom server, Socket.IO, Prisma 6 + MySQL 8.4, zod, tsx scripts with `node:assert`.

**Spec:** `docs/superpowers/specs/2026-10-12-durable-match-settlement-design.md`

## Global Constraints

- Branch `feature/durable-match-settlement`, stacked on #150, #151, #152 until they merge.
- Reward math must not change: reuse `evaluateMatchRewardEligibility`, `resolveRepeatedGroupReward`, `resolveMatchRewardSafetyCeiling`, `applyWalletLedgerMutation` unchanged.
- Ledger idempotency key stays `match_result:<id>:reward`; audit stays `game.match.finalize` / `match_result` / `resourceId = match_results.id` (admin history joins on it).
- No IP addresses in settlement snapshots.
- Mixed-EOL files (`prisma/schema.prisma`, `game-socket.ts`, `package.json`, `ci.yml`, `remaining.md`) are edited byte-exactly (`scratchpad/bytepatch.py`).
- Integration tests run only with an explicit flag and a `tabu_test` database URL.
- Constants: claim TTL 60 s, max attempts 10, retry delays 15 s/30 s/1 m/2 m/5 m/10 m/15 m/30 m (then 30 m), buffer capacity 500, worker interval 60 s, purge settled after 30 days in batches of 500 hourly.

## Review Focus

- Two settlement runs on the same row at once (route nudge + worker) → exactly one reward per user.
- A participant row that already exists from the legacy endpoint (rolling deploy) → no second coin.
- A participant deleted/suspended/unverified between game end and settlement → skipped, others paid, not retried forever.
- Worker crash mid-row (claim never released) → row recovered after claim expiry.
- Snapshot JSON tampered or from a future version → row dead-lettered with a clear error, not a crash loop.

---

### Task 1: Schema and migration

**Files:** Modify `prisma/schema.prisma`; create `prisma/migrations/20261012120000_match_settlements/migration.sql`.

**Produces:** Prisma models `MatchSettlement`, enums `MatchSettlementStatus { pending processing settled dead_letter }`, `MatchEndReason { completed host_ended }`, `MatchResult.endReason MatchEndReason @default(completed)`.

- [ ] Add enums/model/field byte-exactly; `npx prisma validate`; `npx prisma generate`.
- [ ] Generate SQL with `prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.prisma --script`.
- [ ] Apply to `tabu_test`: `DATABASE_URL=<tabu_test> npx prisma migrate deploy`; `npm run test:prisma-migrations`.

### Task 2: Snapshot and retry policy (pure)

**Files:** Create `apps/web/src/lib/match-settlement/types.ts`, `snapshot.ts`, `retry-policy.ts`; test `scripts/test-match-settlement.ts`.

**Produces:**
- `createSettlementSnapshot(room: RoomMatchSnapshot, endReason: MatchEndReason): MatchSettlementSnapshot` (throws `SettlementSnapshotError` when the match is active or timestamps missing).
- `parseSettlementSnapshot(value: unknown): MatchSettlementSnapshot` (strict zod; throws `SettlementSnapshotError`).
- `toRewardRoomSnapshot(snapshot): RoomMatchSnapshot`.
- `getRegisteredParticipants(snapshot)` (unique positive integer `userId`s, first occurrence wins).
- `getSettlementRetryDelayMs(attemptCount)`, `MATCH_SETTLEMENT_MAX_ATTEMPTS`, `MATCH_SETTLEMENT_CLAIM_TTL_MS`, `formatSettlementError(error)` (single line, ≤255 chars).

Unit cases (all must be asserted):
1. Ended room → snapshot v1 with every participant incl. guests; `oyunAktifMi` not stored.
2. Active room / missing start / missing end → throws.
3. Parse round-trip equals input; JSON stringify/parse round-trip.
4. Parse rejects: version 2, extra key (e.g. `ip`), negative/zero/float `userId`, bad team, empty roomCode, >40 participants, non-ISO dates, negative scores, unknown endReason.
5. Registered participant extraction: dedupes repeated `userId`, ignores guests and `userId: null`.
6. `toRewardRoomSnapshot` gives `oyunAktifMi: false` and identical participants.
7. Retry delays: 1→15 s … 8→30 m, 9+ stays 30 m, 0/negative → 15 s.
8. `formatSettlementError`: Error, string, object, multi-line, 1000-char input.

### Task 3: Participant reward core

**Files:** Create `apps/web/src/lib/match-settlement/participant-reward.ts`; test cases live in `scripts/test-match-settlement-integration.ts`.

**Produces:** `settleParticipantReward(tx, { snapshot, userId, settings, now }): Promise<ParticipantRewardOutcome>` where outcome is `{ kind: "rewarded", matchResultId, coinEarned, won, evaluation, repeatedGroup, ceiling, endReason }` or `{ kind: "already_settled", matchResultId, coinEarned, won }` or `{ kind: "not_eligible", reasonCodes }`.

Steps inside one transaction: upsert wallet + profile → `SELECT … FOR UPDATE` wallet → existing `match_results` row check → eligibility → `host_ended` override (coin 0, won false) → repeated group → ceiling → insert with `end_reason` (`ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`) → ledger mutation when coin > 0.

### Task 4: Settlement service

**Files:** Create `apps/web/src/lib/match-settlement/service.ts`, `effects.ts`.

**Produces:**
- `recordMatchSettlement(snapshot): Promise<{ id: number; created: boolean }>`.
- `settleMatchSettlement(id, options?: { now?: Date; hooks?: { beforeParticipant?(userId: number): void | Promise<void> } }): Promise<SettlementRunResult>` with `status: "settled" | "pending" | "dead_letter" | "claimed_elsewhere" | "not_found"` and per-participant outcomes (`rewarded`, `already_settled`, `not_eligible`, `skipped_user_missing`, `skipped_suspended`, `skipped_reward_capability`, `failed`).
- `findDueMatchSettlementIds({ now, limit })`, `sweepDueMatchSettlements({ now?, limit? })`.
- `purgeSettledMatchSettlements({ now?, olderThanDays?, limit? })`.
- `getMatchSettlementHealth()` → `{ pending, processing, deadLetter }`.
- `findParticipantSettlement(roomCode, userId)`.

Integration cases (real MySQL `tabu_test`, guarded by `MATCH_SETTLEMENT_INTEGRATION_TEST=true`):
1. Happy path 2 registered + 2 guests, A wins: rows, coins, ledger keys, settled, guests only in snapshot.
2. Record twice → same id, `created` false.
3. Settle twice sequentially → no extra rows/coin; second run `not_found`/no-op on settled row.
4. Two concurrent `settleMatchSettlement` → one `claimed_elsewhere`, one reward per user.
5. Legacy row already present for one user → `already_settled`, wallet unchanged for that user, other user paid.
6. Draw → both draw coin, `won` false.
7. `host_ended` → coin 0, `won` false, `end_reason` host_ended, no ledger entry, balance unchanged.
8. Deleted user → `skipped_user_missing`, others paid, row settled.
9. Suspended user (active) → skipped; expired suspension → paid.
10. Email-verification-restricted user → skipped; verified → paid.
11. Transient failure via hook for one user → row pending, attempt 1, `available_at` +15 s, `last_error` set, other user paid; rerun before due → not claimable; rerun after due → remaining user paid, settled, first user not double paid.
12. Always-failing hook → `dead_letter` after 10 attempts; sweeper skips it.
13. Crash recovery: row `processing` with expired claim → swept and settled; unexpired claim → skipped.
14. Corrupt snapshot JSON (written directly) → `dead_letter` immediately with parse error.
15. Repeated-group guard: seed threshold rows for the same lineup → reduced coin equals guard result; detailed audit written.
16. Safety ceiling hard cap: seed earned coin above hard cap → coin 0 row written.
17. Missing wallet/profile → created.
18. Audit row `game.match.finalize` with `resourceId = match_results.id`, `actorRole = "system"`, `endReason` in metadata (when detailed audit or telemetry fallback).
19. Purge: settled 31 days old removed, 29 days kept, pending/dead_letter never purged, limit respected.
20. Health counts reflect pending/processing/dead_letter.
21. `findParticipantSettlement` returns latest settlement containing the user; not for non-participants.

### Task 5: In-memory queue and worker

**Files:** Create `apps/web/src/lib/match-settlement/queue.ts`, `worker.ts`.

**Produces:**
- `createSettlementQueue({ record, settle, capacity?, now?, onDrop?, onError? })` with `enqueue(snapshot)`, `flushDue()`, `size()`.
- `enqueueMatchSettlement(room, endReason)` (production wiring, never throws).
- `startMatchSettlementWorker({ intervalMs? }): { runOnce(): Promise<void>; stop(): Promise<void> }`.

Unit cases (fakes, in `scripts/test-match-settlement.ts`):
1. Successful enqueue → record + settle called once, nothing buffered.
2. Record failure → buffered; settle not called; flush before due no-op; flush after due retries; success removes.
3. Settle failure after record success → not buffered (row is durable).
4. Same match enqueued twice while buffered → one buffer entry.
5. Capacity overflow → oldest dropped, `onDrop` called with its key.
6. Worker `runOnce` overlap guard: concurrent calls share one in-flight run.
7. Worker `stop` flushes once and waits for in-flight run.

### Task 6: Runtime wiring

**Files:** Modify `apps/web/src/lib/socket/game-socket.ts` (finishGame + `matchEndReason` in RoomData and RoomMatchSnapshot), `apps/web/server-runtime.ts` (start/stop worker, health stats).

Source-contract cases (in `scripts/test-match-settlement.ts`):
1. `finishGame` calls `enqueueMatchSettlement(` after `bittiAt = Date.now()` and not in the golden-score branch.
2. `resetGame` clears `matchEndReason`; `getRoomMatchSnapshot` exposes it.
3. `server-runtime.ts` starts the worker after `app.prepare` and awaits `stop()` in `shutdown` before closing Redis.
4. Health JSON includes `matchSettlements`.

### Task 7: Finalize endpoint as read/nudge

**Files:** Rewrite `apps/web/src/app/api/game/match/finalize/route.ts`; update `scripts/test-wallet-ledger-foundation.ts`, `scripts/test-admin-match-history.ts`.

Contract cases:
1. Route no longer imports `applyWalletLedgerMutation` or writes `match_results`.
2. Status table from the spec (401/403/409/404/403-denied/200/202) — exercised end to end in Task 8.
3. Ledger foundation test points at `participant-reward.ts`; admin history test asserts `match_duration_seconds` and `snapshot.room.matchFormat` there.

### Task 8: Socket end-to-end

**Files:** Create `scripts/test-match-settlement-e2e.ts` (guard `MATCH_SETTLEMENT_E2E_TEST=true`, loopback server, run against a worktree server bound to `tabu_test`).

Cases:
1. 2 registered + 2 guests play to the end; **no client finalize call**; poll DB → both rows + coins.
2. Host emits reset immediately after `oyunBitti` → still settled.
3. A registered winner disconnects before the final point → still rewarded.
4. Finalize POST after settlement → 200 same coin, repeated POSTs do not change wallet.
5. Finalize from a non-participant registered user → 403 + denied audit.
6. Finalize during an active match → 409.
7. Existing `test:late-spectator-reward` passes against the same server.

### Task 9: CI, scripts and docs

**Files:** `package.json` (scripts), `.github/workflows/ci.yml` (unit test in lint job; integration test with flag in build job), `scripts/test-web-launch-readiness.ts` (unit test entry), `docs/implement docs/remaining.md`, `docs/socket-events.md` (no event change; finalize semantics note).

- [ ] Full verification: root/web/packages typecheck, lint, unit, integration, e2e, late spectator, web launch core.
- [ ] Commit per task; push; PR to `develop` noting the stack.
