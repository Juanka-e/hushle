# Yayıncı Platform Bağlantıları (Twitch + Kick) Tasarımı

Tarih: 5 Kasım 2026. Durum: sohbette alınan kararlar (5 Kasım); uygulama onayı plan
incelemesiyle verilecek.

Bu belge yayın sisteminin **1. aşamasıdır**: yayıncının Twitch ya da Kick kanalını
Hushle hesabına bağlaması, token'ların güvenli saklanması, bağlantının bakımı ve
yayıncı panelinin bu bağlantıyla açılması. Oyun oturumu, yayın ekranı ve sohbet
okuma sonraki aşamaların belgeleridir. Araştırma: [platform OAuth notu](../../stream/platform-oauth-arastirmasi.md);
çerçeve: [çoklu platform planı](../../stream/multi-platform-streamer-plan.md).

## Problem

Yayıncı modu için önce "bu hesap şu kanalın sahibi" kanıtı ve platforma sunucu
tarafından erişim gerekir. Bugün yalnız Google ile giriş var (`OAuthAccount`); o
akış kimlik doğrulama içindir, token saklamaz ve kaldırılabilir bir "kanal izni"
kavramı yoktur.

## Hedef

Giriş yapmış bir kullanıcı Ayarlar'dan Twitch ya da Kick kanalını bağlar; Hushle
kanal kimliğini (id, kullanıcı adı, görünen ad, avatar, kanal adresi) ve platform
token'larını şifreli saklar; bağlantı kendini yeniler, bozulursa ya da uzun süre
kullanılmazsa iptal edilir; yayıncı paneli yalnız etkin bağlantısı olanlara açılır.

## Kapsam dışı (sonraki aşamalar)

- Yayın oturumu, kelime seçimi, tur, puan (2. aşama: `domain-streamer`).
- Yayın ekranı ve OBS kaynaklarının üretime taşınması (2. aşama; tasarım
  `scripts/design-prototypes/hushle-streamer-studio`).
- Sohbet okuma: Twitch EventSub WebSocket, Kick webhook (3. aşama).
- YouTube (ayrı aşama; hassas kapsam incelemesi gerektirir).
- Yayıncıya ödül, coin, mağaza ilişkisi (yok).

## Kararlar

1. **Giriş OAuth'undan ayrı.** `OAuthAccount` dokunulmaz. Yeni tablo
   `streamer_connections`, `user_id` ile `users`'a bağlı. Auth.js provider'ı
   eklenmez; bağlantı akışı kendi uç noktalarıyla yürür (giriş sayfasında Twitch/Kick
   düğmesi çıkmaz).
2. **Rol yok.** Panel erişimi `status = active` bir bağlantı kaydına bağlıdır.
   Beta için kişi başı bayrak yok; sistem ayarı `streamerModeEnabled` (varsayılan
   kapalı) bağlama ve paneli topluca açar/kapar.
3. **Token'lar uygulama anahtarıyla şifreli.** AES-256-GCM, anahtar ortam
   değişkeninden (`STREAMER_TOKEN_KEY`, 32 bayt base64), kayıtta anahtar sürümü.
   Token hiçbir API yanıtına, UI'a, log'a ve audit metadata'sına çıkmaz.
4. **Bir kez bağla; duran token yaşamaz.**
   - Access token süresi dolunca ya da 401'de refresh ile yenilenir.
   - Refresh başarısız olursa token'lar o an silinir, kayıt `needs_reconnect`
     olur; kanal adı ve avatar kalır (tek tıkla yeniden bağlama).
   - 90 gün hiç kullanılmayan bağlantı platformda iptal edilir, token'ları silinir,
     kayıt `needs_reconnect` olur (bakım işi günde bir).
   - Kullanıcı "kaldır" derse, hesap silinirse ya da askıya alınırsa: platformda
     iptal + token silme, kayıt `revoked`.
   - Kapsam genişlerse (ileride sohbet okuma) yeniden onay istenir; eski kayıt
     bozulmaz.
5. **Bir kullanıcı, platform başına bir kanal; bir kanal, tek kullanıcı.**
   Başka bir Hushle hesabına bağlı platform hesabı reddedilir (sessiz birleştirme
   yok). Platform hesabının e-postası hiçbir eşleştirmede kullanılmaz.
6. **Platform ayrıntıları adaptörde.** Ortak arayüz: yetki adresi, kod takası,
   yenileme, iptal, kimlik çekme. Twitch: authorization code + `state`; Kick: aynı +
   PKCE S256 (zorunlu) + client secret. Twitch için saatlik `/validate` şartı
   panel açıkken ve yayın sürerken uygulanır (2. aşama bunu oturuma bağlar; bu
   aşamada panel açılışında doğrulanır).
7. **Kapsamlar en az.** Twitch: boş (kimlik için kapsam gerekmez). Kick:
   `user:read channel:read`. Sohbet kapsamları 3. aşamada artımlı istenir.
8. **Test edilebilirlik.** Sahte platform adaptörü yalnız test ortamında
   (`STREAMER_FAKE_PLATFORM=1` ve `NODE_ENV !== 'production'`); Playwright akışı
   gerçek Twitch/Kick'e çıkmadan uçtan uca çalışır. Gerçek platform kabulü ayrı,
   elle yapılan bir adımdır.

## Veri modeli

`streamer_connections` (yeni):

