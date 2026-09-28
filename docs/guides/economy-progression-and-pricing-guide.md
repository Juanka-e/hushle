# Economy Progression And Pricing Guide

Bu rehber coin, XP, level, gorev ve magazanin ayni sistem icinde nasil konumlanmasi gerektigini tanimlar.

## Ana Karar

Ekonomi once source-aware hale gelmeli.

Yani:

- gameplay coin
- gorev coin
- event coin
- comeback coin
- promo coin
- admin/support hareketleri

tek potada eritilmemeli.

Planlaniyor olmasi, hemen implement edilecegi anlamina gelmez.

Asagidaki alanlar acilis oncesi kapsam disidir:

- XP ekrani
- gorev ekrani
- event claim akisi
- night market

Bu alanlar ancak urun canliya acildiktan ve gercek oyuncu davranisi gozlendikten sonra tekrar ele alinmalidir.

## Bugunku Gercek Durum

Bugun oyuncu coin'i esas olarak oyun oynayarak aliyor.

Varsayilan oduller:

- kazanma: `120`
- kaybetme: `40`
- beraberlik: `40`

Bugunku mock store fiyatlari:

- common: `120`
- rare: `300-340`
- epic: `480-550`
- legendary: `820-960`
- starter bundle: `780`
- premium bundle: `2200`

Bu tablo kabaca:

- common item -> `2` maca yakin
- rare -> `4-5` mac
- epic -> `6-7` mac
- legendary -> `10-12` mac
- premium bundle -> `27-28` mac

Bu baslangic icin kabul edilebilir ama resmi ladder haline getirilmeli.

## Onerilen Fiyat Ladder'i

### Tier 1: Giris

- hedef: `2-3` anlamli mac
- amac:
  - oyuncu ilk satin alimini erken gorur
  - economy "calisiyor" hissi verir

### Tier 2: Duzenli Oynayan Odulu

- hedef: `5-7` anlamli mac
- amac:
  - haftalik hafif oyuncuya da ulasilabilir hedef vermek

### Tier 3: Prestij Baslangici

- hedef: `8-12` anlamli mac
- amac:
  - biraz planlama gerektiren ama grind hissettirmeyen urunler

### Tier 4: Yuksek Prestij

- hedef: `14-20` anlamli mac
- amac:
  - sosyal gorunurlugu olan guclu itemler

### Tier 5: Premium Bundle / Koleksiyon

- hedef: `25-35` anlamli mac
- amac:
  - birikim hedefi vermek
  - ama ulaasilamaz duvar yaratmamak

Ekonomi koruma katmanlari bu ladder'i bozmamali.

Bu yuzden:

- soft cap ve hard ceiling normal oyuncunun pacing'ini bozmayacak kadar yuksek tutulmali
- ilk tuning canli veriden once agresif yapilmamali

Not:

- gameplay reward guard ayarlari artik system settings ekonomi bolumunden yonetilmeye baslandi
- ama bu ayarlar canli oncesi agresif optimize edilmemeli
- once gercek coin kazanimi ve satin alma verisi gorulmeli

## Fiyat Kararlarini Dakika Uzerinden Vermeme Sebebi

Ham sure guvenilmezdir.

Dogru olcu:

- tamamlanmis
- uygun gorulmus
- odul yazmaya hak kazanmis mac

Bu yuzden ladder once "mac esdegeri" ile kurulmalidir, sonra veri geldikce zamana cevrilmelidir.

## Coin Ve XP Ayni Sey Degil

### Coin

- harcanabilir kaynak
- store ve bundle sink'ine gider

### XP

- kalici ilerleme
- harcanmaz
- oyuncuya uzun vadeli devam hissi verir

### Level

- XP'nin gorunen sonucu
- kimlik / prestij / milestone odul alani

Kural:

- XP ekonomisi coin ekonomisinin yedegi olmamali

## XP / Level Icin Onerilen Model

Ilk mantikli model:

1. XP uygun gorulen maclardan gelir
2. sonra gorevlerden de gelir
3. level odulleri milestone tabanli olur

Onerilen odul dagilimi:

- her level:
  - yalniz progres bar ve seviye hissi
