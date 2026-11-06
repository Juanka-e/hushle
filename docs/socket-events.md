# Socket.IO Event Reference

## Client -> Server Events

| Event Name | Payload | Description |
| :--- | :--- | :--- |
| `room:request` | `{ kullaniciAdi: string, odaKodu?: string, guestToken?: string }` | Request to create (if no code) or join a room. ASCII event name is used to avoid encoding regressions across client and server files. |
| `takimlariKaristir` | `void` | (Admin only) Shuffles players between Team A and Team B. |
| `yoneticiligiDevret` | `{ targetPlayerId: string }` | (Admin only) Transfers room admin rights to another player. |
| `oyuncuyuAt` | `{ targetPlayerId: string }` | (Admin only) Kicks and bans a player from the room. |
| `oyun_baslat` | `{ seciliKategoriler: number[], seciliZorluklar: number[], ayarlar: RoomSettings }` | (Admin only) Starts the game with selected settings. |
| `oyun_kontrol` | `void` | (Admin only) Pauses or resumes the game timer. |
| `connection_pause:resolve` | `{ action: 'continue_without_missing' \| 'end_match' }` | During a connection pause, after the grace period (`CONNECTION_PAUSE_GRACE_SECONDS`, default 60): the host, or any online active participant while the host is offline, continues without the missing players (only if each team keeps two online players) or ends the match as `host_ended` (no coins, no win). |
| `oyunVerisi` | `{ eylem: 'dogru' | 'pas' | 'tabu' }` | Narrator sends action result for the current card. |
| `oyun_sifirla` | `void` | (Admin only) Resets the game state to lobby. |
| `takim_degistir` | `void` | Player requests to switch teams (lobby only). |
| `gorunen_ad_guncelle` | `{ displayName: string }`, ack `(response)` | Updates the caller's lobby display name. The acknowledgement is `{ ok: true, displayName }` or `{ ok: false, error, code, params? }` (same shape as an HTTP player error). |
| `kategoriAyarlariGuncelle` | `{ seciliKategoriler: number[], seciliZorluklar: number[] }` | (Admin only) Updates selected categories and difficulties in lobby. |

## Server -> Client Events

| Event Name | Payload | Description |
| :--- | :--- | :--- |
| `lobiGuncelle` | `PublicRoomData` | Broadcasts public player fields, settings, selections and server-computed `startReadiness`. Internal `userId`, identity type, username snapshot and IP are not included. |
| `kapasiteEngeli` | `{ level, retryAfterSeconds, message, code, custom? }` | Tells the requesting client that new admission is temporarily blocked. `code` is `SERVER_BUSY`; `custom: true` means `message` is the operator's capacity notice. Internal capacity totals and thresholds are not included. |
| `oyunDurumuGuncelle` | `GameState` | Broadcasts active game state (scores, timer, current card masked). `connectionPause` carries `waitingForPlayers`, `missingPlayers` (playerId, display name, team), `resolutionAvailableInSeconds` and `canContinueWithoutMissing`. |
| `oyunBasladi` | `void` | Signals that the game has started. Clients switch to game view. |
| `turGecisDurumGuncelle` | `{ oyunDurduruldu: boolean, kalanSure: number, connectionPause?: ConnectionPauseSummary | null }` | Updates state during turn transitions. Reconnect identity and continuity details remain server-side. |
| `hata` | `(message: string, meta?: { code, params?, custom? })` | Player-facing error. See "Player error codes" below. |
| `odadanAtildin` | `{ odaKodu: string }` | Sent to a player who has been kicked. |
| `kategoriAyarlariGuncellendi` | `{ seciliKategoriler, seciliZorluklar }` | Updates lobby UI when admin changes settings. |

## Player error codes

Every player-facing server error carries a stable code from
`apps/web/src/lib/errors/player-error-codes.ts`; the text lives in `dictionaries.<locale>.errors`
(`apps/web/src/lib/i18n/dictionaries.ts`), so Turkish and English players both get readable text.

- **Socket:** `hata` is emitted as `(message, { code, params?, custom? })` through
  `emitPlayerError` (`apps/web/src/lib/socket/player-error-emit.ts`). The first argument stays the
  Turkish text, so a tab left open across a deploy (which only reads the first argument) still shows
  a readable error. `params` fills `{name}` placeholders (for example `ROOM_FULL` uses `{max}`,
  `CONNECTION_DECISION_TOO_EARLY` uses `{seconds}`). `custom: true` marks operator-written text
  (maintenance or capacity notice): Turkish viewers see it as written, English viewers see the
  dictionary text for the code.
- **HTTP:** player-facing routes return `{ error, code, params? }` built by `playerError()`
  (`apps/web/src/lib/errors/player-error.ts`). `error` stays the Turkish text; rate-limit responses
  keep their `Retry-After`/rate-limit headers.
