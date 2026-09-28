# Provider-Neutral Payment Architecture

## Mevcut Durum (2026-08-08)

`feature/payment-orders-foundation` ile ödeme çekirdeğinin tahsilat yapmayan ilk katmanı eklendi:

- `PaymentOrder`, `PaymentAttempt` ve tekil `PaymentFulfillment` modelleri migration ile tanımlandı.
- Tutarlar kayan noktalı sayı yerine minor unit `Int` olarak, ürün/fiyat/currency/grant bilgileri sipariş snapshot'ı olarak tutuluyor.
- Kullanıcı + idempotency key unique constraint'i ve request fingerprint kontrolü aynı isteğin ikinci sipariş üretmesini engelliyor.
- Monoton sipariş state machine'i istemci redirect'inin doğrudan `paid` veya `fulfilled` durumuna sıçramasına izin vermiyor.
- Beş sağlayıcı registry'de bulunuyor; adapter uygulanmadığı için tamamı fail-closed ve tahsilat endpoint'i henüz yok.
- Integration Hub yalnız adapter/credential readiness gösteriyor. Secret değerleri admin paneline veya veritabanına taşınmıyor.
- Runtime seçiminde `PAYMENTS_ENABLED` ve `PAYMENT_ACTIVE_PROVIDER` fail-closed gate olarak kullanılıyor. Admin mutation/toggle, ilk adapter hazır olduğunda RBAC + audit + step-up ile eklenecek.

`feature/payment-webhook-inbox` ile ikinci güvenlik katmanı da hazırlandı:

- raw body doğrulanmadan parse edilmiyor; verifier yoksa endpoint fail-closed `404` dönüyor,
- yalnız doğrulanmış normalize event MySQL inbox'a yazılıyor; ham payload ve imza saklanmıyor,
- provider + event ID unique constraint'i duplicate teslimatı tek satırda topluyor,
- aynı event ID'nin farklı body hash ile gelmesi kimlik çatışması olarak reddediliyor,
- bounded retry, claim lease ve dead-letter worker temeli mevcut Redis job lease sistemiyle uyumlu çalışıyor,
- Redis/Valkey yalnız koordinasyon içindir; webhook source of truth ve retry state'i MySQL'dir.

Bu aşamada `PAYMENTS_ENABLED=false` kalmalıdır. Provider signature adapter'ı ve idempotent order processor tamamlanmadan gerçek checkout açılmaz.

`feature/payment-checkout-ui` ile tahsilat yapmayan üçüncü katman tamamlandı:

- gerçek para teklifleri coin kataloğundan ayrı, sürümlü `PaymentOffer` kayıtlarıdır,
- checkout ve sipariş durumu UI/API sözleşmesi web için hazırdır,
- fiyat, para birimi ve grant verisi yalnız sunucu teklifinden alınır,
- sipariş sahibi dışındaki kullanıcı order status okuyamaz,
- checkout create kullanıcı ve hash'lenmiş IP için ayrı Redis/Valkey rate limit kullanır,
- KVKK aydınlatması onay kutusuna dönüştürülmez; ön bilgilendirme ve satın alma koşulu kabulü ayrı biçimde gösterilir,
- belge sürümleri ve kabul zamanı siparişe bağlı `PaymentCheckoutConsent` kaydında değiştirilemez biçimde tutulur,
- işletme bilgileri ve hukuk onayı tamamlanmadıkça legal readiness fail-closed kalır,
- adapter bulunmadığı için bu branch gerçek provider session veya tahsilat oluşturmaz.

`feature/paytr-iframe-adapter` ile ilk provider adapter temeli eklendi:

- PayTR token ve callback HMAC-SHA256 sözleşmeleri ayrı adapter'da uygulanır,
- tutar ve sepet minor unit üzerinden eşleştirilir,
- callback kritik alanları duplicate/body mutation saldırılarına karşı doğrulanır,
- sağlayıcı hataları bounded kodlara dönüştürülür; ham neden ve secret sızdırılmaz,
- ad, telefon ve adres kalıcı ödeme/audit modeline eklenmez,
- checkout orchestration, order processor ve fulfillment bitmediği için adapter
  registry'ye bağlanmaz ve tahsilat fail-closed kalır.

`feature/payment-fulfillment-foundation` ile teslimat çekirdeği eklendi:

- ortak wallet mutation kodu `@hushle/platform-wallet` paketine taşındı,
- `payment_topup` coin kaynağı earned/admin/grant coin'den ayrıldı,
- paid order row lock altında strict grant snapshot ile işlenir,
- fulfillment, coin/envanter grant'i ve order state aynı transaction'da yazılır,
- duplicate ve concurrent çağrılar ikinci grant üretmez,
- invalid/already-owned/missing item durumları bounded failure olarak tutulur.

