# Adaptive Turnstile Launch Policy

## Karar

Web açılışında birincil bot doğrulama sağlayıcısı Cloudflare Turnstile'dır. Varsayılan widget modu `managed` olur. Uygulama kendi görünmez risk skorunu üretmez ve yalnız IP, cihaz veya aynı arkadaş grubuna dayanarak oyuncuyu cezalandırmaz.

Katmanlar birbirinden bağımsızdır:

1. Redis destekli IP/hesap rate limitleri istek hacmini sınırlar.
2. Turnstile Managed, Cloudflare'ın risk değerlendirmesine göre çoğunlukla sessiz çalışır ve gerekirse etkileşim ister.
3. Sunucu tokenı Siteverify ile doğrular; istemci sonucu güvenilir kabul edilmez.
4. Ekonomi guardrail'leri yalnız ödül miktarını etkiler, captcha veya auth kararını değiştirmez.

Turnstile bir skor sağlamaz. Admin panelindeki skor eşiği yalnız alternatif `recaptcha_v3` sağlayıcısı içindir.

## Oyuncu Akışı

- Sayfa açılışında token alınmaz.
- Oyuncu submit/oda oluştur/katıl butonuna odaklandığında veya işaretçiyi getirdiğinde yalnız public captcha config ve sağlayıcı scripti hazırlanır.
- Token gerçek submit sırasında üretilir. Böylece 300 saniyelik ve tek kullanımlık token gereksiz yere yaşlandırılmaz.
- `managed` + `Gerektiğinde Göster` açıkken normal oyuncu çoğunlukla ek ekran görmez. Cloudflare etkileşim isterse widget merkezde ve erişilebilir biçimde görünür.
- Script veya sağlayıcı geçici olarak erişilemezse production `hard_fail` davranır ve kontrollü genel hata döner. Secret veya detaylı doğrulama nedeni istemciye gönderilmez.

## Sunucu Sözleşmesi

- Maksimum token uzunluğu: `2048` karakter.
- Siteverify timeout: `5000 ms`.
- Beklenen `action` birebir eşleşmelidir.
- Production'da `TURNSTILE_ALLOWED_HOSTNAMES` zorunludur; dönen hostname listede birebir bulunmalıdır.
- `remoteip` mevcutsa sağlayıcıya aktarılır.
- Her doğrulama isteğinde ayrı `idempotency_key` gönderilir.
- Public config yalnız site key ve davranış ayarlarını döndürür. Secret key yalnız sunucuda kalır.

```dotenv
TURNSTILE_ALLOWED_HOSTNAMES=hushle.com,play.hushle.com
```

Şema, path, port ve wildcard kabul edilmez. Production preflight, `NEXT_PUBLIC_SITE_URL` hostname'i listede değilse deploy'u reddeder.

## Admin Politikası

- `Kayıtta Kullan`: açık tutulması önerilir.
- `Oda Oluşturmada Kullan`: açık tutulması önerilir.
- `Girişte Kullan`: login rate limitinin üzerinde ikinci katmandır; saldırı ve hata oranına göre açılabilir.
- `Misafir Katılımında Kullan`: hızlı giriş önceliği nedeniyle başlangıçta kapalı kalabilir; bot dalgasında açılır.
- `Managed`: önerilen production modu.
- `Invisible`: challenge her zaman gizlidir; etkileşim gereken ağlarda doğrulama başarısız olabilir.
- `Non-interactive`: görünür fakat kullanıcı etkileşimi beklemeyen alternatif sunumdur.

Admin ayarları Turnstile anahtarlarını veya hostname allowlist'i saklamaz. Bunlar deployment secret/config yönetiminin parçasıdır.

## Production Aktivasyonu

1. Cloudflare Turnstile dashboard'unda production ve staging hostname'lerini ayrı tanımla.
2. Site key, secret key ve exact hostname allowlist'i deployment ortamına ver.
3. `npm run test:production-preflight` çalıştır.
4. Admin panelinde sağlayıcıyı Turnstile, modu Managed seç ve önce kayıt + oda oluşturmayı aç.
5. Gerçek domain üzerinde kayıt, giriş, oda oluşturma ve misafir katılım smoke testi yap.
6. Sağlayıcı hata oranı, rate-limit reddi ve kullanıcı destek bildirimlerini izle; oyun trafiğine toplu ceza uygulama.

## Test Kapıları

```powershell
npm run test:captcha-security
npm run test:adaptive-turnstile-policy
npm run test:turnstile-smoke
npm run test:captcha-prewarm-e2e
npm run test:production-preflight
```

Sabit Cloudflare test tokenı özel `action` metadata taşımadığından uygulama tarafından `action_mismatch` ile reddedilir. Exact action + hostname başarılı yolunun son kanıtı gerçek staging key/domain smoke testidir.

## Kaynaklar

- [Cloudflare server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Cloudflare widget configurations](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/)
- [Cloudflare testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