- **Clients** call `resolvePlayerErrorMessage` / `resolveApiErrorMessage`
  (`apps/web/src/lib/errors/resolve-player-error.ts`): a known code is translated in the viewer's
  locale; an unknown code falls back to the server text; an empty error falls back to the caller's
  localized fallback or `errors.UNKNOWN_ERROR`. The result is never empty.
- Codes are a wire contract: add new ones freely, never rename or reuse one. `npm run
  test:player-error-codes` checks that every emit and route error carries a code, that every code
  has Turkish and English text with matching placeholders, and that no Turkish text is ASCII-folded.
- The admin panel (`/api/admin/**`, admin pages and components) is Turkish-only and is not part of this
  contract. The same test still checks that its text is spelled with Turkish letters (no ASCII-folded
  words such as "gecersiz"), using `scripts/lib/folded-turkish.ts`.

## Player success notices

Success and status text that the server sends to players has stable codes too, from
`apps/web/src/lib/errors/player-notice-codes.ts`, with text in `dictionaries.<locale>.notices`.

- **HTTP:** success bodies spread `playerNotice()` (`apps/web/src/lib/errors/player-notice.ts`) and
  return `{ ...data, message, messageCode, messageParams? }`. `message` stays the Turkish text that
  older clients show. The field is `messageCode`, not `code`, so it never looks like an error code.
  Current notices: registration (`REGISTRATION_COMPLETE`, `REGISTRATION_VERIFY_EMAIL`), email
  verification (`EMAIL_ALREADY_VERIFIED`, `VERIFICATION_EMAIL_QUEUED`), email change
  (`EMAIL_CHANGE_VERIFICATION_QUEUED`) and password reset (`PASSWORD_RESET_REQUESTED`).
- `GET /api/payments/offers` keeps `checkout.unavailableReason` (Turkish) and adds
  `checkout.unavailableReasonCode` (`CHECKOUT_UNAVAILABLE`, an error code) for the status line.
- **Clients** call `resolveApiNoticeMessage` (`apps/web/src/lib/errors/resolve-player-notice.ts`): a
  known code is translated in the viewer's locale, an unknown code or a body without one shows the
  server text, and an empty body shows the caller's localized fallback.
- **Socket:** no server event carries success text (events send structured state), so there are no
  socket notice codes.
- `npm run test:player-error-codes` checks that player routes send no Turkish text without a code,
  that every notice code has Turkish and English text, and that the Turkish text matches what older
  clients already show.

## Joining from the home page or the dashboard

- The home page and the dashboard send `room:request` on their own socket. Once `lobiGuncelle`
  confirms the join, they hand the connected socket to the room page
  (`apps/web/src/lib/socket/room-socket-handoff.ts`) instead of disconnecting it.
- The room page continues on that socket and sends `room:request` again for the room state; the
  server treats it as a reconnect of the same socket. The player never shows offline in between,
  so a host who starts during the navigation is not refused with `NOT_ENOUGH_PLAYERS`.
- A socket the room page does not pick up within 30 seconds, or that joined another room, is closed.
- `npm run test:room-socket-handoff` covers these rules; `tests/room-join-handoff.spec.ts` checks in
  a browser that the host never sees the guest offline and can start at that moment.

## March 9, 2026 Regression Note

- Guest room creation/join was broken because the custom Socket.IO middleware in `server.ts` rejected unauthenticated sockets.
- Authenticated full-page dashboard room creation was also broken because the dashboard client emitted a different room-request event name than the socket server expected.
- The fix keeps guest sockets allowed at handshake time and standardizes room create/join onto the ASCII event name `room:request`.
- Current room controls also use ASCII event names. The server temporarily keeps
  exact legacy aliases for old clients, but new clients must not emit them.

## Streamer mode

Stream sessions use the same Socket.IO server (default namespace, path `/api/socketio`). The
owner's panel joins the host room `streamer:host:<sessionId>`, which carries the secret card; the
stream screen joins the public room `streamer:public:<sessionId>` with its view key and never
receives the word or its taboos while a round is open. Payloads are checked with strict zod
schemas (a wrong value or an unknown key is `INVALID_REQUEST`). Every event takes an optional ack,
answered `{ ok: true, ... }` or `{ ok: false, error, code }`; without an ack a failure arrives as
`hata`. A socket is in at most one host room and one public room: joining another leaves the
previous one. Unexpected failures answer `UNKNOWN_ERROR`. Handlers live in
`apps/web/src/lib/socket/streamer-socket.ts`; event names and ack types for clients in
`apps/web/src/lib/streamer/socket-contract.ts`.

### Streamer client -> server events

