# Release Compatibility And Versioning

Bu dokuman uygulama surumu, Socket.IO protokolu, veritabani migration'i ve
kozmetik render spec surumunun farkli sorumluluklarini tanimlar. Tek bir global
version numarasi bu dort problemi guvenli bicimde cozmez.

## Surum Katmanlari

| Katman               |  Bugunku deger | Amac                                                      |
| -------------------- | -------------: | --------------------------------------------------------- |
| Web release          |        Git SHA | Hangi kodun deploy edildigini gostermek                   |
| Socket protokolu     | v1, minimum v0 | Acik/eski sekmelerin event kontrati uyumu                 |
| Mobile/public API    |          `/v1` | HTTP request/response kontrati                            |
| Prisma migration     | timestamp + ad | DB semasini sirali ve tekrar uygulanabilir degistirmek    |
| Cosmetic render spec |             v1 | Satin alinmis kart JSON'ini ayni semantics ile yorumlamak |

`sessionVersion` bu tabloya dahil degildir. O alan parola/email gibi guvenlik
olaylarinda session gecersiz kilmak icindir; uygulama release surumu degildir.

## Socket Protokolu

Yeni web istemcisi Socket.IO handshake auth icinde
`clientProtocolVersion: 1` gonderir. Sunucu baglanti kurulmadan once bu degeri
kontrol eder.

Bugunku compatibility penceresi:

- current: v1
- minimum: v0
- v0: surum alani gondermeyen, bu mekanizmadan once acilmis legacy web sekmesi
- v1: bugunku web istemcisi
- v2 ve ustu: bu server tarafindan bilinmedigi icin reddedilir

Bu sayede deploy aninda eski acik sekmeler zorla kopmaz. Gelecekte v2 yayininda
minimum v1 tutularak N-1 destegi verilebilir. v0 ancak eski sekme penceresinin
bittigi ve telemetry'nin guvenli oldugunu gosterdigi ayri release'te kaldirilir.

Uyumsuz istemci room handler'larina ulasmadan reddedilir. Yeni istemciler
kullaniciya sayfayi yenilemesini soyleyen kontrollu hata metni gosterir.
Protokol alani guvenlik kimligi degildir ve istemci tarafindan degistirilebilir;
authorization ve payload dogrulamalari her zaman server-side kalir.

Event degisikligi kurali:

1. Once additive alan/event ekle; eski istemci bilinmeyen alani yok saysin.
2. En az N-1 pencere boyunca eski alan/event'i koru.
3. Breaking semantics gerekiyorsa current version'i artir.
4. Minimum version'i ayni release'te gereksiz yere artirma.
5. Reconnect, devam eden oyun ve eski sekme senaryolarini test et.

## Cosmetic Render Spec

`renderSpecVersion`, item veya satin alim snapshot'inin hangi renderer semantics
ile yorumlanacagini belirler. Bugun yalniz v1 parser'i desteklenir.

Resolver akisi:

1. snapshot'taki requested version okunur
2. desteklenen registry kontrol edilir
3. v1, v1 parser'ina dispatch edilir
4. bilinmeyen/eski bozuk deger guvenli v1 fallback ile render edilir
5. sonuc requested/effective/fallback metadata'si tasir

Admin create/update API'si bu release'in desteklemedigi yeni version'i
kaydetmez. Fallback yeni v2 icerik yayinlama yolu degil, mevcut verinin oyunu
bozmasini engelleyen savunmadir.

v2 cikarma sirasi:

1. v2 schema ve parser kodunu ekle
2. v1 regression ve v2 fixture testlerini gecir
3. admin preview'da v1/v2 farkini goster
4. supported registry'ye v2 ekle
5. ancak bundan sonra yeni item'i v2 olarak kaydet

Eski urunler v1 kalir; toplu migration ile yeni semantics'e zorlanmaz. Satin
alim snapshot'i mevcut render version ve config'i korur.

## Release Ve Rollback

- Git SHA deploy edilen uygulamayi tanimlar.
- Socket protocol bump, code deploy'undan bagimsiz dusunulmez.
- DB degisiklikleri `docs/deploy/database-migrations.md` akisini izler.
- Eski app'e rollback yapilmadan once DB ve protocol ileri/geri uyumu kontrol
  edilir.
- Renderer parser'i kaldirilmaz; o version'i kullanan satin alinmis item kalmayana
  kadar okunabilir tutulur.
