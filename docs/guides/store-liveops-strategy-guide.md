# Store And Liveops Strategy Guide

Bu rehber magazanin, kozmetiklerin, inventory sahipliginin ve gelecekteki liveops akislarinin birbirine karismadan buyutulmesi icin karar cercevesini tanimlar.

## Neden Bu Ayrim Gerekli

Magaza deneyimi ile urunun kendisi ayni sey degildir.

- `cosmetic definition`
  - item'in kendisi
  - rarity
  - type
  - preview assetleri
  - gorsel/render ayarlari
- `store offer`
  - magazada nasil satildigi
  - fiyati
  - aktif mi
  - hangi tarihlerde gorunur
  - featured veya seasonal mi
- `inventory ownership`
  - oyuncu bu item'e sahip mi
  - nereden kazandi
  - equipli mi
  - grant veya purchase kaynagi ne
- `personalized offer`
  - gece pazari
  - geri donus teklifi
  - oyuncuya ozel indirim

Bu ayrim yapilmazsa su problemler cikar:

- ayni item hem magazada hem event reward olarak zor yonetilir
- admin panel karmasiklasir
- gece pazari gibi kisisel teklifler veri modelini kirar
- inventory operasyonlari katalog yonetimiyle ic ice gecer

## Oyuncu Perspektifi

Magaza oyuncuya su sorularin net cevabini vermelidir:

1. Bu item tam olarak ne?
2. Satin almadan once nasil gorunuyor?
3. Bende zaten var mi?
4. Bunu alirsam ne degisecek?
5. Indirim gercek mi, ne kadar suruyor?
6. Bu teklif herkese mi, bana mi ozel?

Oyuncu odakli temel ilkeler:

- preview satin almadan once gorulmeli
- sahip olunan itemler ayri ve net gorunmeli
- equipli item ayri isaretlenmeli
- fiyat dili basit olmali
- seasonal ve limited etiketleri net ama abartisiz olmali
- manipule edici degil, guven veren bir vitrin olusturulmali

## Admin Perspektifi

Admin tarafinin cevaplmasi gereken sorular:

1. Bu item magazada aktif mi?
2. Hangi tarihler arasi gorunuyor?
3. Featured mi?
4. Hangi kampanya ile iliskili?
5. Event item mi?
6. Night market havuzuna girebilir mi?
7. Oyuncuya dogrudan grant edilebilir mi?
8. Bu item kactane oyuncuda var?

Admin yuzeyleri bu ihtiyaclara gore ayri tutulmali.

## Onerilen Branch Sirasi

1. `feature/dashboard-visual-polish`
   - ortak dashboard shell ve responsive kalite
2. `feature/store-merchandising`
   - oyuncu-facing store deneyimi
3. `feature/admin-shop-ux`
   - katalog ve offer yonetimi
4. `feature/admin-inventory-operations`
   - oyuncu envanterini gorme, grant, revoke, audit
5. `feature/night-market-foundation`
   - kisisel teklif ve ozel satis mantigi
6. `feature/economy-abuse-hardening`
   - coin kaynaklari ve anti-abuse stratejisi
7. `feature/cache-and-rate-limit-foundation`
   - Redis/Valkey tabanli ortak runtime katmani

## Branch Kapsamlari

### `feature/dashboard-visual-polish`

Kapsam:

- dashboard shell polish
- overlay ve full-page tutarliligi
- responsive temizlik
- loading, empty, error state kalitesi

Kapsam disi:

- store redesign
- admin kozmetik yonetimi
- economy kurallari

### `feature/store-merchandising`

Kapsam:

- featured, seasonal, limited, bundles, discounted segmentleri
- daha anlasilir urun kartlari
- satin almadan once preview
- sahiplik ve equip durumu
- daha guclu fiyat ve indirim dili

Bu branch oyuncuya "ne alip ne kazanacagini" netlestirir.

### `feature/admin-shop-ux`

Kapsam:

- item ve offer ayrimi
- arama, filtre, toplu islem
- active, hidden, scheduled, event-only durumlari
- featured slot ve merchandising kontrolleri
- kampanya iliskilerinin gorunur kilinmasi

### `feature/admin-inventory-operations`

Kapsam:

- oyuncu inventory goruntuleme
- item grant ve revoke
- equip duzeltme
- grant nedeni ve audit kaydi

### `feature/night-market-foundation`

Kapsam:

- kisisel teklif snapshot modeli
- gece pazari havuzlari
- teklif suresi
- oyuncuya ozel indirim mantigi

Ek planning rehberi:
- `docs/guides/night-market-and-missions-strategy-guide.md`

### `feature/economy-abuse-hardening`