`feature/paytr-checkout-orchestration` ile ilk çalıştırılabilir checkout bağlantısı
yalnız sandbox için eklendi:

- provider registry yalnız `PAYTR_CHECKOUT_MODE=sandbox` iken PayTR'yi hazır sayar;
  `live` fail-closed kalır,
- doğrulanmış hesap e-postası sunucudan alınır; ad-soyad, telefon ve adres token
  isteğinden sonra DB, audit veya log'a yazılmaz,
- order/attempt hazırlığı ve provider çağrısı ayrıdır; ağ beklemesi DB transaction'ını
  açık tutmaz,
- attempt lease ve mevcut session dönüşü concurrent/duplicate token isteklerini
  ikinci tahsilat oturumuna dönüştürmez,
- iFrame session yalnız sipariş sahibine ve yalnız `awaiting_payment` durumunda
  döner,
- coin pack teklifleri chargeback/refund reversal tamamlanana kadar gizlenir,
- redirect yine ödeme kanıtı değildir; webhook processor tamamlanmadan sipariş
  `paid` durumuna geçemez.

`feature/paytr-webhook-order-processor` ile sandbox callback teslim zinciri
tamamlandı:

- PayTR verifier yalnız sandbox credential hazırken webhook registry'ye bağlanır,
- imzalı callback hızlıca MySQL inbox'a yazılır; fulfillment jobs runtime'da çalışır,
- worker provider order referansı, exact tutar, currency, sandbox işareti ve state'i
  row lock altında doğrular,
- success callback order'ı `paid` yapıp atomik fulfillment çalıştırır; failed callback
  order'ı terminal `failed` durumuna alır,
- duplicate event, worker restart ve claim expiry ikinci grant veya bildirim üretmez,
- fulfillment bildirimi kalıcı `notificationSentAt` işaretiyle idempotenttir,
- production preflight checkout için aktif jobs runtime ve gerçek scheduler beyanı
  ister,
- refund/chargeback reversal ve live PayTR hâlâ fail-closed kapsam dışıdır.

## Ürün Kararı

İlk sürüm kayıtlı oyuncular için `checkout` olacaktır: kozmetik, bundle veya ileride coin paketi satın alma. Oyuncunun gerçek para çektiği `cash-out/payout` ilk kapsamda yoktur. Payout; KYC/AML, vergi, fraud ve ülke bazlı lisans gereksinimleri nedeniyle ayrı hukuki ve teknik projedir.

İlk ticari ürün olarak doğrudan kozmetik/bundle satın alımı, coin top-up'tan daha güvenlidir. Coin satışı chargeback sonrasında harcanmış bakiyenin nasıl geri alınacağını gerektirir; bu politika tamamlanmadan paid coin açılmaz.

## Desteklenecek Sağlayıcı Modeli

Adapter registry aşağıdaki provider ID'lerini taşıyacak:

- `shopier_v2`
- `iyzico`
- `paytr`
- `stripe`
- `lemonsqueezy`

Hepsini aynı anda bağlamak yerine ortak çekirdek tamamlandıktan sonra adapter'lar tek tek sandbox + webhook testleriyle eklenir. Merchant hesabı, ülke uygunluğu, ürün politikası, para birimi, vergi ve sözleşme onayı kod tarafından varsayılmaz.

Admin panelden aktif sağlayıcı değiştirilebilir, fakat:

- değişiklik yalnız yeni siparişleri etkiler,
- açık sipariş kendi `provider` ve `providerConfigVersion` snapshot'ıyla devam eder,
- secret key'ler veritabanına veya admin formuna yazılmaz; env/secret manager'da kalır,
- provider kapatmak webhook doğrulamasını kapatmaz; eski sipariş bildirimleri işlenmeye devam eder,
- para birimi/ürün uyumsuzsa provider seçimi kaydedilemez.

## Paket Yapısı

```text
packages/platform-payments/
  src/contracts.ts
  src/order-state-machine.ts
  src/orders.ts
  src/provider-registry.ts
  src/webhook-inbox.ts
  src/fulfillment.ts
  src/adapters/
    shopier-v2.ts
    iyzico.ts
    paytr.ts
    stripe.ts
    lemonsqueezy.ts

packages/platform-wallet/
  src/index.ts

apps/web/src/app/api/payments/
  checkout/session/route.ts
  orders/[id]/route.ts
  webhooks/[provider]/route.ts

apps/jobs/src/
  payment-webhook-worker.ts
  payment-reconciliation-worker.ts
```

