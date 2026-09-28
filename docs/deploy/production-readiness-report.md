# Production Readiness Report

Tarih: 31 Temmuz 2026

Kapsam:

- web uygulamasi ve admin paneli
- uye kayit/giris ve session guvenligi
- web, Socket.IO ve mobile API origin politikalari
- admin subdomain ve Cloudflare Access hazirligi
- Cloudflare Turnstile ve reCAPTCHA
- GA4 ve Google Search Console
- MySQL, Redis, audit, backup, realtime ve gozlemlenebilirlik

## Yonetici Ozeti

Genel sonuc: **kosullu hazir, public production acilisi icin henuz GO degil**.

Uygulamanin build, test, yetkilendirme, ekonomi guardrail, Docker, MySQL, Redis,
audit arsivleme ve backup temeli guclu. Buna karsilik public kullanici trafigi
almadan once asagidaki konular kapatilmalidir:

1. e-posta dogrulama, sifre sifirlama ve transactional email saglayicisi
2. Turnstile production anahtarlari ve adaptif koruma akislarinin aktivasyonu
3. Cloudflare Access kullanilacaksa origin kilidi ve guvenilen header zinciri
4. gercek production/staging TLS, DNS, cookie ve subdomain E2E testi
5. offsite backup upload ve gecici veritabanina restore kaniti
6. merkezi hata izleme ve alarm kanali

Kapali alpha icin e-posta dogrulama/sifre sifirlama gecici olarak manuel destek
akisi ile ertelenebilir. Acik public kayit icin ertelenmemelidir.

## Durum Anahtari

- **Hazir**: Kod, test ve deployment kontrati mevcut.
- **Kismi**: Temel mevcut; production ayari veya dis servis islemi gerekiyor.
- **Eksik**: Public acilis oncesi uygulanmasi gereken urun/guvenlik parcasi.
- **Operasyonel**: Kod disinda Cloudflare, DNS, bucket veya sunucu islemi gerekiyor.

## Mevcut Durum Matrisi

| Alan | Durum | Kisa karar |
| --- | --- | --- |
| Next.js production build | Hazir | Turbopack production build ve TypeScript kontrolleri mevcut |
| Admin RBAC | Hazir | Proxy, layout ve API seviyesinde admin kontrolu var |
| Admin Zero Trust | Kismi | Fail-closed gateway policy var; Cloudflare ve origin guven zinciri disarida kurulacak |
| Admin subdomain | Kismi | Exact origin/CSP temeli var; cift-host auth/cookie E2E tamamlanmadi |
| Web Socket.IO origin | Hazir | Exact allowlist, wildcard reddi ve production originless default-deny var |
| Mobile/public API CORS | Hazir | Production default-deny ve exact `API_ALLOWED_ORIGINS` var |
| HTTP CSRF/origin | Hazir | Production state-change istekleri allowlisted exact Origin ister; eksik header ve cross-site Fetch Metadata fail-closed reddedilir |
| Uye kayit | Hazir/Kismi | 8 karakter + zxcvbn, HIBP, bcrypt, captcha, rate-limit ve admin kontrollu e-posta dogrulama modu var |
| Uye giris | Hazir/Kismi | Web/mobile ortak Redis basarisizlik limitleri, bcrypt, captcha, suspension ve 24 saat JWT var |
| Email verification | Hazir/Kismi | Token, provider bagimsiz outbox, atomik claim, SES/SNS imzali suppression ve admin dead-letter akisi var; production provider smoke gerekir |
| Password reset | Hazir/Kismi | Tek kullanimlik token, enumeration-safe request ve session revoke var; production provider smoke gerekir |
| Cloudflare Turnstile | Kismi | Client/server uygulamasi hazir; production key ve aktivasyon gerekiyor |
| reCAPTCHA v3 | Kismi | Alternatif provider kodu hazir; key ve aktivasyon gerekiyor |
| Google Search Console | Hazir/Kismi | Sitemap, robots, canonical ve HTML verification env destegi var; dis dogrulama yapilacak |
| GA4 | Eksik | GA4 tag, consent mode ve admin konfigurasyonu yok |
| Dahili product analytics | Hazir | PII'siz Redis gunluk aggregate temeli var; GA4 degildir |
| MySQL | Hazir | Persistent volume ve utf8mb4 mevcut |
| Redis/Valkey | Hazir | AOF, cache/rate-limit/coordination temeli ve fallback mevcut |
| Realtime yatay olcek | Kismi | Tek writer production icin uygun; cok replica room-state henuz desteklenmiyor |
| Audit retention | Hazir/Kismi | Hot-to-archive job var; archive purge politikasi operasyonel karar bekliyor |
| Offsite backup | Hazir/Kismi | R2/S3-compatible kod hazir; production upload/restore kaniti gerekiyor |
| Production config preflight | Hazir | Secret, origin, topology, gateway, captcha, email ve backup kontrati deploy oncesi fail-closed kontrol edilir |
| Merkezi error tracking | Hazir/Kismi | PII-safe event, request ID, bounded HTTP exporter ve admin delivery aggregate hazir; production collector ve alarm kanali baglanmali |

