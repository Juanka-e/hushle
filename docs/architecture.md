# Backend Socket Architecture

## Overview
The real-time game logic is handled by a custom Socket.IO server integrated with Next.js. The core logic resides in `apps/web/src/lib/socket/game-socket.ts`.

## Repo Direction

The current production code still runs as one Next.js + Socket.IO runtime.

The accepted medium-term direction is a modular monolith with explicit workspace targets:

- `apps/web`
- `apps/api`
- `apps/jobs`

Physical runtime splitting is intentionally deferred until shared domain and platform code is extracted behind `packages/` boundaries.

See:

- `docs/architecture/adr-001-apps-workspace-and-runtime-split.md`
- `docs/architecture/adr-002-platform-package-boundaries.md`
- `docs/architecture/apps-migration-plan.md`

## Key Components

### Localization and content-language boundary

UI locale is a client preference persisted in the `hushle_locale` cookie and
local storage. Room word locale is server-authoritative state and must not be
derived from an individual player's UI preference. Announcement translations
use a normalized child table; word and category packs use locale-scoped rows.
See `docs/guides/i18n-announcements-and-word-packs.md`.

### 1. GameSocket (`apps/web/src/lib/socket/game-socket.ts`)
This file exports `setupGameSocket(io, roomOwnership)`, which initializes the
socket event listeners with an explicit room ownership coordinator.

*   **State Management:**
    *   `rooms`: A `Map<string, RoomData>` storing the state of all active game rooms.
    *   `socketToRoom`: A `Map<socketId, roomCode>` reverse index enabling **O(1)** room lookup by socket ID (avoids iterating all rooms on every event).
    *   `wordActionTimestamps`: Tracks player actions to prevent spam.
    *   `roomJoinAttempts`: Rate limiting for room creation/joining.

*   **Room Structure (`RoomData`):**
    *   `odaKodu`: Unique 6-character room code.
    *   `creatorId`: The **socket ID** of the current room host. Used for permission checks.
    *   `creatorPlayerId`: The **persistent Player ID** (UUID) of the room creator. Used to restore `creatorId` upon reconnection.
    *   `oyuncular`: List of players in the room.
    *   `oyunDurumu`: Current game state (scores, turn, timer, etc.).
    *   `banList`: Set of banned player IDs and IPs.

### 2. Connection Handling
*   **Connection:** When a client connects, they are assigned a socket ID.
*   **Identification (`odaİsteği`):**
    *   Clients send `kullaniciAdi` and `odaKodu` (optional).
    *   **Authentication:** The Socket.IO middleware securely assigns a persistent `socket.data.userId` from the HttpOnly NextAuth session token (`token.sub`).
    *   **Admin Persistence:** If the `socket.data.userId` matches `creatorPlayerId`, the room's `creatorId` is updated to the new `socket.id`, preserving admin privileges without relying on vulnerable local storage.
    *   **Lobby Disconnection (F5 Bug Fix):** If a player disconnects while the game is NOT active (i.e. still in the Lobby), their record is immediately **deleted** from the room's `oyuncular` array. This ensures that a page refresh (F5) does not leave ghost sessions piling up in the UI, and the player simply rejoins cleanly. If the game is active, they are only marked as `online: false` to allow reconnection to their current score.

### 3. Game Loop
*   **Timer:** A `setInterval` runs on the server for each room to handle turn limits and state transitions.
*   **State Updates:** Game state changes are broadcast to all room members via `oyunDurumuGuncelle` and `lobiGuncelle`.

### 4. Room Ownership Boundary
*   Room state and timers remain process-local.
*   Optional Redis leases prevent two instances from successfully creating the
    same room code.
*   Lease renew and release are token-checked; stale instances cannot delete a
    replacement owner's lease.
*   Ownership is currently enforced only during room creation. Routing,
    cross-instance commands and restart recovery are not implemented, so realtime
    replica count must remain one.
*   Join requests now resolve a server-only owner-aware route decision. Remote
    owner and state mismatch decisions are rejected with a generic player message;
    instance ids are not returned by the decision contract or sent to the client.
*   This resolver is not traffic routing. A gateway/load-balancer contract or
    cross-instance command proxy is still required before adding replicas.

### 5. Security & Protections
*   **WebSocket Authentication:** The `server.ts` utilizes a Socket.IO middleware that checks for a valid `next-auth/jwt` session token. Unauthorized (not logged in) connections are immediately rejected.
*   **Identity Anti-Spoofing & Ban Enforcement:** Room permissions and bans are strictly enforced using the `user.id` from the NextAuth JWT. There is zero reliance on `localStorage`, making identity theft and ban-evasion via storage wiping impossible.
*   **XSS & Clickjacking Prevention:** 
    *   `DOMPurify` is used whenever user-supplied HTML is rendered via `dangerouslySetInnerHTML`.
    *   `next.config.ts` enforces modern HTTP security headers including `Content-Security-Policy`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, and `X-Content-Type-Options: nosniff`.
*   **Rate Limiting & DDOS Protection:**
    *   **Room Joins:** Rate limited (`ROOM_JOIN_MAX_ATTEMPTS` per `ROOM_JOIN_WINDOW_MS`) to prevent connection flooding.
    *   **Word Actions:** A dual-layer cooldown (`WORD_ACTION_COOLDOWN_MS = 500`) prevents users from spamming card actions at both the socket and shared-room levels.
    *   **Word Pool Priming:** A concurrency mutex (`primingLocks`) in `word-service.ts` prevents "cache stampede" scenarios.
*   **IP Spoofing Protection:** The `getClientIp` function relies on the `x-forwarded-for` header securely toggled via the `TRUST_PROXY=true` environment variable.

## 5. Persistence Strategy & Authentication
The real-time and application-wide persistence is managed through a combination of NextAuth sessions and Socket.IO identifiers.

*   **NextAuth Session (JWT):** NextAuth handles user login via Credentials. We support two login flows:
    *   **Registered Users:** Validated against the Prisma `User` table, passing their DB role (`admin` or `user`) to the Session token.
    *   **Guest Users:** Validated via a custom `guest-login` provider generating a securely randomized, non-persisted `guest_${crypto.randomUUID()}` ID.
*   **Socket.IO Verification:** The `server.ts` uses NextAuth's `getToken` middleware to intercept every socket connection and map the trusted `token.sub` to `socket.data.userId`.
*   **Game State Persistence:** We establish a persistent `playerId` attribute across reconnects explicitly through the trusted `socket.data.userId`. `localStorage` is no longer used for maintaining the core `playerId` references, guaranteeing an architecturally sound session binding resistant to tampering.