- milestone level:
  - rozet
  - banner
  - profil kimligi
  - nadiren kucuk coin

Neden:

- her level coin verirsen ikinci coin muslugu acilir
- abuse baskisi artar
- store pacing bozulur

## Gorev Sistemi Ne Zaman Eklenmeli

Gorev sistemi ancak source-aware ekonomi hazir olduktan sonra eklenmeli.

Dogru siralama:

1. gameplay reward guardrail
2. source-aware wallet mantigi
3. XP temel modeli
4. gunluk gorev
5. haftalik gorev
6. event gorevleri

Ek urun karari:

- gorev sistemi "hazir gibi gorundugu icin" acilmayacak
- once retention ve pacing ihtiyaci canli veride gorulecek

## Gorev Odullerinin Dagilimi

Gorevler yalniz coin vermemeli.

Saglikli karisim:

- coin
- XP
- badge/banner
- event token veya gecici prestij ogesi

Bu sayede:

- ekonomi tek musluk olmaz
- oyuncu yalniz coin icin degil kimlik icin de doner

## Night Market Iliskisi

Night market gorevden once degil, gorev ve ekonomi source ayrimi oturduktan sonra gelmeli.

Sebep:

- night market retention vitrini
- gorev sistemi retention davranisi
- ikisi birbirini besler

Ama ekonomi henuz zayifken night market eklemek:

- fiyat algisini bozar
- indirim guvenini zedeler
- abuse baskisini artirir

Ek urun karari:

- night market backlog'da kalir
- store davranisi ve satin alma hizi gozlendikten sonra tekrar degerlendirilir

## Gelecek LiveOps Ve Koleksiyon Yol Haritasi

Bu bolum fikir havuzudur; launch kapsami veya implementasyon taahhudu degildir. Her
ozellik ancak gercek oyuncu verisinde cozecegi problem goruldugunde ayri branch olarak
ele alinir.

Ortak teknik akis:

`campaign -> eligibility -> progress -> claim -> versioned grant -> ledger/inventory`

Bu ayrim sayesinde gorev, etkinlik, seri, market ve kutu odulleri ayni teslimat
kontratini kullanirken kendi hedef kitle, sure, cap ve abuse kurallarini korur.

### Yeni Oyuncu Serisi

- Kayittan sonra baslayan 7 gunluk onboarding campaign'i olabilir.
- Gunler mutlak takvim yerine kullaniciya ait campaign adimlari olarak tutulabilir.
- Bir gun kacirmak tum seriyi sifirlamaz.
- Salt login yerine ilk oyun, ilk tamamlanmis mac, ilk kozmetik secimi gibi
  server-verified onboarding adimlari kullanilir.
- Son odul coin yerine profil rozeti veya baslangic kozmetigi olabilir.

### Geri Donus Serisi

- Yalniz gercek bir inaktivite penceresinden sonra ve belirli cooldown ile acilir.
- Oyuncunun bilerek oyundan uzak kalmasini daha karli hale getirmemelidir.
- Kucuk coin, deneme kozmetigi, etkinlik ilerlemesi veya profil odulu kullanilabilir.
- Yeni oyuncu serisiyle ayni anda stack edilmesi explicit eligibility kurali ister.

### Etkinlik Ve Gorevler

- Gunluk zorunluluk yerine haftada farkli gunlerde oynama gibi esnek hedefler tercih edilir.
- Kategori kullanma, takim hedefi, topluluk hedefi, pas kullanmadan tamamlama ve sezonluk
  koleksiyon gibi cesitler veri tabanli tanimlanabilir.
- Ekranda baslangic/bitis, claim grace period, saat dilimi, kural, ilerleme ve odul net olur.
- Oyuncuya alternatif gorev veya sinirli yenileme hakki verilebilir.
- Her gorev coin vermek zorunda degildir; XP, badge, banner, kozmetik veya event token
  dengesi kullanilir.

### Night Market

- Kullaniciya 4-6 sahip olunmayan urunden sureli teklif snapshot'i verilebilir.
- Teklif acildiktan sonra urun, fiyat, indirim ve bitis zamani degismez.
- Satin alma aninda snapshot sahipligi, sure ve server fiyati yeniden dogrulanir.
- Ayni urunun surekli gelmesini engelleyen rotasyon ve rarity/indirim tavanlari gerekir.
- Harcama davranisini somuren kisiye ozel fiyatlandirma kullanilmaz.

