# Mobile Store Catalog

> Durum: implemented
> Branch: `feature/mobile-store-catalog-read`
> Son guncelleme: 29 July 2026

## Kapsam

Bu dilim mobil API'ye kimlik dogrulanmis katalog okuma endpoint'i ekler:

- `GET /v1/store/catalog`

Query alanlari:

- `kind`: `items` veya `bundles`; varsayilan `items`
- `limit`: 1-50; varsayilan 25
- `cursor`: server tarafindan uretilen opaque devam anahtari
- `type`: yalniz `kind=items` icin `avatar`, `frame`, `card_back`, `card_face`

Item ve bundle sayfalari `sortOrder`, `createdAt`, `id` alanlariyla stabil
siralanir. Cursor bu alanlari birlikte tasir. Istemci cursor ic yapisina
guvenmemeli veya kendisi uretmemelidir.

## Ortak Source Of Truth

`@hushle/platform-store` su davranislarin tek kaynagidir:

- aktif katalog sorgulari
- store fiyat carpani
- aktif discount campaign secimi
- en iyi kampanya fiyatinin hesaplanmasi
- coupon fiyatlama kurallari
- kullaniciya ozel coin, owned ve equipped overlay'i
- item ve bundle pagination

Web tam katalog route'u ve mobil sayfali katalog ayni servisi kullanir. Web
purchase/coupon kodu da fiyatlandirma fonksiyonlarini bu paketten re-export
eder. Boylece istemciye gosterilen fiyat ile server purchase fiyat kurali
birbirinden kopmaz.

## Cache Modeli

Katalog iki katmanlidir:

1. kullanicidan bagimsiz item, bundle, render spec ve promotion snapshot'i
2. cache'lenmeyen kullaniciya ozel bakiye, sahiplik ve kusanma overlay'i

Ortak snapshot Redis varsa Redis, yoksa bounded memory fallback ile 30 saniye
cache'lenir. Admin katalog/promotion degisikligi mevcut
legacy `store-catalog-shared:v1` snapshot'i ile yeni
`store-catalog-revision:v2` anahtarini invalidate eder. Sonraki istekte yeni
revision uretilir ve page cache anahtarlari bu revision'i kullanir. Ayri v2
anahtari rolling deploy sirasinda eski snapshot'in revision sanilmasini engeller.
System settings update ayni zamanda mobil store policy cache'ini invalidate eder.
Redis olmayan ayri local process fallback'inde policy en fazla 15 saniye stale
kalabilir.

Eski revision sayfalari source of truth degildir ve en fazla TTL sonuna kadar
erisilemez cache girdisi olarak kalir. MySQL kalici truth olmaya devam eder.

Mobil sayfada owned sorgusu tum inventory'yi okumaz; yalniz donen item veya
bundle icindeki item id'leri icin calisir. Bu, katalog ve inventory buyudukce
kullanici basina okuma maliyetini sinirlar.

## Guvenlik

- bearer token zorunludur
- suspended hesap auth katmaninda reddedilir
- store veya maintenance policy kapaliysa katalog `409 store_unavailable`
  doner
- user id, coin balance, owned, equipped ve fiyat istemciden kabul edilmez
- promotion usage sayaçlari, internal id'ler, sort order ve match multiplier
  mobil cevaba gonderilmez
- endpoint salt okunurdur ve purchase islemi yapmaz
- user + IP basina 60/dakika rate limit vardir
- cevaplar `Cache-Control: no-store` ile kullanici cihazinda ortak cache'e
  girmez

## Purchase Neden Ayrildi

Bu branch satin alma endpoint'i eklemez. Purchase tasinmadan once ortak servis
su kurallari birlikte korumalidir:

- server-side fiyat ve kampanya snapshot'i
- wallet ledger mutation
- idempotency key
- yetersiz bakiye ve ayni urunu tekrar alma yarislari
- coupon/promotion usage reservation
- inventory yazimi ve notification davranisi

Katalog cevabindaki `finalPriceCoin` istemciye gosterim icindir. Purchase
mutasyonu bu degeri request'ten kabul etmeyecektir.

## Testler

```bash
npm run test:store-catalog-core
npm run test:store-pricing
npm run test:mobile-api
npm run typecheck:packages
npm run typecheck:web
```

MySQL acikken:

```bash
STORE_CATALOG_CORE_INTEGRATION_TEST=true npm run test:store-catalog-core-integration
```

Entegrasyon testi cursor pagination, type filter, promotion fiyati, coin,
owned/equipped overlay'i ve bundle ownership oranini gecici verilerle
dogrular.

## Devam Durumu

Yeni mobil API dilimleri web acilisi stabil hale gelene kadar duraklatildi.
Notifications ve store purchase dahil devam sirasi
`apps/api/MOBILE_ROADMAP.md` icinde korunur. Store purchase acildiginda wallet
ledger ve idempotency zorunlulugu degismez.
