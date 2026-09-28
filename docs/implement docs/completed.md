# Tamamlanan Isler

> Son guncelleme: 31 July 2026
> Durum: aktif completed log

## Yayinda Olan Temel Sistemler
- authenticated dashboard shell
- in-game dashboard overlay
- store, inventory, equip, purchase akislari
- bundle / discount / coupon altyapisi
- cosmetic template/image modeli
- room card cosmetics broadcast
- runtime system settings
- captcha entry gates
- admin table foundation
- moderation foundation
- economy liveops controls
- user email foundation
- admin user operations
- admin audit viewer
- coin grant campaigns
- support desk foundation

## Tamamlanan Feature Branch'ler

### 1. `feature/liveops-system-settings-foundation`
- runtime config omurgasi
- maintenance, MOTD, feature toggles
- admin system settings ekrani

### 2. `feature/security-entry-gates`
- Turnstile / reCAPTCHA gate altyapisi
- register / login / room create / guest join enforcement

### 3. `feature/admin-table-foundation`
- ortak admin header, toolbar, pagination, selection yapisi
- words / shop-items / promotions entegrasyonu

### 4. `feature/moderation-foundation`
- suspend / reactivate / note modeli
- `/admin/users`
- moderation event kaydi

### 5. `feature/economy-liveops-controls`
- runtime reward ve fiyat carpanlari
- bundle/coupon/campaign kill switch'leri
- shop liveops durumu

### 6. `feature/user-email-foundation`
- yeni kayitlarda email zorunlu
- legacy hesap uyumu
- profile ve admin users email gorunumu

### 7. `feature/admin-user-operations`
- admin coin ekle / dus operasyonu
- wallet adjustment kayit modeli
- reason zorunlulugu ve audit baglantisi
- negatif bakiye korumasi

### 8. `feature/admin-audit-viewer`
- `/admin/audit` ekrani
- action / resource / role / search filtreleri
- audit metadata ozet gorunumu

### 9. `feature/coin-grant-campaigns`
- `/admin/coin-grants` campaign ve code yonetimi
- login kullanici coin code redeem akisi
- budget / duplicate claim / code limit korumalari

### 10. `feature/support-desk-foundation`
- full-page dashboard ve in-game overlay icin ortak support girisi
- kullanici ticket olusturma ve reply akisi
- admin support kuyrugu, assignee, public reply ve internal note
- support aksiyonlari icin audit log baglantisi

### 11. `feature/cosmetic-render-upgrade`
- katalogda asil asset'ten bagimsiz nullable `thumbnailUrl`
- grid ve discovery yuzeylerinde memoized, statik thumbnail renderer
- ilk 24 urun ve kullanici kontrollu batch genisletme
- animasyonlu buyuk renderer'i yalniz detay modalinda mount etme

### 12. `feature/admin-cosmetic-authoring`
- frame, card face ve card back icin test edilen hazir template preset'leri
- preset'in etkisini aciklayan ve yalniz render alanlarini degistiren admin akisi
- mevcut resolver ile anlik canli preview
- preset katalogunun shop item write schema ile otomatik dogrulanmasi

### 13. `feature/analytics-event-foundation`
- versiyonlu ve guven seviyeli product event kontrati
- PII ve ham event satiri tutmayan Redis gunluk aggregate
- server-verified store metrikleri ve client-observed navigation siniri
- analytics arizasini business request'inden ayiran dropped telemetry

### 14. `feature/word-analytics-liveops`
- dogru, tabu, pas ve timeout icin server-owned kelime olcumu
- oyuncu, oda ve kelime metni tutmayan Redis gunluk aggregate
- pause suresini dislayan exposure ve cok kategorili aggregate
- admin kelime listesinde 7/30 gunluk bounded performans gorunumu
- dusuk ornek uyarisi ve otomatik yaptirim uygulamayan liveops siniri

### 15. `feature/release-ops-docs`
- release gate, kanit kaydi ve production deploy gercegi
- rollback/incident runbook'u ve launch-day checklist
- production deploy concurrency, release SHA ve archive checksum
- analytics env degerlerinin Compose app container parity'si
- workflow, Compose, health ve dokuman kontrati regresyon testi

