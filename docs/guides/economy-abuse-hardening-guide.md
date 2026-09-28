# Economy Abuse Hardening Guide

Bu rehber `feature/economy-abuse-hardening` branch'inin uygulama sinirlarini tanimlar.

Amac:

- odul ekonomisini daha guvenli hale getirmek
- abuse'u pahali, verimsiz ve izlenebilir hale getirmek
- normal oyuncuyu yanlis pozitif ile cezalandirmamak

## Mevcut Durum Ozeti

Bugunku ekonomi cok dar:

- oyuncu coin'i esas olarak sadece tamamlanan mac odulunden kazaniyor
- `startingCoinBalance = 0`
- varsayilan mac odulleri:
  - kazanma: `120`
  - kaybetme: `40`
  - beraberlik: `40`
- hafta sonu carpani ve genel match/store multiplier var
- store katalog fiyatlari bugun yaklasik:
  - common: `120`
  - rare: `300-340`
  - epic: `480-550`
  - legendary: `820-960`
  - starter bundle: `780`
  - premium bundle: `2200`

Bu haliyle ekonomi "tek source + tek store ladder" modelinde.

Bu branch'in gorevi:

- bu dar modeli source-aware hale getirmek
- ileride gorev, event, comeback reward ve XP eklendiginde sistemin birbirine girmemesini saglamak
- normal oyuncuya gorunur sert ceza vermeden abuse verimini dusurmek

## Bu Branch'te Ne Yapilacak

1. reward eligibility kontrol katmani
- odul yazilacak mac veya oturum gercekten uygun mu
- duplicate claim / participant / completed match dogrulamasi
- guest ile oynayan authenticated oyuncunun odulunu kesmeden merkezi karar verme

2. coin cap ve diminishing returns temeli
- rolling window soft cap
- rolling window hard ceiling
- tekrar eden lineup pattern'lerinde tam blok yerine verim dusurme

3. tekrar eden grup sinyali
- ayni oyuncu grubunun asiri tekrarini izleme
- ayni dizilimle kisa aralikli oyunlari yumusak risk sinyali yapma
- tek basina ceza degil, skor girdisi olarak kullanma

4. suphe skoru ve audit izi
- hard ban yerine skor biriktirme
- neden supheli goruldugunu admin tarafinda izlenebilir hale getirme

5. source-aware economy guardrail
- match reward, admin grant, promo, purchase gibi kaynaklari birbirine karistirmama

6. ekonomi temel modelini netlestirme
- cap mantigini tek global blunt limit yerine source ailesine gore tasarlama
- magazayi "kac dakikada degil, kac anlamli mac esdegerinde" kalibre etme
- XP / level / gorev odullerini coin ekonomisinden ayri planlama

## Bu Branch'te Bilincli Olarak Yapilmayacak

1. otomatik sert ceza
- dogrudan suspend / ban / wallet freeze yok

2. tek basina IP ile karar
- IP ve subnet sadece yumusak sinyal

3. night market implementasyonu
- once ekonomi guardrail oturmali
- urun canliya acilmadan once implement edilmeyecek

4. gorev sistemi implementasyonu
- sadece economy ile iliskili dokuman baglaminda kalir
- urun canliya acilmadan once implement edilmeyecek

5. XP / level ekrani
- bu branch'te yok
- canli kullanim gorulmeden acilmayacak

6. event claim akisi
- bu branch'te yok
- event reward source modeli oturmadan acilmayacak

7. wallet ledger buyuk refactor
- bu ayri bir foundation isi

8. invasive fingerprint veya sert device enforcement
- ilk surumde agresif browser fingerprint yok
- dusuk agirlikli sinyal gerekiyorsa ileride ayri privacy review ile ele alinacak
## Audit Ve Olcek Notu

Bugunku acilis olceginde game.match.finalize icin audit yazimi kabul edilebilir.

Ama buyume halinde asagidaki optimizasyonlar backlog''da tutulmalidir:

1. Redis / Valkey counter
- rolling window coin toplamlari DB aggregate yerine memory store uzerinden hesaplanabilir
- repeated-group tekrar sayaclari DB count yerine keyed counter ile tutulabilir

2. Audit retention / archive
- eski game.match.finalize kayitlari sicak tablodan ayrilabilir
- yalniz koruma tetikleyen veya review degeri yuksek kayitlar uzun tutulabilir

3. Non-triggered finalize telemetry ayrimi
- koruma tetiklenmeyen finalize olaylari tam audit yerine daha hafif telemetry/event akisina tasinabilir
- audit tablosu admin review icin daha degerli ve daha kompakt kalir

