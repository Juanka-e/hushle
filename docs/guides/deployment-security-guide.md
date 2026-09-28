# Deployment Security Guide

Bu rehber production deployment icin minimum guvenli topolojiyi tarif eder.

Amac:
- Next.js / Node backend'i dogrudan internete acmamak
- Nginx'i tek public giris noktasi yapmak
- Auth.js `AUTH_TRUST_HOST` ayarini dogru topoloji ile kullanmak
- MySQL, Redis/Valkey ve benzeri servisleri public internetten izole tutmak

## 1. Dogru Topoloji

Tavsiye edilen production akisi:

1. Internet
2. Nginx
3. `127.0.0.1:3000` uzerindeki Next.js / Node backend
4. `127.0.0.1` veya private network uzerindeki MySQL
5. gerekiyorsa private Redis / Valkey

Kural:
- public olan sadece `80/443`
- backend portlari public olmayacak

## 2. Loopback Bind Nedir?

Loopback bind, servisin sadece ayni makineden erisilebilir bir adrese baglanmasidir.

Ornek:
- `127.0.0.1:3000` -> sadece ayni sunucu erisebilir
- `0.0.0.0:3000` -> firewall aciksa disaridan da erisilebilir

Production hedefi:
- Next backend: `127.0.0.1:3000`
- MySQL: `127.0.0.1:3306` veya private interface
- Redis/Valkey: `127.0.0.1` veya private interface

Docker istisnasi:
- app ayri container icindeyse `HOST=0.0.0.0` olmali
- bu tek basina public exposure anlamina gelmez
- guvenlik kosulu, app portunun host'a publish edilmemesi ve sadece private Docker network uzerinden Nginx tarafindan erisilmesidir

## 3. Neden Backend Portu Public Olmamali?

Node/Next portu dogrudan disariya acik olursa:

1. Nginx bypass edilir
2. reverse proxy uzerinden bekledigin host/header davranisi bozulur
3. health endpoint ve benzeri runtime yuzeyler dogrudan erisilebilir olur
4. TLS termination ve request normalization sadece proxy tarafinda kaldigi icin koruma modeli zayiflar

Bu yuzden:
- public traffic sadece Nginx'e gelsin
- Node backend private kalsin

## 4. `AUTH_TRUST_HOST` Nedir?

Auth.js `Host` basligini kullanir.
Self-hosted deployment'ta bu yuzden `trustHost` davranisi onemlidir.

Bu projede:
- `AUTH_TRUST_HOST=true` production'da sorun degil
- yanlis topolojide risklidir

Yanlis dusunce:
- `AUTH_TRUST_HOST=false` yaparsam daha guvenli olur

Bu dogru degil.
Pratikte daha olasi sonuc:
- `UntrustedHost` hatasi
- login/session akisinin bozulmasi

### Local Development Notu

Development ortaminda `localhost` veya benzeri local origin'lerde Auth.js host guveni pratik olarak acik olmalidir.

Bu projede karar:

- `NODE_ENV !== "production"` iken local dev host'lari otomatik trusted kabul edilir
- production'da ise `AUTH_TRUST_HOST=true` acikca verilmelidir

Yani:

- local development'ta `AUTH_TRUST_HOST` zorunlu degil
- production'da zorunlu karar alanidir

Dogru guvenlik modeli:

1. `AUTH_TRUST_HOST=true`
2. backend direct public degil
3. Nginx tek giris noktasi
4. Nginx dogru `Host` ve `X-Forwarded-*` header'larini geciyor
5. firewall ile raw backend portu kapali

## 5. Production Env Karari

Tavsiye edilen ana ayarlar:

```env
NODE_ENV="production"
HOST="127.0.0.1"
PORT="3000"

NEXTAUTH_URL="https://tabu.com"
NEXT_PUBLIC_SITE_URL="https://tabu.com"
AUTH_TRUST_HOST="true"

HEALTHCHECK_TOKEN="replace_with_long_random_value"
```

