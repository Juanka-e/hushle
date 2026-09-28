# Online Tabu Oyunu — Streamer Mode Teknik Tasarım Dokümanı

## 1. Amaç

Online Tabu oyununun Twitch ve Kick yayıncılarının kendi chatleriyle doğrudan oynayabileceği bir **Streamer Mode** eklenmesi.

Temel oyun döngüsü:

1. Yayıncı Twitch veya Kick hesabını OAuth ile bağlar.
2. Yayıncı özel ekranda hedef kelimeyi ve yasaklı kelimeleri görür.
3. İzleyiciler bu bilgileri görmez.
4. Yayıncı kelimeyi yasaklı kelimeleri kullanmadan anlatır.
5. İzleyiciler Twitch/Kick chatinden tahmin yazar.
6. Sistem chat mesajlarını gerçek zamanlı dinler.
7. Doğru tahmini yapan kullanıcı platform kullanıcı ID'si üzerinden tespit edilir.
8. Kazanan, süre, seri ve leaderboard güncellenir.
9. Yayına verilen ekran sonucu ve yeni round'u gösterir.

İzleyicilerin ayrıca siteye girmesi, hesap açması veya uygulama kurması gerekmez.

---

# 2. Temel Mimari Kararı

Streamer Mode iki ayrı ekrandan oluşmalıdır:

- **Private Host View**
- **Public Stream View**

Bu ekranların görevleri birbirinden kesin olarak ayrılmalıdır.

## Private Host View

Sadece yayıncı tarafından görülür.

Örnek:

```text
BUZDOLABI

❌ soğuk
❌ mutfak
❌ yiyecek
❌ dolap
❌ dondurucu

00:42

[ PAS ]    [ SONRAKİ ]
```

Bu ekranda:

- hedef kelime
- yasaklı kelimeler
- kalan süre
- pas
- round kontrolü
- oyun kontrolü

bulunur.

Bu ekran hiçbir zaman yayına verilmemelidir.

---

## Public Stream View

Yayına verilen ekrandır.

Örnek:

```text
┌──────────────────────────────────────┐

              ROUND 8

           [ CARD BACK ]

               00:42

         CHAT'TEN TAHMİN ET!

🔥 SON BİLEN
melis123 — 4.2 sn

🏆 YAYIN SIRALAMASI

1. Melis       8
2. Burak       6
3. Eren        5

└──────────────────────────────────────┘
```

Public Stream View içerisinde:

- kart arkası
- round numarası
- süre
- leaderboard
- seri bilgileri
- doğru bilen kişi
- kazanan animasyonu
- yayıncı profili
- seçili kozmetikler

gösterilebilir.

Ancak aktif round sırasında:

- hedef kelime
- yasaklı kelimeler

kesinlikle gönderilmemelidir.

Bu bilgiler CSS ile gizlenmemeli veya frontend'e gönderilip görünmez yapılmamalıdır.

Public Stream View API response'u içerisinde bile gizli cevap bulunmamalıdır.

---

# 3. OBS Zorunlu Olmalı mı?

Hayır.

Özel OBS plugin'i veya masaüstü uygulama geliştirmek V1 için gereksizdir.

En iyi yöntem:

```text
https://oyun-domain.com/stream/{sessionToken}
```

adresinin OBS, Streamlabs veya Browser Source destekleyen yayın uygulamasına eklenmesidir.

Örneğin:

```text
Browser Source
Width: 1920
Height: 1080
URL:
https://oyun-domain.com/stream/a8H92Kd
```

Ancak OBS kullanımı zorunlu tutulmamalıdır.

Alternatif olarak yayıncı:

- Public Stream View'u ikinci monitörde açabilir.
- Window Capture yapabilir.
- Tarayıcı penceresini yayınlayabilir.

Dolayısıyla kullanıcıya iki seçenek sunulmalıdır:

```text
OPEN STREAM VIEW

COPY OBS URL
```

---

# 4. Full Stream View ve Overlay Ayrımı

