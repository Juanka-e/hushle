# Player Display Name And Audit Strategy Guide

Bu rehber, kayitli oyuncularin diger oyunculara gorunecek adinin nasil yonetilecegini ve audit tarafinda bunun nasil izlenmesi gerektigini tanimlar.

## Temel Ayrim

Sistemde uc ayri kimlik katmani vardir:

1. `username`
- hesap kimligidir
- benzersizdir
- login, admin ve teknik referanslarda ana kimlik olarak kalir

2. `displayName`
- oyuncunun diger oyunculara gorunen genel adidir
- oyuncu deneyimi odaklidir
- lobby ve oyun ici gorunumde varsayilan ad olarak kullanilabilir

3. `session / room nickname`
- oda bazli gecici takma ad modelidir
- ilk asamada eklenmeyecektir

## Uygulama Karari

Ilk surum icin onerilen model:

- kayitli kullanici gorunen adini `Settings` icinden degistirir
- room join akisinda kullanilacak gorunen ad:
  - once `displayName`
  - yoksa `username`
- guest oyuncu ise giriste yazdigi isimle devam eder

Bu sayede:

- oyuncu tarafi esneklik kazanir
- moderation ve audit tarafi gereksiz yere karmasiklasmaz
- oyuncu her lobby icin ayri maske isim tasimaz

## V2 Karari: Lobby Quick Edit

Sonraki branch planinda su model kabul edilmistir:

1. `Settings`
- kalici `displayName` yonetiminin ana yeri olmaya devam eder

2. `Lobby` / oyun ust bar quick edit
- kucuk avatar + gorunen isim butonu olabilir
- tiklaninca hizli kimlik paneli acilir
- kayitli oyuncu burada gorunen adini guncelleyebilir
- bu alan ayri "oda bazli nickname" sistemi degil, `displayName` hizli erisim yuzeyi olarak davranir
- mobilde kompakt ve tek oyunculuk bir panel olarak davranir

3. kilitleme kurali
- lobby durumunda degistirilebilir
- oyun basladiktan sonra isim degisimi kilitlenir
- mac sonuna kadar sabit kalir

Bu model oyuncu acisindan kullanisli, audit acisindan ise savunulabilirdir.

## Uygulanan V1 Dilimi

`feature/gameplay-ui-polish` icinde ilk kimlik akisi su seviyeye getirildi:

- kayitli oyuncu room join olurken gorunen ad server tarafinda cozulur
- oncelik:
  - `displayName`
  - yoksa `username`
- `Settings` ekraninda `Gorunen Ad` bos birakilirsa profil kaydi `null` olur
- bu durumda istemci tekrar `username` fallback'i ile devam eder
- guest oyuncu session / lobby bazli ad akisini korur

Bu karar onemlidir cunku:

- oyuncu "gorunen adimi silmek istiyorum" diyebilir
- ama sistem bos isimle kalmaz
- kayitli oyuncu yeniden hesap adina duser

## Neden Oda Bazli Serbest Nickname Simdi Gelmiyor

Her oda icin tamamen bagimsiz nickname sistemi ilk bakista kullanisli gorunse de su maliyetleri getirir:

- moderation review zorlasir
- support tarafinda "kim kimdi" takibi kirilir
- audit snapshot'lari daha karmasik hale gelir
- ayni oyuncu kisa surede birden fazla adla gorunebilir

Bu yuzden urun karari:

- `displayName` ana gorunen isim modeli olarak kalsin
- lobby / ust bar quick edit, ayni `displayName` modeline hizli erisim saglasin
- ayri `roomNickname` modeli ilk asamada eklenmesin

## Guest Oyuncu Davranisi

Guest oyuncu icin kalici hesap kimligi yoktur.

Dogru model:

1. guest giriste bir isim yazar
2. lobby durumunda yalniz kendi panelinden isterse degistirebilir
3. oyun basladiktan sonra isim kilitlenir
4. bu isim yalniz o guest oturumu / room akisi icin gecerlidir
5. audit'e `displayNameSnapshot` olarak duser

Yani:

- guest'in kalici `displayName` profili yoktur
- yalniz session / room akisinda gorunen isim vardir
- audit yine snapshot alir, canli state'e bakmaz

## Audit Tarafinda Zorunlu Snapshot Alani

Display name feature'i geldiginde audit canli profile bakarak isim gostermemelidir.

Olay aninda su snapshot alinmalidir:

1. `identityType`
- `registered`
- `guest`

2. `accountUserId`
- kayitliysa var
- guest ise `null`

3. `accountUsernameSnapshot`
- kayitli hesabin degismeyen teknik username'i

4. `displayNameSnapshot`
- mac baslangicinda veya oyun kilitlendiginde diger oyunculara gorunen isim

5. `playerId`
- room / socket tarafindaki teknik oyuncu kimligi

## Snapshot Zamani

Audit icin dogru zaman:

- mac baslangicinda kimlik snapshot'i almak

Bu sayede:

- oyuncu lobby'de son anda yaptigi degisiklik dogru yakalanir
- oyun sirasinda isim degisikligi desteklenmedigi icin review kirilmaz
- finalize zamani canli profile bakmaya gerek kalmaz

## Audit UI Ilkesi

Ekonomi veya oyun review ekraninda:

- bir kaydin sahibi olan oyuncu ayri gosterilmelidir
- ayni macin lobby kadrosu ayri gosterilmelidir
- guest ve kayitli hesap farki net badge ile anlasilmalidir

Onerilen gosterim:

- `KaptanMert`
  - `registered`
  - `@juanka`
  - `userId: 42`

- `Mert`
  - `guest`
  - `playerId: guest:abc123`

Bu sayede:

- displayName sonradan degisse bile eski audit bozulmaz
- support / moderation / economy review tek veri modeliyle ilerler

## Uygulanan Audit Kimlik Gorunumu

Ekonomi audit kayitlarinda lineup artik yalniz duz metin olarak degil, kimlik kartlariyla gorunur:

- `displayNameSnapshot`
- `identityType`
- kayitli oyuncuda `@username`
- kayitli oyuncuda `userId`
- guest oyuncuda `playerId`
- takim bilgisi

Bu sayede audit review sirasinda:

- guest / kayitli ayrimi tek bakista anlasilir
- gorunen ad ile hesap kimligi karismaz
- koruma sistemlerinin `userId` / `playerId` bazli calistigi daha okunur hale gelir

## Branch Planlama Notu

Bu rehberdeki tam audit kimlik ayrimi ve displayName snapshot isi:

- `feature/economy-abuse-hardening` kapsaminda tamamlanmayacak
- `feature/gameplay-ui-polish` veya ilgili oyuncu kimligi branch'inde ele alinacak
- bu branch ayni zamanda:
  - lobby / ust bar quick edit
  - settings displayName yonetimi
  - guest / registered badge sistemi
  - audit kimlik snapshot'i
  - lobby editable / oyun ici readonly akisi
  - settings ve lobby icinde `username` / `displayName` ayrimini netlestirme
  alanlarini birlikte ele alacak

Bu branch'te mevcut ekonomi review UI okunabilirligi ve finalize akis stabilitesi onceliklidir.