## Admin Paneli

### Mevcut korumalar

- `/admin` ve `/api/admin` proxy seviyesinde korunur.
- Session kullanicisinin rolu kritik server akislarinda DB'den tekrar okunur.
- Admin olmayan kullanici admin paneline ve admin API'lerine erisemez.
- `public_login`, `restricted_login` ve `external_gateway` modlari vardir.
- Production varsayilani `restricted_login` ve fail-closed davranistir.
- Sabit gateway header veya Cloudflare Access email header allowlist'i
  tanimlanabilir.
- Admin islemleri audit kayitlariyla izlenir.

### Cloudflare Access riski

Uygulama su anda Cloudflare Access JWT'sini kriptografik olarak dogrulamaz.
Yapilandirilmis header/email degerine guvenir. Bu model ancak:

1. origin internete dogrudan acik degilse,
2. trafik sadece Cloudflare/Nginx guven zincirinden geliyorsa,
3. istemcinin ayni header'i dogrudan enjekte etmesi edge tarafinda engelleniyorsa

guvenlidir.

Production onerisi:

1. `/admin*` ve `/api/admin*` Cloudflare Access arkasina alinmali.
2. Origin IP firewall, Cloudflare Tunnel veya Authenticated Origin Pulls ile
   kilitlenmeli.
3. Tercihen `Cf-Access-Jwt-Assertion` uygulama tarafinda Access JWKS ile
   dogrulanmali.
4. Sadece email header kontrolu kalici nihai cozum sayilmamali.
5. Bir acil durum break-glass admin proseduru dokumante edilmeli.

## Admin Subdomain

`admin.hushle.com` ayni web runtime'a yonlendirilebilir. Mevcut altyapi:

- `TRUSTED_WEB_ORIGINS` ile Socket.IO exact allowlist
- `CSP_STYLE_SOURCES`, `CSP_FONT_SOURCES`, `CSP_CONNECT_SOURCES`
- host ve forwarded-host farkindaligi
- admin gateway modlari

Ancak gercek cift-host production destegi tamamlanmis sayilmaz:

- tek bir `NEXTAUTH_URL` vardir
- host-only auth cookie nedeniyle ana site ve admin subdomain sessionlari
  birbirinden ayrilabilir
- cookie Domain/SameSite/Secure davranisi staging ortaminda test edilmedi
- callback ve logout yonlendirmeleri iki host icin E2E dogrulanmadi
- canonical host ve proxy host routing karari production DNS'e baglidir

Ilk public surum icin onerilen model:

1. `https://hushle.com/admin`
2. Cloudflare Access path policy
3. ihtiyac netlestiginde ayri bir subdomain migration branch'i

## CORS, Origin ve CSP

### Socket.IO

- `NEXT_PUBLIC_SITE_URL` canonical browser originidir.
- Ek browser originleri `TRUSTED_WEB_ORIGINS` ile exact olarak eklenir.
- `*`, path, query, credential ve desteklenmeyen protokol reddedilir.
- Production'da `ALLOW_ORIGINLESS_SOCKET_CLIENTS=false` varsayilir.
- Native mobil istemci auth kontrati tamamlanmadan originless erisim
  acilmamalidir.

### Mobile/public API

- `API_ALLOWED_ORIGINS` exact allowlist'tir.
- Wildcard reddedilir.
- Production'da bos allowlist browser cross-origin isteklerini default-deny
  eder.
