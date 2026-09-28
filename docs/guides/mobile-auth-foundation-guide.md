# Mobile Auth Foundation

> Durum: implemented
> Branch: `feature/mobile-auth-foundation`
> Son güncelleme: 29 July 2026

## Kapsam

`apps/api` içindeki ilk gerçek kullanıcı route'ları:

- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/auth/sessions`
- `DELETE /v1/auth/sessions/:sessionId`

Bu, `apps/web/src/app/api` klasörünün topluca taşınması değildir. Route'lar
business servisleri ortak package sınırına çıkarıldıkça tek tek taşınır.
`/v1/me`, profile read/write, inventory/equip ve store catalog read
tamamlanmistir. Siradaki dilim notifications read'dir.

## Token Modeli

- access token: opaque, varsayılan 15 dakika
- refresh token: opaque, varsayılan 30 gün
- DB'de düz token değil yalnız SHA-256 hash tutulur
- refresh token tek kullanımlıdır ve her kullanımda rotate edilir
- refresh sırasında o oturumun eski access tokenları iptal edilir
- eski access token satırları biriktirilmez; rotation sırasında silinir
- tüketilmiş refresh token tekrar kullanılırsa cihaz oturumundaki tüm tokenlar
  iptal edilir
- kullanıcı başına en fazla 10 aktif mobil cihaz oturumu tutulur; yeni login en
  eski oturumu revoke eder
- logout ve cihaz revoke işlemleri anında MySQL'e yazılır

Token revocation kaynağı MySQL'dir. Redis, login/refresh rate-limit sayaçları
için kullanılır; Redis yoksa 10.000 anahtarla sınırlı process-local fallback
korumayı sürdürür. Token doğrulamasını yalnız Redis'e bağlamadığımız için cache
kaybı eski tokenları yeniden geçerli yapmaz.

## Hesap Güvenliği

- parola doğrulaması mevcut bcrypt hash'i üzerinden ortak pakette yapılır
- kullanıcı askıya alınmışsa login, refresh ve access token doğrulaması reddedilir
- login captcha politikası admin panelindeki `security.captcha` ayarından okunur
- production her zaman `hard_fail` uygular
- captcha policy 15 saniye cache'lenir; yoğun login trafiği her istekte ayar
  sorgusu üretmez
- login yalnız başarısız parola denemelerini sayar; IP başına 30 / 10 dakika
  ve IP'den bağımsız normalize hesap adı başına 8 / 15 dakika uygulanır
- refresh IP başına 60 deneme / 10 dakika ile sınırlıdır
- proxy header'ları yalnız `API_TRUST_PROXY=true` ise dikkate alınır
- JSON body 16 KiB ile sınırlıdır

Kayıt endpoint'i bu dilimde açılmaz. Starting balance, wallet ledger ve kayıt
sinyali ortak account service'e çıkarılmadan mevcut web register kodunu API'ye
kopyalamak iki farklı ekonomi davranışı oluşturur.

## Yayına Alma

Production'da `MOBILE_AUTH_ENABLED` varsayılan olarak `false` değerindedir.
Public route açılmadan önce:

1. additive Prisma şeması uygulanır
2. `DATABASE_URL` ve `REDIS_URL` doğrulanır
3. captcha açıksa provider site/secret key'leri API container'a verilir
4. güvenilir reverse proxy varsa `API_TRUST_PROXY=true` yapılır
5. `MOBILE_AUTH_ENABLED=true` son adımda açılır

TTL ayarları:

- `MOBILE_ACCESS_TOKEN_TTL_MS`
- `MOBILE_REFRESH_TOKEN_TTL_MS`

## Retention

Tüketilmiş refresh hash'leri reuse detection için varsayılan 7 gün tutulur.
Bu pencereden eski token yine geçersizdir fakat artık family reuse sinyali
üretmez. Eski access satırları rotation sırasında doğrudan silinir.
`mobile-auth-retention` job'ı iptal veya refresh süresi bitiminden varsayılan 30
gün sonra cihaz oturumunu ve cascade ile tokenlarını siler.

Dry run:

```bash
npm run jobs:mobile-auth-retention
```

Execute:

```bash
JOBS_ENABLED=true npm run jobs:run -- mobile-auth-retention execute
```

İlgili ayarlar:

- `MOBILE_AUTH_RETENTION_DAYS`
- `MOBILE_AUTH_REUSE_EVIDENCE_DAYS`
- `MOBILE_AUTH_RETENTION_BATCH_SIZE`
- `MOBILE_AUTH_RETENTION_LEASE_TTL_MS`

## Incident İşlemleri

Opaque tokenlarda imzalama secret'ı yoktur. Token veri sızıntısı şüphesinde
`mobile_auth_sessions` kayıtları revoke edilerek oturumlar kapatılır. DB
credential, Redis credential veya captcha secret sızıntısında ilgili altyapı
secret'ı rotate edilir ve API yeniden başlatılır. Refresh reuse tespiti yalnız
ilgili cihaz oturumunu kapatır; kullanıcıya otomatik büyük ceza uygulanmaz.

## Test

DB gerektirmeyen kapılar:

```bash
npm run typecheck:packages
npm run test:mobile-api
npx prisma validate
```

MySQL açıkken additive şema uygulandıktan sonra:

```bash
MOBILE_AUTH_INTEGRATION_TEST=true npm run test:mobile-auth
```

Entegrasyon testi geçici kullanıcı oluşturur; invalid password, login, rotate,
eski access iptali, session list/revoke ve refresh reuse family revoke
senaryolarını doğrular, sonra kullanıcıyı cascade ile temizler.