İki farklı yayın görünümü desteklemek mantıklıdır.

## Full Stream View

Tabu oyununun yayının ana içeriği olduğu senaryo.

```text
/stream/{sessionToken}
```

İçerik:

- büyük kart
- sayaç
- leaderboard
- kazanan
- round bilgisi
- yayıncı kozmetikleri

---

## Transparent Overlay

Yayıncı başka bir oyun veya içerik gösterirken üzerine Hushle/Tabu bilgileri bindirir.

```text
/overlay/{sessionToken}
```

Örnek:

```text
ROUND 8                 00:42

        CHAT'TEN TAHMİN ET

🥇 Melis   8
🥈 Eren    7
🥉 Ali     5
```

Overlay:

- transparan background
- timer
- top 3
- winner animation
- streak
- round bilgisi

gibi minimum öğeleri gösterir.

---

# 5. Bot Gerekli mi?

## V1 için bot yapılmamalıdır.

Bot sistemin temel parçası olmamalıdır.

Yayıncı:

```text
Connect Twitch
```

veya:

```text
Connect Kick
```

dediğinde OAuth üzerinden gerekli chat okuma izinleri alınmalıdır.

Sistem chat mesajlarını doğrudan resmi Twitch/Kick event altyapılarından dinlemelidir.

Bot kullanmadan:

- chat mesajları okunabilir
- kullanıcı ID alınabilir
- username alınabilir
- doğru cevap tespit edilebilir
- leaderboard tutulabilir

Bu nedenle bot zorunlu değildir.

---

## Bot neden V1 dışında kalmalı?

Bot:

- ekstra izin gerektirir
- chat gönderme rate limitleri getirir
- moderasyon sorunu çıkarabilir
- chat spam'ine neden olabilir
- ek hata senaryoları yaratır
- onboarding sürecini uzatır

V1 amacı:

```text
OAuth → Start Session → Play
```

olmalıdır.

---

## Bot ileride opsiyonel olabilir

Örneğin:

```text
Chat Announcements
[ ] Enabled
```

açılırsa bot yalnızca önemli olaylarda yazabilir:

```text
🏆 @melis doğru bildi! 4.1 saniye.
```

veya:

```text
🔥 @burak 5 round seri yaptı!
```

Ancak oyun hiçbir zaman bot çalışmasına bağımlı olmamalıdır.

---

# 6. OAuth Akışı

## İlk giriş

Streamer Mode ekranı:

```text
STREAMER MODE

Connect Platform

[TWITCH]
[KICK]
```

---

## Twitch

OAuth tamamlandıktan sonra:

```text
✓ Twitch Connected
@streamername
```

---

## Kick

OAuth tamamlandıktan sonra:

```text
✓ Kick Connected
@streamername
```

---

# 7. OAuth Sonrasında Yayıncı Akışı

OAuth tamamlandıktan sonra kullanıcı:

```text
STREAMER MODE

Platform
● Twitch — @streamer
○ Kick

Game Mode
● Chat Challenge
○ Streamer vs Chat
○ Teams

Category
[ Mixed ]

Round Time
[ 60 seconds ]

Card Skin
[ Egyptian Gold Cat ]

Avatar Frame
[ Creator Gold ]

Stream Theme
[ Midnight ]

[ CREATE STREAM SESSION ]
```

butonuna basar.

---

# 8. Session Oluşturulduktan Sonra

```text
SESSION READY

Private Host View
[ OPEN ]

Public Stream View
[ OPEN ]

OBS Browser Source
[ COPY URL ]

[ START GAME ]
```

Yayıncının işi mümkün olduğunca burada bitmelidir.

---

# 9. Streamer Mode UX Hedefi

İdeal kullanım:

```text
Connect Twitch
      ↓
OAuth
      ↓
Create Session
      ↓
Open Host View
      ↓
Add Stream View to OBS
      ↓
START
```

İlk kurulumdan sonraki yayınlarda:

```text
Streamer Mode
      ↓
Start Session
      ↓
Play
```

seviyesine düşmelidir.

