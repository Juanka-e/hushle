# Cache And Storage Strategy

> Status: working architecture note
> Last updated: 18 April 2026

## Goal
- Keep MySQL as the source of truth.
- Use Redis or Valkey only for fast, disposable, coordination-oriented data.
- Avoid mixing persistent business records with cache or realtime state.
- Define a repeatable rule for future features so every new module does not invent its own cache/storage behavior.

## Core Rule
- If losing the data would break accounting, audit, support history, user ownership, or legal traceability, it belongs in MySQL.
- If losing the data should only cause a cache miss, a retry, a recomputation, or a temporary performance drop, it can live in Redis/Valkey.

## Source-Of-Truth Rule
- MySQL answers: "what is true?"
- Redis/Valkey answers: "what is fast right now?"

Redis/Valkey must never become the only place where the business truth exists.

## MySQL Responsibilities
- users
- sessions and identity-linked records
- email fields and verification timestamps
- moderation records
- audit logs
- support tickets and support messages
- notifications
- wallet balances
- wallet adjustments
- purchases
- promotions, discount campaigns, coupons
- coin grant campaigns, codes, claims
- system settings persisted state
- future progression records
- future payment orders / ledger / settlements

## Redis Or Valkey Responsibilities
- system settings cache
- rate limiting counters
- notification unread counters or short-lived notification cache
- support queue counters
- captcha / abuse / gateway transient counters
- short TTL locks
- idempotency helpers
- cache invalidation fan-out
- future websocket adapter state
- future room presence / ephemeral coordination state
- realtime instance capacity heartbeat and load-shedding summaries

## Current Pre-Redis Optimizations Already In Place

Redis gelmeden once de bazi yukleri dusurecek process-local optimizasyonlar alinabilir.

Bugun aktif olan mantik:

1. in-memory registered room index
- registered kullanici icin `userId -> roomCode` process-local index tutulur
- bu sayede "zaten odada misin?" kontrolu tum odalari taramadan O(1) lookup ile yapilir
- bu, tek instance veya local development icin yeterli ve ucuzdur

2. same-browser cross-tab presence heartbeat
- ayni browser'da room acik sekme kisa aralikli `localStorage` heartbeat yazar
- dashboard sekmesi yeni oda acmadan once bunu okuyup aninda bloklayabilir
- network, DB veya server maliyeti yoktur

3. server-side room state fallback
- farkli browser veya cihaz senaryosunda `localStorage` paylasilmaz
- bu durumda socket room state icindeki registered user index devreye girer

Bu model bugunku tek-instance yapida yeterlidir.
Multi-instance veya Redis adapter asamasinda bu index process-local olmaktan cikarilip shared coordination katmanina tasinmalidir.

## Application-Side Optimization Notes

Redis/Valkey tek basina yeterli degildir. Uygulama tarafinda da gereksiz tekrar fetch'i azaltmak gerekir.

Erken uygulanabilecek kurallar:

1. event-driven local sync
- kullanici `displayName`, coin, unread count gibi kucuk state degisikliklerinde paneli yeniden fetch etmeden local state guncellenmeli
- ayni tab icinde `storage` yetmedigi icin custom event veya state store kullanilabilir

2. panel-on-open fetch
- dashboard / support / notifications gibi ikincil paneller her render'da degil, panel acildiginda veya ilgili event tetiklenince fetch etmeli

3. short-lived client cache
- cok hizli arka arkaya acilan paneller icin 15-30 saniyelik istemci cache veya SWR dedup mantigi uygulanabilir
- bu ozellikle `user/dashboard`, `user/me`, `notifications/unread-count`, `store/catalog` icin uygundur

4. targeted invalidation
- genel "her seyi yeniden cek" modeli yerine:
  - wallet degisti -> wallet summary invalidate
  - inventory degisti -> inventory ve cosmetic preview invalidate
  - displayName degisti -> identity surfaces local update

5. loading UX ayirma
- her kisa fetch icin tam sayfa yenileniyormus hissi vermemek gerekir
- local optimistic update + background revalidate tercih edilmelidir

Bu kurallar Redis gelmeden once bile faydalidir. Redis geldiginde de cache verimi bu sayede artar.