- Native istemciler Origin gondermeyebilir; guven bearer token ve refresh-token
  kontratindan gelir.

### HTTP state-changing istekler

`POST`, `PUT`, `PATCH` ve `DELETE` web API isteklerinde production politikasi
fail-closed'dur. Gecerli `Origin`, exact `TRUSTED_WEB_ORIGINS` allowlist'inde
olmalidir. Header yoksa veya `Sec-Fetch-Site` degeri `cross-site`/`same-site`
ise istek reddedilir. `X-Forwarded-Host` production'da tek basina guven kaynagi
degildir; spoof regresyonu test edilir.

Development ve kontrollu script istemcileri `compatible` modda header'siz
calisabilir. Bu istisna production'da etkisizdir. Native mobile bearer API
transportu web cookie proxy politikasindan ayridir ve kendi CORS/token
kontratini kullanir.

### CSP

- nonce tabanli `script-src` ve `strict-dynamic`
- `frame-ancestors 'none'`
- `object-src 'none'`
- production HTTPS icin `upgrade-insecure-requests`
- external font/style/connect exact origin ayarlari
- YouTube ve Cloudflare Turnstile frame destegi
- Turnstile challenge originine connect destegi

Bu branch ile Turnstile CSP ve Docker env parity eksikleri kapatildi.

## Uye Kayit ve Giris

### Hazir olanlar

- Credentials tabanli Auth.js
- username ve normalize email uniqueness
- bcrypt cost 10
- kayitta IP bazli Redis destekli rate-limit: 5 deneme / 10 dakika
- register/login captcha entegrasyonu
- suspension kontrolu
- 24 saat JWT session
- kritik server akislarinda kullaniciyi DB'den tekrar dogrulama
- basarili kayit/giris sinyallerinin server tarafinda tutulmasi
- web ve mobile API icin ortak Redis login basarisizlik limitleri
- hesap icin 8 basarisizlik / 15 dakika, IP icin 30 basarisizlik / 10 dakika
- ucuncu hesap hatasindan sonra 250 ms adimla artan, en fazla 1,5 saniye gecikme
- yeni parolalarda minimum 8 karakter, zxcvbn score 3 ve 72 UTF-8 byte siniri
- HIBP Pwned Passwords k-anonim compromised-password kontrolu
- var olmayan kullanicida dummy bcrypt ile timing farkinin azaltilmasi

### Acik riskler

1. Captcha varsayilan olarak kapali; production key/domain smoke ve admin aktivasyonu deploy oncesi zorunlu.
2. Production SMTP credential ve gercek teslimat smoke kaniti yok.
3. SES imza dogrulamali bounce/complaint transport adaptoru hazir; gercek SNS subscription ve simulator smoke kaniti yok.
4. Admin MFA/WebAuthn yok.
5. bcrypt'ten Argon2id'e kademeli rehash henuz yok.
6. Parola kurtarma ve e-posta degisikligi uygulanmistir; production SMTP,
   retention scheduler ve cluster Socket.IO Redis adapter smoke testi deploy
   oncesi zorunludur.

Uygulanan minimum:

- login icin bagimsiz IP ve normalize username basarisizlik limitleri
- minimum 8 karakter ve guc skorlu yeni parola politikasi
- mevcut hesaplar icin zorunlu sifre migrasyonu yerine yeni sifrelerde politika
- HIBP kesintisinde guclu yerel politikayla kontrollu devam
- tek kullanimlik, hash'li parola reset ve e-posta degisim tokenlari
- mevcut parola step-up ve yeni adres dogrulanana kadar canonical adresi koruma
- web, mobile ve aktif oyun socket oturumlarini guvenlik isleminde iptal etme

Siradaki minimum:

- production SMTP credential, gerçek SNS subscription ve SES simulator smoke kanıtı
- native mobile recovery/change transport endpoint'leri
- adminler icin Cloudflare Access MFA; daha sonra uygulama ici WebAuthn

## Cloudflare Turnstile

Kod seviyesi destek **mevcut**:

- provider: `turnstile`
- modlar: invisible, managed, non-interactive
- server-side Siteverify
- action eslestirmesi
- exact production hostname allowlist
- 2048 karakter token siniri ve 5 saniye Siteverify timeout'u
- remote IP aktarimi
- idempotency key
- register, login, room create ve guest join bazinda ayri ac/kapat
- admin system settings ve Integration Hub readiness gorunumu
- production'da zorunlu hard-fail
- Cloudflare test key'leriyle smoke test
- kullanici niyetinde script prewarm; submit oncesinde token uretmeme