UI, domain ve provider adapter'ı birbirinden ayrılır. Web ve ileride mobile app aynı payment API contract'ını kullanır.

## Veri Modeli

### PaymentOrder

- internal order ID
- immutable user ID
- provider ve provider config version
- product/price/currency minor-unit snapshot
- status: `created`, `pending_provider`, `awaiting_payment`, `paid`, `fulfilled`, `failed`, `expired`, `refunded`, `chargeback`
- server-generated idempotency key
- provider order/session reference
- created/updated/paid timestamps

### PaymentAttempt

- order ID
- attempt number
- request fingerprint/hash
- provider request ID
- status ve bounded hata kodu
- secret veya kart verisi içermez

### PaymentWebhookEvent

- provider + provider event ID unique constraint
- raw body hash, imza sonucu ve received timestamp
- bounded/encrypted veya retention kontrollü payload
- processing status, retry count ve last error code
- aynı event tekrar geldiğinde fulfillment çalışmaz

### PaymentFulfillment

- order ID unique
- wallet ledger transaction veya entitlement grant reference
- aynı transaction ikinci kez coin/kozmetik yazamaz
- payment snapshot v1 geriye uyumludur; yeni v2 snapshot ortak sürümlü economy grant
  planını taşır ve runtime capability dışında kalan asset/catalog effect'lerini fail-closed reddeder

Ekonomi grant sözleşmesi, multi-currency geçişi ve loot box sınırı için
`adr-004-versioned-economy-grants-and-loot-boundary.md` geçerlidir. Provider adapter'ları
RNG çalıştırmaz ve ödül içeriğini browser/provider payload'ından almaz.

## Checkout Güvenliği

1. Kullanıcı authenticated olmalı; session sunucuda tekrar doğrulanır.
2. Suspended/required-email-verification hesabı politika gereği reddedilir.
3. Ürün, fiyat, currency ve verilecek içerik yalnız sunucu kataloğundan snapshot alınır.
4. Checkout create, kullanıcı ID + IP bazında Redis rate limit kullanır.
5. Aynı kullanıcı/idempotency key aynı siparişi döndürür; yeni tahsilat başlatmaz.
6. Provider isteği server-to-server yapılır ve provider destekliyorsa ayrıca idempotency header gönderilir.
7. Başarı redirect'i ödeme kanıtı değildir. Yalnız imzalı webhook veya provider verify/retrieve sonucu siparişi `paid` yapabilir.
8. Fulfillment ve ledger yazımı tek transaction/unique constraint ile atomik olur.
9. İstemciye secret, provider ham hata, fraud kuralı veya başka kullanıcının order ID'si gönderilmez.

iyzico initialize özelinde provider genel idempotency garantisi vermediği için ağ
timeout'u normal retry sayılmaz. Attempt `uncertain` olur, reconciliation vakası
açılır ve operator/provider doğrulaması olmadan ikinci initialize yapılmaz.
Server-side retrieve sonucu minimize edilmiş `PaymentCheckoutVerification` kaydına
yazılır; owner callback dahil hicbir browser donusu tek basina paid/fulfillment
gecisi uretmez.

iyzico owner session route'u browser session, verified email, capability, current
legal consent ve user/IP limiter ister. Provider'in cross-site form callback'i ise
browser cookie'sine dayanmaz: opaque order UUID + server-owned token korelasyonu,
constant-time compare ve signed exact retrieve ister. Callback raw token'i redirect
ve loglara tasimaz; webhook/reconciliation yetkisini devralmaz. New-sale mode ile
callback mode ayri tutulur, boylece yeni satis durdurulurken outstanding siparisler
guvenle sonuclanabilir.

## Webhook Güvenliği

- Raw body parse edilmeden önce provider imzası doğrulanır.
- Provider başına ayrı signature adapter kullanılır.
- Stripe event ID, iyzico conversation/payment reference, PayTR merchant order ID ve provider eşdeğerleri dedupe edilir.
- Yanlış imza genel `400` döner ve secret/hashing detayı loglanmaz.
- Geçerli event durable inbox'a yazılınca hızlı provider-specific başarı cevabı dönülür.
- Worker order amount, currency, provider reference ve beklenen state'i tekrar doğrular.
- Out-of-order, duplicate, refund ve chargeback event'leri state machine dışında işlem yapamaz.
- Reconciliation job pending siparişleri provider API üzerinden kontrollü olarak karşılaştırır.