4. Dashboard / player surface cache
- economy ile ilgili ikincil yuzeyler (dashboard summary, unread count, store catalog) Redis/Valkey ile kisa TTL cache'e alinabilir
- bu, oyun loop'unu etkilemeden oyuncu panellerindeki tekrar fetch yukunu azaltir

5. Reward guard counters
- rolling reward window toplamlari ve repeated-group tekrar sayaçlari buyume halinde DB aggregate/count yerine Redis/Valkey counter ile hesaplanabilir
- MySQL yine audit ve match_result truth kaynagi olarak kalir

6. Registered room presence coordination
- bugunku tek-instance yapida registered kullanici icin process-local `userId -> roomCode` index yeterlidir
- multi-instance veya Redis adapter asamasinda bu koordinasyon Redis/Valkey-backed presence/index katmanina tasinmalidir
- bu, farkli process'lerde ayni hesabin ikinci oda acma denemelerini de dogru bloklamayi saglar
Bu maddeler bugun zorunlu degil, ama buyume halinde ilk alinacak olcek onlemleridir.

## Uygulama Sirasi

1. mevcut reward / coin yazim noktalarini cikar
2. eligibility kurallarini merkezi hale getir
3. rolling window soft cap / hard ceiling kur
4. repeated-group diminishing returns kur
5. suphe skoru ve audit event'lerini ekle
6. admin review tarafi icin minimum gorunurluk sagla

Bu siralama acilis oncesi economy foundation icindir.

Asagidaki alanlar acilis sonrasi gozlemden sonra tekrar kararlandirilacak:

- XP / level
- gorev sistemi
- event claim ve event odul UX'i
- night market

## Source-Aware Ekonomi Modeli

Bu branch'te alinacak ana karar:

- tek bir `gunluk max coin` butun sistemi yonetmeyecek

Dogru model:

1. `match_reward`
- normal oyun tamamlamadan gelen coin

2. `mission_reward_daily`
- gunluk gorev coin'i

3. `mission_reward_weekly`
- haftalik gorev coin'i

4. `event_reward`
- sureli etkinlik coin'i

5. `comeback_reward`
- geri donus veya retention reward'u

6. `promo_claim`
- coin grant / code / campaign gibi kampanya coin'i

7. `admin_adjustment`
- support veya operasyon kaynakli manuel hareket

Cap ve abuse guardrail yalniz uygun source ailesine uygulanmali.

Ornek:

- `admin_adjustment` normal gameplay cap'ine girmez
- `promo_claim` ile `match_reward` ayni bucket olmaz
- gelecekte gorev coin'i eklendiginde gameplay cap ile birbirini ezmez

## Cap Stratejisi

Simdi sert dusuk global saatlik/gunluk/haftalik cap koymak yanlis olur.

Sebep:

- coin kaynagi su an neredeyse sadece mac
- yarin gorev ve event eklendiginde ayni limitler anlamsizlasir
- normal oyuncuya "neden coin gelmedi" hissi yaratir

Bu yuzden onerilen model iki fazli:

### Faz 1

- eligibility kontrolu
- tekrar eden grup davranisinda diminishing returns
- cok yuksek ama guvenlik amacli "safety ceiling"

Bu ceiling oyuncunun normal oyunda fark etmeyecegi kadar yuksek olmali.

Amac:

- cok bariz farm davranisini sinirlamak
- normal oyuncuya ceza hissettirmemek

### Ceiling nasil normale doner

Ceiling "gun bitti, sifirlandi" mantigiyla degil, rolling window mantigiyla calismalidir.

Ornek:

- pencere `24 saat`
- oyuncunun son `24 saat` icindeki `match_reward` toplami izlenir
- eski oduller zaman penceresinden dustukce oyuncu otomatik olarak yeniden tam odul bandina doner

Bu model daha dogrudur cunku:

- gece yarisi reset exploit'i yaratmaz
- oyuncuya daha dogal davranir
- ayni gun icinde asiri kasan ile ertesi gun oynayan oyuncuyu daha adil ayirir

Bu branch icin tercih:

- rolling window
- source-aware takip
- takvim gunu reset mantigi yok

### Faz 2

Gorev ve event odulleri gelince:

- source bazli saatlik/gunluk/haftalik budget
- `match_reward` icin ayri budget
- `mission_reward_*` icin ayri budget
- `event_reward` icin ayri budget