Bu branch ile production web container'a:

- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `TURNSTILE_ALLOWED_HOSTNAMES`
- reCAPTCHA alternatif key'leri

aktarilir ve CSP Turnstile originini destekler.

Mevcut local durum:

- Turnstile key'leri bos
- captcha varsayilan olarak disabled
- dolayisiyla localde aktif koruma yok

Production aktivasyon sirasi:

1. Cloudflare dashboard'da production ve staging hostname'lerini ayir.
2. Site/secret key'leri secret store veya `.env.production` ile ver.
3. Once register ve room create akislarini ac.
4. Login rate-limit eklendikten sonra login Turnstile'i ac.
5. Guest join icin bot trafigi gorulmeden zorunlu challenge acma.
6. Managed challenge ve hata oranlarini izle; gercek domain/key smoke testini tamamla.

Ayrintili sozlesme: `docs/security/adaptive-turnstile-policy.md`.

## Cloudflare Edge Route Policy

Kod ve deployment kontrati hazir:

- `infra/cloudflare/edge-security-policy.json` route siniflarini tanimlar.
- WebSocket exact Origin + uygulama rate limit/Turnstile ile korunur; Referer
  zorunlulugu veya handshake challenge kullanilmaz.
- Login/register/room entry icin browser-only kurallar once gozlem, sonra
  Managed Challenge olarak acilir.
- Datacenter/VPN ASN'leri global block edilmez.
- Gelecek `/api/payments/webhooks/{provider}` rotalari browser challenge,
  cookie session, Origin ve Referer kontrolunden ayridir; raw-body provider
  imzasi ve event dedupe zorunludur.
- Production preflight proxy, origin lock ve
  `PAYMENT_WEBHOOK_EDGE_POLICY=signature_first_no_challenge` kararini kontrol eder.

Cloudflare dashboard ve origin firewall gercek durumu koddan kanitlanamaz. Launch
oncesi Security Events, WebSocket reconnect ve provider callback smoke testleri
operasyonel blocker olarak kalir.

## Google Search Console ve SEO

Mevcut:

- canonical metadata
- Open Graph/Twitter metadata
- `/robots.txt`
- `/sitemap.xml`
- oyun odalari icin noindex
- public olmayan route'larin robots disallow listesi
- `GOOGLE_SITE_VERIFICATION` ile HTML meta verification destegi

Search Console iki yolla kullanilabilir:

1. Onerilen: Cloudflare DNS TXT ile domain property dogrulamasi. Kod gerekmez.
2. Alternatif: `GOOGLE_SITE_VERIFICATION` degeriyle HTML meta dogrulamasi.

Disarida yapilacaklar:

- Search Console property acma
- DNS veya HTML token dogrulamasi
- sitemap gonderme
- canonical URL'nin production domainle eslestigini kontrol etme

## GA4 ve Analytics

GA4 destegi su anda **yoktur**:

- `gtag.js` veya Google Tag Manager ekli degil
- GA4 measurement ID env alani yok
- consent mode/CMP yok
- admin panelinde GA4 readiness karti yok

Mevcut `PRODUCT_ANALYTICS_ENABLED` GA4 degildir. PII'siz ve gunluk Redis
aggregate tutan dahili urun telemetrisidir. Kelime analytics de server-owned
gameplay aggregate'idir.

GA4 eklenmeden once:

1. hangi eventlerin Google'a gidecegi belirlenmeli
2. username, room code, user ID, IP ve serbest metin gonderilmemeli
3. KVKK/cookie consent karari verilmeli
4. Consent Mode v2 veya cookieless olcum karari dokumante edilmeli
5. development/staging trafigi production property'den ayrilmali
6. CSP ve ad-blocker hata davranisi ana oyunu etkilememeli

Onerilen ayri branch:

`feature/privacy-aware-ga4-and-search-integrations`

## Veri, Redis ve Realtime

### MySQL

- source of truth
- utf8mb4
- persistent Docker volume
- Prisma migration/build kontrati
- connection limit ayari

### Redis/Valkey

