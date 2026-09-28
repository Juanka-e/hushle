# Night Market And Missions Strategy Guide

Bu rehber night market, gorev sistemi ve coin disi oyuncu motivasyon katmanlarini birlikte dusunmek icin karar cercevesini tanimlar.

Ana karar:

- `night market` su an implement edilmek zorunda degil
- once economy, admin operasyonu ve reward guardrail'leri netlesmeli
- night market ile gorev sistemi birbirinden tamamen kopuk dusunulmemeli
- urun canliya acilmadan once implement edilmemeli
- acilis sonrasi gercek oyuncu davranisi gorulmeden release planina alinmamali

## Neden Simdi Degil

Night market tek basina kucuk bir vitrin ozelligi degil.

Asagidaki alanlara dayanir:

- store offer modeli
- personalized offer modeli
- inventory sahiplik kontrolu
- indirim kurallari
- admin/liveops kontrolu
- ekonomi abuse guardrail'leri
- oyuncuya geri donus motivasyonu

Bu katmanlar zayifken erken night market cikarmak sistemi hizli sekilde camura cevirir.

## Night Market Ne Zaman Acilmali

Asagidaki sartlar saglaninca:

1. normal store ve admin shop akisi oturmus olmali
2. inventory ownership ve admin inventory operasyonu net olmali
3. economy abuse guardrail'leri ilk surum icin yeterli olmali
4. personalized offer mantigi veri modelinde ayrisabiliyor olmali
5. oyuncuya neden geri donmesi gerektigini anlatan baska motivasyon katmanlari hazir olmali

## Night Market Hedefi

Night market'in gorevi:

- oyuncuya "bana ozel firsat" hissi vermek
- normal katalogdan farkli ama guvenilir teklifler sunmak
- tekrar ziyaret motivasyonu olusturmak
- indirim kadar secilmis olma duygusu da vermek

Night market'in gorevi olmayan sey:

- tum ekonomiyi tek basina tasimak
- her login'de random firlatilan kupon pazari olmak
- abuse'u tesvik eden sonsuz reroll mekanigi olmak

## Onerilen Night Market Yapisi

### Offer modeli
- oyuncuya ozel snapshot
- belirli bir sure boyunca sabit kalan teklif seti
- snapshot olustuktan sonra canli katalog degisimi anlik yansimaz

### Offer kompozisyonu
- 1 adet dikkat cekici hero teklif
- 2-4 adet orta degerli teklif
- nadir durumda 1 surpriz/kolleksiyonluk teklif

### Filtreleme
- sahip olunan itemleri disla
- event-only itemler yalniz event baglami varsa dahil olsun
- retired / hidden itemler kuralli olarak dahil edilebilsin
- ayni item tekrar tekrar cikmasin

### Indirim mantigi
- min / max indirim araligi
- rarity ve item tipi kuralli etkilesin
- tamamen saf random dagilim kullanma

### Reroll karari
- ilk surumde yok
- sonradan eklenirse:
  - sink gerekir
  - gunluk sinir gerekir
  - audit gerekir

## Gorev Sistemi Neden Ayni Tartismaya Giriyor

Night market geri donus motivasyonu yaratir.
Gorev sistemi ise geri donus davranisini yonetir.

Bu ikisi ayri ama birbirini tamamlayan katmanlardir.

Yalniz night market olursa:
- oyuncu bir kere bakar cikar
- davranis devamliligi zayif kalir

Yalniz gorev olursa:
- oyun "to-do list" hissine kayar

Birlikte dusunuldugunde:
- night market geri donus meraki yaratir
- gorev sistemi geri donen oyuncuya yapacak sey verir

## Gorev Sistemi Icin Onerilen Ilkeler

### 1. Gorevler ayni seyi zorla tekrar ettirmemeli
- her gun ayni pattern gelirse oyuncu sikilir
- dogal oyun akisini bozmayacak gorevler secilmeli

### 2. Havuz tabanli gorev dagitimi
- herkese birebir ayni gorevler gitmesin
- ama her oyuncu icin suni "tam personal AI quest" de gerekmez

Daha iyi ilk adim:
- gorev havuzu olustur
- oyuncuya havuzdan secili kombinasyon ver
- duplicate ve yorgunluk kontrolu uygula

### 3. Katmanli gorev yapisi
- gunluk hafif gorevler
- haftalik biraz daha derin gorevler
- event gorevleri
- comeback gorevleri

### 4. Yorgunluk onleme
- ayni gorev turu ust uste gelmesin
- "10 mac oyna, 10 mac daha oyna" gibi tekrarlar olmasin
- gorevler farkli davranislari tesvik etsin

### 5. Economy etkisi kontrollu olmali
- gorevler sinirsiz coin muslugu olmamali
- coin odulu, rozet, banner, profil kimligi gibi oduller karmasi daha saglikli

## Oyuncuya Ozel Gorevler Ne Kadar Ozel Olmali

Ilk surum icin tam hyper-personalized gorev sistemi gerekmiyor.

Daha saglikli model:

- segment bazli gorev havuzlari
- oyuncu davranisina gore hafif secim
- ama tamamen opak ve tahmin edilemez gorev dagitimi degil

Ornek segmentler:

- yeni oyuncu
- geri donen oyuncu
- duzenli oyuncu
- koleksiyoncu / cosmetic odakli oyuncu

## Coin Disi Motivasyon Katmanlari

Night market ve gorev sistemi yalniz coin ile calismamali.

Guclu tamamlayicilar:

- profil rozetleri
- profil banner
- sezonluk kimlik ogeleri
- inspect ekraninda gorunen ozel oduller

Neden degerli:

- oyuncu sadece coin icin degil gorunurluk icin de oynar
- sosyal katman kuvvetlenir
- abuse baskisi sadece coin uzerinde toplanmaz

## Uygulama Sirasina Dair Oneri

1. coin grants archive lifecycle
2. admin user observability
3. economy abuse hardening
4. economy progression / pricing / XP kararlarini netlestirme
5. gorev / identity / motivation planning revizyonu
6. sonra gerekirse `feature/night-market-foundation`

## Gorev Sistemi Ne Zaman Uygundur

Gorev sistemi su kosullar saglanmadan eklenmemeli:

1. gameplay reward guardrail v1 cikmis olmali
2. source-aware economy mantigi netlesmis olmali
3. XP/level coin'den ayri konumlanmis olmali
4. gorev odulunun economy pacing'i bozmayacagi biliniyor olmali

Pratikte bu su anlama gelir:

- gorev, economy foundation'dan sonra gelir
- night market ise gorev ve retention motivasyonu oturduktan sonra gelir
- her ikisi de acilis sonrasi gozlemden once implement backlog'ina alinmaz

## Night Market Implementasyonundan Once Sorulacak Sorular

1. teklif modeli `StoreOffer`'dan ayri mi?
2. oyuncuya ozel snapshot nerede tutulacak?
3. ayni item ne kadar sure tekrar cikmayacak?
4. fiyat/indirim mantigi hangi guardrail ile calisacak?
5. gorev sistemi geri donus motivasyonunu zaten kismen karsiliyor mu?
6. hangi coin disi oduller night market ile ayni release penceresinde sunulacak?
