# PayTR iFrame Adapter Rehberi

## Mevcut Durum

`feature/paytr-checkout-orchestration` ile PayTR iFrame token oturumu checkout
akışına bağlandı. Bu sürüm yalnız sandbox çalıştırır:

```env
PAYMENTS_ENABLED=true
PAYMENT_ACTIVE_PROVIDER=paytr
PAYTR_CHECKOUT_MODE=sandbox
PAYTR_MERCHANT_ID=...
PAYTR_MERCHANT_KEY=...
PAYTR_MERCHANT_SALT=...
```

`PAYTR_CHECKOUT_MODE=live` bilinçli olarak fail-closed kalır. Kod token isteğinde
`test_mode=1` değerini sabit gönderir. Sandbox callback processor tamamlanmıştır;
Refund transport adapter foundation hazırdır ancak production çağrısı kapalıdır.
Durable provider attempt/recovery ve live operasyonlar bitmeden gerçek tahsilat açılmaz.

## Checkout Akışı

1. Kullanıcı doğrulanmış hesap e-postasıyla oturum açar.
2. Aktif teklif, fiyat, para birimi ve grant snapshot'ı sunucudan okunur.
3. Ad-soyad, telefon ve adres yalnız checkout isteğinde geçici alınır.
4. Sipariş ve immutable legal consent oluşturulur.
5. `PaymentAttempt` kısa bir lease ile `requested` durumuna alınır.
6. PayTR token çağrısı veritabanı transaction'ı dışında yapılır.
7. Başarılı token hash'lenerek attempt'e, oturumu yenilemek için ham token ise
   owner-only sipariş kaydına yazılır; sipariş `awaiting_payment` olur.
8. Aynı idempotency anahtarı yeni sipariş veya ikinci provider çağrısı üretmez.

Provider timeout veya reddi yalnız bounded hata kodu olarak saklanır. Ham provider
cevabı, secret, iletişim alanları ve kart verisi log/audit/veritabanına yazılmaz.

## Veri Minimizasyonu

- E-posta browser payload'ından alınmaz; doğrulanmış session hesabından okunur.
- Ad-soyad, telefon ve adres PayTR token çağrısından sonra kalıcı uygulama verisi
  haline gelmez.
- Kart verisi uygulama sunucusundan geçmez ve PayTR iFrame içinde kalır.
- Kullanıcı IP'si güvenilir proxy zincirinden alınır. Local sandbox'ta yalnız
  server-owned `PAYTR_SANDBOX_USER_IP` fallback'i kullanılabilir.
- Owner order API yalnız sandbox `iframeUrl` döndürür; merchant secret dönmez.

## Güven Sınırı

- Redirect başarı kanıtı değildir.
- Yalnız doğrulanmış PayTR callback'i durable inbox'a girebilir.
- Worker tutar, para birimi, provider/order referansı ve state'i doğrulamadan
  siparişi `paid` yapamaz.
- Fulfillment row lock, transaction ve unique constraint ile idempotenttir.
- Coin paketleri refund/chargeback reversal politikası tamamlanana kadar katalogdan
  gizlenir ve API tarafından reddedilir.
- Provider secret'ları env/secret manager'da kalır; admin UI ve DB'ye yazılmaz.

## Kalan Aktivasyon İşleri

- durable provider refund attempt ve uncertain-state recovery,
- provider reconciliation ve admin dead-letter operasyon yolu,
- Cloudflare callback no-challenge smoke testi,
- hukuk onaylı işletme, aydınlatma ve mesafeli satış metinleri,
- en son düşük tutarlı canlı ödeme ve iade smoke testi.

## Testler

```bash
npm run test:payment-paytr-adapter
npm run test:payment-paytr-checkout
npm run test:payment-paytr-checkout-integration
npm run test:payment-paytr-webhook
npm run test:payment-paytr-webhook-integration
npm run test:payment-checkout-e2e
```

Entegrasyon testleri geçici MySQL şeması kullanır. Playwright testi transient
iletişim alanlarını, legal kabulleri ve sandbox iFrame açılışını doğrular.

## Resmi Kaynaklar

- [PayTR iFrame API](https://dev.paytr.com/iframe-api)
- [PayTR iFrame API 1. Adım](https://dev.paytr.com/iframe-api/iframe-api-1-adim)
- [PayTR iFrame API 2. Adım](https://dev.paytr.com/iframe-api/iframe-api-2-adim)
- [PayTR İade API](https://dev.paytr.com/iade-api)
