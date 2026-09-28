# Web Real-Device Smoke Preflight

## Identity

- Date: 30 July 2026
- Release SHA: `ba4c591`
- LAN origin: `http://192.168.1.3:3202`
- Decision: `PENDING_PHYSICAL_DEVICE`

## Automated Preflight

| Check | Result | Evidence |
| --- | --- | --- |
| Production build | PASS | Next.js production build completed |
| LAN HTTP readiness | PASS | HTTP 200 on the private IPv4 origin |
| HTTP smoke CSP | PASS | No `upgrade-insecure-requests` on the HTTP-only LAN origin |
| Frame protection | PASS | `X-Frame-Options: DENY` |
| Socket.IO handshake | PASS | Polling handshake returned a session and WebSocket upgrade |
| Chromium responsive matrix | PASS | 20 tests passed |
| WebKit public matrix | PASS | 8 tests passed, registered DB flow intentionally skipped |
| Multiplayer Chromium | PASS | Join, reload reconnect, start and synchronized pause |
| Multiplayer WebKit | PASS | Join, reload reconnect, start and synchronized pause |
| Temporary gameplay fixture | PASS | Idempotent prepare/status/cleanup lifecycle on `hushle_dev` |

## Physical Evidence Still Required

- iOS Safari on a physical iPhone
- Android Chrome on a physical phone
- portrait and landscape orientation
- virtual keyboard, touch, scroll and safe-area behavior
- real-device room/game synchronization
- laptop browser visual pass

This file is preflight evidence only. It does not satisfy the physical-device
release gate and must not be changed to `GO` without completed per-device
evidence files.
