# PayTR Sandbox Refund Acceptance Runbook

## Amaç ve Sınır

Bu runbook PayTR sandbox'ta tamamlanmış tek bir test siparişinin tam iadesini uçtan
uca doğrular. Test gerçek production para hareketi değildir ancak seçilen sandbox
siparişinde provider iadesi ve yerel entitlement reversal oluşturur.

- Kısmi iade desteklenmez.
- Live/production refund açılmaz.
- Aynı admin hem talep hem onay veremez.
- Komut `NODE_ENV=production` ortamında çalışmaz ve yalnız adı `test`, `dev` veya
  `sandbox` içeren veritabanlarını kabul eder.
- Timeout sonrasında komut tekrar çalıştırılmaz; admin panelindeki recovery kullanılır.

## Ön Koşullar

1. `PAYTR_CHECKOUT_MODE=sandbox` ve `PAYTR_REFUND_MODE=sandbox` olmalı.
2. Geçerli `PAYTR_MERCHANT_ID`, `PAYTR_MERCHANT_KEY` ve `PAYTR_MERCHANT_SALT`
   yalnız süreç environment'ında bulunmalı.
3. Sandbox checkout ve webhook ile oluşmuş, `fulfilled` durumda ve fulfillment'ı
   `completed` olan bir PayTR siparişi seçilmeli.
4. Sipariş daha önce refund/chargeback olmamalı ve açık reversal talebi taşımamalı.
5. İki farklı, güncel `admin` kullanıcı ID'si hazırlanmalı.

## Çalıştırma

PowerShell örneği:

```powershell
$env:PAYTR_REFUND_SANDBOX_ACCEPTANCE_CONFIRM='I_UNDERSTAND_THIS_CREATES_A_TEST_REFUND'
$env:PAYTR_REFUND_ACCEPTANCE_ORDER_ID='<fulfilled-order-uuid>'
$env:PAYTR_REFUND_ACCEPTANCE_REQUESTER_USER_ID='<first-admin-id>'
$env:PAYTR_REFUND_ACCEPTANCE_REVIEWER_USER_ID='<second-admin-id>'
npm run payment:paytr-refund-sandbox-acceptance
```

Onay cümlesi ve sipariş/admin ID'leri kalıcı `.env` dosyasına yazılmamalıdır.

Komut sırasıyla:

1. güvenli DB adı ve sandbox readiness kontrolü yapar,
2. yerel sipariş/fulfillment durumunu doğrular,
3. PayTR durum sorgusunda test modu, exact tutar ve currency kontrolü yapar,
4. kalıcı refund request oluşturur,
5. farklı admin kimliğiyle provider refund çağrısını onaylar,
6. PayTR durum sorgusunda exact reference, tutar, currency ve tamamlanma kaydını
   yeniden doğrular,
7. secretsiz JSON evidence özeti basar.

## Sonuçların Yönetimi

### `passed`

- `payment_reversal_requests.status=approved`
- `payment_provider_refund_attempts.status=succeeded`
- sipariş `refunded`
- ilgili inventory veya ücretli coin lot reversal uygulanmış olmalı
- JSON çıktısı değişiklik/operasyon kaydına eklenebilir; secret içermez

### `provider_failed`

Provider isteği kesin reddetmiştir. Yerel entitlement değişmez. Admin panelinde hata
kodu incelenir; provider paneli kontrol edilmeden yeni talep açılmaz.

### `provider_review`

Sonuç belirsizdir. Komut veya refund endpoint'i tekrar çağrılmaz. Admin panelinde
`PayTR durumunu doğrula` kullanılır. Exact tamamlanmış iade bulunmadan yerel reversal
uygulanmaz.

### Post-check başarısızlığı

Provider refund çağrısı ve yerel reversal başarıyla tamamlanmış ancak son durum
sorgusu henüz kaydı göstermemiş olabilir. Yeni refund oluşturulmaz. Aynı request admin
paneli ve PayTR paneli üzerinden incelenir; audit ve attempt kayıtları korunur.

## Production Aktivasyonu

Bu kabul testi production kilidini otomatik kaldırmaz. Live aktivasyon ayrı değişiklik,
merchant sözleşmesi, legal onay, alarm/runbook doğrulaması ve rollback kararı gerektirir.
Mevcut production preflight `PAYTR_REFUND_MODE=disabled` dışında fail-closed kalır.