### 16. `docs/encoding-cleanup`
- cift encode edilmis tasarim prototiplerinin UTF-8 onarimi
- stale UTF-16 lint/typecheck raporlarinin kaldirilmasi
- UTF-8 EditorConfig ve kalici encoding integrity testi
- mevcut ASCII socket event dokumani ve escaped legacy compatibility alias'lari

### 17. `feature/wallet-ledger-foundation`
- atomik coin bakiye ve immutable ledger yazimi
- tum mevcut coin kaynaklarinin merkezi servise tasinmasi
- lazy legacy snapshot ve yeni hesap opening kaydi
- eszamanli magaza harcamalarinda satir kilidi
- admin ledger history ve bakiye reconciliation gorunumu
- MySQL concurrency/idempotency CI testi

### 18. `feature/mobile-api-foundation`
- bagimsiz ve surumlu Node HTTP API runtime
- paylasilan `@hushle/api-contracts` paketi
- health/meta, exact CORS, request ID ve security header davranisi
- varsayilan kapali Docker API profili
- runtime HTTP ve package boundary regresyon testi
- bearer auth sonrasina bagli kademeli route migration plani
- opaque access/refresh token, rotation, reuse family revoke, cihaz oturumu
  listeleme/revoke ve mobile auth retention temeli
- ortak player-core servisi, `/v1/me`, profile update ve transaction icinde
  web/mobile audit parity

### 19. `feature/email-verification-foundation`
- `off | optional | required_for_new_accounts` runtime modu
- provider bagimsiz transactional outbox ve Nodemailer SMTP adaptoru
- hash'li, 24 saatlik, tek kullanimlik token ve resend invalidation
- verification-only session icin ortak web/mobile/socket capability politikasi
- Mailpit local gelistirme servisi ve SES SMTP uyumlu production env kontrati
- Redis lease zorunlu delivery/retention job'lari
- bounded outbox, token ve pending hesap retention
- admin readiness gorunumu ve zorunlu mod icin fail-closed config kontrolu

### 20. `chore/prisma-migration-baseline-and-deploy-gates`
- mevcut MySQL semasindan version-controlled Prisma baseline
- mevcut DB icin backup, restore smoke ve sifir drift zorunlu baseline komutu
- app startup'ina bagli olmayan tek-seferlik Compose migration servisi
- migration basarisizliginda app rollout'unu durduran deploy gate
- CI'da temiz DB uzerinde `prisma migrate deploy` kontrati

### 21. `feature/release-compatibility-and-render-versioning`
- legacy v0 ve current v1 icin Socket.IO handshake compatibility penceresi
- desteklenmeyen istemciyi room handler'larindan once reddeden server gate
- yeni istemcide kontrollu sayfa yenileme mesaji
- card face/back icin gercek render spec registry ve v1 parser dispatch
- bilinmeyen snapshot version'inda v1 fallback metadata'si
- desteklenmeyen render version'ini yeni item'a yazmayi engelleyen admin API gate

### 22. `fix/restore-cutover-and-schema-ops-lock`
- aktif production DB'ye in-place restore'u fail-closed kapatma
- backup, restore ve migration icin ortak host-level schema operation lock
- izole restore, migration-forward, smoke ve kontrollu DB cutover runbook'u
- backup sonrasi kayip veri araligi ile Redis/process-local state sinirinin kaydi
- lock contention ve gercek dump/restore entegrasyon testleri

### 23. `feature/email-delivery-operations-and-bounce-handling`
- sureli, atomik DB outbox claim ve coken worker recovery akisi
- idempotent provider event ve hard-bounce/complaint suppression temeli
- suppression-aware fail-closed teslimat davranisi
- admin dead-letter gorunumu, kontrollu retry ve audit
- MySQL concurrency, statik guvenlik ve admin Playwright dogrulamalari

### 24. `feature/production-config-preflight`
- secret degerlerini loglamayan fail-closed production env preflight
- secret kalite/benzersizlik, HTTPS origin ve DB credential parity kontrolleri
- captcha, e-posta, admin gateway ve offsite backup icin acik politika kararlari
- tek realtime writer, rate limit, Redis namespace ve proxy trust guard'lari
- deploy oncesi otomatik gate, fixture testleri ve operator runbook'u

