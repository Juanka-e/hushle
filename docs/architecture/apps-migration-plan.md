# Apps Migration Plan

> Status: active migration
> Last updated: 27 July 2026

## Goal

Repo'yu bir anda microservice'e bolmeden, kontrollu sekilde `apps/` + `packages/` yonune tasimak.

Bu planin hedefi:

- mevcut oyunu ve admin panelini kirip dagitmamak
- mobil uygulama ihtimalini bugunden dogru sinirlara oturtmak
- realtime, API ve jobs yuklerini zamanla ayri runtime'lara ayirabilmek
- Docker/local development akisini veri kaybi yaratmadan sade tutmak

## Non-Goals

Su anda yapmiyoruz:

- hemen ayri `apps/api` servisi yayina almak
- DB motorunu MySQL'den PostgreSQL'e cevirmek
- microservice, message broker veya distributed saga tasarimina gecmek

## Current Truth

Bugunku sistem:

- tek repo
- `apps/web` altinda tek Next.js uygulamasi
- `apps/web/server.ts` ile custom Socket.IO server
- Prisma + MySQL source of truth
- Redis client, fallback, rate limit ve oda coordination temeli hazir
- shared cache katmanlari ve Socket.IO Redis adapter event fan-out temeli hazir
- oda state'i process-local; realtime multi-instance henuz hazir degil

Bu nedenle dogru yon `modular monolith first`tir.

## Target Shape

```text
apps/
  web/      -> oyuncu web + admin panel + UI'ya yakin BFF route'lari
  api/      -> mobil/public/backend API runtime
  jobs/     -> retention, archive, telemetry, cleanup, batch workflows

packages/
  domain-game/
  domain-economy/
  domain-player/
  platform-db/
  platform-cache/
  platform-auth/
  shared-config/
  shared-types/
```

`packages/` isimleri ileride daralabilir veya birlesebilir.
Buradaki amac once sorumluluk sinirini netlestirmektir.

## Why This Order

Dogru gecis sirasi:

1. hedef klasorleri tanimla
2. paylasilan kodu `packages/` altina cikar
3. import ve config bagimliliklarini merkezilestir
4. ancak bundan sonra runtime tasimasi yap

Tersini yapmak erken kirilim ve import karmasasi uretir.

## Phase Plan

### Phase 0 - Scaffold And Rules

Durum: tamamlandi.

Bu fazin ciktilari:

- `apps/` klasoru
- `packages/` hedef siniri
- root npm workspace kontrati
- ADR
- migration plan dokumani
- local infra helper script'leri
- named volume ile veri kaliciligi notlari
- Redis health/retry/key prefix ve Docker connection smoke testi

Bu fazda fiziksel runtime ayrimi yoktur.

### Phase 1 - Package Boundaries

Durum: platform temeli tamamlandi, domain ayirimlari ihtiyaca gore devam edecek.

Tamamlanan platform sinirlari:

- `packages/platform-db`
- `packages/platform-cache`
- Next.js transpile ve Docker `npm ci` workspace destegi
- direct infrastructure importlarini engelleyen boundary smoke testi

Ilk teknik ayirma kod tasimasi degil, sorumluluk ayirmasidir.

Oncelikli adaylar:

- `packages/platform-db`
  - Prisma client
  - DB helper'lari
  - transaction giris noktalari

- `packages/platform-cache`
  - Redis/Valkey abstraction
  - memory fallback
  - counter/cache contract'lari

- `packages/platform-auth`
  - session lookup
  - auth helper'lari
  - role gate util'leri

- `packages/domain-player`
  - profile/display name/avatar/frame mantigi
  - room identity projection helper'lari

- `packages/domain-economy`
  - reward eligibility
  - reward source kurallari
  - abuse guard hesaplari

- `packages/domain-game`
  - room/game state pure logic
  - turn/score helper'lari

Phase 1 kurali:
- UI component'leri dogrudan runtime'a yakin kalabilir
- once logic ve platform katmani ayrilir

### Phase 2 - `apps/web` Move

Durum: tamamlandi.

Tamamlananlar:

- Next.js kaynaklari, public asset'ler ve web configleri `apps/web` altina tasindi
- custom Next.js + Socket.IO runtime'i `apps/web/server.ts` altina tasindi
- root npm komutlari `@hushle/web` workspace'ine delege edildi
- root test/seed scriptleri yeni uygulama yoluna uyarlandi
- Docker `npm ci` katmani web workspace manifestini kapsiyor
- root `.env*` dosyalari local gelistirme uyumlulugu icin web runtime tarafindan yukleniyor

Bu tasimadan sonra root repo:

- workspace orchestration
- Docker
- shared config
- packages

rolune gelir.

### New Game Modes

Yeni oyun modlari ilk asamada yeni bir web uygulamasi olarak acilmaz.

Her mod:

- `packages/domain-game` altinda kendi kural/state/validation modulune sahip olur
- ortak room, identity, economy ve audit kontratlarini kullanir
- `apps/web` icinde yalniz route, Socket.IO adapter ve UI katmanini tutar
- reward source ve eligibility kararlarini mod kimligiyle sunucu tarafinda uretir

Bir mod ancak farkli deploy, farkli teknoloji veya bagimsiz olcekleme ihtiyaci
dogurursa ayri bir `apps/*` runtime'ina ayrilir. Bu sayede yeni mod eklemek mevcut
Tabu akisini kopyalamaz ve mobil API kontratini web UI'ya baglamaz.

### Phase 3 - `apps/jobs`

Durum: temel tamamlandi.

Ayri jobs runtime'i ilk gercek operasyonel faydayi burada verir.

Buraya alinabilecekler:

- audit retention / archive
- telemetry rollup
- notification cleanup
- catalog/background sync
- economy review aggregation

Bu faz, web request runtime'ini agir batch islerinden ayirir.

### Phase 4 - `apps/api`

Durum: runtime, transport contract, mobile auth gate, `/v1/me`, profile
read/write, sayfali inventory/equip ve store catalog read tamamlandi. Purchase
wallet ledger/idempotency ortaklastirmasindan sonra ayri ele alinacak.

Ancak su durumlarda gercek runtime'a donusturulmeli:

- mobil uygulama backlog'dan implementasyona gectiginde
- web ve mobil farkli release cadence istediginde
- public/backend contract'lari UI'dan bagimsizlasmaya basladiginda

Bu runtime'in ana rolu:

- mobile-safe API contract
- admin disi backend gateway logic
- BFF disi entegrasyon girisleri

### Phase 5 - Shared Coordination

Multi-instance veya yuksek online esiginde:

- Redis/Valkey counter
- shared presence
- Socket.IO adapter (event fan-out temeli tamamlandi, varsayilan kapali)
- rate limit store
- dashboard summary cache

bu faza alinacak.

Burada da kural degismez:

- truth MySQL
- speed/coordinator Redis

Socket.IO adapter tek basina bu fazi tamamlamaz. Mevcut room map, timer, host
transfer ve `userId -> roomCode` indexi process-local kalir. Realtime replica
sayisi artirilmadan once:

- `roomCode -> owner instance` karari tamamlandi; trafik yonlendirme bekliyor
- polling icin sticky session veya websocket-only karari
- Redis room ownership lease ve stale owner detection - create-only temel tamamlandi
- owner-aware join karari tamamlandi; owner'a cross-instance forwarding bekliyor
- restart/reconnect/timer recovery semantigi

tamamlanmalidir. Health cevabindaki `multiInstanceReady=false` bu operasyonel
siniri acikca belirtir.

## Docker And Local Development Plan

### Current Decision

Local gelistirme iki sekilde calisabilmeli:

1. infra-only Docker + app host machine
2. full Docker compose

Bu yuzden mevcut scriptler korunur:

- `npm run infra:up`
- `npm run infra:down`
- `npm run infra:logs`
- `npm run dev`

### Persistence Rule

MySQL ve Redis volume'leri named volume uzerinden kalici kalir.

Beklenen davranis:

- `docker compose down` -> veri silinmez
- container restart -> veri silinmez
- machine restart -> volume duruyorsa veri silinmez
- yalniz `down -v` veya manuel volume delete -> veri silinir

Bu davranis local resetlerde gereksiz veri kaybini engeller.

### Why MySQL Stays

Bu migration sirasinda DB motoru degistirmek teknik riski gereksiz buyutur.

Su an yapilacak sey:

- MySQL'i source of truth olarak korumak
- Prisma schema ve deploy aliskanligini stabil tutmak
- runtime ayrimini DB migration'indan ayri ele almak

### Future Docker Shape

Kisa vadede:

- tek app container kabul
- mysql
- redis
- nginx

Orta vadede:

- `web`
- `jobs`
- mysql
- redis
- nginx

Mobil/API ihtiyaci gercek oldugunda:

- `web`
- `api`
- `jobs`
- mysql
- redis
- nginx

Bu siralama operasyon yukunu kontrollu buyutur.

## Branch Plan

Onerilen implementasyon sirasi:

1. `feature/apps-workspace-foundation` - tamamlandi
- workspace root duzenleri
- `apps/` ve gerekirse `packages/` scaffolding
- tsconfig/path planinin hazirlanmasi

2. `feature/packages-extraction-foundation` - platform temeli tamamlandi
- platform ve domain paketlerinin ilk tasinmasi

3. `feature/docker-local-dev-foundation` - tamamlandi
- local compose/dev ergonomisi
- volume/persistence docs
- env orneklerinin sadelestirilmesi

4. `feature/cache-and-rate-limit-foundation` - temel tamamlandi
- Redis abstraction
- memory fallback
- shared coordination hazirligi

5. `refactor/apps-web-runtime-migration` - tamamlandi
- Next.js/custom server fiziksel tasimasi
- root orchestration uyarlamasi
- Docker, test ve dokuman yolu uyarlamalari

