# Payment Checkout and Legal Readiness

## Mevcut Durum

Server-priced teklif kataloğu, owner-only sipariş durumu, immutable legal consent,
atomik fulfillment, PayTR sandbox iFrame ve iyzico request-only hosted checkout UI
hazirdir. Gercek tahsilat kapalidir. Provider secimi yalniz server config ile yapilir;
oyuncu request icinden provider secemez. Gercek merchant sandbox kabul kaydi ve
operasyon smoke testleri tamamlanmadan live moda gecilmez.

## Hukuki Yüzey Ayrımı

- Ödeme Aydınlatma Metni bilgilendirmedir; zorunlu açık rıza kutusu değildir.
- Pazarlama/ticari ileti izni checkout veya teslimat şartı yapılmaz.
- Mesafeli satış ön bilgilendirmesi ve satın alma koşulları ayrı bağlantılarla
  gösterilir.
- Sipariş kanıtında belge sürümü, kabul zamanı, request ID ve hash'lenmiş user-agent
  tutulur. Ham IP veya kart verisi tutulmaz.
- PayTR için geçici alınan ad-soyad, telefon ve adresin aktarım amacı ödeme
  aydınlatmasında açıkça belirtilir.
- iyzico icin kimlik numarasi, telefon ve tek fatura adresi tam odeme aninda alinir;
  profil, order, audit, URL, browser storage veya hash kaydina donusturulmez.
- iyzico veri aktarimi bilgilendirmesi satis kosullari kabulunden ayri gosterilir.
  Bu kutu pazarlama izni veya genel acik riza olarak kullanilmaz.

Kod metinleri işletme bilgileri kesinleşene kadar taslaktır. Unvan/adres,
vergi-MERSİS bilgileri, sağlayıcı ve yurt dışı aktarım modeli, iade-cayma politikası
ve yetkili merci bilgileri hukuk danışmanı tarafından onaylanmalıdır.

## Sandbox Gate

```env
PAYMENTS_ENABLED=true
PAYMENT_ACTIVE_PROVIDER=paytr
PAYTR_CHECKOUT_MODE=sandbox
JOBS_ENABLED=true
PAYMENT_WEBHOOK_SCHEDULE_CONFIGURED=true
PAYMENT_LEGAL_APPROVED=true
PAYMENT_LEGAL_APPROVAL_EVIDENCE_FILE=/srv/hushle/payment-evidence/payment-legal-approval.json
PAYMENT_LEGAL_APPROVAL_EVIDENCE_SHA256=sha256:<reviewed-file-digest>
PAYMENT_ROLLOUT_SEED=<stable-random-value>
PAYMENT_LEGAL_BUSINESS_NAME=...
PAYMENT_LEGAL_BUSINESS_ADDRESS=...
PAYMENT_LEGAL_CONTACT_EMAIL=...
PAYMENT_CHECKOUT_TERMS_VERSION=checkout-terms-v1
PAYMENT_PRIVACY_NOTICE_VERSION=payment-privacy-v1
PAYMENT_DISTANCE_SALES_NOTICE_VERSION=distance-sales-v1
```

iyzico sandbox secildiginde ek olarak `PAYMENT_ACTIVE_PROVIDER=iyzico` ve
`IYZICO_CHECKOUT_MODE`, `IYZICO_OWNER_CHECKOUT_MODE`, `IYZICO_CALLBACK_MODE`,
`IYZICO_WEBHOOK_MODE`, `IYZICO_RECONCILIATION_MODE` degerlerinin tamami `sandbox`
olmalidir. API key, secret, merchant ID, public HTTPS origin ve gercek merchant test
kaniti sonrasi `IYZICO_SANDBOX_ACCEPTANCE_RECORDED=true` zorunludur. Varsayilan
degerler `disabled/false` oldugu icin UI kodunun varligi tek basina checkout acmaz.
Iyzico kabul kaniti dosya yolu ve SHA-256 digest'i de zorunludur; merchant veya legal
surum degisirse eski kanit preflight'tan gecmez.

Production preflight ödeme açıldığında PayTR sandbox mode, credential ve hukuk
alanlarını birlikte doğrular. `PAYTR_CHECKOUT_MODE=live` bu sürümde blocker'dır.
Normal production yayında callback zinciri bitene kadar `PAYMENTS_ENABLED=false`
kalmalıdır.

Metin değiştiğinde ilgili sürüm artırılır. Eski sipariş kabul ettiği belge
sürümlerini korur. `PAYMENT_LEGAL_APPROVED=true` yalnız nihai metin ve işletme
bilgileri onaylandıktan sonra kullanılır.

## Güvenlik Kontrolü

1. Session, doğrulanmış e-posta ve hesap capability server-side doğrulanır.
2. Teklif DB'den yeniden okunur; istemciden fiyat, para birimi veya grant alınmaz.
3. Legal sürüm stale ise API `409` döndürür.
4. User ve IP limitleri ayrı distributed counter kullanır.
5. Idempotency anahtarı kullanıcı ve request fingerprint ile korunur.
6. Order status `id + userId` ile okunur ve private/no-store döner.
7. Provider çağrısı DB transaction'ı dışında çalışır; attempt lease concurrent
   token isteklerini sınırlar.
8. Redirect ödeme kanıtı değildir; yalnız imzalı webhook/reconciliation sonucu
   siparişi `paid` yapabilir.

## Kalan Aktivasyon Isleri

Gerçek Iyzico sandbox kabulü için
[`iyzico-sandbox-acceptance-runbook.md`](./iyzico-sandbox-acceptance-runbook.md)
kullanılır. Harness initialize ve verify aşamalarını ayırır; token, hosted URL ve buyer
verilerini kanıt çıktısına taşımaz ve kabul flag'ini otomatik açmaz.

Scheduler heartbeat ve merkezi alarm kabul adımları
[`payment-scheduler-observability.md`](./payment-scheduler-observability.md) içinde
tanımlıdır.

1. Merchant ve veri aktarim modelinin hukuki onayi.
2. Gercek merchant sandbox initialize, callback, webhook ve reconciliation kabul testi.
3. Alert, scheduler ve operasyon runbook kabul kaydi.
4. Ayrica incelenen live-mode implementasyonu; sandbox flag'lerini live kabul etmek yasaktir.

Kanita bagli aktivasyon ve rotasyon adimlari
[`payment-activation-evidence.md`](./payment-activation-evidence.md) icinde tanimlidir.
Yeni checkout oturumlarini kademeli acma ve acil durdurma davranisi
[`payment-rollout-and-emergency-pause.md`](./payment-rollout-and-emergency-pause.md)
icinde tanimlidir.