### 25. `fix/strict-state-change-origin-policy`
- production cookie API'lerinde eksik Origin icin fail-closed davranis
- exact trusted-origin allowlist ve cross-site Fetch Metadata reddi
- production'da spoof edilebilir forwarded-host header'larindan guven uretmeme
- development script uyumlulugu ile mobile bearer API ayriminin korunmasi
- deploy preflight gate ve spoof/missing-header regresyon testleri

### 26. `feature/central-observability-foundation`
- web, API ve jobs icin ortak provider-neutral observability paketi
- format kontrollu request ID ve web response/downstream korelasyonu
- PII/secret redaksiyonlu bounded structured JSON event kontrati
- gameplay'i bozmayan exporter failure izolasyonu ve aggregate status
- runtime health/admin capacity gorunumu, regresyon testleri ve operator rehberi

### 27. `feature/observability-exporter-and-alerting`
- HTTPS bearer-auth collector icin bounded batch/queue exporter
- web, API, jobs ve Next instrumentation runtime konfigurasyonu
- exporter teslim, kuyruk, drop ve failure aggregate admin/health gorunumu
- production preflight, Docker env, alarm esikleri ve incident runbook'u

### 28. `feature/google-oauth-account-linking-foundation`
- token saklamayan provider-neutral OAuth account modeli ve Auth.js adapter'i
- Google verified-email kontrolu ve otomatik ayni-email link reddi
- Settings icinden explicit link/unlink ve son giris yontemi korumasi
- nullable parola icin web/mobile guvenli fallback davranisi
- Apple ve yeni provider'lar icin registry, env ve production preflight kontrati

### 29. `feature/adaptive-turnstile-launch-policy`
- Managed Turnstile varsayilani ve oyuncu niyetinde tokenless provider prewarm
- exact action/production hostname, token boyutu ve Siteverify timeout kontrolleri
- production preflight hostname kontrati ve Docker env parity
- anlasilir admin akis ac/kapat metinleri, server policy ve Playwright regresyonlari

### 30. `feature/production-edge-security-policy`
- Cloudflare Free icin application-first declarative edge policy
- WebSocket, browser auth/room entry, checkout ve payment webhook route ayrimi
- proxy/origin-lock ve signature-first webhook production preflight kararlari
- provider-neutral payment mimarisi ve guvenli adapter branch sirasi

### 31. `feature/payment-orders-foundation`
- minor-unit fiyat ve immutable urun/grant snapshot'i tasiyan payment order modeli
- ayni kullanici + idempotency key icin atomik duplicate korumasi ve payload fingerprint kontrolu
- provider-neutral state machine, attempt ve tekil fulfillment kontrati
- fail-closed checkout gate ile Integration Hub provider readiness gorunumu
- gercek MySQL race testi ve admin Integration Hub Playwright smoke testi

### 32. `feature/payment-webhook-inbox`
- raw-body-first provider verifier kontrati ve fail-closed webhook route'u
- MySQL durable inbox, provider event ID dedupe ve body hash kimlik catismasi korumasi
- bounded metadata; raw payload, signature, cookie ve authorization saklamama karari
- retry, claim lease, exponential backoff ve dead-letter worker temeli
- Redis/Valkey'i yalniz job koordinasyonunda tutan kalici veri ayrimi

### 33. `feature/payment-checkout-ui`
- coin magazasindan ayri server-priced ve surumlu payment offer modeli
- responsive checkout, fail-closed readiness ve owner-only order status yuzeyi
- user + hash'lenmis IP distributed rate limit ve stale legal version reddi
- aydinlatma, on bilgilendirme ve satin alma kosullarinin ayri sunumu
- siparise bagli immutable legal consent snapshot ve mobile API roadmap parity

### 34. `feature/paytr-iframe-adapter`
- resmi alan sirasini kullanan PayTR iFrame token HMAC adapter temeli
- callback HMAC dogrulamasi, constant-time karsilastirma ve provider `OK` kontrati
- minor-unit sepet/tutar esligi ve bounded provider transport/hata davranisi
- kalici modele iletisim verisi eklemeyen veri minimizasyonu karari
- checkout processor ve fulfillment bitene kadar fail-closed aktivasyon siniri