## What Must Not Move Out Of MySQL
- wallet source of truth
- purchase history
- coin grant claims
- support message history
- audit logs
- system settings persisted values
- any record needed for reconciliation, refunds, moderation, or legal traceability

## Decision Framework For Future Features
When a new feature is added, use this order:

1. Does the record need to survive a Redis flush or process restart?
- yes -> MySQL
- no -> continue

2. Would data loss create user-visible ownership/accounting inconsistency?
- yes -> MySQL
- no -> continue

3. Is the value derived from MySQL and cheap enough to recompute?
- yes -> cache is optional
- no -> Redis/Valkey cache is a good candidate

4. Is the data coordination-oriented across multiple Node processes?
- yes -> Redis/Valkey
- no -> process memory may still be acceptable in development

## Feature Decision Examples

### Good Redis/Valkey Candidates
- login/register brute-force counters
- support reply cooldown counters
- coin redeem abuse counters
- system settings cache
- notification unread count cache
- short-lived room join locks
- websocket fan-out/pub-sub

### Good MySQL Candidates
- support ticket message bodies
- wallet balances and wallet adjustments
- purchase/order history
- notification records themselves
- coin grant claim history
- audit events

### Maybe / Case-By-Case
- unread counts
  - truth in MySQL
  - cached count in Redis/Valkey
- current room snapshot
  - persistent match summary in MySQL if needed
  - active ephemeral room coordination in Redis/Valkey

## Development Strategy
- Local machine can run Redis or Valkey safely before server deployment.
- Development should still support fallback without Redis when practical.
- Preferred model:
  - dev without Redis: memory fallback works
  - dev with Redis/Valkey: used for realistic integration testing
  - prod: managed or self-hosted Redis/Valkey

This means local development is not blocked, but production architecture is still modeled correctly.

## PM2 Strategy

### What PM2 Solves
- uses multiple CPU cores
- keeps HTTP/API workload from being pinned to one Node process
- gives restart supervision
- improves resilience for standard request/response traffic

### What PM2 Does Not Solve By Itself
- shared cache
- shared rate limits
- shared websocket room state
- cross-process timers and ephemeral locks

If the app runs with `pm2 max`, two users of the same room can land on different Node processes.
Without shared realtime coordination, each process sees a different in-memory room map.

That breaks:
- room membership consistency
- lobby updates
- host/admin transfer logic
- reconnect flows
- timers

## Safe Production Options For Realtime

### Option A: single realtime process
- Keep one dedicated Socket.IO process for realtime room state.
- Scale the web app separately.
- Simpler operationally.
- Best early production choice if room concurrency is still moderate.

### Option B: Redis adapter + shared coordination
- Use Socket.IO Redis adapter or equivalent Redis-compatible adapter.
- Move ephemeral room coordination signals into Redis-backed infrastructure.
- More scalable, but more complex.
- Better once real concurrent room load and PM2 multi-instance become normal.

### Current Socket.IO Redis Adapter Boundary

Redis adapter foundation is implemented but disabled by default:

- `SOCKET_IO_REDIS_ADAPTER_ENABLED=false` keeps the single-runtime behavior.
- Explicit enablement requires `REDIS_URL`; startup fails instead of silently
  falling back to a process-local adapter.
- Publisher and subscriber use dedicated Redis connections because a subscribed
  connection cannot be reused as a general cache client.
- `/api/health` reports adapter enablement, availability, sticky-session
  declaration, room-state backend and `multiInstanceReady`.
- The integration test starts two Socket.IO runtimes and verifies cross-instance
  room fan-out through Redis.
- The room ownership lease foundation is also implemented but disabled by default.
  When enabled, room creation claims a token-protected Redis lease before the room
  becomes visible in process memory.
- A single runtime heartbeat renews all locally tracked leases. Release and renew
  use compare-by-token Lua scripts, so a stale process cannot modify a new owner's
  lease.
- Lease conflicts, lost leases, renew failures and current ownership counts are
  reported under `/api/health`. Enabled-but-unavailable ownership reports
  `status: degraded` without terminating active matches.
