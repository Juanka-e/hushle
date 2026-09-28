# Payment Webhook Operations

## Mevcut Durum

PayTR sandbox callback zinciri aktiftir. Web route imzayı doğrular, normalize olayı
MySQL durable inbox'a yazar ve PayTR'ye yalnız bundan sonra `OK` döner. Ürün teslimi
request thread'inde değil, lease korumalı `apps/jobs` worker'ında yapılır.

## Veri Ayrımı

- MySQL: webhook inbox, delivery/attempt sayıları, retry/dead-letter, order ve
  fulfillment source of truth.
- Redis/Valkey: yalnız global job lease ve cache invalidation koordinasyonu.
- Redis kaybı event kaybettirmez; worker geçici durursa event MySQL'de bekler.
- Raw body, imza, kart verisi ve iletişim alanları saklanmaz. Yalnız body SHA-256
  ve bounded normalize metadata tutulur.

## Güvenlik Kontratı

1. Endpoint session, CSRF, Origin/Referer veya captcha beklemez.
2. Body `PAYMENT_WEBHOOK_MAX_BODY_BYTES` sınırıyla stream edilir.
3. PayTR HMAC raw byte üzerinden constant-time karşılaştırmayla doğrulanır.
4. Hatalı imza genel `400`, kapalı/eksik verifier `404` döndürür.
5. Durable insert başarısızsa `5xx` dönerek provider retry yapmaya zorlanır.
6. Worker callback'in order referansı, sandbox işareti, exact minor-unit tutarı,
   para birimi ve mevcut order state'ini tekrar doğrular.
7. Redirect veya browser sonucu hiçbir zaman `paid` kanıtı değildir.

## Worker

Dry-run:

```bash
npm run jobs:run -- payment-webhook dry-run
```

Execute:

```bash
JOBS_ENABLED=true npm run jobs:run -- payment-webhook execute
```

Production scheduler en fazla bir dakikalık aralıkla bu one-shot job'ı çağırmalıdır.
Global Redis lease aynı anda iki scheduler çağrısının aynı batch'i çalıştırmasını
engeller; DB claim token ise event seviyesindeki ikinci korumadır.

Checkout açılmadan önce:

```env
JOBS_ENABLED=true
PAYMENT_WEBHOOK_SCHEDULE_CONFIGURED=true
```

`PAYMENT_WEBHOOK_SCHEDULE_CONFIGURED` otomatik scheduler değildir; operatorün cron,
container scheduler veya platform job tanımını gerçekten kurduğunu preflight'a
beyan eden production gate'tir.

## İşleme Davranışı

- `awaiting_payment + payment_succeeded`: order `paid`, ardından atomik fulfillment.
- `awaiting_payment + payment_failed`: order `failed`, session token temizlenir.
- `paid/fulfilled + aynı success`: idempotent tekrar; ikinci grant oluşmaz.
- `created/pending_provider`: bounded retry; checkout finalize yarışına tolerans.
- tutar, currency, sandbox veya order uyuşmazlığı: non-retryable dead-letter.
- refund/chargeback: reversal uygulanmaz; ayrı reversal altyapısı tamamlanana kadar
  güvenli biçimde otomatik işlem dışı kalır.

Fulfillment sonrası oyuncuya tek ekonomi bildirimi oluşturulur. Bildirim teslim
işareti `PaymentFulfillment.notificationSentAt` üzerinde transaction ile tutulur;
worker crash/retry ikinci bildirim üretmez. Unread notification cache best-effort
invalidate edilir, MySQL yine source of truth'tür.

## Operasyon

- Retry gecikmesi bounded exponential backoff kullanır.
- Expired claim başka worker tarafından geri alınabilir.
- Dead-letter otomatik ürün vermez veya para iadesi yapmaz.
- Dead-letter kayıtları order, bounded error ve callback evidence ile manuel
  reconciliation için korunur.
- Checkout geçici kapatılırken `PAYMENTS_ENABLED=false` yapılır; bekleyen callback'ler
  için PayTR credential ve sandbox webhook verifier erişimi korunur.

## Testler

```bash
npm run test:payment-webhook
npm run test:payment-paytr-webhook
npm run test:payment-paytr-webhook-integration
```

Entegrasyon testi disposable MySQL üzerinde imzalı callback, duplicate delivery,
success/failed state, tek fulfillment, tek notification, invalid signature ve
amount mismatch dead-letter senaryolarını doğrular.