### Koleksiyon, Set Ve Crafting

- Kart sayisi buyudugunde season ve set kataloglari discovery sorununu azaltir.
- Koleksiyon albumu, tamamlama rozeti, profil vitrini ve yalniz gorsel set prestiji
  eklenebilir.
- Duplicate kozmetik gerekiyorsa surumlu shard/crafting kuraliyla donusturulebilir.
- Set tamamlama rekabet avantajina veya coin uretim carpanina donusmemelidir.

### Kutu Ve Paket Acilisi

- Ilk aday parayla satilan rastgele kutu degil, oyun/etkinlikle kazanilan kozmetik
  container olmalidir.
- Rarity metadata'si ile loot olasiligi ayri kavramlardir.
- Immutable loot table version, acik oranlar, server-side CSPRNG, idempotent open request,
  open receipt, pity ve duplicate compensation zorunludur.
- Tum kartlar tek havuza doldurulmaz; set/season bazli kontrollu havuzlar kullanilir.
- Ucretli rastgele icerik ancak yas/bolge, olasilik gosterimi, refund, tuketici hukuku ve
  platform politikalari ayrica onaylanirsa degerlendirilir.

### Diger Adaylar

- sezon yolu ve ucretsiz odul seridi
- topluluk hedefleri
- profil unvani, rozet ve vitrin
- kozmetik wishlist veya secili set pity'si
- etkinlik magazasi ve sureli event token
- ucretsiz kozmetik deneme bileti
- oyun sonu takim basari kartlari

## Implementasyon Acma Kriterleri

Yeni bir feature branch acilmadan once su sorular cevaplanir:

1. Hangi gercek oyuncu problemini cozuyor?
2. Basari metrigi nedir: retention, discovery, conversion veya koleksiyon tamamlama mi?
3. Yeni coin muslugu ya da zorunlu gunluk davranis uretiyor mu?
4. Eligibility, claim idempotency, provenance, refund ve abuse siniri tanimli mi?
5. Admin yayinlama/geri alma ve oyuncu bilgilendirme UX'i tanimli mi?
6. Ozellik kapatildiginda sahiplik ve devam eden claim'ler nasil korunacak?

Bu cevaplar ve yeterli saha verisi yoksa ozellik backlog'da kalir.

## Bu Branch Sonunda Hedeflenen Karar Ciktilari

1. coin source aileleri net tanimli
2. gameplay reward pacing belirlendi
3. ilk fiyat ladder'i resmilesti
4. XP/level'in coin'den ayri bir katman oldugu netlesti
5. gorevlerin ne zaman eklenmesi gerektigi kararlandi

## Aclis Sonrasi Tekrar Degerlendirilecekler

1. XP / level gercekten gerekli mi
2. gorev sistemi retention icin gerekli mi
3. event claim UX'i oyuncu akisina nasil oturacak
4. night market gercekten deger uretecek mi
5. yeni oyuncu/comeback serisi hangi davranis problemini cozuyor
6. katalog buyuklugu set, crafting veya loot gerektiriyor mu
7. ucretsiz container modeli oyuncu guveni ve ekonomi pacing'iyle uyumlu mu

## Gelecekte Eklenebilecek Ayarlar

Urun canliya acildiktan sonra ve veri geldikten sonra su alanlar acilabilir:

- XP/level ac/kapat
- gorev sistemi gorunurlugu
- event reward gorunurlugu
- comeback reward ac/kapat
- store pacing review dashboard'u

Ama ilk acilis oncesi bunlarin hicbiri zorunlu degildir.

## Mevcut Runtime Notu

Su anda kurulan ekonomi runtime'i:

- merkezi `match_reward` eligibility
- rolling window `soft cap / hard ceiling`
- repeated-group diminishing returns

Yani acilis oncesi hedeflenen ekonomi guardrail artik tamamen "dokuman fikri" olmaktan cikti; temel runtime katmani kurulmaya baslandi.