### 35. `feature/payment-fulfillment-foundation`
- ortak `@hushle/platform-wallet` transaction paketi ve web compatibility export'u
- earned/grant/admin coin'den ayrilan `payment_topup` ledger kaynagi
- paid order row lock altinda atomik coin ve kozmetik fulfillment
- duplicate/concurrent retry icin order, fulfillment ve ledger idempotency zinciri
- invalid, missing ve already-owned grant icin bounded failure kaydi
- disposable MySQL migration, race ve partial bundle rollback testleri

### 36. `feature/paytr-checkout-orchestration`
- yalnız sandbox kabul eden fail-closed PayTR provider readiness
- server-priced order ile idempotent PayTR iFrame token session orchestration
- transaction dışında provider çağrısı ve row-lock korumalı attempt lease
- doğrulanmış hesap e-postası ile kalıcı tutulmayan geçici iletişim alanları
- owner-only iFrame resume, responsive checkout ve Playwright doğrulaması
- coin pack ürünlerini reversal politikası tamamlanana kadar gizleme
- production Compose env parity ve live modu reddeden preflight gate

### 37. `feature/paytr-webhook-order-processor`
- sandbox credential gate'li PayTR webhook verifier registry bağlantısı
- row-lock altında order referansı, tutar, currency, sandbox ve state doğrulaması
- durable inbox worker üzerinden idempotent paid/failed geçişleri ve fulfillment
- worker retry/restart durumunda tek grant ve tek bildirim garantisi
- notification cache invalidation ve kalıcı notification delivery işareti
- checkout için jobs runtime ve scheduler zorunlu production preflight kapısı
- imzalı callback zincirini zorlayan disposable MySQL entegrasyon testi

### 38. `feature/payment-reconciliation-and-reversal-foundation`

- PayTR sandbox status-query adapter ve bounded reconciliation worker
- Redis global lease, retry aralığı ve production scheduler preflight gate'i
- idempotent kozmetik entitlement reversal ve equipped slot temizliği
- fungible coin için kazanılmış bakiyeye dokunmayan manuel inceleme politikası
- admin ödeme operasyon görünümü, dead-letter retry ve audit'li reversal endpoint'i

### 39. `feature/payment-case-resolution-and-dual-approval`

- uzlaştırma vakaları için notlu `resolved` / `ignored` operatör kararları
- yerel refund ve chargeback uygulamalarında farklı ikinci admin onayı
- onay talebi, inceleyen admin ve karar notunu koruyan kalıcı işlem geçmişi
- sipariş satır kilidi altında atomik onay, entitlement reversal ve yarış koruması
- açık vaka, dead-letter ve bekleyen onay eşikleriyle admin-only operasyon uyarıları

### 40. `feature/payment-coin-lot-provenance-and-reversal`

- her ücretli coin fulfillment'ı için siparişe tekil ve tutarlılık kontrollü coin lotu
- normal debitlerde non-payment-first, ardından oldest-paid-lot allocation politikası
- yalnız ilgili lotun kalan kısmını düşen idempotent `payment_reversal` ledger kaydı
- harcanmış ücretli coin için negatif bakiye yerine bounded manuel inceleme kanıtı
- spend/refund yarışında wallet row lock ve allocation tabanlı tutarlılık testi
- mevcut payment/legal/provider gate'leri altında coin-pack checkout aktivasyonu

### 41. `feature/payment-manual-review-resolution`

- manuel reversal kayıtları için tekil, durumlu ve geriye dönük doldurulan vaka modeli
- zorunlu admin notlu `resolved` / `waived` karar geçmişi ve yarış koşulu koruması
- bakiye, askıya alma ve ekonomi guard ayarlarına dokunmayan fail-safe çözüm akışı
- isteğe bağlı, güvenli varsayılan metinli oyuncu bildirimi ve cache invalidation
- açık vaka odaklı admin metriği, karar formu, audit ve Playwright doğrulaması

### 42. `feature/paytr-refund-adapter-foundation`

