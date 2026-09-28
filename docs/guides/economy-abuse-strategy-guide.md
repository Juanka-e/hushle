# Economy And Abuse Strategy Guide

Bu rehber coin ekonomisini ve odul abuse risklerini yonetmek icin karar cercevesini tanimlar.

Ana prensip:

- abuse tamamen yok edilemez
- hedef, abuse'u pahali, verimsiz ve izlenebilir hale getirmektir

## Temel Varsayimlar

- guest kullanicilar coin kazanamaz
- coin sadece hesapli kullaniciya yazilir
- dogrudan engelleme yerine cogu durumda kademeli verim dusurme daha sagliklidir
- arkadas gruplarinin arka arkaya oynamasi tek basina abuse kaniti degildir

## Coin Ekonomisinin Hedefi

Coin sistemi su uc amaca hizmet etmelidir:

1. oyun oynadikca ilerleme hissi vermek
2. magazadaki itemler icin makul bir hedef olusturmak
3. abuse edilmesi kolay bir para birimine donusmemek

## Coin Source Ve Sink Dengesi

### Potansiyel Coin Source'lar

- gercek mac tamamlama
- gunluk giris
- gunluk veya haftalik gorevler
- event gorevleri
- admin/support telafisi
- ozel kampanyalar

### Potansiyel Coin Sink'ler

- magazadan satin alma
- bundle satin alma
- ileride varsa reroll veya ozel pazar ucretleri
- etkinlik veya vanity harcamalari

Ekonomi saglikli olsun istiyorsak source ve sink birlikte dusunulmeli.

## Katmanli Anti-Abuse Stratejisi

Tek kural ile abuse engellenmez. Katmanli model gerekir.

### Katman 1: Odul Uygunlugu

Odul yazmadan once temel uygunluk kontrol edilir.

Ornek sinyaller:

- kullanici guest degil
- mac gercekten tamamlandi
- minimum mac suresi asildi
- minimum anlamli katilim var
- minimum ayri hesapli oyuncu sayisi saglandi
- oyun akisi gercekten ilerledi

Amac:

- bos veya cok kisa maclarin odul sistemine girmemesi

### Katman 2: Gunluk Ve Saatlik Cap

Bu en temiz ilk savunmadir.

Onerilen mantik:

- gunluk max coin kazanci
- saatlik veya belirli pencere icinde max coin
- belirli esikten sonra odul azalmasi

Bu sayede abuse tamamen durmasa bile ekonomik etkisi sinirlanir.

### Katman 3: Tekrarlayan Grup Analizi

Burasi en kritik alan.

Tek basina "ayni oyuncular yine oynadi" demek abuse degildir.

Gercek dunya durumu:

- arkadas grubu ayni aksam 3-4 veya daha fazla el oynayabilir
- bu normaldir

Bu yuzden uygulanacak mantik yasaklama degil, kademeli verim azaltma olmalidir.

Onerilen sinyaller:

- ayni oyuncu grubunun sik tekrari
- ayni rakiplere karsi art arda odul kazanimi
- cok kisa araliklarla ayni lineup
- asiri duzenli win/loss paterni
- ayni IP veya subnet benzerligi

Ama bu sinyaller tek basina cezalandirma nedeni olmamali.

Onerilen davranis:

- normal tekrarlar tam odul alir
- tekrar yogunlugu arttikca coin verimi oransal azalir
- asiri supheli paternde odul sifira yaklasir veya review'e duser

Bu hem adildir hem de gercek arkadas gruplarini gereksiz cezalandirmaz.

### Katman 4: Suphe Skoru

Tek bir kural yerine skor birikimi daha dogrudur.

Suphe skoruna etki edebilecek seyler:

- tekrar eden ayni grup
- ayni IP/subnet
- cok hizli mac dongusu
- dusuk cesitlilik
- yeni hesaplar
- dusuk guvenli hesaplar

Skor kullanim alani:

- odul carpani dusurme
- gecikmeli odul
- manual review
- audit log

### Katman 5: Audit Ve Manual Review

Tam otomatik ceza sistemi tek basina dogru degildir.

Gerekenler:

- supheli ekonomi olaylari audit'e dusmeli
- admin tarafinda coin kaynagi gorulebilmeli
- gerekirse wallet adjustment yapilabilmeli

## IP Ve Subnet Sinyalinin Yeri

IP/subnet iyi bir baslangic sinyalidir ama asla tek karar verici olmamali.

Sebep:

- ayni evde oynayan oyuncular normal olabilir
- okul, yurt, ofis gibi yerlerde ayni subnet dogaldir
- mobil operator NAT durumlari vardir

Bu sinyalin dogru kullanimi:

- suphe skoruna yumusak katkida bulunmak
- tek basina blok atmamak

## Diminishing Returns Mantigi

