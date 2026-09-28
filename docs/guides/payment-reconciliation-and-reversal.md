# Ödeme Uzlaştırma ve Ters İşlem Operasyonları

## Mevcut Durum

- PayTR sandbox durum sorgusu yalnız sabit HTTPS endpoint üzerinden, HMAC token,
  timeout ve 16 KiB response sınırıyla yapılır.
- `payment-reconciliation` job'ı eski `awaiting_payment` siparişleri sınırlı batch
  halinde inceler ve Redis global lease kullanır.
- Varsayılan 12 otomatik denemeden sonra provider sorgusu durur; açık vaka manuel
  inceleme için korunur ve sonsuz retry trafiği oluşmaz.
- Tutar, para birimi veya sandbox modu uyuşmazsa sipariş teslim edilmez; tekil bir
  `PaymentReconciliationCase` açılır.
- Provider dönüş/iade kaydı bildirirse otomatik entitlement değişikliği yapılmaz.
- `/admin/payments` sipariş, son webhook, dead-letter, bekleyen ikinci onay ve
  uzlaştırma durumunu gösterir.
- Açık vaka ve dead-letter sayıları yapılandırılabilir eşikleri geçtiğinde yalnız
  admin ekranında uyarı oluşur. Oyuncuya otomatik ceza veya bakiye işlemi uygulanmaz.

## iyzico Uzlaştırma Sınırı

- iyzico sorguları yalnız `IYZICO_CHECKOUT_MODE=sandbox` ve
  `IYZICO_RECONCILIATION_MODE=sandbox` birlikte açıkken job/admin tarafından çalışır.
- Sunucuda saklanan Checkout Form tokenı varsa provider retrieve çağrısı yapılır. Tutar,
  ödenen tutar, para birimi, conversation/token bağı, ödeme durumu ve fraud durumu exact
  doğrulanmadan sipariş `paid` veya `fulfilled` yapılmaz.
- Webhook kaybolsa bile exact retrieve kanıtı aynı idempotent fulfillment yolunu
  çalıştırabilir. Eşzamanlı webhook, job ve admin çağrıları sipariş/fulfillment satır
  kilitleriyle tek grant ve tek bildirim üretir.
- Initialize timeout sonrasında token yoksa provider retrieve teknik olarak mümkün
  değildir. Vaka `iyzico_initialize_uncertain_manual_review` olarak korunur; otomatik
  initialize retry, ödeme tahmini, ceza veya entitlement değişikliği yapılmaz.
- `paid` görünen fakat exact `PaymentCheckoutVerification` kanıtı bulunmayan iyzico
  siparişi tamamlanmaz ve manuel incelemeye alınır.
- Ortak `PAYMENT_RECONCILIATION_MAX_ATTEMPTS` sınırından sonra otomatik sorgu durur;
  operatör provider paneli ve kalıcı vaka kanıtıyla karar verir.

## Shopier Uzlaştırma Sınırı

- Checkout, signed webhook ve reconciliation modlarının üçü de `live` değilse
  Shopier siparişleri job batch'ine girmez ve admin sorgusu fail-closed kapanır.
- Product API idempotency anahtarı sağlamadığı için timeout sonrasında ikinci create
  yapılmaz. Yalnız exact ve tekil custom listing iç siparişe bağlanır.
- Order API ürün ID ile en fazla iki kayıt ister. Sıfır/çoklu sonuç, aktif refund,
  ek line item, shipping/discount, tutar, para birimi, ürün veya alıcı e-posta
  uyuşmazlığı otomatik teslimatı durdurur ve inceleme vakası oluşturur.
- Alıcı e-postası log, audit veya snapshot'a yazılmaz; bellekte keyed HMAC ile hesap
  e-postasına bağlanır.
- Webhook ve Order API aynı exact-proof transaction'ını kullanır. Eşzamanlı job,
  webhook ve admin sorgusunda tek verification, grant ve bildirim oluşur.
- 200 istek/dakika provider kotası; bounded batch, Redis global lease, 15 dakikalık
  schedule ve maksimum deneme sayısıyla korunur. 429 sonraki pencereye bırakılır.

## Vaka Çözümleme

- Açık vaka `resolved` veya `ignored` kararı, zorunlu operatör notu ve admin kimliğiyle
  kalıcı olarak kaydedilir.
- `resolved` yalnız sipariş terminal durumdaysa kullanılabilir. Böylece ödeme bekleyen
  bir sipariş yanlışlıkla çözülmüş gösterilemez.
- `ignored`, sağlayıcı panelinde bilinçli inceleme sonrasında otomatik sorgulamayı
  durdurur; karar geçmişini silmez.
- Eşikler `PAYMENT_OPEN_CASE_ALERT_THRESHOLD` ve
  `PAYMENT_DEAD_LETTER_ALERT_THRESHOLD` ile belirlenir. Varsayılanlar 25 ve 10'dur.

## Reversal Güvenlik Politikası

Admin paneli iki ayrı akış sunar. `externally_confirmed` modunda ilk operatör provider
panelindeki işlemi tamamlayıp referansıyla yerel reversal ister. `provider_api` modu
yalnız hazır PayTR sandbox yapılandırmasında tam iade çağrısı yapar. İki modda da talebi
oluşturan admin kendi talebini onaylayamaz veya reddedemez; farklı bir admin talep
UUID'si ve zorunlu inceleme notuyla karar verir.