- provider-neutral refund request/result ve readiness kontratı
- resmi alan sıralı HMAC-SHA256 PayTR refund formu ve sabit HTTPS endpoint
- timeout, response boyutu ve exact order/amount/reference doğrulamalı transport
- provider hata metnini dışarı taşımayan bounded hata davranışı
- production'da refund execution'ı kapalı tutan preflight ve Compose env parity
- production para hareketini kapalı tutan readiness ve regresyon testleri

### 43. `feature/payment-provider-refund-attempt-orchestration`

- kalıcı `processing`, `succeeded`, `failed`, `uncertain` provider attempt modeli
- tam tutarı siparişten alan ve farklı ikinci admin isteyen PayTR sandbox refund akışı

- timeout/transport belirsizliğinde entitlement değiştirmeyen `provider_review`
- kör retry yerine exact reference, tutar, currency ve tamamlanma kanıtlı recovery
- admin durum görünümü, MySQL entegrasyon testi ve Playwright doğrulaması

### 44. `feature/iyzico-checkout-adapter-foundation`

- sabit sandbox host/path kullanan iyzico Checkout Form initialize/retrieve transport temeli
- resmi `IYZWSv2` HMAC-SHA256 authorization ve exact minor-unit tutar dönüşümü
- timeout, stream response boyutu, provider redirect allowlist ve bounded hata korumaları
- callback token'ını ödeme kanıtı saymayan server-side retrieve sözleşmesi
- hassas alıcı verisi ve legal kararlar tamamlanana kadar route/UI bağlamayan fail-closed sınır

### 45. `feature/stripe-checkout-adapter-foundation`

- sabit Stripe Checkout Session endpoint'i ve pinli API sürümü kullanan sandbox transport
- server-owned minor-unit tutar, order metadata ve provider idempotency key sözleşmesi
- yalnız test/restricted-test key, hosted URL allowlist, timeout ve bounded stream response
- redirect/session cevabını ödeme kanıtı saymayan webhook-first aktivasyon sınırı
- Türkiye merchant uygunluğu bulunmadığı için production önceliği vermeyen realist provider kararı

### 46. `feature/iyzico-buyer-data-legal-contract`

- PayTR ve iyzico için sürümlü, provider bazlı request-only buyer data politikası
- iyzico ad/soyad, telefon, adres ve 11 haneli kimlik alanı normalizasyon sözleşmesi
- hassas değer yerine yalnız `buyer-data-v1` sürümünü saklayan checkout consent migration'ı
- profil, sipariş, attempt, audit, log ve telemetry için değer/hash saklamama sınırı
- KVKK veri minimizasyonu ve yurt dışı aktarım incelemesini aktivasyon kapısı yapan dokümantasyon

### 47. `feature/iyzico-checkout-orchestration`

- row lock ve request lease ile tekil iyzico Checkout Form initialize orkestrasyonu
- duplicate istekte aynı hosted session'ı döndüren kalıcı provider referansları
- timeout ve belirsiz transport sonucunda kör retry'ı kesen `uncertain` attempt/vaka akışı
- callback token'ını kanıt saymadan exact amount/currency doğrulayan server-side retrieve
- fulfillment açmadan minimize edilmiş provider doğrulama kanıtı ve MySQL yarış testi

### 48. `feature/iyzico-signature-v3-webhook`

- yalnız Checkout Form HPP formatını kabul eden Signature V3 HMAC verifier
- explicit sandbox webhook mode ve merchant ID eşleştirme kapısı
- raw token saklamadan order/token/payment reference korelasyonu ve durable inbox dedupe
- success event için server-side retrieve/exact verification olmadan fulfillment yapmayan processor
- failure, duplicate, token mismatch ve amount mismatch MySQL/route testleri

### 49. `feature/iyzico-reconciliation`

- PayTR davranışını koruyan provider-neutral reconciliation dispatch
- explicit sandbox reconciliation modu ve provider kırılımlı bounded job aday seçimi
- token bulunan eski iyzico siparişlerinde exact retrieve proof ile idempotent fulfillment recovery
- token bulunmayan initialize belirsizliğinde kör retry yapmayan kalıcı manuel inceleme vakası
- job, admin reconcile, eşzamanlı worker ve proofsuz paid sipariş güvenlik testleri