Bu model gelecekte sistemi kirmaz.

## Soft Cap Ve Hard Ceiling Ayrimi

Tek bir sert ceiling yerine iki katman daha sagliklidir:

1. soft cap
- odul dususu burada baslar
- oyuncu tam blok hissetmez

2. hard ceiling
- en ust emniyet freni
- sadece asiri uc davranista devreye girer

Ilk surumde hedef:

- normal oyuncu soft cap'i bile nadiren gorsun
- hard ceiling ise neredeyse yalniz abuse/farm davranisinda devreye girsin

## Yuzdesel Dusus Nasil Olmali

Ilk tercih:

- otomatik ama bounded profil mantigi

Yani admin panelde serbestce "her basamak icin 17 farkli yuzde" girmek yerine:

- `yumusak`
- `standart`
- `sert`

gibi damping profilleri daha dogrudur.

Neden:

- ayarlamasi daha kolay
- operator hatasi daha az
- ekonomi tuning'i daha izlenebilir

Ikinci asamada istenirse su alanlar acilabilir:

- `softCapCoin`
- `hardCapCoin`
- `minRewardMultiplier`
- `dampingProfile`

Ama ilk surumde serbest cok nokta yuzde editoru acmak istemiyoruz.

## Fiyatlandirma Ve Satin Alma Temposu

Ekonomi kararini dakika bazli degil, "anlamli tamamlanmis mac esdegeri" ile vermek daha dogru.

Cunku:

- bugun gercek ortalama mac suresi instrument edilmis degil
- ham sure yerine bitirilmis ve uygun gorulen mac daha saglikli olcu birimi

Bugunku varsayilan odul tablosunda kabaca:

- ortalama bir mac getirisi yaklasik `80 coin` kabul edilebilir
  - kazanma `120`
  - kaybetme `40`

Bu durumda bugunku fiyatlar su tempo hissini veriyor:

- `120` coin -> `1.5` mac civari
- `300-340` coin -> `4-5` mac
- `480-550` coin -> `6-7` mac
- `820-960` coin -> `10-12` mac
- `780` bundle -> `9-10` mac
- `2200` premium bundle -> `27-28` mac

Bu fena bir baslangic degil, ama uzun vadede bilincli ladder lazim.

Onerilen hedef ladder:

1. giris itemleri
- `2-3` anlamli mac

2. yaygin ama arzu edilir itemler
- `5-7` anlamli mac

3. orta-prestij itemler
- `8-12` anlamli mac

4. yuksek prestij itemler
- `14-20` anlamli mac

5. premium veya koleksiyon bundle
- `25-35` anlamli mac

Ana kural:

- oyuncu her oturumda "ulasilabilir bir sonraki hedef" gormeli
- ama premium ladder da hemen bitmemeli

## XP Ve Level Hakkinda Karar

Evet, uzun vadede XP/level eklemek mantikli.

Ama coin ile ayni mantiga baglamak dogru degil.

Dogru ayrim:

- `coin` -> harcanabilir ekonomi
- `xp` -> kalici ilerleme hissi
- `level` -> prestij ve ilerleme katmani

Ilk surum icin onerilen model:

1. XP sadece uygun gorulen maclardan ve ileride gorevlerden gelir
2. her level'da zorunlu coin odulu verme
3. coin yerine daha cok:
   - rozet
   - banner
   - profil kimligi
   - milestone odulu

Sebep:

- her level coin vermek ikinci bir coin muslugu yaratir
- abuse baskisi coin uzerinde daha da artar

Daha saglikli model:

- erken level'larda kucuk onboarding odulleri olabilir
- asil oduller milestone level'larda verilir
  - ornek: `5 / 10 / 15 / 20`

## Gorev Ve Etkinlik Sistemi Ne Zaman

Gorev sistemi bu branch'te implement edilmemeli.

Dogru siralama:

1. reward eligibility ve soft abuse guardrail
2. source-aware ekonomi modeli
3. sonra gorev/event reward tasarimi
4. sonra XP / level entegrasyonu
5. en son night market gibi retention vitrini

Yani gorev sistemi ekonomiden once degil, ekonomi source ayrimi oturduktan sonra gelmeli.

## IP, Ayni Ev, Fingerprint

Burada sert davranmak yanlis olur.

Gercek dunya:

- ayni evde birden fazla oyuncu olabilir
- ayni cihaz aginda normal oyun olabilir
- NAT ve paylasimli baglanti cok yaygindir

Bu yuzden:

- IP tek basina karar vermez
- subnet tek basina karar vermez
- device fingerprint ilk surumde kullanilmaz

Eger ileride fingerprint dusunulurse:

- yalniz yumusak sinyal olur
- asla tek basina enforcement tetiklemez
- privacy ve operasyon maliyeti ayri review ister

Ilk surum icin dogru sinyal karmasi:

- tekrar eden lineup
- mac hizi / velocity
- hesap yasi
- katilim cesitliligi
- trusted IP / subnet yumusak katkisi
- access signal surekliligi

## Oyuncuya Hissettirmeme Prensibi

Oyuncu su hissi almamali:

- "sistem beni gizlice cezalandirdi"
- "arkadaslarla oynadim diye coin kesildi"

Bu yuzden bu branch'te tercih:

- hard ceza yok
- buyuk blok yok
- once yumusak verim dusurme
- audit ve review var

Sistem abuse'u pahali hale getirmeli, gosterisli ceza vermemeli.

## Admin Tarafindan Ayarlanabilirlik

Evet, ama sinirsiz kural paneli olarak degil.

Dogru model:

- birkac bounded ayar
- guvenli varsayilanlar
- admin'in her esigi keyfi olarak 0-100 oynamadigi dar araliklar

Ornek ileri asama ayarlari:

- match reward multiplier
- safety ceiling enable/disable
- repeated-group damping profile
- review threshold profile

Ekonomi panelinde ileride acilabilecek bounded alanlar:

- `matchRewardGuardEnabled`
- `matchRewardWindowHours`
- `matchRewardSoftCapCoin`
- `matchRewardHardCapCoin`
- `matchRewardMinMultiplier`
- `matchRewardDampingProfile`
- `repeatedGroupEnabled`
- `repeatedGroupWindowHours`
- `repeatedGroupThreshold`
- `repeatedGroupMinMultiplier`

Yapilmamasi gereken:

- her heuristic icin ayri serbest numeric admin paneli

Bu hem operator hatasini artirir hem sistemi karmasiklastirir.

## Admin Panel UX Ilkesi

Bu ayarlar ileride admin panelde acilacaksa:

- tek tabloda karmasik teknik alan yigini olmamali
- "oyuncu etkisi" ve "guvenlik etkisi" acikca anlatilmali
- her alanin altinda kisa yardim metni olmali
- `soft cap` ve `hard ceiling` farki ayri anlatilmali
- `tekrar eden grup dususu` ayri kartta toplanmali

Onerilen panel gruplari:

1. `Mac Odul Ayarlari`
2. `Odul Koruma Tavani`
3. `Tekrar Eden Grup Korumasi`
4. `Sinyaller Ve Review`

Yani teknik olarak ayarlanabilir olsun, ama operator icin anlasilir kalsin.

## Su Anda Hazirlanan Runtime Ayarlar

Bu branch'te system settings ekonomi bolumune su bounded alanlar eklenmeye baslandi:

- `matchRewardGuardEnabled`
- `matchRewardWindowHours`
- `matchRewardSoftCapCoin`
- `matchRewardHardCapCoin`
- `matchRewardMinMultiplier`
- `matchRewardDampingProfile`
- `repeatedGroupEnabled`
- `repeatedGroupWindowHours`
- `repeatedGroupThreshold`
- `repeatedGroupMinMultiplier`

Not:

- bu alanlar acilis oncesi agresif tuning icin degil
- once guvenli varsayilanlarla gelir
- sonra evaluator bu ayarlari kullanir

## Onerilen Acilis Default'lari

Canli oncesi baslangic profili olarak onerilen conservative varsayilanlar:

- `matchRewardGuardEnabled = true`
- `matchRewardWindowHours = 24`
- `matchRewardSoftCapCoin = 3600`
- `matchRewardHardCapCoin = 5200`
- `matchRewardMinMultiplier = 0.35`
- `matchRewardDampingProfile = gentle`
- `repeatedGroupEnabled = true`
- `repeatedGroupWindowHours = 12`
- `repeatedGroupThreshold = 8`
- `repeatedGroupMinMultiplier = 0.55`

Bu profilin mantigi:

- normal oyuncuyu neredeyse hic hissettirmeden koruma acmak
- ilk acilista asiri sert dusus kullanmamak
- organize farm davranisini tam verimde birakmamak

## Branch'te Uygulanan V1

Su an bu branch'te aktif olarak kurulan runtime davranis:

1. merkezi reward eligibility
- `match finalize` route icindeki daginik kararlar tek katmana toplandi
- deny / allow_full / allow_reduced karari artik acik reason code ve review flag ile donuyor

2. reward source ayrimi
- `match_reward`
- `promo_claim`
- `admin_adjustment`
su an runtime ve audit metadata'da ayri tasiniyor

3. rolling window safety ceiling
- yalniz `match_reward` icin calisiyor
- `soft cap` ustunde odul kademeli azalir
- `hard ceiling` ustunde coin sifira kadar inebilir
- eski oduller pencerenin disina ciktikca oyuncu otomatik olarak tam banda doner

4. repeated-group diminishing returns
- ayni oyuncu ayni lineup ile ayni pencere icinde tekrar odul aliyorsa verim kademeli dusurulur
- ilk esige kadar tam odul devam eder
- esik asildiktan sonra `repeatedGroupMinMultiplier` alt sinirina kadar iner

5. audit aciklanabilirligi
- `requestedRewardCoin`
- `allowedRewardCoin`
- `blockedRewardCoin`
- `repeatedGroup*`
- `rewardGuard*`
alanlari audit metadata'ya yazilir

6. economy review admin gorunurlugu
- audit ekranina `Mac Odulleri`, `Koruma Tetikleri`, `Ceiling`, `Tekrar Grup` preset'leri eklendi
- economy review satirlari tek satir metadata yigini yerine daha okunur bloklar halinde gosterilir
- ilgili kayitta:
  - odulu alan oyuncu
  - lobby kodu
  - sure
  - istenen / verilen odul
  - tetiklenen koruma bandi
gorunur hale geldi

7. finalize akis stabilitesi
- duplicate finalize yarisinda odul insert'i idempotent hale getirildi
- audit yazimi hata verirse oyuncu odul response'u bozulmaz
- `LAST_INSERT_ID()` BigInt donusunun response'u kirma riski kapatildi

8. room-level review baglami
- audit economy review kaydinda ayni macin `Lobi Kadrosu` gorunur
- bu alan o satirdaki oyuncunun ayni maca girdigi tum oyuncu kadrosunu gosterir
- bu liste "cezali oyuncular" listesi degildir; review baglamidir

## Yuk Ve Cok Oyunculu Senaryo Notu

Su anki finalize maliyeti authenticated oyuncu basina:

1. repeated-group icin bir `count`
2. rolling ceiling icin bir `aggregate`
3. `matchResult.create`
4. `wallet.update`
5. `auditLog.create`

Bu model acilis seviyesi icin kabul edilebilir cunku:

- sorgular indeksli alanlara dayanir
- guest oyuncular wallet/audit finalize yazimi yapmaz
- ayni arkadas grubunun tekrari sistemi mantiksal olarak tetikler ama runtime'i dogrudan cokertmez

Asil buyume riski:

- audit tablosu buyumesi
- canli trafik buyudugunde finalize throughput'un artmasi

Bu durumda sonraki adim:

- audit retention / arsivleme
- non-triggered finalize kayitlarini daha hafif telemetry akimina tasima
- `feature/cache-and-rate-limit-foundation` sonrasinda Redis/Valkey destekli hafif counter yardimi

Oyuncu paneli tarafinda da:

- dashboard summary local event sync
- unread count shared counter
- catalog / profile mini-summary cache

gibi katmanlar eklenirse, oyun disi fetch yukleri DB uzerinde daha hafif kalir.

## Bu Branch'te Bilincli Olarak Hala Yapilmayanlar

- XP / level runtime'i
- gorev runtime'i
- event reward runtime'i
- night market
- invasive fingerprint
- otomatik sert enforcement
- tam suspicion scoring paneli
- displayName snapshot ile guest / registered audit kimlik ayrimi
- room ici canli gorunen isim degisikligi

## Guardrail'ler

1. false positive maliyeti yuksek
- bir kural oyuncuyu haksiz yere cezalandiriyorsa sert olmamali

2. hard block son care
- once odul dusurme veya odulu yazmama

3. admin tarafi aciklanabilir olmali
- neden riskli oldugu metadata ile gorunmeli

4. source ayrimi bozulmamali
- support grant ile normal match reward ayni kategoriye dusmemeli

## Referans Dokumanlar

- `docs/guides/economy-abuse-strategy-guide.md`
- `docs/guides/night-market-and-missions-strategy-guide.md`
- `docs/guides/admin-user-observability-guide.md`
- `docs/guides/player-display-name-and-audit-strategy-guide.md`



