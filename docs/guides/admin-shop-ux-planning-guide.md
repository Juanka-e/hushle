# Admin Shop UX Planning Guide

Bu rehber `feature/admin-shop-ux` branch'inin kapsam sinirini netlestirir.

Amac, admin tarafindaki shop, bundle ve promotion operasyonlarini daha okunur ve buyumeye uygun hale getirmektir.

## Branch Amaci

Bu branch su problemleri cozmelidir:

- shop item listesinin karmasiklasmasi
- featured / active / hidden mantiginin daginik gorunmesi
- coupon / discount / bundle iliskilerinin admin gozunde anlasilmaz kalmasi
- seasonal ve future liveops akislarina hazir bir operasyon yuzeyi olmamasi

Bu branch sonunda admin panel su sorulara hizli cevap verebilmelidir:

1. Bu item aktif olarak magazada gorunuyor mu?
2. Featured mi?
3. Hangi type ve rarity'de?
4. Hangi kampanya veya kuponlarla iliskili?
5. Bundle icinde kullaniliyor mu?
6. Seasonal veya limited gibi merchandising etiketi tasiyor mu?
7. Simdi gorunur ama sonra kapanacak sekilde planlanabiliyor mu?

## Kapsam

Planlanan ana isler:

1. shop item listesi icin daha okunur admin shell
- daha iyi arama
- type / rarity / active / featured filtreleri
- daha net durum rozetleri
- daha iyi tablo veya liste yogunlugu

2. merchandising kontrol dili
- featured
- active / hidden
- badge text
- sort order / vitrin sirasi

3. promotion ve offer baglantilarinin daha gorunur hale gelmesi
- item hangi coupon/discount ile bagli
- bundle icinde kullaniliyor mu
- admin bir item'in magazadaki tum baglamini gorebilmeli

4. gelecege hazir durum modeli
- active
- hidden
- scheduled
- seasonal
- limited
- event-only

5. batch operasyonlari
- toplu activate/deactivate
- toplu featured ac/kapat
- toplu badge temizleme veya duzenleme

## Bilincli Kapsam Disi

Bu branch'te yapilmamasi gerekenler:

1. oyuncu inventory operasyonlari
- grant / revoke
- kullanici inventory inspect

2. night market implementasyonu
- sadece veri ve operasyon ihtiyaclari gozetilir
- feature'in kendisi bu branch'te gelmez

3. economy abuse kurallari
- coin kazanma / reward eligibility
- repetitive group heuristics

4. Redis / cache / PM2 altyapisi

5. oyuncu-facing store redesign
- bu buyuk oranda `feature/store-merchandising` ile geldi
- burada odak admin operasyonudur

## Ekran ve Akis Hedefleri

### Shop Items

- ustte net toolbar
- arama ve hizli filtreler
- liste veya tablo satirinda:
  - gorsel
  - isim
  - code
  - type
  - rarity
  - fiyat
  - featured durumu
  - active durumu
  - bagli bundle/promo sinyalleri

### Promotions

- coupon / discount / bundle yonetimi ayni sayfada kaybolmamalidir
- hedef tipi daha net okunmali:
  - global
  - item
  - bundle
- baslangic / bitis zamani ve aktiflik durumu gorunur olmali

### Merchandising Controls

- admin featured secimini net yapabilmeli
- vitrin mantigi "isFeatured" checkbox seviyesinde kalmamalidir
- hangi item'in neden one ciktigi anlasilir olmali

## Acik Tasarim Kararlari

Bu branch icinde netlestirilecek ve gerekirse revize edilecek noktalar:

1. item ve store offer ayrimi veri modelinde hemen mi yapilacak?
2. scheduled / seasonal / limited alanlari mevcut modele minimal alan ekleyerek mi cozulmeli?
3. promotions sayfasi tek yuzey mi olmali, yoksa coupon / discount / bundle alt bolumleri daha keskin ayrilmali mi?
4. shop item listesi tablo mu olmali yoksa card+table hibrit mi olmali?

## Model Guardrails

Bu kisim sonraki branch'lerde veri modelinin camura donmemesi icin korunmasi gereken kurallari kaydeder.

1. `ShopItem` ile gelecekteki `StoreOffer` ayni sey degildir
- bugunku modelde satis ayarlari halen buyuk oranda `ShopItem` ustunde tasiniyor
- bu yalnizca gecis donemi tercihi olarak kabul edilmelidir
- uzun vadede:
  - `ShopItem` = kozmetigin kendisi
  - `StoreOffer` = magazada nasil ve ne zaman satildigi