### 50. `feature/iyzico-owner-checkout-surface`

- verified registered account ve guncel legal consent isteyen owner-only sandbox session route
- callback cookie'sine guvenmeden order + server-owned token ile baglanan bounded form callback
- initialize/retrieve resmi response signature dogrulamasi ve exact basket/order korelasyonu
- raw token'i redirect, public order JSON, log ve fulfillment yuzeyinden uzak tutan veri minimizasyonu
- callback'in yalniz proof yazdigini, cross-owner ve token mismatch'in provider'a ulasmadigini
  kanitlayan MySQL, static ve Playwright testleri

### 51. `feature/iyzico-jit-checkout-ui`

- server-selected provider bilgisini kullanan provider-neutral checkout formu
- iyzico kimlik, telefon ve tek adres alanlarini yalniz component memory'de tutan JIT akis
- buyer-data aktarim bildirimi ile satis kosullari kabulunu ayiran UI
- allowlist'li hosted redirect, callback sonucu mesaji ve otomatik loop yaratmayan resume butonu
- PayTR regresyonu, storage/URL veri minimizasyonu ve iyzico redirect Playwright testleri

### 52. `feature/iyzico-sandbox-acceptance-harness`
- gerçek merchant credential'larıyla initialize ve exact retrieve kanıtını PII/token saklamadan kaydeden kabul aracı
- tutar, para birimi, conversation ve payment reference korelasyon kontrolleri
- kabul kanıtını yalnız hash ve bounded metadata ile üreten operasyon runbook'u

### 53. `feature/iyzico-operations-readiness`
- payment worker execute heartbeat'leri ve admin scheduler health görünümü
- stale/missing scheduler için token korumalı health degradation
- dead-letter ve açık vaka eşiklerinde 15 dakikalık Redis cooldown'lı merkezi uyarılar

### 54. `feature/payment-scheduler-deployment`
- webhook için bir dakikalık, reconciliation için on beş dakikalık systemd timer şablonları
- yalnız iki payment job'ını kabul eden, schedule gate ve bounded timeout kullanan Compose wrapper
- jobs/app container'larında eksik Iyzico, webhook ve scheduler environment aktarımları
- tokeni process argümanında göstermeyen HTTPS health probe ve dış monitor kabul kontratı

### 55. `feature/payment-activation-evidence-gates`
- legal onay boolean'ını provider, belge sürümleri ve veri aktarım kapsamına bağlı SHA-256 manifest ile güçlendirme
- Iyzico acceptance v2 kanıtını hashed merchant ID ve exact legal sürümlerine bağlama
- regular/non-symlink, bounded, world-readable olmayan dosya ve exact digest production preflight kapısı
- kanıtları uygulama image'ından ayıran salt-okunur deployment evidence mount'u

### 56. `feature/payment-rollout-and-emergency-pause`
- varsayılan paused/0% fail-closed checkout kontrolü
- stable seed ve registered user ID tabanlı deterministik kademeli rollout
- her checkout POST'unda cache dışı authoritative server-side enforcement
- revision kontrollü, audit ile atomik admin güncellemesi ve tek aksiyonlu acil durdurma
- callback, webhook ve reconciliation akışını kesmeyen rollback sınırı
- health ve PII'siz merkezi observability görünürlüğü

### 57. `feature/ses-feedback-webhook-foundation`
- exact topic ARN ve aynı-region AWS sertifika hostu doğrulamalı SNS adapter
- bounded body/certificate fetch, signature V1/V2 ve distributed route rate limit
- permanent bounce/complaint suppression, transient bounce koruması ve recipient bazlı idempotency
- güvenli subscription confirmation gate, production preflight ve Cloudflare route policy

### 58. `feature/shopier-custom-listing-checkout-foundation`
- güncel Shopier v1 API ile siparişe özel, stok 1 dijital `customListing` transportu
- exact server price/currency, product ID ve hosted URL doğrulaması
- concurrent checkout lease, duplicate resume ve belirsiz create sonucunda kör retry koruması
- bounded timeout/response, PAT gizliliği ve provider hata detayı minimizasyonu
- webhook, reconciliation, refund ve gerçek kabul kanıtı bitene kadar fail-closed registry

