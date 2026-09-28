# Mobile Player Core

> Durum: implemented
> Branch: `feature/mobile-player-core`
> Son güncelleme: 29 July 2026

## Kapsam

Bu dilim mobil API'ye ilk kimlik doğrulanmış oyuncu verisi route'larını ekler:

- `GET /v1/me`
- `PATCH /v1/profile`

Ortak business service `@hushle/platform-player` paketindedir. Mevcut web
`PATCH /api/user/profile` route'u da aynı servisi kullanır. Böylece display name,
bio, e-posta normalizasyonu, benzersizlik ve audit davranışı iki runtime arasında
kopyalanmaz.

## Veri Minimizasyonu

`GET /v1/me` tüm inventory listesini döndürmez. Response yalnız user kimliği,
e-posta doğrulama durumu, coin özeti, profil ve kuşanılmış slot id'lerini içerir.
Kozmetik detayları ve inventory listesi sonraki sürümlü endpoint'te sayfalama ile
taşınacaktır.

## Profil Güncelleme

- `displayName`: trim edilir; boş değer kalıcı username fallback'i için `null`
  olur; en fazla 60 karakterdir
- `bio`: trim edilir; en fazla 300 karakterdir
- `email`: trim/normalize edilir; geçerli format ve 191 karakter sınırı aranır

En az bir alan bulunmalıdır. E-posta değişirse doğrulama zamanı sıfırlanır.
Unique yarış durumu Prisma `P2002` ile ayrıca yakalanır.

Profil/e-posta değişikliği ile audit kayıtları aynı DB transaction'ında yazılır.
Mobil ve web adapter'ları güvenilir request IP ve user-agent bilgisini ortak
servise verir.

## Güvenlik ve Yük

- bearer token doğrulanmadan oyuncu verisi okunmaz
- suspended hesaplar platform-auth tarafından reddedilir
- IP başına genel player API sınırı 300/dakikadır
- `/v1/me` user + IP başına 120/dakikadır
- profile update user + IP başına 20/dakikadır
- body üst sınırı 16 KiB'dir ve cevaplar cache edilmez

## Test Stratejisi

Bu branch UI render veya etkileşim bileşeni değiştirmez. Bu nedenle yeni
Playwright senaryosu eklemek yerine doğru katmanlar test edilir:

```bash
npm run test:player-core
npm run test:mobile-api
npm run typecheck:packages
npm run typecheck:web
```

MySQL açık ve additive Prisma şeması uygulanmışken:

```bash
PLAYER_CORE_INTEGRATION_TEST=true npm run test:player-core-integration
```

Entegrasyon testi geçici kullanıcılarla core response, coin özeti,
profil/e-posta update, display name fallback, e-posta çakışması ve audit
metadata davranışını doğrulayıp verileri temizler.

UI değişen sonraki branch'lerde ilgili Playwright doğrulaması zorunlu olarak
değerlendirilir.

## Devam Durumu

Inventory/equip ve store catalog read tamamlanmistir. Yeni mobil API dilimleri
web acilisi stabil hale gelene kadar duraklatildi. Ertelenen sira ve yeniden
baslatma kosullari `apps/api/MOBILE_ROADMAP.md` icindedir; fiyat ve bakiye
istemciden kabul edilmez.
