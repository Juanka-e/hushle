# Shopier Custom Listing Checkout Foundation

## Karar

Shopier v1 API uygulama tarafında doğrudan ödeme oturumu oluşturmaz. Bunun yerine
ürün oluşturma API'si bir Shopier ürün URL'si döndürür. Hushle ortak bir katalog
ürününe yönlendirme yapmaz; her iç ödeme siparişi için:

- `type=digital`
- `customListing=true`
- `stockQuantity=1`
- `shippingPayer=sellerPays`
- sunucunun belirlediği exact fiyat ve para birimi

ile siparişe özel liste oluşturur. Dönen product ID iç siparişin
`providerSessionReference` alanına bağlanır.

Ortak ürün kullanmak; aynı tutardaki iki siparişi, kullanıcıyı ve webhook sonucunu
güvenli biçimde eşlemeye yetmediği için reddedilmiştir.

## Güvenlik Sınırları

- Yalnız sabit `https://api.shopier.com/v1/products`,
  `https://api.shopier.com/v1/orders` ve `https://api.shopier.com/v1/refunds`
  endpoint'leri çağrılır.
- PAT yalnız `Authorization: Bearer` başlığında taşınır; body, DB, audit veya loga yazılmaz.
- Provider redirect takip edilmez.
- Request 10 saniye, response 64 KiB ile sınırlıdır.
- Dönen product ID, `www.shopier.com/{id}` URL'si, başlık, fiyat, para birimi,
  dijital ürün, custom listing, stok ve kargo alanları exact doğrulanır.
- Shopier create endpoint'i idempotency anahtarı yayımlamadığı için timeout sonucu
  otomatik retry edilmez. Attempt `uncertain` olur ve sonraki dilimde reconciliation
  ile çözülür.
- Checkout user/IP dağıtık rate limitlerini ve mevcut rollout/emergency pause
  kontrollerini kullanır.
- Shopier checkout ek kimlik/adres verisini Hushle'da toplamaz. Kullanıcı Shopier
  sayfasında kayıtlı hesabındaki doğrulanmış e-postayı kullanması gerektiğini görür.
- `order.created` webhook'unda e-posta uyuşmazsa sonraki dilimde fulfillment yerine
  manuel inceleme açılacaktır.

## Aktivasyon Durumu

Shopier yalnız canlı API yayımladığı için sahte sandbox modu tanımlanmaz. Foundation
env sözleşmesi:

```env
SHOPIER_PERSONAL_ACCESS_TOKEN=
SHOPIER_PRODUCT_MEDIA_URL=https://cdn.example.com/payments/hushle-product.png
SHOPIER_CHECKOUT_MODE=disabled
SHOPIER_WEBHOOK_MODE=disabled
SHOPIER_RECONCILIATION_MODE=disabled
SHOPIER_REFUND_MODE=disabled
SHOPIER_WEBHOOK_TOKEN=
SHOPIER_ACCOUNT_ID=
SHOPIER_LIVE_ACCEPTANCE_RECORDED=false
SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_FILE=
SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_SHA256=
```

`adapterAvailable=true` olur ancak tüm modlar `live`, canlı kabul kaydı ve dosya
özeti doğrulanmış kanıt olmadan runtime ve production preflight fail-closed kalır.

Tamamlanan webhook katmanı:

- HS256 signed `order.created` doğrulaması
- bağlı olmayan event türlerini inbox'a yazmadan reddeden fail-closed event kapısı
- account ID, 5 dakikalık timestamp replay window ve raw-body digest dedupe
- resmî webhook ID metadata korelasyonu; imzalanmayan ID/timestamp değişikliğine karşı
  dedupe kimliği imzalı payload digest'inden türetilir
- tek dijital ürün, adet 1, exact product/title/tutar/currency doğrulaması
- keyed HMAC e-posta korelasyonu; uyuşmazlıkta teslimat yerine inceleme vakası
- idempotent coin/kozmetik fulfillment ve notification

Tamamlanan reconciliation katmanı:

- ayrı `SHOPIER_RECONCILIATION_MODE=live` aktivasyon kapısı
- ayrı `SHOPIER_REFUND_MODE=live` aktivasyon kapısı; `pending` veya belirsiz sonuçta oyuncu hakkı değiştirilmez
- timeout sonucu belirsiz ürün oluşturmayı exact ve tekil Product API eşleşmesiyle kurtarma
- sıfır/çoklu ürün eşleşmesinde otomatik create retry veya tahmin yapmama
- ürün ID ile Order API sorgusu; exact line item/totals ve keyed-HMAC alıcı e-postası
  doğrulanmadan fulfillment yapmama
- aktif refund görüldüğünde otomatik grant yerine inceleme vakası
- webhook, job ve admin çağrılarında ortak satır kilidi ve exact-proof işlemcisi

Tamamlanan refund katmanı:

- farklı ikinci admin onayı ve yalnız tam tutarlı API iadesi
- kalıcı provider refund attempt ile Shopier refund ID eşlemesi
- `pending` ve timeout sonucunda entitlement değiştirmeden `provider_review`
- kör POST tekrarı yerine refund ID ile GET; ID yoksa dar zaman aralığında exact ve
  tekil order/tutar/currency eşleşmesi