| Event Name | Payload | Ack | Error codes |
| :--- | :--- | :--- | :--- |
| `streamer:host:join` | `{ sessionId: uuid }` | `{ ok: true, state: HostStreamSnapshot }` | `AUTH_REQUIRED` (no signed-in user, or a suspended one), `STREAMER_MODE_DISABLED` (streamer mode is off), `STREAMER_SESSION_NOT_FOUND` (no live session), `STREAMER_SESSION_NOT_OWNED`, `INVALID_REQUEST`, `RATE_LIMITED` (10 joins / 10 s per socket) |
| `streamer:host:start`, `streamer:host:pause`, `streamer:host:resume`, `streamer:host:pass`, `streamer:host:next` | none | `{ ok: true }` | `STREAMER_ACTION_INVALID_PHASE`, `STREAMER_WORD_POOL_EMPTY` (start, pass, next), `SERVER_BUSY` (start, pass, next: the word draw did not answer within 9.5 s; nothing changed, try again), `STREAMER_SESSION_NOT_FOUND` (no host room joined, or the session ended), `STREAMER_MODE_DISABLED`, `RATE_LIMITED`, `INVALID_REQUEST` |
| `streamer:host:end` | none or `{ reason?: "ended" }` | `{ ok: true }` | `STREAMER_SESSION_NOT_FOUND`, `RATE_LIMITED`, `INVALID_REQUEST`, `SERVER_BUSY` (a pending action held the session past 10 s; the end still runs in its turn); never refused for streamer mode: the owner can always take the stream off the air |
| `streamer:host:settings` | `{ theme?, camera?, cameraSize?, clock?, cardBack?: { itemId } \| null, showCardName? }`, at least one key | `{ ok: true }` | `INVALID_REQUEST`, `STREAMER_CARD_NOT_ALLOWED` (not owned and not in the showcase), `STREAMER_CARD_CATALOGUE_UNAVAILABLE`, `STREAMER_SESSION_NOT_FOUND`, `STREAMER_MODE_DISABLED`, `RATE_LIMITED` |
| `streamer:host:rotate-key` | none | `{ ok: true, viewKey }`: the only place the new key is sent | `STREAMER_SESSION_NOT_FOUND` (also when the session ended while the new key was stored), `RATE_LIMITED` (the host-action burst, then the `streamer-view-key` bucket: 10 / 15 min per user, shared with `POST /api/streamer/sessions/current/view-key`), `SERVER_BUSY` (the database did not store the key within 10 s; the old key stays valid, try again), `STREAMER_MODE_DISABLED` |
| `streamer:public:join` | `{ viewKey: string(43) }` | `{ ok: true, state: PublicStreamSnapshot }` | `STREAMER_VIEW_KEY_INVALID` (unknown, rotated or ended key, an interrupted session, or streamer mode off), `RATE_LIMITED` (`streamer-public-join`, 30 / 60 s per IP), `INVALID_REQUEST` |

Host actions (every `streamer:host:*` event but the join) share a burst limit of
10 per 10 s per socket and, once the socket joined a host room, 10 per 10 s per user (a second
tab of the owner shares it); they act only on the host room this socket joined, and ownership is
checked again on each one. While an admin has streamer mode off, host joins and every host action
but `streamer:host:end` answer `STREAMER_MODE_DISABLED`, and public joins the same
opaque `STREAMER_VIEW_KEY_INVALID` as a wrong key. The switch is read from its stored row
(cached 5 s): while the database does not answer it is unknown, and unknown refuses nothing and
stops nothing.
A successful host join also puts the socket in its user's session room (`private:user-session:<userId>`),
so a password reset or an email change disconnects it, as it does game sockets.

### Streamer server -> client events

| Event Name | Room | Payload | Description |
| :--- | :--- | :--- | :--- |
| `streamer:host:state` | host | `HostStreamSnapshot` | Every state change, with the card (`card: { wordId, target, taboos }`), the tolerance and the full ranking. |
| `streamer:public:state` | public | `PublicStreamSnapshot` (schema 4) | Every state change without the card; `reveal` carries the word only once the round is finished. A server guard checks the JSON actually sent and drops any public state that has a host-only field, an early reveal, or a value equal to the live word or one of its taboos once folded (normal tolerance); fields are matched by path segment, and names, fixed values such as the theme and card-back hex colours are not compared; the passed card's word is compared with the live word only. A blocked state is reported once per session, round and rule. |
| `streamer:ended` | host and public | `{ reason: "ended" \| "idle" \| "interrupted" \| "stopped" }` | The session ended: `ended` by the host or the end route, `idle` after 6 h without activity, `interrupted` when the server shuts down (sent before the sockets close; the row is interrupted), `stopped` when an admin switches streamer mode off (checked every 15 s) or suspends the owner (the row is ended with its summary). Both rooms are emptied after it. |
| `streamer:ended` | public | `{ reason: "view-key-rotated" }` | The view key was rotated: the old stream screens leave the room; the host room stays. |
| `streamer:host:notice` | host | `{ kind: "connection-needs-reconnect", platform: "twitch" \| "kick" }` | The hourly check of the session's channel link found it no longer valid (the link is now `needs_reconnect`): the session keeps running, a new one needs a reconnect. Sent once until the link is valid again; transient platform errors send nothing. |
| `hata` | caller | `(message, { code })` | A failed streamer event sent without an ack, or `ORIGIN_REJECTED` just before the disconnect. |

Every `streamer:ended` reason means the view key is dead. `npm run test:streamer-socket-integration`
covers these rules.
