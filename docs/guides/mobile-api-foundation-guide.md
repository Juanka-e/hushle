# Mobile API Foundation

> Durum: implemented
> Branch: `feature/mobile-api-foundation`
> Son güncelleme: 29 July 2026

## Karar

`apps/api` bu branch ile boş scaffold olmaktan çıkar ve gerçek, sürümlü bir
Node HTTP runtime'ına dönüşür. Ancak mevcut `apps/web/src/app/api` ağacı topluca
taşınmaz.

Toplu taşıma yapılmamasının nedeni dosya konumu değil bağımlılıktır:

- mevcut user route'ları Auth.js browser cookie session'ına bağlı
- admin route'ları web panelinin BFF katmanı
- match finalize process-local Socket.IO oda state'ini okuyor
- bazı service'ler hâlâ `apps/web` runtime sınırında

Bu bağımlılıkları kopyalamak iki farklı auth ve iki farklı business rule
oluşturur. Doğru geçiş, business service'i package sınırına çıkarıp web ve API
adapter'larının aynı servisi çağırmasıdır.

## Bugünkü Endpoint'ler

### `GET /health`

Runtime process health cevabıdır. DB readiness anlamına gelmez; kullanıcı verisi
endpoint'leri eklendiğinde dependency readiness ayrı alanlarla genişletilir.

### `GET /v1/meta`

İstemciye API sürümünü ve capability durumunu verir. Planlı özelliği mevcutmuş
gibi göstermez:

- runtime meta: `available`
- bearer auth: runtime flag aciksa `available`, aksi halde `planned`
- profile/inventory: auth runtime flag aciksa `available`, aksi halde `planned`
- progression: `planned`
- realtime gameplay/admin: `web_runtime_only`

## Transport Kontratı

Başarılı cevap:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "apiVersion": "v1",
    "requestId": "..."
  }
}
```

Hata cevabı:

```json
{
  "ok": false,
  "error": {
    "code": "not_found",
    "message": "Endpoint was not found."
  },
  "meta": {
    "apiVersion": "v1",
    "requestId": "..."
  }
}
```

Kontratlar `packages/api-contracts` altında transporttan bağımsız tutulur.
Mobile client ileride bu paketten üretilen OpenAPI/client artefact'larını
kullanabilir.

## Güvenlik

### CORS

`API_ALLOWED_ORIGINS` virgülle ayrılmış exact browser origin allowlist'idir.
Wildcard kabul edilmez. Production default'u boş listedir.

Native mobil uygulamalar genellikle browser `Origin` header'ı göndermez.
Origin bulunmaması kimlik doğrulaması değildir. Kullanıcı endpoint'leri
açılmadan önce bearer access token zorunlu olacaktır.

### Request ID

- geçerli `X-Request-Id` en fazla 64 güvenli karakterle kabul edilir
- geçersiz veya eksik değer server UUID'siyle değiştirilir
- response aynı ID'yi `X-Request-Id` ve JSON meta içinde döndürür

### Response

- `Cache-Control: no-store`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- internal stack, filesystem veya runtime exception istemciye gönderilmez

## Auth Gate

Cookie session'ı mobile API'ye taşınmayacak. Sonraki auth slice aşağıdakiler
tamamlanmadan kullanıcı endpoint'i açamaz:

1. kısa ömürlü access token
2. yalnız hash'i DB'de tutulan, rotate edilen refresh token
3. token family reuse detection ve family revoke
4. cihaz/oturum listesi ve kullanıcı logout/revoke
5. login/register rate limit ve captcha policy parity
6. suspended kullanıcı kontrolü
7. secret rotation ve incident runbook

JWT kullanılması zorunlu değildir. İlk hedef revocation ve rotation davranışı
net, server-owned opaque token modelidir.

## Route Taşıma Planı

### Faz 1 - bu branch

- `apps/api` runtime
- `/health`, `/v1/meta`
- versioned envelope
- CORS/request ID/security headers
- opsiyonel Docker profile

### Faz 2 - mobile auth - tamamlandı

- login, refresh, logout
- session/device revoke
- `platform-auth` veya eşdeğer shared package

Detaylar `docs/guides/mobile-auth-foundation-guide.md` içindedir. Production
enablement explicit flag ile yapılır. Player core, inventory/equip ve store
catalog read tamamlanmistir. Yeni mobil route tasimalari web acilisi stabil
hale gelene kadar duraklatilmistir; devam sirasi
`apps/api/MOBILE_ROADMAP.md` icindedir.

### Faz 3 - player core - tamamlandı

- `/v1/me` - tamamlandı
- profile read/write - tamamlandı
- inventory read - tamamlandi
- equip mutation - tamamlandi

Business logic önce shared package/service sınırına çıkarılır. Next route'ları
uyumluluk adapter'ı olarak aynı servisi çağırmaya devam eder.

### Faz 4 - economy/content

- store catalog - tamamlandi
- purchase
- notifications
- support

Wallet ledger ve server-side fiyatlama değişmez. İstemciden bakiye, fiyat veya
reward sonucu kabul edilmez.

### Realtime ve admin

- admin route'ları web BFF'de kalır
- match finalize realtime writer'da kalır
- active-room endpoint'i shared presence tamamlanmadan taşınmaz

## Docker ve Deploy

Host geliştirme:

```bash
npm run api:dev
```

Opsiyonel Compose:

```bash
docker compose --profile api up -d api
```

Profile açılmadıkça ek API container'ı çalışmaz. Port yalnız loopback'e publish
edilir. Nginx/public DNS route'u ayrı production security review sonrasında
eklenir.

## Kabul Kriterleri

- API runtime Next.js veya `apps/web` import etmiyor
- production CORS default-deny
- wildcard reddediliyor
- native originless request transport seviyesinde çalışıyor
- version/request ID her JSON cevapta bulunuyor
- bilinmeyen route ve yanlış method deterministik cevap veriyor
- runtime HTTP smoke ve boundary testi CI'da çalışıyor
