# Production Config Preflight

Production deploy, image pull veya migration başlamadan önce `.env.production`
dosyasını fail-closed doğrular:

```bash
npm run ops:preflight -- --env-file .env.production
```

Observability icin production karari da zorunludur:

- `PRODUCTION_OBSERVABILITY_POLICY=http`: HTTPS collector URL'i ve bagimsiz
  ingest-only token gerekir.
- `PRODUCTION_OBSERVABILITY_POLICY=disabled_risk_accepted`: exporter kapali
  kalir, URL/token bos olmak zorundadir ve preflight acik risk uyarisi verir.

Queue/batch/timeout ayarlari ve alarm esikleri
`observability-exporter-operations.md` belgesindedir.

Edge guvenligi icin production karari zorunludur:

- `cloudflare_free_safe_launch`: proxy acik, origin firewall/Tunnel/AOP ile
  kilitli ve payment webhook'lari signature-first/no-challenge politikasindadir.
- `direct_origin_risk_accepted`: Cloudflare edge korumasi olmadan launch riskini
  acikca kabul eder ve warning uretir.
- Free Bot Fight Mode, payment provider callback'leri gercek ortamda smoke
  edilmeden acilmaz; custom rule ile guvenilir istisna verilemez.

Route matrisi ve rollout: `cloudflare-admin.md`.

OAuth icin de acik karar zorunludur:

- `PRODUCTION_OAUTH_POLICY=google`: Google provider etkin olmali, client ID ve
  guclu client secret bulunmalidir.
- `PRODUCTION_OAUTH_POLICY=disabled_risk_accepted`: provider kapali kalir ve
  preflight acik risk uyarisi uretir.

Preflight secret değerlerini hiçbir zaman yazdırmaz. Yalnız alan adı ve hata
sınıfını gösterir. En az bir `BLOCKER` varsa deploy başlamaz.

## Zorunlu Kontroller

- `NODE_ENV=production`
- bağımsız ve placeholder olmayan auth, health ve MySQL secret'ları
- `DATABASE_URL` kullanıcı/parolasının MySQL alanlarıyla eşleşmesi
- exact HTTPS public/auth/CORS origin'leri; wildcard reddi
- production Redis namespace'i, açık rate limit ve parola breach kontrolü
- state-changing web API istekleri icin `STATE_CHANGE_ORIGIN_POLICY=strict`
- `single-writer` ve tek realtime replica
- originless Socket.IO istemcilerinin web açılışında kapalı olması
- fail-closed admin gateway ve açık header/identity allowlist politikası
- reverse proxy trust kararlarının açık olması
- captcha için `turnstile` veya yazılı `disabled_risk_accepted` kararı
- e-posta için `smtp` veya yazılı `disabled_risk_accepted` kararı
- SMTP seçildiyse provider, token secret, sender, host, port ve jobs hazırlığı
- offsite backup endpoint, bucket ve credential alanları

`disabled_risk_accepted` blocker'ı kaldırır fakat warning üretir. Bu değer launch
onayı değildir; release kaydında gerekçesi ve sahibi yazılmalıdır.

## Secret Rotasyonu

Secret değişiminde yalnız ilgili alanı değil bağlı alanları da güncelleyin.
Özellikle `MYSQL_PASSWORD` değişince URL-encoded karşılığı `DATABASE_URL` içinde
de değişmelidir. Preflight iki değeri karşılaştırır ve ayrışmayı engeller.

Production secret dosyası repoya commit edilmez. `.env.production.example`
yalnız alan sözleşmesidir ve bilerek geçersiz placeholder değerler taşır.

## Sınırlar

Preflight DNS, gerçek TLS zinciri, Cloudflare Access policy sonucu, SMTP teslimatı
veya object storage yazma yetkisini kanıtlamaz. Bunlar launch checklist'teki canlı
smoke adımlarıyla ayrıca doğrulanır.
