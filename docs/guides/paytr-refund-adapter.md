# PayTR Refund Adapter Foundation

## Mevcut Durum

PayTR'nin iade endpoint'i için provider-neutral kontrat, bounded transport adapter ve
kalıcı refund attempt orkestrasyonu hazırdır. Uygulama yalnız **tam iade** açar.

```env
PAYTR_REFUND_MODE=disabled
```

Production preflight, `PAYTR_REFUND_MODE` için `sandbox` ve `live` değerlerini
reddeder. Dolayısıyla production'da provider API iade butonu ve endpoint'i fail-closed
kalır. Yerelde ancak checkout ve refund modu birlikte `sandbox` ve merchant bilgileri
geçerliyse ikinci onaya gönderilebilir.

## Adapter Kontratı

- Endpoint yalnız sabit `https://www.paytr.com/odeme/iade` adresidir.
- Token, PayTR'nin belirttiği sırayla `merchant_id + merchant_oid + return_amount
  + merchant_salt` girdisinin HMAC-SHA256 sonucudur.
- Minor-unit tutar tam iki ondalıklı biçime çevrilir; locale bağımlı virgül üretilmez.
- `merchant_oid` ve `reference_no` 1-64 karakter alfanümerik değerlerle sınırlıdır.
- Merchant key ve salt POST body, sonuç, log veya audit verisine eklenmez.
- Timeout 1-30 saniye aralığında, response ise en fazla 16 KiB ile sınırlıdır.
- Başarı cevabındaki sipariş, tutar ve referans istekle birebir eşleşmelidir.
- Provider `err_msg` metni dışarı taşınmaz; yalnız bounded uygulama hata kodu üretilir.

## Kalıcı Orkestrasyon

- Harici provider işlemi sonrası kullanılan `externally_confirmed` akış korunur.
- `provider_api` talebi tam tutarı sipariş kaydından alır; istemci tutar gönderemez.
- Talebi oluşturan admin onaylayamaz. Provider çağrısından hemen önce ikinci admin
  rolü ve sipariş durumu transaction içinde yeniden doğrulanır.
- Provider çağrısı veritabanı transaction'ı dışında yapılır.
- Kalıcı attempt durumları `processing`, `succeeded`, `failed` ve `uncertain`'dır.
- Başarıda provider kanıtı ile inventory/wallet reversal tek transaction'da uygulanır.
- Kesin ret `provider_failed`; timeout, transport veya geçersiz cevap
  `provider_review` üretir ve yerel varlıklara dokunmaz.
- `provider_review` yeni refund talebini engeller. Kör retry yerine PayTR durum
  sorgusunda aynı `reference_no`, tam tutar, tamamlanmış kayıt ve test modu aranır.
- Provider çağrısı sonrasında admin rolü değişmişse yerel reversal uygulanmaz; kayıt
  güvenli inceleme durumunda bırakılır.

## Bilinçli Güvenlik Sınırı

PayTR `reference_no` alanını kabul eder ancak resmi doküman bunu tekrarlanan refund
istekleri için idempotency garantisi olarak tanımlamaz. Bu nedenle:

- timeout veya bağlantı kopmasında aynı istek kör biçimde tekrarlanmaz,
- provider başarısı kalıcı olarak kanıtlanmadan yerel entitlement reversal yapılmaz,
- mevcut `externally_confirmed` reversal akışı otomatik refund ile karıştırılmaz,
- partial refund ürün/entitlement politikası belirlenmeden kısmi iade açılmaz.
- sandbox merchant kabul testi tamamlanmadan production kilidi kaldırılmaz.

## Test

```bash
npm run test:payment-paytr-refund
npm run test:payment-provider-refund-integration
npm run test:payment-paytr-refund-acceptance
npm run test:production-preflight
npm run typecheck:packages
```

Testler HMAC hesabını, exact decimal tutarı, secret minimizasyonunu, response sınırını,
ikinci onayı, timeout sonrası kör retry engelini, kesin reddi ve exact recovery kanıtını
doğrular.

Gerçek merchant sandbox kabulü için
[`paytr-refund-sandbox-acceptance-runbook.md`](./paytr-refund-sandbox-acceptance-runbook.md)
kullanılır. Bu opt-in komut CI'da gerçek provider'a çağrı yapmaz.

## Resmi Kaynaklar

- [PayTR İade API](https://dev.paytr.com/iade-api)
- [PayTR Hata Kodları](https://dev.paytr.com/hata-kodlari)
- [PayTR Durum Sorgu API](https://dev.paytr.com/durum-sorgu)