En pratik ve oyuncu dostu yaklasimlardan biri budur.

Ornek fikir:

- ilk normal maclar tam odul
- ayni oyuncu grubuyla tekrar sayisi arttikca odul dusmeye baslar
- cok yogun tekrar davranisinda odul cok azalir

Avantaji:

- normal oyun ceza hissettirmez
- organize abuse ekonomik olarak anlamsizlasir

Bu sistemin dilini oyuncuya tamamen acmak zorunda degiliz, ama ic mantigin adil olmasi gerekir.

## Gorev Sistemi Hakkinda

Gorev sistemi coin ekonomisini destekleyebilir ama kotu tasarlanirsa kisir dongu ve yorgunluk yaratir.

### Gorev Sisteminin Riski

- her gun ayni seyi yaptiran gorevler sikar
- oyuncuyu oyunun dogal akisindan koparabilir
- "to-do list" hissi yaratir

### Dogru Gorev Mantigi

Gorevler oyuncuyu tek bir grind'a degil, farkli davranislara yonlendirmeli.

Ornek ilkeler:

- gunluk gorevler kisa ve hafif olmali
- haftalik gorevler biraz daha derin olabilir
- gorev cesitliligi donmeli
- ayni gorevler ust uste cok sik gelmemeli
- gorevler oyun deneyimini bozmamali

### Oyuncuya Ozel Gorevler

Tam kisisel gorev sistemi ilgi cekici olabilir ama asiri kisilestirme gereksiz karmasa yaratabilir.

Daha iyi ilk adim:

- gorev havuzu olustur
- oyuncuya havuzdan secili kombinasyon ver
- ama tamamen ayni gorevler herkese gitmesin

Bu sayede:

- cesitlilik olur
- operasyon maliyeti kontrollu kalir
- oyuncu her gun ayni rutine saplanmaz

## Coin Disi Motivasyon Katmanlari

Ekonomi sadece coin ile kurulursa her sey abuse tartismasina baglanir. Coin disi prestij katmanlari faydalidir.

Ornekler:

- profil rozetleri
- profil banner
- sezonluk basari isaretleri
- event bazli kimlik ogeleri

Neden degerli:

- oyuncu sadece coin icin degil, gorunurluk icin de oynar
- profil inspect aninda deger hissi olusur
- sosyal rekabet guclenir

Bu, coin ekonomisinin tum yukunu tek basina tasimamasini saglar.

## Oyuncu Perspektifinden Adil Sistem

Oyuncu su hissi almamali:

- "sistem beni sebepsiz kisiyor"
- "arkadaslarla oynadigim icin cezalandiriliyorum"
- "gorevler is gibi"

Oyuncu su hissi almali:

- oynadikca mantikli ilerliyorum
- exploit yapmadan da makul kazanc elde ediyorum
- sistem asiri abuse'u frenliyor ama beni haksiz yere cezalandirmiyor

## Ilk Surum Icin Onerilen Kararlar

1. guest coin kazanmaz
2. odul sadece anlamli ve tamamlanmis maclara yazilir
3. dusuk sert global cap yerine once yuksek `safety ceiling` kullanilir
4. tekrar eden oyuncu gruplarinda odul kademeli azalir
5. ayni IP/subnet sadece yumusak suphe sinyali olur
6. invasive fingerprint ilk surumde kullanilmaz
7. supheli pattern audit'e duser
8. admin wallet adjustment imkani korunur

## XP, Level Ve Fiyatlandirma Iliskisi

Ekonomi yalniz coin uzerinden tasinmamalidir.

Saglikli ayrim:

- coin -> satin alma ekonomisi
- XP -> kalici ilerleme
- level -> prestij ve milestone odul kati

Bu nedenle:

- her level'da yuksek coin verme yanlistir
- coin pacing store ladder'ina gore kurulur
- XP pacing oyuncunun uzun vadeli devam hissine gore kurulur

Ek planning referansi:

- `docs/guides/economy-progression-and-pricing-guide.md`

## Daha Sonra Degerlendirilecekler

- gorev sistemi
- haftalik gorevler
- profil rozetleri
- profil banner
- sezonluk ilerleme sistemi
- targeted comeback economy kampanyalari

Bu alanlar icin ek planning rehberi:
- `docs/guides/night-market-and-missions-strategy-guide.md`

## Uygulama Oncesi Sorulacak Sorular

1. Coin hangi davranislari odullendirecek?
2. Hangi davranislar ekonomik olarak kisilmali?
3. Oyuncu adalet hissi bozulmadan hangi sinyaller kullanilacak?
4. Hard block yerine hangi noktalarda diminishing returns yeterli?
5. Audit panelinde hangi sinyaller gorunmeli?
6. Economy sistemi social identity katmanlariyla nasil dengelenecek?