- imzalı `refund.requested` ve `refund.updated` olaylarının idempotent işlenmesi
- sistem dışında veya kısmi başlatılmış iadelerde otomatik oyuncu cezası yerine
  reconciliation vakası
- `succeeded` kanıtı ile merkezi reversal; duplicate webhook/recovery yarışında tek uygulama
- admin panelinde sağlayıcı iade ID'si ve sağlayıcı bazlı readiness görünümü

Kalan canlı aktivasyon kapıları:

1. Shopier panelinde webhook subscription ve worker/scheduler smoke doğrulaması.
2. Gerçek düşük tutarlı ödeme, pending iade, succeeded iade ve duplicate teslim kabulü.
3. `shopier-live-acceptance-v1` kanıt manifestinin güvenli dosyada kaydı ve SHA-256 eşleşmesi.
4. Satıcı hesabı, vergi/fatura ve dijital ürün uygunluğunun hukuki/operasyonel onayı.

## Canlı Kabul Harness'i

Shopier sandbox yayımlamadığı için kabul, gerçek fakat düşük tutarlı tek bir siparişle
yapılır. Harness normal registry'yi açmaz ve `SHOPIER_LIVE_ACCEPTANCE_RECORDED` değerini
kendisi değiştirmez. Kabul boyunca:

- `PAYMENTS_ENABLED=false` kalır; oyuncular checkout açamaz,
- ödeme webhook'unu ve mutabakatı gözlemek için checkout/webhook/reconciliation modları
  `live` olur,
- `SHOPIER_REFUND_MODE=disabled` kalır; yalnız acceptance CLI iade POST'u atabilir,
- işlem limiti varsayılan 5.000 minor unit (50 TRY), değiştirilemez hard ceiling ise
  10.000 minor unit'tir (100 TRY),
- PAT, webhook token ve e-posta hiçbir çıktıya; ham provider referansları checkpoint ve
  final manifeste yazılmaz. `initialize` çıktısındaki tek kullanımlık checkout URL'si
  ödemeyi tamamlayacak operatöre gösterilir.

Gerekli kesin onay:

```env
SHOPIER_ACCEPTANCE_CONFIRM=I_CONFIRM_A_REAL_LOW_VALUE_SHOPIER_TRANSACTION
```

Akış:

1. `dry-run`: kullanıcı, offer, tutar sınırı, TRY para birimi ve media URL'sini doğrular;
   provider çağrısı ve DB yazımı yapmaz, PAT veya canlı işlem onayı gerektirmez.
2. `initialize`: doğrulanmış acceptance kullanıcısı ve aktif düşük tutarlı offer için iç
   sipariş ve stok 1 custom listing oluşturur. Bu faz Shopier'da ürün oluşturur, karttan
   para çekmez. Dönen URL'de operatör gerçek ödemeyi tamamlar.
3. `capture-payment`: imzalı webhook, exact ödeme kanıtı, fulfillment ve kapanmış
   reconciliation durumunu doğrular; immutable payment checkpoint yazar.
4. Admin ödeme ekranında birinci admin `provider_api` tam iade talebi oluşturur.
   `refund` fazı farklı ikinci admin ID'sini doğrular, durable local processing kaydından
   sonra tek canlı refund POST'u gönderir ve immutable refund checkpoint yazar.
5. `verify`: pending/processing niyetinin kaydını, provider `succeeded` sonucunu,
   entitlement reversal'ı ve duplicate refund olayının ikinci kez hak düşürmediğini
   doğrular. Provider'a yalnız bounded iki GET yapar ve final manifesti exclusive yazar.

Komutlar:

```bash
npm run payment:shopier-live-acceptance -- dry-run
npm run payment:shopier-live-acceptance -- initialize
npm run payment:shopier-live-acceptance -- capture-payment
npm run payment:shopier-live-acceptance -- refund
npm run payment:shopier-live-acceptance -- verify
```

Her checkpoint ve final output mutlak path olmalı; mevcut dosyanın üzerine yazılmaz.
`verify` çıktısındaki digest, production env'de
`SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_SHA256` olur. Dosyanın mutlak path'i
`SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_FILE` olarak salt-okunur mount edilir. Ancak ayrı
hukuki/operasyon onayı tamamlandıktan sonra `SHOPIER_LIVE_ACCEPTANCE_RECORDED=true` ve
runtime modları production deploy'da açılır.

## Resmi Sözleşme

- API base/version: `https://api.shopier.com/v1/`
- Kimlik doğrulama: PAT veya OAuth 2.0 Bearer token
- API quota: application-user başına 200 istek/dakika
- Webhook: HTTPS, 5 saniyede 200, HS256/HMAC-SHA256, en fazla 9 retry
- Kullanılan yetkiler: `products:write`, ileride `products:read`, `orders:read`,
  `refunds:read`, `refunds:write`

Kaynaklar:

- https://developer.shopier.com/reference/post-products
- https://developer.shopier.com/reference/get-products
- https://developer.shopier.com/reference/get-orders
- https://developer.shopier.com/reference/events-headers-payloads
- https://developer.shopier.com/reference/webhook-configuration
- https://developer.shopier.com/reference/post-refunds
- https://developer.shopier.com/reference/rate-limits