### 59. `feature/shopier-signed-webhook-fulfillment`
- raw body HS256, account ID ve beş dakikalık timestamp replay doğrulaması
- imzalı raw-body digest tabanlı durable dedupe, resmî webhook ID korelasyonu ve identity conflict koruması
- tek dijital ürün/adet, exact product/title/tutar/currency ödeme kanıtı
- ham e-posta saklamayan keyed HMAC korelasyonu ve uyuşmazlıkta inceleme vakası
- idempotent coin/kozmetik fulfillment, notification ve MySQL duplicate testi

### 60. `feature/shopier-order-reconciliation`
- Shopier Product/Order API üzerinden timeout recovery ve ödeme uzlaştırması
- exact ürün, tutar, para birimi ve alıcı korelasyonu olmadan teslimat yapmayan fail-closed akış
- webhook, job ve admin kontrollerinde ortak idempotent ödeme kanıtı uygulaması

### 61. `feature/shopier-refund-orchestration`
- Shopier Refund API create/get/list adapter'ı ve ayrı canlı aktivasyon kapısı
- kalıcı Shopier refund ID, pending/failed/succeeded durumları ve belirsiz sonuç recovery
- imzalı refund webhook'ları, exact tam iade eşlemesi ve idempotent merkezi reversal
- harici veya kısmi iadede otomatik ceza yerine operatör reconciliation vakası
- sağlayıcı bazlı admin readiness görünümü ve canlı kabul kanıtı production preflight'ı

### 62. `feature/versioned-entitlement-grant-contract`
- provider ve kaynak bağımsız, strict ve boyut sınırlandırılmış economy grant planı
- mevcut payment grant v1 kayıtlarını koruyan payment snapshot v2 adaptasyonu
- yalnız `COIN` ve `shop_item` açan fail-closed runtime capability registry
- geçersiz grant taşıyan yeni teklifleri checkout yüzeyinden gizleme
- multi-currency migration ve loot/container açılışını payment RNG'sinden ayıran ADR

### 63. `feature/shopier-live-acceptance-harness`
- public checkout kapalıyken çalışan, kesin onaylı ve düşük tutar sınırlı canlı kabul CLI'ı
- provider/DB mutation yapmayan dry-run; initialize, checkpoint, tek refund POST ve verify fazları
- immutable checkpoint, secret-safe manifest ve production evidence digest üretimi
- provider pending/succeeded, exact reversal ve duplicate refund idempotency doğrulaması
- kabul kanıtı oluşmadan normal checkout/refund registry'sini açmayan fail-closed sınır

### 64. `feature/bilingual-announcements-and-word-locales`
- kalıcı ve sekmeler arası senkron Türkçe/İngilizce web locale altyapısı
- güvenli içerik bloklarını koruyan çift dilli duyuru, güncelleme ve SSS akışı
- locale bazlı kategori/kelime paketleri ve sunucu otoriteli oda kelime dili
- cross-locale kategori/kelime bağlarını API ve socket sınırında reddeden kontroller

## Tamamlanan Docs-Only Branch'ler
- `docs/cleanup-roadmap-and-encoding`
  - stale roadmap ve tarihsel planning copleri temizlendi
  - aktif dokumanlar sadelestirildi ve karar odakli hale getirildi

## Tamamlanan Onemli Fix Branch'leri
- room regression fix zinciri
- dependency `undici` advisory hotfix
- room hydration ve single inspector yetki duzeltmeleri

## Not
Bu dosya sadece kalici olarak degerli tamamlanmis dilimleri tutar.
Eski gunluk debug notlari ve artik tekrar bakilmayan checklist'ler burada tutulmaz.
# Bilingual Theme And Player Surface Completion

- Duyuru modalı ve önizlemeleri ortak açık/koyu tema provider'ına bağlandı.
- Dashboard, envanter, mağaza, ayarlar, bildirim, destek, hesap kurtarma,
  checkout ve ödeme hukuki belge yüzeyleri TR/EN kapsamına alındı.
- Duyuru editöründeki ASCII Türkçe kalıntıları UTF-8 metinlerle değiştirildi ve
  repository mojibake taraması temizlendi.
