# Admin Subdomain And CORS

Kisa cevap:

- Su an `/admin` ayni origin uzerinde en dusuk operasyonel riskli secenektir.
- `admin.hushle.com` gibi ayri bir subdomain desteklenebilir, ancak auth/cookie
  gecisi Socket.IO veya CSP allowlist'inden bagimsiz olarak planlanmalidir.

## Mevcut Origin Yapisi

- `NEXT_PUBLIC_SITE_URL` canonical web originidir.
- `TRUSTED_WEB_ORIGINS` virgulle ayrilmis ek browser originlerini Socket.IO
  allowlist'ine ekler.
- Allowlist degerleri tam origin olmalidir. Wildcard, URL path, query, credential
  ve origin benzeri suffix eslesmesi kabul edilmez.
- HTTP `POST`, `PUT`, `PATCH` ve `DELETE` istekleri halen same-origin kontrolunden
  gecer. Socket allowlist'e origin eklemek CSRF sinirini gevsetmez.
- `ALLOW_ORIGINLESS_SOCKET_CLIENTS` native mobil/server istemcileri icin ayridir.
  Production varsayilani kapali kalir. Mobil kimlik dogrulamasi ve cihaz token
  kontrati hazirlanmadan acilmaz.

Ornek:

```env
NEXT_PUBLIC_SITE_URL="https://hushle.com"
TRUSTED_WEB_ORIGINS="https://admin.hushle.com,https://play.hushle.com"
```

## Font, Asset Ve Baglanti CSP Kaynaklari

Harici kaynaklar genel bir CSP override'i yerine direktif bazinda eklenir:

- `CSP_STYLE_SOURCES`: harici stylesheet originleri
- `CSP_FONT_SOURCES`: harici font originleri
- `CSP_CONNECT_SOURCES`: API ve WebSocket originleri

Ornek:

```env
CSP_STYLE_SOURCES="https://fonts.googleapis.com"
CSP_FONT_SOURCES="https://fonts.gstatic.com,https://assets.hushle.com"
CSP_CONNECT_SOURCES="https://api.hushle.com,wss://socket.hushle.com"
```

Cloudflare kullanmak tek basina Cloudflare domainlerini CSP'ye eklemeyi gerektirmez.
Tarayicinin gercekte baglandigi font, asset, API veya WebSocket origin'i eklenir.
Wildcard kaynaklar kabul edilmez. Font ve style kaynaklari production'da HTTPS,
Socket kaynaklari WSS kullanmalidir.

## Admin Subdomain Gecis Listesi

1. `NEXTAUTH_URL` ve auth callback URL listesi
2. `NEXT_PUBLIC_SITE_URL` canonical URL karari
3. `TRUSTED_WEB_ORIGINS` Socket.IO allowlist
4. cookie domain ve SameSite davranisi
5. Cloudflare Access policy kapsami
6. CSP style/font/connect kaynaklari
7. ayni admin yuzeyinin path ve subdomain altinda birlikte calisacagi gecis suresi

Auth callback URL'leri, cookie ayarlari ve Cloudflare Access policy'si origin/CSP
allowlistlerinden bagimsizdir. Bunlardan biri digerini otomatik olarak ayarlamaz.

## Baska Containerlar Olursa

1. Yalniz reverse proxy `80/443` portlarini disari acar.
2. Uygulama, veri tabani, Redis ve jobs containerlari private networkte kalir.
3. Host veya path bazli reverse proxy kurallari acik tanimlanir.

Ornek:

- `hushle.com` -> web app
- `admin.hushle.com` -> ayni app veya ileride ayri admin runtime
- `grafana.hushle.com` -> private gozlemleme servisi, Access arkasinda

Kisa vadeli onerilen sira `/admin`, Cloudflare Access path korumasi ve gercek
operasyonel ihtiyac olustugunda kontrollu `admin.hushle.com` gecisidir.
