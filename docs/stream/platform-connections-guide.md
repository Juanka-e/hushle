# Yayıncı Platform Bağlantıları: Kurulum ve İşletme Rehberi

Tarih: 5 Kasım 2026. Kapsam: `feature/streamer-platform-connections` dalı
([tasarım](../superpowers/specs/2026-11-05-streamer-platform-connections-design.md),
[araştırma](./platform-oauth-arastirmasi.md)).

Yayıncı, Ayarlar → "Yayın kanalları" bölümünden Twitch ya da Kick kanalını bağlar.
Kanal kimliği `streamer_connections` tablosunda tutulur; platform token'ları AES-256-GCM
ile şifrelenir ve hiçbir API yanıtına, log'a ya da audit kaydına çıkmaz. `/streamer`
sayfası etkin bir bağlantı olmadan açılmaz.

## 1. Platform uygulamalarını oluşturma

**Twitch** — <https://dev.twitch.tv/console> (hesapta 2FA açık olmalı):

- Uygulama türü: Confidential. Kategori: Game Integration (ya da uygun olanı).
- OAuth Redirect URL: `https://<site>/api/streamer/connect/twitch/callback`
  (yerel geliştirmede `http://localhost:3000/api/streamer/connect/twitch/callback`).
- Client ID → `STREAMER_TWITCH_CLIENT_ID`, Client Secret → `STREAMER_TWITCH_CLIENT_SECRET`.
- Kapsam istenmez (kimlik için gerekmez). Sohbet okuma sonraki aşamada `user:read:chat`
  ile artımlı istenecek.

**Kick** — kick.com → Settings → Developer (2FA açık olmalı):

- Redirect URL: `https://<site>/api/streamer/connect/kick/callback`.
- Client ID → `STREAMER_KICK_CLIENT_ID`, Client Secret → `STREAMER_KICK_CLIENT_SECRET`.
- Akış PKCE S256 + client secret ile çalışır; kapsamlar `user:read channel:read`.
- Uygulama doğrulaması (developers@kick.com) isteğe bağlıdır; sohbet aşamasında
  abonelik tavanını artırmak için erken istenmesi önerilir.

## 2. Ortam değişkenleri

| Değişken | Açıklama |
| --- | --- |
| `STREAMER_TOKEN_KEY` | Token şifreleme anahtarı, tam 32 bayt base64: `openssl rand -base64 32`. `AUTH_SECRET`'tan bağımsız üretilir. |
| `STREAMER_TOKEN_KEY_VERSION` | Anahtar sürümü (tam sayı ≥ 1, varsayılan 1). Şifreli değerlerin başına yazılır. |
| `STREAMER_TOKEN_KEY_PREVIOUS`, `STREAMER_TOKEN_KEY_PREVIOUS_VERSION` | Rotasyon sırasında eski anahtar ve sürümü (bkz. §5). |
| `STREAMER_TWITCH_CLIENT_ID` / `_SECRET`, `STREAMER_KICK_CLIENT_ID` / `_SECRET` | Platform uygulama kimlikleri. Biri eksikse o platform "bağlanamıyor" görünür. |
| `STREAMER_OAUTH_PUBLIC_ORIGIN` | Tarayıcının gördüğü köken (`https://hushle.com`). Boşsa `NEXT_PUBLIC_SITE_URL` kullanılır. Docker/nginx arkasında istek kökeni `0.0.0.0:3000` olduğu için zorunludur. |
| `STREAMER_FAKE_PLATFORM` | Yalnız test. Üretim ön kontrolü `1` görürse durur. |
| `STREAMER_CONNECTION_DORMANT_DAYS` | Kullanılmayan bağlantının iptal süresi (1–365, varsayılan 90). |
| `STREAMER_HYGIENE_BATCH_SIZE`, `STREAMER_HYGIENE_LEASE_TTL_MS` | Bakım işi parti boyu (varsayılan 100) ve Redis kilidi (varsayılan 300000). |
| `STREAMER_HYGIENE_SCHEDULE_CONFIGURED` | systemd zamanlayıcı kurulduktan sonra `true`; sarmalayıcı betik bunu ister. |