---

# 10. Viewer Login Olmamalı

İzleyicilerin:

- siteye gitmesi
- QR okutması
- hesap oluşturması
- OAuth yapması
- uygulama indirmesi

gerekmemelidir.

Viewer yalnızca Twitch/Kick chat'e yazar:

```text
melis: buzdolabı
```

ve oyuna katılmış olur.

Backend kullanıcının görünen nick'inden ziyade platform kullanıcı ID'sini temel almalıdır.

Örnek:

```text
twitch:73842819
```

veya:

```text
kick:98753221
```

Bu sayede kullanıcı adını değiştirse bile skor geçmişi korunabilir.

---

# 11. Chat Event Normalizasyonu

Twitch ve Kick'ten gelen eventler ortak formata çevrilmelidir.

Örnek:

```ts
type ChatMessage = {
  platform: "twitch" | "kick";
  channelId: string;

  user: {
    id: string;
    username: string;
    displayName: string;
    badges: string[];
  };

  messageId: string;
  text: string;
  timestamp: Date;
};
```

Guess Engine platformdan bağımsız çalışmalıdır.

```text
Twitch ─┐
        ├─> Chat Adapter
Kick ───┘
             ↓
        Normalized ChatMessage
             ↓
          Guess Engine
```

Bu yapı ileride YouTube gibi yeni platformların eklenmesini kolaylaştırır.

---

# 12. Doğru Cevap Kontrolü

Örneğin cevap:

```text
Buzdolabı
```

Chat mesajlarının aşağıdaki varyasyonları doğru sayılabilir:

```text
buzdolabı
BUZDOLABI
Buzdolabı!
buzdolabi
```

Normalize adımları:

1. trim
2. lowercase
3. Unicode normalize
4. punctuation temizleme
5. fazla boşluk temizleme
6. Türkçe karakter toleransı

Örnek:

```text
"Buzdolabı!!!"

→

"buzdolabı"
```

---

# 13. Guess Tolerance

Yayıncı ayarı:

```text
Guess Tolerance

● Normal
○ Strict
○ Flexible
```

## Strict

Neredeyse tam eşleşme.

## Normal

Türkçe karakter veya küçük yazım farklılıkları kabul edilir.

Örnek:

```text
buzdolabi
```

## Flexible

Küçük typo toleransı olabilir.

Ancak fuzzy matching çok agresif olmamalıdır.

Default:

```text
Normal
```

önerilir.

---

# 14. Sistem Yükünü Düşük Tutma

Bu özellik tasarlanırken en önemli kurallardan biri:

## Chat mesajlarını PostgreSQL'e kaydetmemek.

Bir yayında binlerce mesaj gelebilir.

Örnek:

```text
araba
ev
uçak
masa
telefon
sandalye
buzdolabı
```

Yanlış tahminlerin hiçbir kalıcı değeri yoktur.

Pipeline:

```text
Twitch / Kick
      ↓
Chat Event
      ↓
Active Session?
      ↓
Active Round?
      ↓
Normalize
      ↓
Compare
      ↓
Wrong
      ↓
DROP
```

Yanlış tahmin:

```text
DB INSERT = 0
```

olmalıdır.

---

# 15. Doğru Tahminde Saklanacak Veri

Doğru tahminde yalnızca gerekli event:

```text
RoundWinner

roundId
platform
userId
username
timeMs
timestamp
```

saklanmalıdır.

Örneğin:

```json
{
  "roundId": "r_98231",
  "platform": "twitch",
  "userId": "73842819",
  "username": "melis",
  "timeMs": 4182
}
```

---

# 16. Redis Kullanımı

Aktif session verileri Redis'te tutulabilir.

Örnek key'ler:

```text
stream:session:{sessionId}

stream:round:{sessionId}

stream:leaderboard:{sessionId}

stream:user:{platform}:{userId}

stream:cooldown:{roundId}:{userId}
```

Leaderboard için Redis Sorted Set kullanılabilir.

Örnek:

```text
ZINCRBY stream:leaderboard:123 1 twitch:73842819
```

Session bittiğinde gerekli aggregate veriler PostgreSQL'e yazılır.

---

# 17. Public View'a Her Chat Mesajı Gönderilmemeli

Yanlış mimari:

```text
Twitch
 ↓
Backend
 ↓
WebSocket
 ↓
OBS
```

ile her chat mesajını yayın ekranına aktarmak.

Buna gerek yoktur.

Public View yalnızca anlamlı oyun eventlerini almalıdır:

```text
ROUND_STARTED
WINNER_FOUND
LEADERBOARD_UPDATED
ROUND_ENDED
SESSION_ENDED
```

Böylece chat saniyede yüzlerce mesaj alsa bile OBS tarafında render yükü oluşmaz.

---

# 18. Aktif Oyun Yoksa Chat İşlenmemeli

Yayıncı hesabını OAuth ile bağlamış olabilir.

Ancak Streamer Mode açık değilse:

```text
NO ACTIVE SESSION
```

durumundadır.

Chat eventleri oyun motoruna verilmemelidir.

Akış:

```text
OAuth Connected
      ↓
No Session
      ↓
Ignore Game Processing
```

Yayıncı:

```text
START STREAM SESSION
```

dediğinde:

```text
ACTIVE
```

hale gelir.

Session kapandığında tekrar:

```text
INACTIVE
```

olur.

---

# 19. Streamer Mode Herkese Açılmalı mı?

## İlk sürümde tamamen herkese açık yapılması önerilmez.

Ancak menü herkese görünmelidir.

Örnek:

```text
PLAY

Quick Play
Private Room
Streamer Mode  BETA
```

Streamer Mode'a giren normal kullanıcı:

```text
Play with your Twitch or Kick community.

[ CONNECT TWITCH ]
[ CONNECT KICK ]
```

OAuth ile platform kimliği doğrulanabilir.

Ancak beta döneminde erişim ayrıca feature entitlement ile kontrol edilebilir.

---

# 20. Role Yerine Feature Entitlement

Sadece:

```text
role = STREAMER
```

kullanılması önerilmez.

Genel roller ayrı kalmalıdır:

```text
USER
MODERATOR
ADMIN
```

Streamer erişimi:

```text
streamer_mode_enabled = true
```

veya daha genel olarak:

```ts
features: {
  streamerMode: true
}
```

ile yönetilmelidir.

---

# 21. Creator Profile

Önerilen yapı:

```text
creator_profiles

id
user_id
status
streamer_mode_enabled
created_at
approved_at
```

Status:

```text
PENDING
ACTIVE
SUSPENDED
REJECTED
```

Platform bağlantıları ayrı tutulmalıdır.

```text
platform_connections

id
user_id
platform
platform_user_id
username
access_token_encrypted
refresh_token_encrypted
created_at
```

---

# 22. Beta Dönemi

Başlangıçta Streamer Mode:

```text
BETA
```

olarak çıkabilir.

Erişim:

- davet edilen yayıncılar
- manuel onaylanan yayıncılar
- küçük veya büyük creatorlar
- test hesapları

ile sınırlandırılabilir.

Follower sayısına göre otomatik eleme yapılması şart değildir.

Küçük yayıncılar da ürün testi açısından değerlidir.

---

# 23. Creator Başvuru Akışı

En iyi akış:

```text
Streamer Mode
      ↓
Connect Twitch / Kick
      ↓
OAuth
      ↓
Verified Platform Account
      ↓
Request Creator Access
```

Admin paneli:

```text
CREATOR REQUESTS

Twitch
@streamername
Verified ✓

[ APPROVE ]
[ REJECT ]
```

Approve sonrası:

```text
streamer_mode_enabled = true
```

---

# 24. Beta Sonrasında

Sistem stabil hale geldiğinde temel Streamer Mode herkese açılabilir.

Akış:

```text
Connect Twitch
      ↓
OAuth
      ↓
Create Session
```

Ancak ayrı bir:

```text
Verified Creator
```

veya:

```text
Partner Creator
```

statüsü korunabilir.

Bu statüler yalnızca ekstra imkan verir.

Örnek:

- özel creator badge
- gelişmiş analytics
- özel stream theme
- özel overlay
- custom branding
- featured streamer
- uzun istatistik geçmişi
- creator kozmetikleri

---

# 25. Streamer Mode Ücretli Olmalı mı?

Temel Streamer Mode'un ücretli yapılması önerilmez.

Yayıncı oyunun dağıtım kanalıdır.

Örneğin 500 izleyicili bir yayıncı:

```text
500 potansiyel kullanıcı
```

önüne ürünü getirir.

Bu nedenle:

```text
Basic Streamer Mode = Free
```

önerilir.

Gelir:

- premium kartlar
- kart arkaları
- avatar frame
- stream themes
- winner animation
- özel transitions
- özel ses paketleri
- creator branding

üzerinden elde edilebilir.

---

# 26. Mevcut Kart Kozmetikleri

Streamer Mode mevcut kart sistemini özellikle kullanmalıdır.

Örneğin yayıncının seçili kartı:

```text
Egyptian Gold Cat
```

ise Public Stream View'da round boyunca kartın arka yüzü görünür.

Doğru cevap geldiğinde:

```text
CARD FLIP
```

animasyonu yapılır.

Örnek:

```text
        🏆 MELIS

      BUZDOLABI

    ⚡ 3.84 saniye

          +1
```

Kart flip tamamlandıktan sonra yeni karta geçilir.

Bu, mevcut kozmetik sistemini yayın sırasında sürekli görünür hale getirir.

---

# 27. Avatar ve Frame Kozmetikleri

Yayıncı profil bölümü:

```text
[ Avatar + Premium Frame ]

@streamername
CHAT CHALLENGE
```

şeklinde Public View'a eklenebilir.

Kullanılabilecek mevcut kozmetikler:

- avatar
- avatar frame
- kart önü
- kart arkası
- tema
- winner animation

Bu sayede kozmetiklerin kullanım alanı genişler.

---

# 28. Creator Pack

Onaylanan creatorlara başlangıçta özel kozmetik verilebilir.

Örnek:

```text
CREATOR PACK

Creator Card Back
Creator Avatar Frame
Creator Winner Animation
```

Bunlar yayın sırasında kullanılır.

Normal oyuncuların creator kozmetiklerini görmesi doğal reklam etkisi oluşturur.

---

# 29. Viewer Ekonomisi

İlk sürümde chat oyuncularına ana oyun ekonomisinden coin verilmemelidir.

Örneğin:

```text
17 doğru cevap
→ 170 coin
```

sistemi şu riskleri getirir:

- bot hesaplar
- alt hesaplar
- fake stream
- farm stream
- abuse

Bu yüzden ilk etapta chat oyuncularının ayrı istatistikleri olmalıdır.

Örnek:

```text
Wins
Correct Answers
Fastest Guess
Longest Streak
Weekly Rank
```

Ana ekonomiyle doğrudan bağlantı kurulmaz.

---

# 30. Leaderboard

## Session Leaderboard

```text
1. Melis       14
2. Eren        12
3. Burak        9
```

---

## Weekly Leaderboard

```text
1. Melis       84
2. Eren        72
3. Burak       61
```

---

## All-Time Leaderboard

Daha sonra eklenebilir.

Ancak leaderboard yayıncı bazlı tutulmalıdır.

Örnek:

```text
streamerId + platformUserId
```

---

# 31. Viewer Stats

İleride:

```text
Melis

Correct Answers: 184
First Answers:    96
Longest Streak:   11
Average Time:    8.4s
Fastest Guess:   0.82s
```

gibi istatistikler tutulabilir.

Kategori bazlı:

```text
Film     72
Sport    41
Games    35
General  36
```

eklenebilir.

---

# 32. Streak Sistemi

Örnek event:

```text
🔥 Melis 3 kere üst üste ilk bildi!
```