- Once a runtime observes a different owner, its local lease stays terminally
  `lost`; it cannot become a zombie owner by reclaiming the key later.
- Owner-aware route resolution is implemented on room join. It distinguishes
  local, missing, remote-owner, local-state-missing, ownership-mismatch and Redis
  unavailable decisions.
- Remote owner ids are consumed only inside the resolver and are not returned in
  its decision contract. Until a gateway can route a socket to its owner, remote
  and inconsistent joins receive one generic temporary error rather than a fake
  reconnect loop.
- Redis lookup failure does not reject a join when the room is already present
  locally. Existing single-instance playability remains the priority.

This foundation does not make realtime multi-instance safe. Authoritative room
maps, turn timers, host transfer and registered-user room indexes still live in
the owning process. Polling transport also needs load-balancer affinity. Therefore:

- production topology is explicitly `single-writer`; see
  `docs/architecture/adr-003-single-realtime-writer-topology.md`
- keep `REALTIME_REPLICA_COUNT=1`; startup rejects any other declared count
- keep `multiInstanceReady=false`
- do not treat adapter availability as room-state availability
- set `SOCKET_IO_STICKY_SESSIONS_CONFIGURED=true` only after affinity is actually
  configured at the load balancer
- treat the replica count env as a deployment contract, not runtime discovery;
  orchestration and monitoring must still enforce one app replica

Before increasing realtime replicas:

1. Choose an owner-aware gateway/command proxy or another single-writer-per-room
   topology.
2. Give every realtime process a unique and stable `INSTANCE_ID`.
3. Add sticky sessions for Socket.IO polling or intentionally remove polling
   after compatibility tests.
4. Enable and load-test the Redis adapter and ownership leases.
5. Route cross-instance room commands to the owner or move authoritative room
   state behind a concurrency-safe shared state machine.
6. Define reconnect, owner restart, timer recovery and split-brain behavior.
7. Pass multi-instance reconnect, rolling deploy, failover and load tests before
   replacing the startup guard.

## Recommended Realtime Direction
- Early production:
  - single realtime process is acceptable
  - web app can scale more independently
- When concurrent room load grows:
  - introduce Redis/Valkey adapter
  - introduce shared ephemeral coordination
  - stop relying on process-local room truth

## System Settings Strategy
- Persist settings in MySQL `system_settings`.
- Read through the shared Redis/Valkey JSON cache with a `15s` TTL.
- Admin updates commit to MySQL first and then await shared cache invalidation.
- Redis/Valkey outages use the bounded process-memory fallback. Different instances
  can temporarily disagree for at most the cache TTL while Redis is unavailable.
- Redis flush or cache loss only causes a MySQL reload; MySQL remains the source of truth.
- Provider secret keys stay in environment variables and are never stored in this cache.
- The Socket.IO room metrics provider also uses a process-global registration so
  Next admin routes read the live local counters instead of a bundle-local zero
  fallback. Multi-instance aggregation remains Redis heartbeat based.

## Dashboard And Player Surface Strategy

Bugunku yapida dashboard, inventory, shop ve notifications panelleri istemci fetch ile guncellenir.

Erken buyume icin bu kabul edilebilir.
Ama oyuncu sayisi ve panel kullanim yogunlugu artarsa su model uygulanmalidir:

### App-side
- `tabu:display-name-updated` benzeri custom event'lerle same-tab sync
- local optimistic profile update
- panel bazli fetch yerine hedefli refetch

### Backend-side
- `user/dashboard` kisa TTL cache
- `store/catalog` kisa TTL cache
- `notifications/unread-count` Redis counter
- support queue / unread summary counter

### Invalidation
- profile update -> identity cache bust
- wallet change -> dashboard summary bust
- store publish / catalog update -> catalog cache bust
- notification write/read -> unread counter refresh

Bu model oyunun ana socket loop'unu fetch baskisindan ayri tutar ve ikincil yuzeyleri daha ucuz hale getirir.

## Current Shared JSON Cache Foundation

Implemented in `@hushle/platform-cache`:

- Redis-first JSON read-through cache
- bounded process-memory fallback when Redis is unavailable
- process-local single-flight loading to prevent duplicate DB work
- corrupt JSON eviction and loader recovery
- explicit key invalidation
- hit, miss, load, coalescing, error and invalidation metrics
- `CACHE_MEMORY_MAX_ENTRIES` bound, default `500`

Current application consumers:

- visible category tree, TTL `60s`
- admin dashboard static word/category counters, TTL `10s`
- system settings, TTL `15s`
- shared store catalog snapshot, TTL `30s`
- per-user notification unread count, TTL `10s`
- per-user dashboard match summary, TTL `30s`

The admin dashboard keeps room and online-player metrics outside the cached static
payload. Those values are read live on every request. Category and word mutations
await targeted invalidation before returning success.

Cache telemetry is available through the authenticated capacity health API and the
Integration Hub. Redis flush or cache loss must only increase DB work temporarily;
it must not alter wallet, inventory, audit, match, or settings truth.

The store catalog is split into two layers:

- shared Redis snapshot: active items, bundles, campaign pricing and live-ops view
- per-request MySQL overlay: wallet balance, owned item ids, equipped slots and
  bundle ownership counts

The shared snapshot never stores a user id, coin balance, ownership or equipped
state. Admin item, bundle, discount and system-settings mutations invalidate the
shared key. Time-based availability and campaign display can remain in the storefront
snapshot for at most `30s`; purchase transactions still reload and validate price,
promotion capacity, ownership and wallet truth directly from MySQL.

Notification unread counts use one user-scoped cache key. Notification create,
read and archive operations invalidate only the affected user. Services that create
notifications inside a MySQL transaction defer Redis work until after commit so a
rollback or an in-flight transaction cannot publish an incorrect counter. Redis
stores only `{ unreadCount }`; notification bodies and metadata remain in MySQL.

Support tickets do not currently have a read/unread model. Their lists and workflow
state therefore remain MySQL-backed instead of inventing an ambiguous Redis counter.
An admin queue summary should be added only with a defined operational meaning such
as `open + in_progress`, a visible consumer and mutation-complete invalidation.

The user dashboard is split into live and cached data:

- live MySQL read: current coin balance
- shared Redis cache: match totals, wins, earned match coin and five recent matches

The match-finalize route invalidates only the finalized user's summary after the
MySQL transaction commits. Duplicate finalize claims do not invalidate because they
do not create a new match result. The cache contains no wallet or profile data.
During a Redis outage, another process can show match statistics up to `30s` stale,
while the coin balance remains live and settlement truth remains in MySQL.

## Rate Limit Strategy
- Development can use memory-backed rate limiting.
- Production should use Redis/Valkey-backed counters so limits are shared across all instances.
- Priority routes:
  - auth login
  - auth register
  - support message write
  - coin redeem
  - admin mutation routes
  - system settings update

Distributed counters use one Redis Lua operation for `INCR`, first-write expiry and
TTL read. This prevents a process interruption between `INCR` and `PEXPIRE` from
leaving a permanent counter. Redis command failures fall back to process-local
limits and emit at most one warning per 30 seconds to avoid outage log storms.

## Rollout Plan For `feature/cache-and-rate-limit-foundation`

### Phase 1
- implemented: cache/rate-limit abstraction layer
- implemented: bounded memory fallback for local development and Redis faults
- implemented: Redis/Valkey backend via env

### Phase 2
- implemented: atomic distributed rate limit store with local fallback
- implemented: system settings cache behind shared adapter
- implemented: targeted JSON cache invalidation helpers

### Phase 3
- implemented: notification unread counter
- add support queue counters after their product semantics are defined
- add short TTL coordination helpers
- implemented: Socket.IO Redis adapter event fan-out foundation, default off
- implemented: static admin dashboard summary cache
- implemented: shared store catalog cache plus per-user MySQL overlay
- implemented: dashboard match summary cache plus live wallet overlay
- add identity/profile mini-summary cache only where it creates measurable savings

### Phase 4
- if PM2 multi-instance realtime becomes standard:
  - enable the tested Socket.IO Redis adapter foundation
  - enable the tested create-only room ownership lease foundation
  - owner-aware request decision foundation is implemented
  - add gateway routing or cross-instance command forwarding
  - add sticky sessions or remove polling transport
  - add room/lobby authoritative shared coordination and recovery semantics