- AOF everysec
- shared cache
- distributed rate-limit
- capacity heartbeat
- telemetry aggregate
- gecici coordination
- ulasilamazsa guvenli alanlarda process-local fallback

Rate-limit Redis arizasinda process-local moda duser. Tek app replica icin
islevseldir; cok replica korumasi olarak yeterli degildir.

### Realtime

Room state process-localdir. Production topolojisi:

- `REALTIME_TOPOLOGY=single-writer`
- `REALTIME_REPLICA_COUNT=1`

Redis adapter ve ownership temeli bulunsa da room-state sharing/forwarding
tamamlanmadan realtime app replica sayisi artirilmamalidir.

## Audit ve Backup

### Audit

- admin ve kritik kullanici islemleri audit tablosuna yazilir
- siradan finalize olaylari Redis rollup'a alinabilir
- hot audit kayitlari job ile archive tablosuna tasinabilir
- archive kayitlari otomatik purge edilmez

Production kararlari:

- hot retention gunu
- archive retention ve hukuki saklama suresi
- manuel legal hold
- archive export/purge yetkisi

### Backup

Kod seviyesi:

- local gzip MySQL dump
- SHA-256
- S3-compatible offsite upload
- Cloudflare R2, Amazon S3 ve benzer servisler
- remote size dogrulamasi
- checksum dogrulamali restore
- gecici DB restore smoke testi

Production hazirlik kaniti ancak su uc islem gercekte tamamlaninca verilir:

1. production benzeri backup
2. private offsite bucket upload
3. gecici DB'ye basarili restore ve tablo kontrolu

## Observability ve Operasyon

Mevcut:

- token korumali `/api/health`
- web/API/jobs icin ortak PII-safe structured error event kontrati
- web HTTP isteklerinde `X-Request-Id` korelasyonu
- takilabilir provider-neutral exporter ve failure sayaci
- Redis latency/readiness
- realtime topology ve ownership status
- capacity/admission health
- telemetry ve analytics sayaçlari
- admin Integration Hub

Eksik:

- production collector endpoint/token ve alarm kanali konfigurasyonu
- uptime probe ve alarm escalation
- CPU/RAM/disk/DB connection dashboard
- on-call bildirim kanali

Minimum onerilen:

- HTTP ingest collector'u Sentry/OpenTelemetry veya log platformuna baglama
- Uptime Kuma/Better Stack benzeri external probe
- host ve container metricleri
- disk ve backup failure alarmi
- Redis fallback ve audit fallback sayaclari icin alarm

## Public Go-Live Kapilari

### P0

- [ ] Production secret/env dosyasi secret store ile hazir
- [ ] `AUTH_SECRET`, health token ve DB sifreleri uzun ve benzersiz
- [x] Login distributed basarisizlik rate-limit
- [x] Guclu yeni parola ve compromised-password politikasi
- [ ] Turnstile key ve aktif flow karari
- [x] Email verification + password reset uygulama akisi
- [ ] Production email provider credential ve teslimat smoke kaniti
- [ ] Cloudflare Access/origin lock veya admin ayni-origin guvenlik karari
- [ ] Production TLS/DNS/cookie/subdomain E2E
- [ ] Offsite backup + restore smoke kaniti
- [ ] Merkezi error tracking ve uptime alarmi
- [ ] Tek realtime writer deployment dogrulamasi

### P1

- [ ] GA4 privacy/consent tasarimi
- [ ] Search Console property ve sitemap kaydi
- [ ] Admin MFA/WebAuthn
- [ ] Archive purge/legal hold politikasi
- [ ] Load test ve kapasite esikleri
- [ ] Incident/break-glass tatbikati

## Dogrulama Komutlari

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run test:web-launch-readiness:core
npm run test:web-launch-readiness:integration
npm run test:turnstile-smoke
npm run test:csp
npm run test:web-origin-policy
npm run test:admin-access-gateway
npm run test:auth-redirect-security
npm run test:auth-password-policy
npm run test:auth-login-rate-limit
npm run test:branding-seo-settings
npm audit --omit=dev --audit-level=high
```

Gercek production readiness yalniz local test sonucu degildir. Staging
hostname, Cloudflare policy, TLS, secret store, backup bucket ve alarm kanali
birlikte dogrulanmalidir.