Public View:

```text
🔥 3 STREAK
MELIS
```

Bu tür eventler yayın içeriğini daha eğlenceli hale getirir.

---

# 33. Anti-Spam

Bir viewer:

```text
araba
ev
uçak
telefon
masa
sandalye
...
```

şeklinde aşırı tahmin spamlayabilir.

V1 için basit cooldown yeterlidir.

Örnek:

```text
guessCooldown = 500ms
```

Ayrıca isteğe bağlı:

```text
Max guesses per round

Unlimited
10
5
3
```

eklenebilir.

Default başlangıçta fazla agresif olmamalıdır.

---

# 34. Server Authoritative Yapı

Aktif cevap frontend'e gönderilmemelidir.

Yanlış:

```js
if (chatMessage === secretWord) {
  // winner
}
```

kontrolünü public browser'da yapmak.

Doğru mimari:

```text
Chat Event
    ↓
Backend Guess Engine
    ↓
Active Round
    ↓
Secret Answer
    ↓
Compare
    ↓
Winner
```

Public View sadece:

```text
WINNER_FOUND
```

eventini alır.

---

# 35. Session Mimari Özeti

```text
                ONLINE TABU

              STREAMER MODE
                    │
        ┌───────────┴───────────┐
        │                       │
      Twitch                   Kick
        │                       │
       OAuth                   OAuth
        │                       │
        └───────────┬───────────┘
                    │
              START SESSION
                    │
          ┌─────────┴─────────┐
          │                   │
    PRIVATE HOST         PUBLIC STREAM
         VIEW                 VIEW
          │                   │
      Secret Word          Card Back
      Forbidden            Timer
      Controls             Leaderboard
          │                Winner
          │                Cosmetics
          │                   │
          │            OBS / Window Capture
          │
          └──────── Guess Engine
                      │
                Twitch/Kick Chat
```

---

# 36. Önerilen Backend Modülleri

Başlangıçta ayrı microservice'ler oluşturmak gereksizdir.

Mevcut backend içerisinde modüler başlanabilir.

Örnek:

```text
modules/
└── streamer/
    ├── platform/
    │   ├── twitch/
    │   └── kick/
    │
    ├── session/
    ├── round/
    ├── chat-ingestion/
    ├── guess-engine/
    ├── leaderboard/
    ├── overlay/
    └── creator/
```

İleride ihtiyaç olursa:

```text
stream-gateway
guess-worker
```

ayrılabilir.

Başlangıçta gereksiz microservice karmaşasından kaçınılmalıdır.

---

# 37. Önerilen Veritabanı Yapısı

## creator_profiles

```text
id
user_id
status
streamer_mode_enabled
created_at
approved_at
```

## platform_connections

```text
id
user_id
platform
platform_user_id
username
access_token_encrypted
refresh_token_encrypted
created_at
```

## stream_sessions

```text
id
user_id
platform_connection_id
started_at
ended_at
status
```

## rounds

```text
id
session_id
word_id
started_at
ended_at
winner_platform
winner_platform_user_id
winner_username
winner_time_ms
```

## score_events

```text
id
session_id
platform
platform_user_id
username
type
points
created_at
```

Chat mesajlarının tamamı burada tutulmamalıdır.

---

# 38. V1 Oyun Modu

İlk sürümde tek mod yeterlidir:

## Chat Challenge

Yayıncı anlatır.

Chat doğru kelimeyi bulmaya çalışır.

İlk doğru bilen kullanıcı round'u kazanır.

V1'e şu modlar eklenmemelidir:

- Survival
- Red vs Blue
- Channel Points
- Viewer coin
- karmaşık takım sistemi
- global hesap linking

Bunlar altyapı doğrulandıktan sonra eklenebilir.

---

# 39. İleride Eklenebilecek Modlar

## Streamer vs Chat

```text
STREAMER    CHAT

   7         9
```

Chat kelimeyi sürede bulursa Chat +1.

Bulamazsa Streamer +1.

---

## Team Battle