Kapsam:

- coin source ve sink kurallari
- odul uygunlugu
- gunluk/saatlik cap
- repetitive group heuristics
- audit ve manual review

## Gece Pazari Stratejisi

Gece pazari normal magazanin sadece kopyasi olmamali. Oyuncuya ozel, sinirli sureli ve heyecanli bir yuzey olmali.

Uygulama zamanlamasi acisindan ek not:
- once economy abuse guardrail'leri ve motivasyon katmanlari yeterli seviyeye gelmeli
- gorev sistemi ve coin disi kimlik odulleri ile birlikte dusunulmeli

### Gece Pazari Hedefleri

- oyuncuya "bugun bana cikan teklifler" hissi vermek
- normal magazada gorunmeyen firsatlar sunmak
- indirim ve item secimini kisilestirmek
- tekrar tekrar ayni seyleri gostermemek

### Onerilen Gece Pazari Davranisi

- her oyuncu icin snapshot uretilir
- belirli sayida teklif verilir
- teklifler belirli sure gecerli olur
- teklif olustuktan sonra havuz anlik degismez

Ornek:

- 5 teklif
- 1 adet dikkat cekici "hero offer"
- 2 orta degerli teklif
- 2 surpriz veya koleksiyonluk teklif

### Indirim Araligi

Admin panelde tanimlanabilir:

- minimum indirim yuzdesi
- maksimum indirim yuzdesi

Ornek:

- `15% - 40%`

Ama tamamen duz random yerine kuralli dagilim daha iyi olur:

- yaygin itemler daha genis indirim araligina girebilir
- nadir itemler daha kontrollu indirim alir
- uzun suredir inactive olan itemler daha ozel davranabilir

### Item Havuzu Filtreleme

Gece pazari icin detayli filtreleme gerekir.

Desteklenmesi gereken filtreler:

- sahip olunan itemleri disla
- aktif magazadaki itemleri dahil et veya etme
- inactive archived itemleri dahil et
- seasonal itemleri dahil et
- event-only itemleri dahil et
- belirli rarity setleri
- belirli cosmetic type setleri
- admin blacklist veya whitelist

Bu filtreleme olmadan gece pazari hissi zayif kalir.

### Reroll Hakkinda

Varsayilan karar:

- ilk surumde reroll olmamali

Sebep:

- abuse yuzeyini buyutur
- oyuncu beklentisini bozar
- ekonomi sink tasarimi gerektirir

Gelecekte eklenirse:

- ucretli sink olmali
- gunluk sinirli olmali
- audit edilmeli

## Store Icinde Preview Neden Kritik

Oyuncu satin almadan once etkisini gormezse magaza guven vermez.

Preview sisteminde dusunulmesi gerekenler:

- card front
- card back
- avatar
- frame
- profil banner
- rozetler

Kural:

- satin almadan once gorunen sonuc net olmali
- mevcut equipli kombinasyonla beraber gorulebilmeli
- "aldim ama umdugum gibi degilmis" hissi minimuma inmeli

## Diger Kimlik Yuzeyleri

Gelecekte oyuncu profiline deger katabilecek alanlar:

- profil rozetleri
- profil banner
- sezonluk veya event rozetleri
- oyuncu karti veya inspect paneli

Neden degerli:

- sadece satin alma degil, sosyal gorunurluk motivasyonu yaratir
- bir oyuncunun profiline tiklandiginda rozet ve banner gorulmesi koleksiyon degerini artirir
- Discord benzeri kimlik katmani, oyuncu bagliligini guclendirir

Ama bunlar store redesign ile tek branch'e sikistirilmamali. Buyuk ihtimalle ayrica planlanmali.

## Store Icinde Dusunulmesi Gereken Senaryolar

1. always-on katalog
2. featured koleksiyon
3. seasonal koleksiyon
4. limited-time drop
5. event odulu
6. bundle
7. coupon etkisi
8. indirim kampanyasi
9. oyuncuya ozel teklif
10. admin grant
11. retired ama arsivde duran item
12. gece pazarina ozel item havuzu

## Uygulama Oncesi Karar Kurallari

Yeni bir ozellik geldiginde su sorular sorulmali:

1. Bu yeni sey item mi, offer mi, ownership mi, personalized offer mi?
2. Herkese mi gorunur, belirli oyunculara mi?
3. Schedule gerekiyor mu?
4. Preview gerekiyor mu?
5. Inventory audit gerekir mi?
6. Night market havuzuna girebilir mi?
7. Event reward ile ayni urun tekrar satilabilir mi?

Bu sorular cevaplanmadan veri modeline yeni alan doldurmak dogru degildir.
