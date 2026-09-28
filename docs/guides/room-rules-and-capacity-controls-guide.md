# Room Rules And Capacity Controls

> Status: implemented on `feature/room-rules-and-capacity-controls`
> Last updated: 28 July 2026

## Goals

- Keep a single room bounded without making small friend groups unable to play.
- Prevent registered-account reward abuse without requiring a participation percentage at launch.
- Let operations reduce capacity without deploying code.
- Preserve existing games and reconnects during load shedding.
- Use Redis for disposable cluster coordination while keeping persistent settings in MySQL.

## Room And Team Limits

- Code hard limit: 20 online players per room.
- Code hard limit: 10 active players per team.
- Admin defaults: 12 online players per room and 6 per team.
- Spectators count toward the room limit but not the team limit.
- The sum of both team capacities must cover the configured room capacity.
- Lowering a limit never removes a player already in a room.
- New joins and team changes use the latest setting.
- Reconnecting players bypass new-admission blocks so an active game is not broken.

The hard limits are not configurable. The admin values can only make them stricter.

## Start Rules

- Every room requires at least 4 active players, regardless of identity type.
- Both teams must contain at least 2 active players so the narrator has a teammate who can guess.
- Offline players and spectators do not count.
- No minimum participation percentage is enforced at launch.

The rule is evaluated from the active match roster, not from old or disconnected
room entries. A future 1v1 mode may define a separate role rotation, but the current
Tabu mode does not permit 1v1 play.

## Match Roster And Rewards

The server captures an immutable participant snapshot when the match starts:

- persistent player id
- user id when registered
- identity type
- username snapshot
- display name snapshot
- team at start
- role at start

Late joins during an active game are spectators. They are excluded from the snapshot
and cannot receive the match reward. Reward eligibility also rejects a spectator role
as defense in depth. A failed or unfinished match has no valid completion timestamp
and cannot be finalized for a reward.

This design keeps reward identity attached to `userId` and persistent player identity.
Changing lobby display names does not reset economy guard history.

## Admission Modes

Settings are managed under Admin > System Settings > Capacity.

- `automatic`: warning and critical thresholds control admission.
- `open`: thresholds are bypassed, but hard room/player limits still apply.
- `closed`: new room creation and new joins are closed.

Automatic behavior:

- warning threshold: create and join stay open; admin health shows warning.
- critical threshold: new room creation closes; joins to existing rooms stay open.
- maximum active rooms: new room creation closes; existing rooms can still fill.
- maximum online players: new creation and joins close.

The player-facing response is intentionally generic. Internal counts and thresholds
are only returned by the admin health endpoint.

## Redis Capacity Heartbeat

Each realtime instance publishes a 30-second TTL snapshot every 10 seconds and after
important room-state changes.

Keys use `REDIS_KEY_PREFIX`:

- `<prefix>:capacity:instances`
- `<prefix>:capacity:instance:<INSTANCE_ID>`

The snapshot includes:

- active rooms and matches
- online players and spectators
- connected sockets
- RSS and heap usage
- event-loop lag

Cluster reads use `MGET` when supported. The current process always replaces its own
stored heartbeat with its fresher local metrics, preventing local stale reads and
double counting. Missing or malformed instance keys are removed from the registry.

If Redis is unavailable, the application falls back to local metrics. This preserves
playability but means admission reflects only the current process until Redis returns.

## Scale Boundary

Capacity heartbeat is a load-shedding signal, not an atomic global seat reservation.
Remote instance metrics can be up to one heartbeat interval old. The warning and
critical headroom reduces overshoot, while exact per-room limits remain enforced by
the room-owning process.

Before multiple realtime writers own the same room:

- Socket.IO Redis adapter event fan-out foundation is implemented, default off
- create-only single-writer Redis lease foundation is implemented, default off
- owner-aware join decision and anomaly metrics are implemented
- add gateway routing or command forwarding plus restart recovery
- add atomic global admission reservations only if production load proves necessary
- load test reconnect, host handoff, duplicate join, and reward finalization

Do not move wallet balances, match results, audit records, or system settings truth
into Redis.

## Operations Checklist

1. Keep `warningThresholdPercent` below `criticalThresholdPercent`.
2. Keep `teamMaxPlayers * 2 >= roomMaxPlayers`.
3. Confirm Redis is available in the admin capacity card.
4. Verify reconnect works while admission mode is `closed`.
5. Verify two active players cannot start, including a guest-only A/B pair.
6. Verify four active players arranged 2+2 can start.
7. Verify a late join during a match is a spectator and receives no reward.
8. Verify lowering room/team limits does not remove existing players.

Automated load and manual admin scenarios are maintained in:

- `docs/guides/room-capacity-load-validation-checklist.md`
- `npm run test:room-ownership`
- `ROOM_OWNERSHIP_REDIS_TEST=true npm run test:room-ownership-redis`
- `npm run test:room-routing`