```text
RED TEAM
vs
BLUE TEAM
```

Chat kullanıcıları iki takıma ayrılır.

---

## Survival

Çok sayıda viewer eleme mantığıyla yarışır.

---

## Category Voting

Chat:

```text
!film
!spor
!oyun
!genel
```

gibi seçim yapabilir.

---

# 40. V1 Kapsamı

Streamer Mode V1 aşağıdaki özelliklerden oluşmalıdır:

### Platform

- Twitch OAuth
- Kick OAuth
- Twitch chat event
- Kick chat event

### Game

- Chat Challenge
- active round
- doğru cevap detection
- normalizasyon
- süre
- ilk doğru cevap
- round winner

### Views

- Private Host View
- Public Stream View
- OBS Browser Source URL
- Transparent Overlay

### Leaderboard

- session leaderboard
- streak
- fastest guess
- winner animation

### Cosmetics

- card back
- card flip
- avatar
- avatar frame
- stream theme

### Backend

- Redis active state
- Redis leaderboard
- PostgreSQL aggregate/result storage
- wrong guesses dropped
- no raw chat history

### Creator Access

- OAuth identity verification
- beta entitlement
- creator approval
- admin enable/disable

---

# 41. V1 Dışında Bırakılacaklar

İlk sürümde yapılmaması önerilenler:

- zorunlu chat botu
- özel OBS plugin'i
- desktop app
- viewer login
- viewer OAuth
- viewer coin
- channel points
- complex team modes
- global cross-platform leaderboard
- her chat mesajının DB'ye yazılması
- her mesajın WebSocket ile OBS'ye gönderilmesi
- tüm özellikleri microservice'e ayırmak

---

# 42. Nihai Ürün Kararı

Önerilen yapı:

```text
Streamer connects Twitch/Kick
        ↓
OAuth
        ↓
Create Session
        ↓
Private Host View
+
Public Stream View
        ↓
Streamer adds Public View to OBS
or captures browser window
        ↓
Streamer explains
        ↓
Viewers guess directly in Twitch/Kick chat
        ↓
Backend detects winner
        ↓
Leaderboard + animation
        ↓
Next round
```

## Temel prensipler

1. **Bot zorunlu değil.**
2. **OBS plugin'i gereksiz.**
3. **Browser Source yeterli.**
4. **Viewer login olmamalı.**
5. **Chat mesajları kalıcı olarak saklanmamalı.**
6. **Sadece aktif session'lar işlenmeli.**
7. **Secret word yalnızca server + host tarafında bulunmalı.**
8. **Streamer Mode başlangıçta kontrollü beta olmalı.**
9. **Sonrasında temel Streamer Mode herkese ücretsiz açılabilir.**
10. **Monetization kozmetik ve creator özelleştirmelerinden gelmeli.**
11. **Mevcut kart ve avatar kozmetikleri Streamer Mode'a doğrudan entegre edilmeli.**
12. **Mimari Twitch/Kick adapter mantığıyla kurulmalı ve ileride yeni platformlara açık olmalı.**

---

# 43. Önerilen Yol Haritası

## Phase 1 — Core Integration

- Twitch OAuth
- Kick OAuth
- platform adapter interface
- chat ingestion
- guess normalization
- active session
- winner detection

## Phase 2 — Stream Experience

- Private Host View
- Public Stream View
- OBS Browser Source
- transparent overlay
- timer
- leaderboard
- winner animation
- card flip

## Phase 3 — Cosmetics

- selected card back
- avatar
- avatar frame
- stream theme
- creator cosmetics

## Phase 4 — Creator Beta

- creator request
- admin approve/reject
- entitlement
- analytics
- error monitoring

## Phase 5 — Public Release

- Streamer Mode herkese açılır
- Verified Creator seviyesi korunur
- premium stream cosmetics
- advanced analytics

## Phase 6 — Advanced Modes

- Streamer vs Chat
- Team Battle
- Survival
- Category Voting
- optional bot announcements
- optional Channel Points/reward integrations
