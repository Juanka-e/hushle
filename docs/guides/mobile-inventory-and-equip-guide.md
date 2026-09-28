# Mobile Inventory And Equip

> Durum: implemented
> Branch: `feature/mobile-inventory-and-equip`
> Son guncelleme: 29 July 2026

## Kapsam

Bu dilim mobil API'ye iki kimlik dogrulanmis oyuncu endpoint'i ekler:

- `GET /v1/inventory`
- `PATCH /v1/inventory/equipped`

Inventory okuma, sahiplik kontrolu, item turu dogrulamasi ve kusanma/cikarma
kurallari `@hushle/platform-inventory` paketindedir. Mevcut web inventory ve equip
route'lari da ayni servisi kullanir.

## Listeleme Kontrati

Mobil liste varsayilan 25, en fazla 50 item dondurur. Desteklenen query alanlari:

- `limit`: 1-50
- `type`: `avatar`, `frame`, `card_back`, `card_face`
- `cursor`: server tarafindan uretilen opaque devam anahtari

Siralamada `acquiredAt DESC, id DESC` kullanilir. Cursor bu iki alani birlikte
tasir; istemci cursor ic yapisina guvenmemeli veya kendisi uretmemelidir.

Response profilin kusanilmis slotlarini, sayfa item'larini ve `nextCursor`
bilgisini verir. Tum envanter tek istekte mobil cihaza gonderilmez.

## Kusanma Ve Cikarma

Request:

```json
{
  "itemType": "avatar",
  "shopItemId": 42
}
```

Bir slotu bosaltmak icin `shopItemId: null` gonderilir.

Server su kurallari uygular:

- kullanici bearer token'dan belirlenir
- item gercekten var olmalidir
- item kullanicinin inventory kaydinda bulunmalidir
- item tipi hedef slotla ayni olmalidir
- sahiplik kontrolu ve profil update `Serializable` transaction icinde kalir
- fiyat, sahiplik veya equipped degeri istemciden kabul edilmez
- store/maintenance feature policy hem web hem mobil adapter'da kontrol edilir

## Yuk Ve Cache

Inventory source of truth MySQL'dir. Listeleme yolu read-only'dir; her okumada
wallet/profile upsert veya transaction calistirmaz. Kusanma mutasyonu eksik
`UserProfile` kaydini bir kez olusturabilir.

Bu dilimde inventory response cache eklenmedi. Kusanma sonrasi stale cache
riski olmadigi icin invalidation gerekmiyor. Olcek gerektirirse ileride:

- inventory revision/version key
- user bazli kisa TTL cache
- mutation sonrasi revision artirma

eklenebilir. Redis hicbir zaman sahiplik source of truth'u olmaz.

Store availability mobile API'de 15 saniyelik ortak cache abstraction'i ile
okunur. Redis yoksa mevcut platform-cache fallback davranisi kullanilir.

## Rate Limit

- genel player API: IP basina 300/dakika
- inventory read: user + IP basina 120/dakika
- equip mutation: user + IP basina 30/dakika

## Testler

```bash
npm run test:inventory-core
npm run test:mobile-api
npm run typecheck:packages
npm run typecheck:web
```

MySQL acikken:

```bash
INVENTORY_CORE_INTEGRATION_TEST=true npm run test:inventory-core-integration
```

Entegrasyon testi pagination, type filter, sahiplik, tur uyusmazligi,
kusanma/cikarma ve equipped projection davranisini gecici verilerle dogrular.

UI degismemistir. Buna ragmen mevcut gameplay Playwright suite'i web adapter
regresyonu icin branch kabul kapisinda calistirilir.

## Siradaki Dilim

Store catalog read `feature/mobile-store-catalog-read` diliminde tamamlanmistir.
Purchase daha sonra tasinmali ve wallet ledger, idempotency, server-side
fiyatlama ve kampanya snapshot kurallari ortak economy paketine alinmadan
acilmamalidir.
