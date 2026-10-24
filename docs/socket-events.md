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
