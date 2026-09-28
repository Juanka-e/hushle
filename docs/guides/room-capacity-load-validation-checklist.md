# Room Capacity Load Validation Checklist

> Last updated: 28 July 2026
> Target: launch-preparation validation

## Automated Validation

Start the application with isolated local infrastructure:

```powershell
npm run infra:up
$env:PORT="3101"
$env:HOST="127.0.0.1"
$env:DATABASE_URL="mysql://hushle:hushle@127.0.0.1:3307/hushle_dev"
$env:REDIS_URL="redis://127.0.0.1:6381"
$env:REDIS_KEY_PREFIX="hushle:test:capacity-load"
$env:RATE_LIMIT_ENABLED="false"
npm run dev
```

Run the parallel room load test from a second terminal:

```powershell
$env:SOCKET_TEST_URL="http://127.0.0.1:3101"
$env:ROOM_CAPACITY_TEST_EXPECTED_MAX="12"
$env:ROOM_CAPACITY_TEST_EXPECTED_TEAM_MAX="6"
$env:ROOM_CAPACITY_TEST_CANDIDATES="24"
npm run test:room-capacity-load
```

The test verifies:

- concurrent candidates never exceed the configured room limit
- overflow sockets receive a room-full error
- both teams remain balanced and within team capacity
- full-room reconnect keeps the same guest `playerId`
- reconnect does not create a duplicate room player
- a new outsider is still rejected after reconnect
- lobby payloads do not expose user id, identity type, username snapshot, or IP

The values must match the capacity settings loaded by the test server. The script does
not mutate MySQL settings.

## Recorded Baseline

Local Windows and Docker validation on 28 July 2026:

- 24 concurrent candidates
- 12 admitted
- 12 rejected
- 10 consecutive successful runs
- observed parallel join completion: 42-70 ms
- reconnect preserved persistent guest identity in every run

This is a correctness baseline, not a production capacity benchmark.

### Four-player Start Rule

The test creates and removes a temporary registered user:

```powershell
$env:SOCKET_TEST_URL="http://127.0.0.1:3101"
$env:DATABASE_URL="mysql://hushle:hushle@127.0.0.1:3307/hushle_dev"
npm run test:room-registered-start-rule
```

It verifies that three active players cannot start, four active players arranged
2+2 pass the start guard, and the next server validation is category selection.

### Closed Admission And Reconnect

This test temporarily writes system settings. It is restricted to a loopback URL,
requires an explicit mutation gate, restores the original API settings and raw MySQL
rows, and removes its temporary admin and audit records:

```powershell
$env:SOCKET_TEST_URL="http://127.0.0.1:3101"
$env:DATABASE_URL="mysql://hushle:hushle@127.0.0.1:3307/hushle_dev"
$env:CAPACITY_ADMISSION_MUTATION_TEST="true"
npm run test:room-admission-closed
```

It verifies that `closed` blocks new create/join requests immediately while an
existing guest reconnect keeps the same persistent player identity. The same test
also verifies live room/team limit lowering, admission resuming after limits are
raised, Redis-backed capacity metrics, and `warning`, `critical`, and `closed`
admin health decisions.

### Late Spectator Reward

The test creates and removes a temporary registered user, category, word, denied
audit record, and any unexpected reward records:

```powershell
$env:SOCKET_TEST_URL="http://127.0.0.1:3101"
$env:DATABASE_URL="mysql://hushle:hushle@127.0.0.1:3307/hushle_dev"
$env:LATE_SPECTATOR_REWARD_TEST="true"
npm run test:late-spectator-reward
```

It starts and finishes a real guest match, joins the registered user after the
participant snapshot is frozen, and verifies `403`, no match result, no coin
change, and a denied finalize audit.

## Manual Admin Scenarios

### Admin Health Visual State

1. Confirm the capacity card reports Redis as available.
2. Confirm room, player, match, spectator, socket, memory, and event-loop values update.
3. Confirm normal, warning, critical, and closed states remain readable on desktop and mobile.
4. Confirm long capacity messages do not overflow the card.

## Failure Rules

- Do not merge if admitted players exceed the configured room limit.
- Do not merge if reconnect creates a second persistent player.
- Do not merge if an overflow socket receives lobby state after rejection.
- Do not merge if spectator finalize writes coin.
- Do not merge if the admin API replaces live Socket.IO metrics with zero values.
- Do not tune production limits from local latency numbers alone.
