# Voice and Lobby Experience Roadmap

Decision review: 2026-09-07. Implementation update: 2026-09-08.

## Implementation status

The user approved the non-voice lobby scope. Implemented in the current worktree:
- Server-selected starting team using cryptographic randomness inside the existing
  start lock; the round-end domain rule now accepts either starting team.
- Two-sided 1.6-second reveal inside the existing preparation countdown, with
  pause and reduced-motion support. No additional countdown or separate reveal
  deadline was introduced; the existing server countdown controls visibility.
- Host-only `narrator_order` socket action in the lobby, strict payload validation,
  200ms per-socket pacing and within-team swaps of stable player records.
- Up/down controls in team sidebars, hidden during play. Team changes keep the
  existing roster position; departing lobby players lose their old position and
  rejoin through normal membership handling. Mid-game ordering is locked.
- Compact word-language select independent of UI language, with associated label.
- Collapsed game settings using native keyboard-accessible details/summary.
- New/default capacity settings are 10 per room and 5 per team. Existing persisted
  admin values are deliberately NOT overwritten; operators must select 10/5 there
  for an existing deployment. The configurable hard ceilings remain 20/10.

Verification completed:
- Web TypeScript and targeted ESLint checks.
- Domain tests for A/B starters at 2, 5 and 30 rounds, including golden score.
- Room socket security, capacity policy, system settings and encoding checks.
- Real local socket integration: four guests, non-host reorder rejected, host
  reorder accepted, identity set preserved.
- Four Playwright cases: locale persistence, announcement navigation/theme, and
  compact lobby settings with mobile/desktop overflow assertions and screenshots.

Remaining acceptance: full multi-client match/reconnect and pause/reveal visual
tests for both starters, physical mobile tests and operator capacity configuration.
Voice, team leaders and streamer integrations remain deferred. No release or PR
completion is implied by these local checks.

## Accepted: defer built-in voice

Built-in voice is deferred. Launch priorities remain core gameplay, reconnect,
mobile usability and release verification. Friends can use an external voice
application; no external voice integration is implied.

Direct P2P shifts media traffic to players but cannot meet the requirement that
players must not learn each other's IP addresses. Mandatory TURN hides peer
addresses when correctly configured, but carries media traffic and has bandwidth
cost. SFU also carries media traffic. Neither Docker nor Redis removes that cost.

If voice is revisited, prefer a separately budgeted SFU service with TURN where
needed. This is a candidate architecture, not an approved deployment. Never put
audio packets through the game Socket.IO server, Next.js handlers or Redis.
Separate media resources protect gameplay but do not eliminate hosting costs.

Required acceptance criteria for a future voice branch:
- Explicit microphone consent; optional voice, no recording by default.
- Server-authorized room membership for registered and guest identities.
- Short-lived access credentials, membership revocation and duplicate-session control.
- Atomic capacity admission, reconnect grace and per-room/global voice limits.
- No direct P2P fallback that compromises peer IP privacy when relay fails.
- No peer IP disclosure through signaling, public metadata or diagnostics.
- Media operators still see connecting IPs; do not promise universal anonymity.
- Budget/egress monitoring, packet loss and connection-success metrics.
- Capacity exhaustion disables new voice admission, not the running game.
- Test real mobile networks and devices, TURN outage, kick/rejoin, races and
  media saturation on owned infrastructure. Browser automation alone is insufficient.

References:
- https://webrtc.org/getting-started/turn-server
- https://docs.livekit.io/reference/internals/livekit-sfu/
- https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/RTCPeerConnection

## Scope record: beta capacity and simple lobby

Approved direction (see implementation status for persisted-setting caveat):
- Keep minimum two players per team; propose maximum five per team for beta.
- Ten is an upper bound, not a requirement to start with exactly ten players.
- Game capacity and future voice capacity must be independent.
- Quick setup means sensible defaults, not a new matchmaking service or game mode.
- Put advanced settings behind a disclosure rather than a mandatory setup wizard.

UI language remains a personal preference. Word-pack language is a room setting
controlled by the host in the lobby and locked during play. Show it clearly next
to category selection; filter categories by that locale. Do not silently change
room language when one participant changes UI language.
See `../guides/i18n-announcements-and-word-packs.md`.

## Scope record: starting-team reveal

Candidate branch: `feature/starting-team-reveal` (not created by this document).

- The server selects the starting team once per new match, not per reconnect.
- A short team A/B flip reveals that result; animation never decides the result.
- Persist the decision in authoritative match state with a reveal deadline.
- Duplicate start requests must not redraw; pause/reconnect must preserve result.
- Reveal once at match start. Later transitions use narrator-change messaging.
- Respect reduced motion and avoid adding another long preparation countdown.
- Audit turn progression, round completion and reward finalization for both
  starting teams; do not assume team A always starts.
- Existing clients need a compatible state contract before rollout.

## Scope record: narrator order without team leaders

Candidate branch: `feature/lobby-narrator-order` (requires separate approval).

Initially let the host reorder narrators within each team in the lobby, using
accessible up/down buttons. Do not depend on drag-and-drop on mobile.
Use stable player identities, validate the full roster/order server-side, and
lock ordering during a match. Define disconnect/reconnect and team-change behavior
before implementation. Do not change identity-based economy protection.

Defer team leaders, leader drafting and competing permissions until demand exists.
The host already supplies a simpler authority model for friend groups.

## Streamer mode remains separate

The user-owned `../stream/online-tabu-streamer-mode.md` is a design input, not shipped
functionality. Review it in a separate scoped branch: private host state versus
public overlay, platform integration, reconnect and reward policy need explicit
approval. Do not mix streamer chat scoring into normal match coin eligibility.

## Proposed sequence

1. Complete current localization/release verification and genuine blockers.
2. Approve and implement starting-team reveal with server and UI tests.
3. Approve narrator ordering and simple/advanced lobby organization separately.
4. Revisit streamer mode and built-in voice independently after launch feedback.

All candidate branch names are plans, not claims of opened or merged branches.