Üretim ön kontrolü (`npm run ops:preflight -- --env-file .env.production`): platform
değişkenlerinden biri doluysa ilgili platformun kimlik + secret çifti, 32 baytlık
`STREAMER_TOKEN_KEY` (`AUTH_SECRET`'tan farklı) ve varsa https `STREAMER_OAUTH_PUBLIC_ORIGIN`
aranır. Hiçbiri yoksa yalnız uyarı verir: yayıncı modu kapalı kalır.

## 3. Açma sırası

1. Değişkenleri `.env.production`'a yaz, `npm run ops:preflight` yeşil olsun.
2. Deploy. `streamer_connections` migration'ı `prisma migrate deploy` ile uygulanır.
3. Admin → Sistem Ayarları → Özellikler → "Yayıncı Modu" anahtarını aç. Kapalıyken
   bağlama düğmeleri gizli, `/streamer` "yakında" der; açılışta süren bağlama istekleri
   callback'te yeniden denetlenir.
4. Ayarlar sayfasında Twitch/Kick satırları görünür. Bağla → platform onayı → "Kanal
   bağlandı" mesajı. `/streamer` "Kanal hazır" der.

## 4. Bakım işi (duran token yaşamaz)

`streamer-connection-hygiene` işi `apps/jobs` içinde çalışır: `STREAMER_CONNECTION_DORMANT_DAYS`
boyunca yayın oturumu açmamış `active` bağlantıların token'ları platformda iptal edilir
(en iyi çaba) ve satır `needs_reconnect` / `dormant` olur; yayıncı Ayarlar'da "Yeniden
bağla" görür. Kuru çalıştırma varsayılandır:

```bash
npm run jobs:run -- streamer-connection-hygiene            # dry run, yalnız sayar
JOBS_ENABLED=true npm run jobs:run -- streamer-connection-hygiene execute
```

Üretimde günde bir `infra/systemd/hushle-streamer-hygiene.timer` (03:40) →
`scripts/ops/run-payment-job.sh streamer-connection-hygiene`. Birim dosyaları
`scripts/ops/install-payment-schedulers.sh` ile kurulur; zamanlayıcı yalnız
`ENABLE_STREAMER_HYGIENE=true scripts/ops/install-payment-schedulers.sh --enable` ile
açılır ve `.env.production` içinde `STREAMER_HYGIENE_SCHEDULE_CONFIGURED=true` ister. Her iptal `streamer.connection.dormant_revoked` audit kaydı bırakır (aktör: system).

Diğer yaşam döngüsü olayları:

- Refresh başarısız (`invalid_grant`): token'lar anında silinir, `needs_reconnect` / `refresh_failed`.
- Platform token uç noktasından 401 (`invalid_client`, yanlış secret) ya da ağ hatası:
  satır dokunulmaz, hata çağırana iletilir; önce yapılandırmayı düzelt.
- Kullanıcı "Kaldır" der: platformda iptal + `revoked` / `user_disconnected`.
- Askıya alma: admin "suspend" işlemi `revokeStreamerConnectionsForUser` ile kullanıcının
  bütün bağlantılarını platformda iptal eder ve `revoked` / `account_closed` yapar; canlı yayın
  oturumu da `stopped` ile biter (§8.5).
- Hesap silme: yalnız e-postası doğrulanmamış hesaplar bakım işiyle silinir; bu hesaplar
  kanal bağlayamaz (`account_not_active`). Veritabanı cascade satırı siler. İleride tam
  bir hesap silme akışı eklenirse silmeden önce `revokeStreamerConnectionsForUser`
  çağrılmalıdır; cascade sonrası platform tarafında iptal mümkün değildir.
- Yeniden bağlama: yeni token'lar yazıldıktan sonra eskileri platformda iptal edilir;
  kanal değiştiyse audit `channel_changed` nedeni taşır.

## 5. Anahtar rotasyonu

1. Yeni anahtar üret: `openssl rand -base64 32`.
2. `.env.production`: eski `STREAMER_TOKEN_KEY` → `STREAMER_TOKEN_KEY_PREVIOUS`, eski sürüm →
   `STREAMER_TOKEN_KEY_PREVIOUS_VERSION`; yeni anahtar → `STREAMER_TOKEN_KEY`,
   `STREAMER_TOKEN_KEY_VERSION` bir artar. Hem app hem jobs konteynerine ulaşır.
3. Deploy. Satırlar tembel yeniden şifrelenir: her refresh'te access ve refresh token
   yeni anahtarla yazılır (`token_key_version` güncellenir).
4. `STREAMER_CONNECTION_DORMANT_DAYS` (90 gün) geçince eski anahtar düşürülebilir:
   o süre içinde kullanılmayan satırları bakım işi zaten iptal etmiştir; kalanlar yeni
   anahtardadır. Eski anahtar erken düşürülürse o satırlar ilk kullanımda
   `needs_reconnect` olur (veri kaybı yok, yayıncı yeniden bağlar).

## 6. Doğrulama ve testler

- Birim: `npm run test:streamer-token-crypto`, `test:streamer-platform-clients`,
  `test:streamer-token-service`, `test:streamer-connect-state`, `test:streamer-connect-flow`,
  `test:streamer-hygiene-job`, `test:streamer-connection-foundation`.
- Veritabanı: `STREAMER_INTEGRATION_DATABASE_URL=<tabu_test> npm run test:streamer-connection-store-integration`
  (`hushle_dev` reddedilir).
- Uçtan uca: sunucu `STREAMER_FAKE_PLATFORM=1` (+ üretim modlu smoke sunucusunda
  `HUSHLE_E2E_SMOKE=1`) ve bir `STREAMER_TOKEN_KEY` ile başlatılır;
  `STREAMER_FAKE_PLATFORM=1 npm run test:streamer-connect-e2e`. Sahte platform
  `/api/streamer/connect/fake/authorize` ile onay ekranını taklit eder; üretimde 404 döner.
- Gerçek Twitch/Kick kabulü elle yapılır: gerçek uygulama kimlikleriyle bağla, Ayarlar'da
  kanal adının geldiğini, `/streamer`'ın açıldığını, "Kaldır" sonrası platform
  "Bağlı uygulamalar" listesinden düştüğünü doğrula. Kick revoke ucu için parametrelerin
  query mi body mi okunduğu bu adımda teyit edilmelidir (kod ikisini de gönderir).

## 7. Bilinen sınırlar

1. aşamada burada sayılan üç eksik 2. aşamada kapandı. Bugünkü davranış:

- **`state` sunucuda da tek kullanımlıktır.** Bağlama başlarken state'in sha256 özeti 10 dakikalığına
  kaydedilir; state'in kendisi hiçbir yerde saklanmaz. Kayıt `REDIS_URL` tanımlı ve Redis cevap
  veriyorsa Redis'te (`SET NX PX`), değilse süreç belleğindedir (en çok 10 000 kayıt). Callback
  çerezi doğruladıktan sonra, kodu platforma vermeden önce kaydı siler; aynı state ikinci kez
  gelirse `state_invalid` döner. Kayıt yazılamazsa bağlama başlamaz.
- **Token yenileme karşılaştır-ve-yaz ile yapılır.** Yeni token'lar yalnız satır hâlâ `active` ise
  ve okunduğu andaki refresh token'ı tutuyorsa yazılır. Bir süreçte aynı bağlantı için aynı anda
  tek platform yenilemesi çalışır; aynı anda gelen çağıranlar onu bekler.
  - Yarışı kaybeden yenileme, satır aynı kanala bağlı ve etkinse kazananın token'ını kullanır;
    kendi taze token'larını iptal etmez (ikisi aynı platform yetkisini paylaşabilir).
  - Satır bu arada başka bir kanala yeniden bağlandıysa çağıran yeniden bağlanma ister, satıra
    dokunulmaz ve kendi taze token'ları platformda iptal edilir (en iyi çaba). Satır artık etkin
    değilse de taze token'lar iptal edilir.
  - Satırın artık tutmadığı bir refresh token için gelen `invalid_grant` yarış kaybıdır, ölü yetki
    sayılmaz. `needs_reconnect` işareti de denenen refresh token'a bağlıdır: arada gelen bir
    yeniden bağlama silinmez.
- **Yayın sürerken kanal bağlantısı saatte bir doğrulanır** (Twitch'in şartı, bkz. §8.5).

Kalan sınırlar:

- Tek yenileme kuralı ve Redis'siz state kaydı süreç başınadır. Tek web replikasıyla (ADR-003) bu
  yeterlidir; ayrı süreçlerdeki yenileme yarışlarını karşılaştır-ve-yaz çözer.
- Platformda iptal sırası: saklı access token, saklı refresh token, ikisi de reddedilirse
  refresh ile taze bir access token alınıp o iptal edilir (Twitch yalnız access token kabul eder).
- `/streamer` her açılışta etkin bağlantıyı doğrular (gerekirse yeniler, Twitch'te
  `/validate` çağırır); geçersiz bağlantı `needs_reconnect` olur.

## 8. Yayın oturumu ve OBS

Kapsam: 2. aşama ([tasarım](../superpowers/specs/2026-11-05-streamer-session-and-screens-design.md),
[plan](../superpowers/plans/2026-11-05-streamer-session-and-screens.md)). Yayıncı `/streamer`
sayfasından oturum açar, OBS'ye yayın ekranı adresini verir ve turları oradan yönetir.
Gerçek sohbet okuma henüz yok (3. aşama); tahmin kaynağı yalnız geliştirme amaçlı sahte sohbettir.

### 8.1 Ön koşullar

- Admin → Sistem Ayarları → Özellikler → "Yayıncı Modu" açık (`streamerModeEnabled`).
- Ayarlar'da en az bir etkin kanal bağlantısı (§3). Bağlantı yoksa oturum kurulamaz
  (`STREAMER_CONNECTION_REQUIRED`).
- Kullanıcı başına aynı anda tek aktif oturum vardır; ikincisi `STREAMER_SESSION_ACTIVE` ile reddedilir.
  Oturum oluşturma kullanıcı başına 15 dakikada 10 ile sınırlıdır. Bitmekte olan (son kaydını
  yazan) bir oturum yeni oturumu engellemez; eski satır yine `ended` olarak kapanır.

### 8.2 Oturum açma ve OBS adresleri

1. `/streamer` → bağlı kanalı, kelime dilini, kategorileri, tur süresini (30–120 sn),
   toleransı (`strict` / `normal`), temayı, kamera yuvasını ve kart arkasını seç, sonra oturumu başlat.
2. "OBS" kutusu dört adres gösterir. Her biri OBS'de bir Tarayıcı Kaynağı olarak eklenir.
   Anahtar adresin sonundadır ve yalnız oturumu açtığın (ya da anahtarı yenilediğin)
   sayfada görünür. Sayfa yenilenirse anahtar gizlenir; yeniden görmek için anahtarı yenile.

| Kaynak | Adres | Tarayıcı Kaynağı boyutu |
| --- | --- | --- |
| Tam ekran sahne | `/stream/<görüntüleme-anahtarı>` | 1920×1080 |
| Yarım ekran sütun | `/stream/<görüntüleme-anahtarı>?layout=half` | 960×1080 |
| Üst şerit | `/stream/<görüntüleme-anahtarı>?overlay=top` | 1920×220 |
| Alt şerit | `/stream/<görüntüleme-anahtarı>?overlay=bottom` | 1920×220 |

Ekranının tamamını yayınlıyorsan panel anahtarı ve kartı yayına çıkarmamana yardım eder:

- Adresler maskeli gelir (`/stream/••••••`, düzen parametresi görünür kalır). Her satırın "Göster"
  düğmesi yalnız o satırı açar, "Gizle" yeniden maskeler; yeni bir anahtar bütün satırları yeniden
  maskeler. "Kopyala" maskeyi açmadan gerçek adresi kopyalar. Maskeli alan seçilemez ve
  sürüklenemez, yani elle kopyalama noktaları almaz; kopyalama başarısız olursa önce "Göster"e bas.
- "Yeni sekmede önizle" tam ekran adresini yeni bir sekmede açar. Adres sayfadaki hiçbir
  bağlantının içinde durmaz; üstüne gelince tarayıcının durum çubuğunda görünmez.
- Kart kutusundaki "Kartı gizle" kelimeyi ve yasaklı kelimeleri sayfadan kaldırır; "Kartı göster"
  geri getirir.

### 8.3 Kamera deliği ölçüleri

Tam ekran sahnede web kamerası için bir delik bırakılır. Ölçüler `x, y` (sol üst köşe) ve
`genişlik×yükseklik` olarak verilir. 1080p sahnenin kendi koordinatıdır; 720p her değerin
2/3'ünün yuvarlanmış halidir. OBS kutusundaki kamera ölçüleri aynı sayıları gösterir.

Köşe yuvalarında (`tl` sol üst, `tr` sağ üst, `bl` sol alt, `br` sağ alt) delik kenarlardan 70 px içeridedir:

| Boy | Yuva | 1080p | 720p |
| --- | --- | --- | --- |
| `s` | `tl` | 70, 70 · 480×270 | 47, 47 · 320×180 |
| `s` | `tr` | 1370, 70 · 480×270 | 913, 47 · 320×180 |
| `s` | `bl` | 70, 740 · 480×270 | 47, 493 · 320×180 |
| `s` | `br` | 1370, 740 · 480×270 | 913, 493 · 320×180 |
| `m` | `tl` | 70, 70 · 560×315 | 47, 47 · 373×210 |
| `m` | `tr` | 1290, 70 · 560×315 | 860, 47 · 373×210 |
| `m` | `bl` | 70, 695 · 560×315 | 47, 463 · 373×210 |
| `m` | `br` | 1290, 695 · 560×315 | 860, 463 · 373×210 |
| `l` | `tl` | 70, 70 · 640×360 | 47, 47 · 427×240 |
| `l` | `tr` | 1210, 70 · 640×360 | 807, 47 · 427×240 |
| `l` | `bl` | 70, 650 · 640×360 | 47, 433 · 427×240 |
| `l` | `br` | 1210, 650 · 640×360 | 807, 433 · 427×240 |

Yarım yuvalarda boy etkisizdir, delik yarım ekranın tamamıdır:

| Yuva | 1080p | 720p |
| --- | --- | --- |
| `left` | 0, 0 · 960×1080 | 0, 0 · 640×720 |
| `right` | 960, 0 · 960×1080 | 640, 0 · 640×720 |

`none` seçilirse delik yoktur. Sayılar yayın ekranının `cameraRect` işlevinden gelir;
ekran ve panel aynı işlevi kullanır.

### 8.4 Anahtarı yenileme

Panelde "Yeni anahtar üret" (onay sorar) yeni bir görüntüleme anahtarı üretir ve dört adresi
günceller. Eski anahtarla açık olan bütün yayın ekranları düşer (`streamer:ended`, neden
`view-key-rotated`); yeni adresleri OBS'de yeniden girmen gerekir. Yayın adresi sızdıysa
bunu kullan. Yenileme host odasını etkilemez: panel açık kalır ve oyun sürer.

Yenileme kullanıcı başına 15 dakikada 10 ile sınırlıdır; panel ve
`POST /api/streamer/sessions/current/view-key` aynı kotayı paylaşır. Veritabanı yeni anahtarı
10 saniyede yazamazsa `SERVER_BUSY` döner ve eski anahtar geçerli kalır.

### 8.5 Kesinti, boşta kapanma ve bitiş

Oturum aşağıdaki yollardan biriyle kapanır. Her birinde panel ve yayın ekranı `streamer:ended`
alır, iki oda da boşaltılır ve görüntüleme anahtarı geçersiz olur. Yayın ekranı bundan sonra
yeniden bağlanmaz, çevrimdışı sahnesinde kalır.

| Neden | Ne zaman | Satır |
| --- | --- | --- |
| `ended` | Yayıncı "Oturumu bitir"e basar ya da `POST /api/streamer/sessions/current/end` çağrılır. | `ended`, özetle |
| `idle` | 6 saat boyunca etkinlik olmaz. | `ended`, özetle |
| `stopped` | Admin yayıncı modunu kapatır ya da kullanıcıyı askıya alır. | `ended`, özetle |
| `interrupted` | Sunucu düzgün kapanır (deploy, `SIGTERM` / `SIGINT`). | `interrupted` |

- **Bitirince:** oturum kapanır, kelime havuzu temizlenir, ilk 10 sıra ve katılımcı sayısı
  özet olarak kaydedilir. Oturumu bitirmek yayıncı modu kapalıyken de serbesttir.
- **6 saat boşta:** etkinlik sayılanlar yayıncının panelden yaptığı her işlem (yanlış anda yapılıp
  reddedilenler dahil) ve turun kabul ettiği tahminlerdir (yanlış ya da doğru). Tur kapalıyken
  gelen, eski, tekrarlanan ya da geçersiz sohbet mesajları ve saat tıkları oturumu açık tutmaz.
- **Sunucu düzgün kapanırsa:** bekleyen işlemler en çok 10 saniye beklenir; zaten bitmekte olan
  bir oturum `ended` olarak tamamlanır. Kalan oturumlarda iki oda önce `interrupted` alır, sonra
  satırlar `interrupted` yazılır ve soketler kapanır.
- **Süreç çökerse:** oturumlar bellekte tutulur (tek web replikası); sonraki açılışta `active`
  kalmış bütün satırlar `interrupted` olur.
- Panel kesilen oturumu kesildiği andan itibaren 24 saat "Oturum yarıda kesildi" diye gösterir ve
  yeni oturum açmayı önerir; daha eski bir kesinti gösterilmez.
- **Yayıncı modu kapatılırsa (acil durdurma):** sunucu anahtarı 15 saniyede bir okur ve okunan
  değeri 5 saniye saklar; kapalı okununca bütün canlı oturumlar en geç yaklaşık 20 saniye içinde
  `stopped` ile biter. Mod kapalıyken yeni oturum, anahtar yenileme ve test-guess
  `STREAMER_MODE_DISABLED` (403) alır; host katılımı ve oturumu bitirme dışındaki host olayları da
  aynı kodu alır; yayın ekranı katılımı yanlış anahtarla aynı yanıtı (`STREAMER_VIEW_KEY_INVALID`)
  alır. `/streamer` "Yayıncı modu yakında" der. Veritabanı cevap vermezse anahtar "bilinmiyor"
  sayılır: hiçbir oturum durdurulmaz ve soket istekleri reddedilmez; yeni oturum açma ise kapalı
  kabul edilir.
- **Askıya alma:** admin bir kullanıcıyı askıya alınca önce kanal bağlantıları platformda iptal
  edilir, sonra canlı oturumu `stopped` ile biter. Bitiş en çok 10 saniye beklenir (son çare
  sınırı 21 saniye): oturum takılı kalsa da audit kaydı yazılır ve oturum kendi sırasında biter.
  Panel "Yayın oturumu sistem tarafından durduruldu." der.
- **Çıkış cihaz başınadır:** çıkış yalnız o cihazın oturum çerezini siler; başka bir cihazda ya da
  açık kalmış bir panel sekmesinde süren yayını durdurmaz. Yayını bitirmek için panelde "Oturumu
  bitir"i kullan. Parola sıfırlama ve e-posta değişikliği ise kullanıcının bütün soketlerini
  (panel dahil) düşürür; yayın sürer, yeniden giriş yapınca panelden bitirilebilir.
- **Saatlik kanal doğrulaması:** oturum sürerken açıldığı kanal bağlantısı saatte bir doğrulanır
  (gerekirse token yenilenir, Twitch'te `/validate` çağrılır). Bağlantı artık geçerli değilse
  satır `needs_reconnect` olur ve oturum sürer; panel bir kez haber alır ve sayfa açık kaldıkça
  "Kanal bağlantın yenilenmeli; bu yayın sürüyor, yeni oturum için ayarlardan yeniden bağlan."
  uyarısını "Ayarlar'a git" bağlantısıyla gösterir. Bağlantı bu arada başka bir kanala yeniden
  bağlandıysa da aynı uyarı çıkar (oturum eski kanal için açılmıştı). Geçici platform hataları
  bir şey değiştirmez. `/streamer` açılırken canlı oturumun platformunda etkin bağlantı yoksa
  panel yine açılır, aynı uyarıyı gösterir ve başlığı "Kanal bağlantını yenile" olur.
- **Kelime çekimi:** kelime havuzu 10 saniyede cevap vermezse "Turu başlat", "Sonraki kart" ve
  "Pas geç" `SERVER_BUSY` alır; oturum olduğu gibi kalır, tekrar denenebilir.
- **Sürüm yenilemesi:** deploy sunucunun soket protokolünü değiştirdiyse açık OBS sayfası el
  değmeden kendini yeniler: 30 sn, 60 sn, 120 sn, sonra her 300 sn'de bir, bir bağlantı kabul
  edilene kadar. Sayaç tarayıcı oturumunda tutulur (yalnız sayı, anahtar değil). Sunucu yeniden
  başladıysa oturum zaten `interrupted` olduğundan sayfa çevrimdışı kalır; anahtar hâlâ geçerliyse
  yayın kaldığı yerden sürer.
- Veritabanında yalnız oturum ve tur sonuçları (kazanan, süre) tutulur; ham sohbet ve
  yanlış tahminler yazılmaz.

### 8.6 Yayın vitrini anahtarı

Admin sistem ayarlarındaki `streamerShowcaseAllCosmetics` (varsayılan kapalı) yalnız yayın
ekranının kart arkası seçimini etkiler. Kapalıyken yayıncı kendi envanterindeki koleksiyonlardan
seçer; açıkken bütün koleksiyonlar seçilebilir. Seçim sunucuda da doğrulanır: ayar kapalıyken
sahip olunmayan koleksiyon `STREAMER_CARD_NOT_ALLOWED` ile reddedilir. Normal oyun odaları
her durumda yalnız sahip olunan kozmetikleri kullanır.

Anahtar canlı oturumlara geriye dönük uygulanmaz: açıkken seçilmiş, sahip olunmayan bir kart
arkası, yayıncı başka bir kart arkası seçene ya da oturum bitene kadar ekranda kalır. Her yeni
seçim o anki ayara göre doğrulanır.

Kart arkası yayına sınırlanmış olarak çıkar; sınırlar yayın ekranının çizdikleridir. Renkler
yalnız 3 ya da 6 haneli hex olabilir (değilse varsayılan renk); desen ve hareket sabit listeden
gelir (değilse `none`); sayılar aralığa kısılır (desen ölçeği 8–42 px, hareket süresi
1800–12000 ms, parlama bulanıklığı 8–56; desen, parlama ve kaplama opaklığı en çok 0,42, 0,36 ve
0,45). Görsel adresi yalnız aynı sitedeki bir yol (`/…`) ya da kullanıcı adı ve parola taşımayan
bir `https` adresi olabilir, en çok 2048 karakter; ad en çok 60 karakterdir. Bilinmeyen alanlar
hiç gönderilmez.

### 8.7 Sahte platform ve test-guess (yalnız geliştirme)

`STREAMER_FAKE_PLATFORM=1` yalnız geliştirme ve test içindir; üretim ön kontrolü bu değerde
durur. Açıkken:

- `POST /api/streamer/sessions/current/test-guess` gövdesi `{ "name": "...", "text": "..." }`
  ile etkin oturuma sahte bir izleyici tahmini gönderir (kullanıcı başına dakikada 120 istek).
  Bayrak kapalıyken (üretim) bu uç 404 döner.
- `?demo=` yayın ekranı sahneleri (galeri ve ekran görüntüsü testleri) çalışır.

Gerçek sohbet 3. aşamada aynı tahmin arayüzünden (`ChatGuess`) gelecek; bu uçlar o zaman da
yalnız test içindir.

### 8.8 Güvenlik notları

- Kelime ve yasaklı kelimeler tur bitmeden public odaya, yayın sayfasının HTML'ine ya da
  `streamer:public:state` mesajına çıkmaz; kart yalnız host odasındadır. Sunucu, yayına
  giden her durumu göndermeden önce denetler ve ihlalde düşürür. Public oda
  yayıncı kartını tur bitene kadar hiçbir zaman almaz.
- Görüntüleme anahtarı 32 bayt rastgeledir; veritabanında yalnız sha256 özeti saklanır.
  Anahtar log'a ve audit'e yazılmaz. Anahtar adresin yolunda durur, çünkü OBS kaynağı sabit bir
  adres ister. Yayın ekranı gizli bir şey göstermez: sızan bir anahtar yalnız herkese açık yayın
  görüntüsünü, yayın gecikmesinden birkaç saniye önce gösterir. Sızdıysa anahtarı yenile (§8.4).
- Host olayları yalnız oturum sahibindendir. Host odasına katılırken oturum çerezi
  (`sessionVersion` dahil) ve askıya alma denetlenir; her olayda soketin bu oturumun host
  odasında olduğu ve sahibin aynı kullanıcı olduğu denetlenir.
- Sınırlar:

| Ne | Sınır |
| --- | --- |
| Oturum açma | kullanıcı başına 15 dakikada 10 |
| Anahtar yenileme | kullanıcı başına 15 dakikada 10 (panel ve HTTP ucu aynı kotayı paylaşır) |
| Host olayları | soket başına 10 saniyede 10; host odasına katılmış sokette ayrıca kullanıcı başına 10 saniyede 10 (ikinci sekme aynı kotayı paylaşır) |
| Host odasına katılım | soket başına 10 saniyede 10 |
| Yayın ekranına katılım | IP başına dakikada 30 |
| test-guess (yalnız geliştirme) | kullanıcı başına dakikada 120 |
| Sohbetten izlenen oyuncu | oturum başına en çok 2000 |

- Oyuncu sınırı 2000'e ulaşınca yeni bir oyuncu için puanı olmayan, en uzun süredir sessiz oyuncu
  bırakılır; izlenenlerin hepsi puanlıysa yeni gelenin tahmini alınmaz. Panelde ve özette görünen
  katılımcı sayısı (`participants`) oturum boyunca tahmini kabul edilen kişi sayısıdır: her yeni
  kişi bir sayılır, bırakılıp geri gelen yeniden sayılır.

### 8.9 Testler

- Birim: `npm run test:domain-streamer`, `test:streamer-session-service`,
  `test:streamer-card-backs`, `test:streamer-session-foundation`,
  `test:streamer-socket-integration`, `test:stream-screen`, `test:streamer-panel`.
- Veritabanı: `STREAMER_INTEGRATION_DATABASE_URL=<tabu_test> npm run test:streamer-session-store-integration`.
- Uçtan uca: §6'daki sunucu ayarlarıyla (`STREAMER_FAKE_PLATFORM=1`, `HUSHLE_E2E_SMOKE=1`,
  `STREAMER_TOKEN_KEY`) ve Playwright sürecinde `DATABASE_URL` ile
  `npm run test:streamer-stream-screen-e2e` ve `npm run test:streamer-session-e2e`.
  Üç yayıncı e2e betiği (`test:streamer-connect-e2e` dahil) genel `features` sistem ayarını
  değiştirir; bu yüzden `--workers=1` ile ve art arda çalışır, paralel koşulmamalıdır.