6. `feature/domain-game-foundation` - tamamlandi
- mevcut Tabu ayar ve mac bitis kurallarini transport/UI katmanindan ayirma
- `@hushle/domain-game` game mode registry ve server-owned `tabu` mode contract
- match audit snapshot'ina mode kimligi ekleme
- gelecekteki web/admin hostlari icin exact Socket.IO origin allowlist
- harici font/style/connect kaynaklari icin direktif bazli CSP yapilandirmasi

7. `feature/jobs-runtime-foundation` - tamamlandi
- `apps/jobs` one-shot runner ve job registry temeli
- dry-run varsayilan, iki asamali acilan audit retention/archive isi
- Redis lease ile multi-instance koordinasyonu
- archive kopyasi dogrulanmadan hot audit silmeme garantisi
- admin hot/archive read path tamamlandi
- telemetry rollup sonraki dar branch'te

8. `feature/socketio-redis-adapter-foundation` - tamamlandi
- varsayilan kapali, explicit enable ve fail-fast Redis baglantisi
- dedicated publisher/subscriber connection
- iki runtime arasinda Redis fan-out entegrasyon testi
- health'te adapter ve multi-instance readiness gorunurlugu
- room state process-local kaldigi icin replica artirmama guardrail'i

9. `feature/realtime-room-ownership-foundation` - tamamlandi
- varsayilan kapali ve Redis yoksa fail-fast create lease
- token kontrollu claim, renew ve release
- stale process'in yeni owner lease'ini silememesi
- health'te conflict, lost ownership ve renew failure gorunurlugu
- mevcut maci Redis kesintisinde sonlandirmayan create-only enforcement

10. `feature/realtime-owner-routing-foundation` - tamamlandi
- local, missing, remote owner ve state mismatch karar sozlesmesi
- remote instance kimligini istemciye gondermeme
- routing hazir degilken genel mesajla guvenli join reject
- Redis lookup kesintisinde mevcut local odayi oynanabilir tutma
- health'te routing anomaly ve lookup failure metrikleri

11. `feature/realtime-deployment-topology-guard` - tamamlandi
- production icin tek realtime writer karari ve ADR
- process-local room state varken replica sayisini birde tutan startup guard
- Socket.IO transport seciminin dogrulanmis env ayarina baglanmasi
- health endpointinde topology ve multi-instance readiness gorunurlugu
- coklu instance gecisi icin sticky session, owner forwarding, recovery ve
  failover kabul kapisi

12. `feature/audit-telemetry-rollup-foundation` - tamamlandi
- signal-first finalize audit siniflandirmasi
- temiz finalize olaylari icin PII'siz Redis gunluk counter
- Redis arizasinda odulu etkilemeden detayli audit fallback
- health metrikleri ve gercek Redis Lua/TTL testi

13. `feature/mobile-api-foundation` - tamamlandi
- bagimsiz Node HTTP runtime ve `@hushle/api-contracts`
- `/health` ve `/v1/meta`
- exact CORS, request ID ve guvenli JSON envelope
- explicit Docker profile; public Nginx route'u yok
- bearer auth sonrasi kademeli player endpoint migration plani

14. `feature/mobile-auth-foundation` - tamamlandi
- opaque access/refresh token, rotation ve session revoke
- explicit runtime enablement ve captcha policy parity

15. `feature/mobile-player-core` - tamamlandi
- `/v1/me` ve profile read/write
- ortak player service ve transaction icinde audit

16. `feature/mobile-inventory-and-equip` - tamamlandi
- bounded cursor pagination ile `/v1/inventory`
- server-side sahiplik/tur kontrolu ile equip ve unequip
- web ve mobil adapter'lar icin ortak inventory service

17. `feature/mobile-store-catalog-read` - tamamlandi
- bounded cursor pagination ile `/v1/store/catalog`
- ortak promotion/coupon fiyatlandirma source of truth'u
- revision tabanli Redis/memory katalog page cache
- cache disinda kalan user coin/owned/equipped overlay'i

Sonraki mobil dilimler web acilisi stabil hale gelene kadar duraklatildi.
Tamamlanan kapsam, ertelenen siralama ve yeniden baslatma kapisi
`apps/api/MOBILE_ROADMAP.md` icinde tutulur. Web mobil responsive calismalari
`apps/web` kapsaminda devam eder.

## Guardrails

Gecis boyunca korunacak kurallar:

- tek branch tek konu
- runtime ayirmadan once package ayirimi
- MySQL source of truth'u bozmama
- Redis'i persistent truth gibi kullanmama
- local developer flow'u zorlastirmama

## Success Criteria

Bu plan basarili sayilirsa:

- yeni mod veya yeni web yuzeyi eklenirken root app daha az sisir
- mobil API cikarmak buyuk refactor gerektirmez
- jobs yukleri web runtime'ini kirletmez
- local developer `infra:up + dev` ile veri kaybetmeden calisir