iyzico Checkout Form webhook'u tutar/currency taşımadığı için Signature V3 tek
başına fulfillment kanıtı değildir. V3 doğrulaması, merchant/order/token/payment
referansı korelasyonu ve server-side retrieve ile oluşan exact
`PaymentCheckoutVerification` birlikte sağlanmadan sipariş `paid` olmaz. Legacy
iyzico signature sürümleri compatibility fallback olarak kabul edilmez.

## Rate Limit Ayrımı

- Checkout create: user + IP, düşük limit, idempotent retry toleransı.
- Order status: yalnız order sahibi, kısa cache/poll backoff.
- Webhook: browser limiter kullanılmaz; endpoint/body-size ve invalid-signature burst limiti kullanılır.
- Admin provider değişimi: admin session + RBAC + step-up + audit + düşük mutation limiti.
- Refund/reconcile: yalnız admin/jobs, distributed lock ve audit.

Rate limit hiçbir zaman geçerli webhook tekrarını kalıcı olarak kaybettirmemeli. Sağlayıcı retry davranışı için hızlı inbox kaydı ve idempotent worker şarttır.

## Coin ve Chargeback Politikası

- `payment_topup`, `purchase_spend`, `refund` ve `chargeback` ayrı ledger source olarak kalır.
- Paid coin ile earned coin kaynağı audit'te ayrılır.
- Chargeback geldiğinde kör biçimde bütün bakiyeyi negatife çekmek yerine ilgili paid grant/reward lot'u terslenir.
- Harcanmış paid bakiye reversal kanıtında manuel incelemeye ayrılır; bu aşamada
  otomatik hesap kısıtı uygulanmaz ve oyunla kazanılmış ödüle büyük ceza verilmez.
- Kozmetik doğrudan satın alındıysa entitlement revoke/freeze politikası ürün şartlarında açık olmalıdır.

## Adapter Sırası

1. `feature/payment-orders-foundation`: şema, state machine, provider registry, idempotency ve admin readiness.
2. `feature/payment-webhook-inbox`: raw-body signature contract, durable inbox, jobs/retry/reconciliation.
3. `feature/payment-checkout-ui`: tamamlandı; kayıtlı kullanıcı checkout/order status UI, legal versioning ve mobile contract notları.
4. `paytr` iFrame kriptografik/transport adapter temeli: tamamlandı; aktivasyon,
   processor ve fulfillment ayrı güvenlik diliminde tamamlanacak.
5. `iyzico` Checkout Form HMAC/transport, request-only buyer data, durable
   initialize/retrieve, Signature V3 webhook, reconciliation, owner-only
   session/callback ve just-in-time UI tamamlandi. Registry adapter'i yalniz tum
   explicit sandbox kapilari acikken route edilebilir; hukuki onay, gercek merchant
   sandbox kabulu ve ayri live implementasyonu bitmeden production tahsilat acilmaz.
6. `shopier_v2`: Güncel v1 API ile siparişe özel `customListing` dijital ürün checkout
   foundation'ı eklendi. Ortak katalog yerine stok 1 private link ve exact server price
   kullanılır. HS256 `order.created`, replay/account/dedupe kontrolleri, exact proof,
   e-posta uyuşmazlığında inceleme ve idempotent fulfillment tamamlandı. Reconciliation,
   refund ve gerçek düşük tutarlı kabul bitene kadar registry fail-closed kalır.
7. `stripe` Checkout Session sandbox transport temeli: tamamlandı; webhook processor,
   merchant ülke uygunluğu ve sandbox kabulü bitene kadar devre dışı. Türkiye mevcut
   resmi merchant ülke listesinde olmadığı için production önceliği değildir.
8. `lemonsqueezy` adapter'ı; Merchant of Record ürün/ülke uygunluğu doğrulandıktan sonra.
9. Refund HMAC/transport adapter foundation: tamamlandı.
10. Durable refund attempt, uncertain-state recovery, ikinci admin ve operasyon paneli:
   tamamlandı; production çağrısı gerçek merchant sandbox kabulü ve ayrıca live onay
   verilene kadar kapalıdır.

Bir adapter production smoke testini geçmeden admin seçim listesinde `Hazır` görünmez.

## Resmi Kaynaklar

- [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions)
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Stripe webhook security](https://docs.stripe.com/webhooks)
- [iyzico Checkout Form initialize](https://docs.iyzico.com/en/payment-methods/checkoutform/cf-implementation/cf-initialize)
- [iyzico webhook ve Signature V3](https://docs.iyzico.com/en/advanced/webhook)
- [PayTR iFrame API](https://dev.paytr.com/iframe-api)
- [PayTR İade API](https://dev.paytr.com/iade-api)
- [Lemon Squeezy webhook requests](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests)