- Kozmetikte yalnız fulfillment `grantResult` içindeki kesin inventory ID'leri
  kaldırılır. Başka kaynaktan kazanılan item korunur.
- Kaldırılan item kuşanılmışsa yalnız ilgili profil slotu temizlenir.
- Talep geçmişi oluşturan, inceleyen, karar ve zaman bilgileriyle korunur.
- Admin rolü API girişinde ve ödeme servisinin transaction'ı içinde yeniden
  doğrulanır; yalnız istemci veya route seviyesindeki kontrole güvenilmez.
- Onay, sipariş satır kilidi altında entitlement değişikliğiyle aynı transaction'da
  uygulanır. Eşzamanlı çift onaydan yalnız biri başarılı olabilir.
- Sipariş başına tek uygulanmış reversal vardır; yeni bekleyen talepler aynı sipariş
  satır kilidiyle seri hale getirilir.
- Refund daha sonra chargeback'e dönüşebilir; entitlement ikinci kez kaldırılmaz.
- Yeni coin fulfillment'ları siparişe tekil lot kanıtı taşır. Reversal yalnız bu
  lotta kalan coinleri `payment_reversal` ledger kaydıyla düşer; earned/grant/admin
  coinlere dokunmaz.
- Harcanmış ücretli coin bakiye eksiye çekilmez. Geri alınabilen miktar otomatik
  uygulanır, harcanmış fark `manual_review` kanıtında operatöre gösterilir.
- Lot özelliğinden önce oluşmuş fulfillment tahmin edilmez ve güvenli biçimde
  `legacy_manual_review_no_wallet_mutation` politikasında kalır.
- Oyuncuya yalnız genel durum bildirimi gider. Provider iç hata kodları ve koruma
  ayrıntıları istemciye gönderilmez.
- Timeout veya bağlantı kopması provider başarısızlığı sayılmaz. Talep
  `provider_review` durumunda kalır, yeni refund engellenir ve yerel entitlement
  değiştirilmez. Recovery yalnız exact referans, tutar ve tamamlanmış PayTR iade
  kaydıyla uygulanır.

## Ücretli Coin Manuel İnceleme

- Harcanmış ücretli coin veya lot özelliğinden önceki belirsiz kayıt, reversal ile
  aynı transaction içinde tekil bir `PaymentManualReviewCase` oluşturur.
- Açık vaka neden kodu, geri alınamayan coin miktarı ve reversal ilişkisiyle admin
  ödeme ekranında görünür. Tarihsel kapanmış kayıtlar açık vaka sayacını şişirmez.
- Admin vakayı `resolved` veya `waived` kararı ve zorunlu operasyon notuyla kapatır.
  Karar veren admin ve zaman bilgisi kalıcı tutulur; aynı vaka ikinci kez kapatılamaz.
- Bu karar bakiye, askıya alma, ekonomi guard veya güvenlik puanı değiştirmez. Para
  ya da coin üzerinde ek otomatik işlem üretmek bu akışın bilinçli olarak dışındadır.
- Oyuncu bildirimi isteğe bağlıdır. Boş mesajda güvenli genel metin kullanılır;
  provider kanıtı, iç hata kodu ve abuse sinyali oyuncuya gönderilmez.
- Endpoint admin oturumunu ve servis transaction'ı içindeki güncel admin rolünü
  ayrı ayrı doğrular; reversal UUID tekrar onayı, admin/IP rate limit ve audit kaydı
  zorunludur. Serbest bildirim metni audit metadata'ya kopyalanmaz.

## Çalıştırma

```bash
npm run jobs:run -- payment-reconciliation dry-run
JOBS_ENABLED=true npm run jobs:run -- payment-reconciliation execute
```

Production'da ödeme açılmadan önce hem webhook hem reconciliation scheduler'ı ayrı
olarak kurulmalı ve aşağıdaki onaylar verilmelidir:

```dotenv
PAYMENT_WEBHOOK_SCHEDULE_CONFIGURED=true
PAYMENT_RECONCILIATION_SCHEDULE_CONFIGURED=true
```

Yerel reversal operasyonu için en az iki ayrı admin hesabı hazır olmalıdır. Bu,
uygulama içindeki ikinci onay kontrolünün operasyonel ön koşuludur.

## Dead-Letter Retry

Admin retry yalnız `dead_letter` kaydını tekrar kuyruğa alır. Event UUID'si body'de
ikinci kez doğrulanır, admin/IP rate limit uygulanır ve önceki hata/attempt bilgisi
audit metadata'ya yazılır. Retry provider callback imzasını veya sipariş tutar
kontrolünü atlamaz.

## Gelecek Sınırlar

- Live PayTR refund açılışı resmi sandbox kabul/smoke testi, runbook onayı ve ayrı
  production değişikliği gerektirir. Mevcut preflight production refund modunu kapalı
  tutar.
- Kısmi iade; ürün miktarı, bundle entitlement ve coin lot paylaştırma politikası
  tasarlanmadan eklenmemelidir.
- Reconciliation alarm metrikleri merkezi observability exporter'a bağlanmalıdır.
- Alarm metrikleri exporter'a bağlandığında eşik aşımı merkezi uyarı kanalına
  yönlendirilmeli; admin sayfasındaki mevcut uyarı yedek görünüm olarak korunmalıdır.
