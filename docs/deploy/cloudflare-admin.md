# Cloudflare Edge and Admin Protection

## Launch Profile

Production için önerilen profil `cloudflare_free_safe_launch` değeridir:

```dotenv
PRODUCTION_EDGE_SECURITY_POLICY=cloudflare_free_safe_launch
CLOUDFLARE_PROXY_ENABLED=true
CLOUDFLARE_ORIGIN_LOCK_MODE=firewall
CLOUDFLARE_BOT_FIGHT_MODE=disabled_until_webhook_smoke
PAYMENT_WEBHOOK_EDGE_POLICY=signature_first_no_challenge
```

Cloudflare kullanmak origin'i otomatik olarak gizlemez. Sunucu firewall'u yalnız Cloudflare IP aralıklarını kabul etmeli veya Tunnel/Authenticated Origin Pulls kullanılmalıdır. Uygulama `CF-*` başlıklarına origin kilidi olmadan güvenmemelidir.

Kaynak politika: `infra/cloudflare/edge-security-policy.json`.

## Route Sınıfları

### WebSocket `/api/socketio/`

- Boş `Referer` engellenmez. Tarayıcı gizlilik politikaları Referer'ı meşru biçimde kaldırabilir.
- Kimlik sinyali `Origin` başlığıdır ve uygulama exact trusted-origin allowlist uygular.
- Managed Challenge WebSocket handshake üzerinde kullanılmaz; bağlantıyı bozabilir.
- Oda oluşturma ve guest join aynı socket yolu üzerinde olsa da uygulama action bazında Redis rate limit, session kontrolü ve Turnstile uygular.
- Datacenter ASN/VPN trafiği topluca engellenmez.

### Login, Register ve Oda Girişleri

- Redis IP + hesap limitleri asıl hacim kontrolüdür.
- Turnstile action bazında çalışır; sayfa açılışında token üretmez.
- Cloudflare rate-limit kuralı önce gözlem/managed challenge olarak denenir; doğrudan kalıcı block ile başlanmaz.
- Bilinen kötü User-Agent listesi tek başına güvenlik kararı değildir. Kolayca taklit edilir.

### Ödeme Checkout

- Yalnız kayıtlı ve sunucuda yeniden doğrulanmış session işlem başlatabilir.
- İstemciden fiyat, coin miktarı, kullanıcı ID veya başarı durumu kabul edilmez.
- Checkout create endpoint'i kullanıcı + IP + idempotency anahtarıyla sınırlandırılır.
- Turnstile step-up yalnız risk/abuse görülürse checkout başlatmada kullanılabilir; sağlayıcı callback'ine uygulanmaz.

### Ödeme Webhook'ları

- Ayrılmış prefix: `/api/payments/webhooks/{provider}`.
- Browser değildir; `Origin`, `Referer`, cookie session veya Turnstile beklenmez.
- Provider imzası raw body üzerinde doğrulanır.
- Event ID/provider reference unique tutulur, tekrar bildirim ikinci kez bakiye veya entitlement yazamaz.
- Payload önce durable inbox'a kaydedilir, hızlı `2xx/OK` dönülür ve işleme jobs worker devam eder.
- Body size, content type ve endpoint bazlı hacim sınırı uygulanır; IP allowlist tek güven kaynağı değildir.

Cloudflare Free Bot Fight Mode custom rule ile istisna edilemediğinden ödeme callback'lerini yanlışlıkla challenge edebilir. Bütün provider callback'leri gerçek production smoke testinden geçmeden global olarak açılmaz.

## Aday Kurallar

1. Kötü User-Agent: yalnız browser navigation için önce gözlem, sonra Managed Challenge. WebSocket ve payment webhook hariç.
2. Boş/kötü Referer: uygulanmaz.
3. Datacenter/VPN/hosting ağı: yalnız hassas browser girişlerinde gözlem; global block uygulanmaz.
4. Verified bot: public `GET` SEO rotalarında korunur; state-changing API veya socket yetkisi sağlamaz.
5. Admin: `/admin*` ve `/api/admin*` Cloudflare Access MFA arkasına alınır. Uygulamanın kendi admin session/RBAC kontrolü yine çalışır.

## Rollout

1. Security Events üzerinden 7-14 gün sadece gözlemle.
2. False-positive listesinde mobil operatör, VPN, okul/iş ağı, uptime monitor ve ödeme sağlayıcılarını kontrol et.
3. Browser-only aday kuralı Managed Challenge yap.
4. Block'a ancak tekrarlanabilir kötü imza ve düşük false-positive kanıtı varsa geç.
5. WebSocket reconnect, guest join, kayıt, login ve her ödeme webhook'unu gerçek cihaz/ağ ile tekrar test et.

## Test

```powershell
npm run test:edge-security-policy
npm run test:web-origin-policy
npm run test:room-socket-security
npm run test:production-preflight
```

## Resmi Kaynaklar

- [Cloudflare custom rules](https://developers.cloudflare.com/waf/custom-rules/)
- [Cloudflare rate limiting best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/)
- [Cloudflare security feature interoperability](https://developers.cloudflare.com/waf/feature-interoperability/)