### Phase 5
- move economy guard rolling counters behind Redis/Valkey
- move repeated-group keyed counters out of primary DB counts where operationally justified
- keep MySQL audit and settlement truth unchanged

## Concrete Future Redis/Valkey Candidates

### Economy
- rolling `match_reward` earned-in-window counters
- repeated-group lineup counters
- short TTL reward guard decision helpers

### Dashboard / Player UX
- implemented: notification unread count
- implemented: dashboard match summary snapshot
- implemented: shared store catalog snapshot
- support inbox summary counters

### Security / Abuse
- shared request rate limits
- captcha / gateway temporary abuse counters
- idempotency keys
- short TTL locks around sensitive mutation bursts

### Realtime / Multi-instance
- implemented: Socket.IO adapter pub/sub foundation
- implemented: create-only room ownership lease, renew and token-safe release
- implemented: server-only owner-aware join decision and routing anomaly metrics
- room presence coordination
- reconnect grace-period helpers
- cross-instance room transfer signals
- registered `userId -> roomCode` shared presence index
- short-TTL instance capacity snapshots and stale-instance registry cleanup

## Current Capacity Coordination

The room runtime now publishes a Redis-backed capacity heartbeat:

- heartbeat interval: 10 seconds
- instance snapshot TTL: 30 seconds
- registry: `<prefix>:capacity:instances`
- snapshot: `<prefix>:capacity:instance:<INSTANCE_ID>`
- cluster reads prefer `MGET`
- the current process replaces its stored snapshot with fresh local counters
- Redis failures fall back to process-local metrics

This data is disposable operational state. MySQL remains the source of truth for
capacity settings. The heartbeat is suitable for warning/critical load shedding but
is not an atomic global seat reservation. Exact room/team limits are still enforced
by the process that owns the room.

If multi-instance traffic later requires strict global admission, add a short-TTL
atomic reservation counter with rollback/reconciliation. Do not add it before load
tests show heartbeat threshold headroom is insufficient.

## What Still Stays In MySQL Even After Redis

- final wallet balances
- match results
- audit logs
- support history
- notifications source records
- profile source data
- system settings source data

Redis/Valkey burada hizlandirici katmandir, hakikat katmani degildir.

## Audit Retention And Telemetry Strategy

Audit icin kalici cozum "butun olaylari sonsuza kadar ayni sicak tabloda tutmak" olmamalidir.

Onerilen model:

1. hot audit
- admin'in gunluk inceledigi son 30-90 gunluk kritik olaylar
- hizli sorgu ve filtreleme burada kalir

2. archive audit
- daha eski audit kayitlari sicak tablodan ayrilir
- ayri archive tablo seti veya daha ucuz storage/read path kullanilir

3. signal-first audit
- admin mutation
- wallet adjustment
- moderation / support action
- reward guard tetikleyen economy olaylari
- guvenlik acisindan anlamli hata / red event'leri
tam audit olarak tutulur

4. non-triggered telemetry
- review degeri dusuk, hacmi yuksek kullanici olaylari tam audit yerine hafif event/telemetry hattina tasinabilir
- ornek: guard tetiklenmeyen siradan `game.match.finalize` olaylari

Temel retention kurali:
- hot audit -> otomatik retention
- eski kayitlar -> archive
- dusuk degerli event'ler -> daha kisa retention veya telemetry-only

Bu is manuel DB temizligi olarak dusunulmemelidir.
Scheduled retention/archive job ile policy-driven calismalidir.

Mevcut implementasyon:

- `apps/jobs` web request runtime'indan ayri one-shot job runner'idir
- `audit-retention` varsayilan olarak dry-run calisir
- gercek calisma hem explicit execute mode hem `JOBS_ENABLED=true` gerektirir
- Redis yoksa mutating job fail-closed olur; local memory lock'a dusmez
- hot audit varsayilani 90 gundur ve ayarlanabilir
- islem batch sinirli ve idempotent archive anahtariyla calisir
- archive satiri transaction icinde dogrulanmadan hot satir silinmez
- archive kayitlari bu fazda otomatik silinmez
- admin archive arama yuzeyi ve archive purge politikasi ayri bir sonraki fazdir
- admin audit ekraninda hot ve archive kaynaklari ayri, sayfalanmis
  gorunumlerdir; iki tablo uygulama belleginde birlestirilmez