Notlar:
- `HOST="127.0.0.1"` backend'i private tutar
- `NEXTAUTH_URL` canonical public origin olmali
- `NEXT_PUBLIC_SITE_URL` da public canonical origin olmali
- `HEALTHCHECK_TOKEN` production health endpoint korumasi icin kullanilir

## 6. Nginx Reverse Proxy Kurallari

Nginx'in gorevi:

1. public TLS terminasyonu
2. canonical host yonetimi
3. backend'e request forwarding
4. public origin ile internal backend arasinda tek giris noktasi olmak

Ornek mantik:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name tabu.com www.tabu.com;
    return 301 https://tabu.com$request_uri;
}

server {
    listen 443 ssl http2;
    server_name tabu.com;

    ssl_certificate /etc/letsencrypt/live/tabu.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tabu.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

Minimum beklenti:
- `Host` gecmeli
- `X-Forwarded-Proto` gecmeli
- websocket upgrade header'lari gecmeli

## 6.2 Cloudflare Origin Certificate Akisi

Cloudflare kullanilacaksa pratik model:

1. DNS Cloudflare uzerinden yonetilir
2. sunucuda public giris yine Nginx olur
3. Cloudflare Origin Certificate uretilir
4. cert ve key repo'ya commit edilmez
5. Nginx container'ina read-only mount edilir

Bu repo icindeki beklenen yol:

- `nginx/ssl/origin-cert.pem`
- `nginx/ssl/origin-key.pem`

Cloudflare SSL/TLS modu:
- `Full (strict)`

Onemli:
- `.pem` dosyalarini uygulama koduna koyma
- sadece Nginx katmanina mount et
- app container SSL terminate etmesin

## 6.1 `TRUST_PROXY` Karari

Bu projede `TRUST_PROXY`, uygulamanin su header'lara guvenip guvenmeyecegini belirler:

- `X-Forwarded-For`
- `X-Real-IP`

Bu bilgi su alanlari etkiler:
- request rate limit anahtarlari
- audit log IP kaydi
- bazi operasyonel gozlemleme alanlari

Dogru kullanim:

```env
TRUST_PROXY=true
```

Ama bu sadece su sartlarda dogrudur:

1. backend public degil
2. Nginx tek giris noktasi
3. Nginx bu header'lari kendisi set ediyor
4. firewall ile raw app portu kapali

Yanlis kullanim:
- backend hala publicken `TRUST_PROXY=true`

Bu durumda biri backend'i dogrudan vurup spoofed `X-Forwarded-For` gonderebilir.
Sonuc:
- audit IP kirlenir
- rate limit anahtarlari yanlislasir
- gelecekte IP gorunurlugu gibi operasyonel kararlar bozulur

Guvenli kural:
- `Nginx + private backend` ise `TRUST_PROXY=true`
- aksi halde `TRUST_PROXY=false`

## 7. Firewall / Port Politikasi

Public acik olacak:
- `80`
- `443`

Public kapali olacak:
- `3000` (Next/Node)
- `3306` (MySQL)
- Redis / Valkey portlari
- varsa admin/debug/internal baska portlar

Sunucu seviyesinde kontrol et:
- UFW
- iptables/nftables
- cloud security group
- hosting panel firewall kurallari

Kural:
- sadece proxy public
- uygulama servisleri private

## 8. Health Endpoint Politikasi

Bu projede `/api/health`:
- development'ta acik
- production'ta `x-health-token` + `HEALTHCHECK_TOKEN` ile korunur

Beklenen production cagrisi:

```http
GET /api/health
x-health-token: <HEALTHCHECK_TOKEN>
```

Token yoksa:
- `404`

Bu endpoint'i public monitoring endpoint gibi dusunme.
Production'da private operasyon endpoint'i olarak ele al.

## 9. Public API Yuzeyi Nasil Dusunulmeli?

Public endpoint olmasi tek basina acik demek degildir.

Bu projede bilincli public yuzeyler var:
- auth flow
- register
- captcha public config
- visible announcements

Asil kritik ayrim:
- public route olabilir
- ama backend direct public olmamali

Yani:
- uygulama public route'lara sahip olabilir
- Node process public internete dogrudan acilmamali

## 10. Socket.IO ve CORS

Bu projede Socket.IO:
- development'ta `*`
- production'ta `NEXT_PUBLIC_SITE_URL`

Bu tek-origin deployment icin kabul edilebilir.

Ama su durumlarda tekrar ele alinmali:
- birden fazla public origin
- ayri admin domain
- staging/prod paralel origin
- CDN veya farkli frontend hostlari

O durumda tek string yerine allowlist gerekir.

## 11. MySQL ve Redis / Valkey

MySQL:
- kalici veri
- source of truth
- public olmayacak

Redis / Valkey:
- shared cache
- rate limit
- transient coordination
- public olmayacak

Production kural:
- DB ve cache servisleri private network veya loopback uzerinde kalacak

## 12. Minimum Production Checklist

Deploy oncesi kontrol:

1. `AUTH_TRUST_HOST=true`
2. `NEXTAUTH_URL` dogru
3. `NEXT_PUBLIC_SITE_URL` dogru
4. `HOST=127.0.0.1`
5. Nginx tek public giris noktasi
6. `3000` public kapali
7. `3306` public kapali
8. Redis/Valkey varsa public kapali
9. `HEALTHCHECK_TOKEN` set
10. canonical host disinda istekler redirect veya reject oluyor

## 12.1 Prisma On Windows

Windows local development'ta `prisma db push` sonundaki otomatik generate asamasi bazen:

- `EPERM`
- `query_engine-windows.dll.node` rename hatasi

uretebilir.

Bu tipik olarak engine dosyasinin bir baska process tarafindan kullaniliyor olmasindan kaynaklanir.

Bu repo icin yalniz gecici local prototipte kullanilan akim:

1. `npm run db:push:local`
   - `prisma db push --skip-generate`
2. `npm run db:generate`
   - `prisma generate`

Toplu akim:

```bash
npm run db:sync
```

Merge edilecek kalici schema degisikliklerinde `db push` kullanilmaz. Migration
`npm run db:migrate:dev -- --name <acik-ad>` ile uretilir; production'da
`npm run db:migrate:deploy` ile uygulanir. Baseline ve release proseduru icin
`docs/deploy/database-migrations.md` izlenir.

Bu sayede:

- schema sync ayri yapilir
- generate ayri yapilir
- Windows'taki gereksiz `EPERM` gürültüsü azalir
Not:
- Bu repo icin --no-engine akisi tercih edilmiyor.
- Local MySQL development icin klasik prisma generate kullanilmali.
- EPERM gorursen en sik neden dev server veya baska bir process''in Prisma engine dosyasini kilitlemesidir.
- Bu durumda:
  1. dev server''i durdur
  2. 
pm run db:generate calistir
  3. dev server''i yeniden baslat

## 13. En Sik Yanlislar

1. `AUTH_TRUST_HOST=false` yapip guvenligi arttirdigini sanmak
- gercekte auth akisini bozabilir

2. Nginx kurup backend portunu yine public birakmak
- reverse proxy modelini bozar

3. MySQL'i internetten acmak
- cok kotu karar

4. Redis/Valkey'i sifresiz veya public acmak
- cok kotu karar

5. `NEXTAUTH_URL` ve `NEXT_PUBLIC_SITE_URL` uyumsuz birakmak
- callback/session/origin sorunlari cikarir

## 14. Bu Rehberin Karari

Bu proje icin guvenli production modeli:

1. Nginx public
2. Next backend private
3. MySQL private
4. Redis/Valkey private
5. `AUTH_TRUST_HOST=true`
6. Health endpoint token ile korunmus

Bu model, host trust ve reverse proxy konusunu en dusuk operasyonel riskle yonetir.

