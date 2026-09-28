# ADR-003: Single Realtime Writer Topology

Status: Accepted

## Context

The production runtime currently consists of one combined Next.js and Socket.IO
`app` container behind one Nginx upstream. Authoritative rooms, timers, turn
state, and active match state are held in process memory.

Redis foundations exist for Socket.IO fan-out and room ownership leases, but
they do not move authoritative room state out of the process and do not forward
commands to the room owner. Running multiple app replicas would therefore allow
clients from the same room to reach processes with different room state.

## Decision

Production uses one realtime writer:

- `REALTIME_TOPOLOGY=single-writer`
- `REALTIME_REPLICA_COUNT=1`
- Nginx has one `app:3000` upstream
- Socket.IO keeps WebSocket and HTTP polling enabled by default
- sticky sessions are not required while there is only one upstream
- the Redis adapter and ownership leases remain disabled by default

The runtime rejects unsupported topology names and any declared replica count
other than one. `REALTIME_REPLICA_COUNT` is a deployment contract, not service
discovery; orchestration and monitoring must still ensure that only one app
replica is running.

## Consequences

- Current room behavior remains deterministic and easy to operate.
- Redis may still serve cache, counters, capacity heartbeats, and coordination.
- Enabling the Socket.IO Redis adapter alone does not make scaling safe.
- Horizontal app scaling is intentionally blocked until room routing and
  recovery are production-ready.
- The single app instance is a realtime availability boundary. Container
  restart recovery recreates the runtime but does not restore active matches.

## Multi-instance Migration Gate

Before increasing realtime replicas:

1. Choose and document the target topology: owner-aware gateway/command proxy,
   or another design that preserves one authoritative writer per room.
2. Assign every realtime process a unique, stable `INSTANCE_ID`.
3. If polling remains enabled, configure and verify load-balancer affinity. If
   WebSocket-only is chosen, complete browser, proxy, reconnect, and mobile
   compatibility tests first.
4. Enable and load-test the Socket.IO Redis adapter.
5. Enable room ownership leases and alert on conflicts or lost ownership.
6. Implement actual command forwarding to the owning process; observe-and-reject
   routing is not sufficient.
7. Define room recovery or explicit match-loss behavior after owner failure.
8. Run multi-instance reconnect, failover, rolling deploy, and load tests.
9. Replace this ADR and runtime guard only after those checks are accepted.