| Alan | Açıklama |
| --- | --- |
| `id` | Int, otomatik |
| `user_id` | `users.id`; silinince cascade |
| `platform` | enum `twitch` / `kick` |
| `platform_user_id` | Platformun kullanıcı kimliği (string) |
| `login` | Twitch `login` / Kick `slug` |
| `display_name`, `avatar_url`, `channel_url` | Görsel anlık görüntü; her bağlanmada tazelenir |
| `scopes` | Verilen kapsamlar, boşlukla ayrılmış |
| `access_token_enc`, `refresh_token_enc` | Şifreli; `needs_reconnect` / `revoked` durumunda NULL |
| `token_key_version` | Şifreleme anahtarı sürümü |
| `access_token_expires_at` | Platformun `expires_in` değerinden |
| `status` | enum `active` / `needs_reconnect` / `revoked` |
| `status_reason` | `refresh_failed` / `dormant` / `user_disconnected` / `account_closed` / `scope_change` |
| `last_validated_at`, `last_used_at`, `connected_at`, `revoked_at` | Zamanlar |

Tekillikler: `(platform, platform_user_id)` ve `(user_id, platform)`.

Audit olayları (metadata'da token yok): `streamer.connection.linked`,
`streamer.connection.relinked`, `streamer.connection.disconnected`,
`streamer.connection.refresh_failed`, `streamer.connection.dormant_revoked`.

## Akış

1. `GET /api/streamer/connect/{platform}/start`: oturum, askıya alınmamış hesap,
   `streamerModeEnabled`, hız sınırı. `state` (32 bayt rastgele) ve Kick için PKCE
   verifier üretilir; `{state, verifier, userId, platform, iat}` HMAC imzalı,
   `httpOnly`, `SameSite=Lax`, 10 dakikalık çerezde taşınır. Platforma yönlendirme.
2. `GET /api/streamer/connect/{platform}/callback`: çerez var, imza doğru, süresi
   geçmemiş, `state` eşit, oturumdaki kullanıcı çerezdeki kullanıcıya eşit; çerez
   hemen silinir (tek kullanım). Kod takası; kimlik çekme; başka kullanıcıya bağlı
   mı kontrolü; kayıt upsert (`active`, token'lar şifreli); audit; Ayarlar'a
   `?streamer=linked` ile dönüş. Hata durumunda `?streamer=error&code=...`
   (platform hata metni asla yansıtılmaz).
3. `POST /api/streamer/connections/{platform}/disconnect`: oturum, güvenilir
   Origin, hız sınırı, sahiplik; platformda revoke (hata olsa da devam), token
   silme, `revoked`, audit.
4. `GET /api/streamer/connections`: kullanıcının bağlantıları (platform, login,
   display_name, avatar_url, channel_url, status, connected_at). Token yok.
5. Token servisi (sunucu içi): `getAccessToken(connection)`; süresi 60 sn içinde
   dolacaksa ya da 401 gelirse refresh; refresh 400/401 verirse karar 4'teki
   `needs_reconnect` yolu.
6. Bakım işi: günde bir `dormant` taraması (`last_used_at` ya da yoksa
   `connected_at` 90 günden eski ve `active`).
7. `/streamer` sayfası: `streamerModeEnabled` kapalıysa "yakında"; bağlantı yoksa
   Ayarlar'a yönlendiren açıklama; `needs_reconnect` ise uyarı; `active` ise bu
   aşamada yalnız "kanal hazır" özeti (gerçek panel 2. aşama).

## Güvenlik kontrol listesi (her adımda doğrulanır)

- `state` tek kullanımlık, kullanıcıya bağlı, 10 dakika; tahmin edilemez.
- Callback'te oturum ve çerez kullanıcı eşleşmesi; eşleşmezse bağlanmaz.
- Platform hesabı başka kullanıcıdaysa red; e-posta ile eşleştirme yok.
- Token'lar yalnız sunucuda, şifreli; yanıt/log/audit'te yok; anahtar sürümü ile
  rotasyon mümkün.
- Askıya alınmış kullanıcı bağlayamaz; hesap silinince cascade + platform iptali.
- Hız sınırı: start kullanıcı başına (15 dk / 10), callback IP başına (15 dk / 10;
  bu aşamada oturum zaten doğrulanmış olur), disconnect kullanıcı başına (15 dk / 5).
- `state` tek kullanımlığı çerezin callback'te silinmesine dayanır; sunucu tarafında
  kullanılmış state kaydı (Redis set-if-absent) tutulmaz. Yakalanmış çerez + state
  en çok 10 dakika ve yalnız kurbanın oturumuyla tekrar oynatılabilir; sonraki
  aşamada Redis guard eklenebilir.
- POST uçları güvenilir Origin ister; GET callback yalnız yönlendirme yapar,
  yanıt gövdesinde veri yok.
- Yönlendirme hedefi sabit (Ayarlar); açık yönlendirme yok.
- Platform hata metinleri ve yanıt gövdeleri kullanıcıya ve log'a ham geçmez.
- Secret'lar ortam değişkeninde; production preflight üçünü de (Twitch, Kick,
  token anahtarı) ya da açık "kapalı" politikasını ister.
- Sahte adaptör production'da derlense bile etkinleşemez.

## Yapılmayacaklar

- Platform token'ını istemciye vermek (overlay dahil).
- Twitch/Kick ile giriş (login) sunmak.
- Kick'in gayriresmî Pusher soketi.
- Kullanıcı başına beta bayrağı.