2. Yeni canli-ops ihtiyaclari icin rastgele boolean patlatilmamali
- `seasonal`, `limited`, `event-only`, `scheduled` gibi ihtiyaclar icin tekil daginik flag yerine ortak yayin modeli tercih edilmeli
- bu branch'te eklenen minimal model:
  - `availabilityMode`
  - `startsAt`
  - `endsAt`
- yeni branch'lerde ayni probleme ikinci bir alan seti acilmamali

3. Gorunurluk ile sahiplik ayni tabloda cozulmemeli
- bir item'in:
  - magazada gorunmesi
  - bundle icinde satilmasi
  - admin tarafindan grant edilmesi
  - event odulu olmasi
  farkli kavramlardir
- inventory ownership kararlarini `ShopItem` uzerine gommek yasak olmali

4. Night market ve kisisel teklifler icin item degil offer uretilmeli
- oyuncuya ozel indirim
- oyuncuya ozel secili item havuzu
- tekrar olusturulabilir teklif snapshot'i
gibi yapilar dogrudan `ShopItem` alanlariyla cozulmemeli

5. Event-only item mantigi dogrudan direct store katalogundan ayrilmalidir
- bu branch'te `event_only` item'lar dogrudan oyuncu magazasinda listelenmez
- ama ileride:
  - event reward
  - admin grant
  - night market
  - ozel campaign
  kanalinda kullanilabilir kalmalidir
- oyuncu-facing tarafta dogru yon, bu item'lari normal katalog yerine ayri bir `event shelf` veya `event store` modulu icinde gostermektir
- bu yuzey acildiginda ayni item modeli uzerinden `Etkinlik Ozel` rozeti ve event baglami tasinmalidir

6. Paketler ile item'lar ayni yayin modeline zorlanmamalidir
- bu turda yalniz item gorunurlugu ele alindi
- bundle tarafi daha sonra ayri `offer/liveops` mantigi ile ele alinmali
- aksi halde paketlere item mantigi, item'lara paket mantigi karisir

7. Promotions, coupon ve bundle iliskileri kaynak-gercek olarak kalmali
- item satirinda sadece ozet gorunur
- asil karar kaynaklari:
  - promotions
  - coupons
  - bundles
sayfalari olmali
- iliski bilgisini kopyalayip ikinci truth source olusturmayalim

8. Gelecekte acilabilecek dogru refactor yonu
- `ShopItem`
- `StoreOffer`
- `InventoryOwnership`
- `PersonalizedOffer`
ayrimi

Bu ayrim gelene kadar:
- `availabilityMode`
- `startsAt`
- `endsAt`
- `isFeatured`
- `badgeText`
alanlari yalniz gecis katmani olarak kullanilmalidir

## Bu Branch'te Eklenenler

Bu branch yalniz "admin ekranini guzellestirme" isi degildir. Esas hedef, magazayi buyudugunde tasiyacak operasyon katmanini kurmaktir.

1. `shop-items` operasyon yuzeyi toparlandi
- arama
- aktif / pasif filtreleri
- vitrinde / standart filtreleri
- yayin modu filtresi
- daha net sayaçlar
- toplu aksiyonlar

2. Urun ile promosyon iliskileri gorunur hale geldi
- bir kozmetik satirindan:
  - `Paket`
  - `Kampanya`
  - `Kupon`
  baglantisi gorulebiliyor
- bu sayede admin "bu item nerelerde kullaniliyor?" sorusunu tek akisla cozebiliyor

3. `promotions` ekrani liveops paneline donustu
- bolum filtresi:
  - `Paketler`
  - `Kampanyalar`
  - `Kuponlar`
- durum filtresi:
  - `Aktif`
  - `Pasif`
  - `Planli`
  - `Suresi Doldu`
- toplu yayina alma / durdurma
- daha okunur kartlar
- daha net form dili
- form editorleri listeyi uzatmak yerine responsive operasyon sheet'inde acilir
- yeni ve duzenle akislari ayni kontrollu editoru kullanir
- silme / pasife alma sonucu onay dialogunda islemden once aciklanir
- toplu durum degisikligi N adet paralel PUT yerine tek, sinirli ve audit'li
  bulk endpoint kullanir

4. Promotion lifecycle mantigi netlestirildi
- `Sil` ile `Pasife Al` ayrildi
- aktif kayit ilk asamada pasife iner
- pasif ve guvenli kayit ikinci asamada gercekten silinebilir
- kullanilmis veya iliskili kayitlar hard delete olamaz