- archive actor kimligi tasima anindaki username snapshot'i ve kalici user id
  ile korunur
- production schedule ancak hedef ortamdaki retention suresi ve archive
  gorunumu operasyon ekibi tarafindan kabul edildikten sonra acilir
- jobs process varsayilan olarak ayri ve dusuk bir DB pool (`3`) kullanir;
  `JOBS_DATABASE_CONNECTION_LIMIT` ile ayarlanabilir
- non-triggered `game.match.finalize` olaylari production'da PII icermeyen
  UTC gunluk Redis rollup'ina gider
- review flag, repeated-group veya safety-ceiling sinyali olan finalize olaylari
  lineup ve guard metadata'siyla tam audit olarak kalir
- telemetry rollup yalniz toplam mac, coin, sure, oyuncu, kayitli/misafir ve
  galibiyet sayaclarini tutar; user id, player id, IP, oda kodu ve lineup tutmaz
- Redis kullanilamazsa finalize basarisiz olmaz ve olay mevcut detayli audit
  yoluna geri duser
- `match_results` her durumda kalici mac/odul truth'u olmaya devam eder
- telemetry counter varsayilani 45 gun TTL'dir; bu operasyonel trend verisidir,
  moderation veya finansal ledger degildir
- health endpointi attempted, recorded, audit fallback ve son basari/hata
  zamanlarini `telemetry.matchFinalize` altinda gosterir

Komutlar:

```bash
npm run jobs:audit-retention
JOBS_ENABLED=true npm run jobs:run -- audit-retention execute
```

Production container tek seferlik olarak su profille cagrilabilir:

```bash
docker compose --profile jobs run --rm jobs
```

Redis/Valkey burada sunlari hizlandirabilir:
- archive job coordination lock'lari
- telemetry counter / aggregation - non-triggered finalize icin uygulandi

## Product Analytics Aggregate Foundation

- `store.item_purchased.v1` ve `store.bundle_purchased.v1` yalniz basarili
  server transaction'larindan PII'siz gunluk Redis aggregate uretir.
- `navigation.screen_viewed.v1` client-observed olarak ayri guven sinifindadir;
  coin, gelir veya gameplay karari tasimaz.
- Ham event satiri, user id, IP, room code ve serbest metadata tutulmaz.
- Redis/config arizasi ana request'i bozmaz; health telemetry'de `dropped`
  sayaci artar ve audit fallback yazilmaz.
- Match finalize mevcut ozel rollup'ta kalir; reader migration olmadan iki hatta
  birden yazilarak cift sayim uretilmez.
- Ayrintili kontrat: `docs/analytics-event-strategy.md`.
- Word analytics gunluk tek hash kullanir; admin reader gorunen word ID'leri
  `HMGET` ile 7/30 gunluk bounded aralikta okur. Keyspace scan yapilmaz.
- unread / review queue counter'lari

Ama audit truth ve admin inceleme izi yine MySQL/kalici storage tarafinda kalmalidir.

## Integration With Future Features
New features should not connect to Redis/Valkey by default.
They should connect only if one of these is true:

- they need cross-instance coordination
- they need shared rate limits
- they need short-lived cache for expensive reads
- they need ephemeral presence/session-like state
- they need pub/sub invalidation or fan-out

Otherwise:
- keep the truth in MySQL
- add Redis/Valkey only when the benefit is operationally real

## Current Recommended Branch Order
1. `feature/integration-hub`
2. `feature/dashboard-visual-polish`
3. `feature/cache-and-rate-limit-foundation`

## Decision Summary
- MySQL stores truth.
- Redis/Valkey stores speed and coordination.
- PM2 helps CPU/process scaling, not shared state correctness.
- Realtime room state cannot stay purely process-local once PM2 multi-instance starts.
- Redis/Valkey should be introduced as a shared infrastructure foundation, not as a one-off patch for a single feature.
