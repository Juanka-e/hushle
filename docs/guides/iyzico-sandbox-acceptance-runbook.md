# Iyzico Sandbox Checkout Acceptance Runbook

## Amaç ve sınır

Bu runbook, gerçek Iyzico sandbox hesabıyla Checkout Form initialize, callback/retrieve,
Signature V3 webhook, fulfillment ve reconciliation zincirini kontrollü biçimde doğrular.
Live ödeme açmaz ve production veritabanında çalışmaz.

- Komut yalnız adı `test`, `dev`, `sandbox`, `staging` veya `acceptance` içeren bir
  veritabanını kabul eder.
- Tüm Iyzico çalışma modları `sandbox` olmalıdır.
- API ve secret anahtarları `sandbox-` öneki taşımalıdır.
- Açık onay cümlesi olmadan provider çağrısı yapılmaz.
- Buyer verileri yalnız initialize isteğinde kullanılır; DB'ye, kanıt çıktısına veya
  komut argümanlarına yazılmaz.
- Hosted ödeme URL'si ve Checkout Form tokenı terminal çıktısına yazılmaz.
- Komut `IYZICO_SANDBOX_ACCEPTANCE_RECORDED` değerini otomatik değiştirmez.

Iyzico Checkout Form akışı initialize ve retrieve adımlarından oluşur. Callback'teki
token yalnız retrieve için kullanılır; fulfillment ancak exact tutar/para birimi,
başarılı ödeme/risk sonucu ve doğrulanmış provider imzası sonrasında yapılır.

## Ön koşullar

1. Public HTTPS test/staging origin callback ve webhook isteklerini uygulamaya
   ulaştırmalıdır.
2. Webhook ve reconciliation worker/scheduler test ortamında çalışıyor olmalıdır.
3. Iyzico merchant panelinde Signature V3 ve webhook hedefi yapılandırılmış olmalıdır.
4. Doğrulanmış e-postası olan aktif bir test kullanıcısı ve düşük tutarlı aktif bir
   ödeme teklifi bulunmalıdır.
5. Test kullanıcısı tarayıcıda oturum açmış olmalıdır; ödeme sayfası bu sahiplik
   üzerinden açılır.

## Geçici ortam değişkenleri

Bu değerleri kalıcı `.env` dosyasına veya CI loglarına yazmayın. Buyer alanlarında
yalnız sandbox kabulü için ayrılmış test verileri kullanın.

```powershell
$env:IYZICO_SANDBOX_ACCEPTANCE_CONFIRM='I_UNDERSTAND_THIS_CREATES_A_REAL_IYZICO_SANDBOX_CHECKOUT'
$env:IYZICO_ACCEPTANCE_PUBLIC_ORIGIN='https://staging.example.com'
$env:IYZICO_ACCEPTANCE_USER_ID='<verified-test-user-id>'
$env:IYZICO_ACCEPTANCE_OFFER_CODE='<low-value-active-offer>'
$env:IYZICO_ACCEPTANCE_MAX_AMOUNT_MINOR='10000'
$env:IYZICO_ACCEPTANCE_REQUEST_IP='<test-client-ip>'
$env:IYZICO_ACCEPTANCE_GIVEN_NAME='<sandbox-test-name>'
$env:IYZICO_ACCEPTANCE_FAMILY_NAME='<sandbox-test-surname>'
$env:IYZICO_ACCEPTANCE_IDENTITY_NUMBER='<sandbox-test-identity>'
$env:IYZICO_ACCEPTANCE_PHONE='<sandbox-test-phone>'
$env:IYZICO_ACCEPTANCE_ADDRESS='<sandbox-test-address>'
$env:IYZICO_ACCEPTANCE_CITY='<sandbox-test-city>'
$env:IYZICO_ACCEPTANCE_COUNTRY='Turkey'
$env:IYZICO_ACCEPTANCE_ZIP_CODE='<sandbox-test-zip>'
```

Credential, merchant ID, beş sandbox mode ve legal metin sürümleri deployment secret
manager veya geçici process environment üzerinden sağlanır.

## 1. Initialize

```powershell
npm run payment:iyzico-sandbox-acceptance -- initialize
```

Komut aktif teklifi server-side okur, legal consent snapshot'lı ve kullanıcıya bağlı
tek sipariş oluşturur, initialize çağrısını yapar ve secretsiz bir özet döndürür.
Çıktıdaki `orderId` değerini kaydedin. Test kullanıcısıyla staging uygulamasında
`/checkout?order=<orderId>` adresini açıp Iyzico sandbox ödeme adımını tamamlayın.

Komutu aynı sipariş için tekrar initialize etmek yerine mevcut sipariş sayfasından
devam edin. Timeout veya belirsiz sonuçta provider paneli ve reconciliation kaydı
incelenmeden yeni ödeme oluşturmayın.

## 2. Callback, webhook ve worker

Ödeme tamamlandıktan sonra:

1. Iyzico callback'i uygulamaya POST etmeli ve retrieve sonucu doğrulanmalıdır.
2. Signature V3 webhook inbox'a alınmalı ve secretsiz metadata ile işlenmelidir.
3. Webhook worker siparişi idempotent biçimde fulfill etmelidir.
4. Webhook gecikirse reconciliation worker exact provider kanıtıyla aynı sonucu
   üretmeli; açık case kalmamalı veya case `resolved` olmalıdır.

## 3. Verify

```powershell
$env:IYZICO_ACCEPTANCE_ORDER_ID='<initialize-output-order-id>'
npm run payment:iyzico-sandbox-acceptance -- verify
```

Başarılı rapor şu kontrollerin tamamını `true` göstermelidir:

- owner-bound sipariş ve legal consent,
- başarılı initialize attempt,
- exact retrieve tutarı, paid tutarı, currency, `SUCCESS` ve risk `1`,
- işlenmiş imzalı başarılı webhook,
- tamamlanmış fulfillment ve bildirim,
- çözülmüş veya gerekmemiş reconciliation,
- DB'den temizlenmiş geçici token/hosted URL.

Kanıt raporu `iyzico-sandbox-acceptance-v2` şemasını, hashed merchant ID'yi ve kabul
edilen legal belge sürümlerini içerir. Provider payment reference yalnız SHA-256
olarak bulunur. Token,
hosted URL, buyer alanları ve credential bulunmaz. Rapor başarısızsa acceptance flag
açılmaz; eksik check operasyon kayıtları üzerinden incelenir.

## Aktivasyon kararı

Başarılı rapor tek başına live ödeme onayı değildir. İncelenmiş sandbox kanıtı,
webhook retry/dead-letter alarmı, reconciliation scheduler, hukuki onay ve rollback
prosedürü tamamlandıktan sonra deployment secret manager'da
`IYZICO_SANDBOX_ACCEPTANCE_RECORDED=true` ve doğrulanan dosyanın
`IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256` değeri birlikte ayarlanabilir. Ayrıntılı
dosya izinleri ve digest akışı `payment-activation-evidence.md` içindedir. Live mode
bu sürümde yine fail-closed kalır.