5. Duplicate kod hatalari insan gibi hale getirildi
- paket / kampanya / kupon kodu cakistiginda net hata doner
- benzersiz olan alanin `code` oldugu operasyon tarafinda acik hale geldi

6. Siralama paneli buyuk katalog icin hazirlandi
- drag-and-drop paneli arama ve segment scope ile birlikte calisir
- buyuk katalogda "final vitrin sirasi" araci olarak konumlanir

## Yayin Modeli

Bu branch'in en kritik altyapisi `availabilityMode + startsAt + endsAt` gecis modelidir.

Eklenen alanlar:
- `availabilityMode`
- `startsAt`
- `endsAt`

Desteklenen yayin modlari:

1. `always_on`
- surekli yayinda
- kalici katalog urunu

2. `scheduled`
- takvimli yayin
- `startsAt` ile acilir
- gerekirse `endsAt` ile kapanir

3. `seasonal`
- sezon baglamli urun
- oyuncu tarafinda `Sezonluk` gibi merchandising sinyali uretir

4. `limited`
- sinirli sureli veya sinirli hissi veren urun
- oyuncu tarafinda `Sinirli` ve gerekiyorsa `Son Gunler` sinyali uretir

5. `event_only`
- normal magazada listelenmez
- ileride event shelf / event store gibi ayri yuzeylerde kullanilmak uzere sistemde durur

Bu model neyi cozer:
- magazayi sadece `isActive` ile yonetme zayifligini kapatir
- admin onceden planli yayin yapabilir
- oyuncu tarafinda merchandising sinyalleri uretilir
- future liveops icin yeni daginik boolean alanlar acma ihtiyacini azaltir

## Gelecek Branch'ler Icin Hazirlik

Bu branch sonraki isleri dogrudan kolaylastirmak icin zemin hazirlar.

1. `feature/admin-inventory-operations`
- item grant / revoke
- oyuncu envanteri inspect
- audit ve sahiplik operasyonlari

Bu branch ile baglantisi:
- burada "ne satiliyor / nasil gorunuyor / hangi promosyonla bagli" netlesir
- inventory branch'i ise "kimde var / kime verildi / nasil geri alinir" tarafini kurar

2. `feature/night-market-foundation`
- `event_only`
- `seasonal`
- `limited`
modelleri future offer mantigina zemin olur

3. ilerideki dogru veri modeli refactor'u
- `ShopItem`
- `StoreOffer`
- `InventoryOwnership`
- `PersonalizedOffer`

Bu branch tam refactor'u yapmaz, ama sonraki branch'lerde veri modelinin camura donmemesi icin dogru gecis cizgisini cizer

## Oyuncu Tarafina Tasinan Anlam

Admin tarafinda secilen yayin modu oyuncu tarafinda anlamli merchandising sinyali uretir.

Planlanan / mevcut oyuncu sinyalleri:
- `Sezonluk`
- `Sinirli`
- `Sureli`
- `Son Gunler`

`event_only` icin not:
- normal katalogda gostermek dogru degil
- ayri event shelf veya event store dogru yuzey

## Operasyonel Sonuc

Bu branch tamamlandiginda admin panel su sorulara daha saglam cevap verir:

1. Bu item magazada gorunuyor mu?
2. Hangi yayin modelinde?
3. Vitrinde mi?
4. Hangi bundle / kampanya / kupon ile bagli?
5. Kullanilmis bir promosyonu guvenli sekilde sadece pasife mi almaliyim?
6. Kullanilmamis ve bagimsiz kaydi kalici olarak silebilir miyim?

Bu cevaplar olmadan buyuyen magazayi saglikli yonetmek mumkun degildir.

## Merge Kriteri

Bu branch su durumda merge edilir:

1. admin shop ve promotions yuzeyleri daha okunur hale gelmis olmali
2. featured / active / hidden akisi test edilmis olmali
3. item -> promotion / bundle iliskileri admin tarafinda daha gorunur olmali
4. `npx tsc --noEmit` ve `npm run lint` temiz olmali
5. gerekiyorsa ilgili smoke test eklenmis olmali

## Sonraki Branch Baglantisi

Bu branch tamamlandiktan sonra en dogru sonraki adim:

- `feature/admin-inventory-operations`

Sebep:
- katalog operasyonu netlesmeden inventory operasyonu yapmak admin UX'i tekrar karmasiklastirir
- once "ne satiliyor / nasil gorunuyor / nasil yonetiliyor" netlesmeli
- sonra "kime verildi / kimde var / nasil geri alinir" tarafina gecilmeli

