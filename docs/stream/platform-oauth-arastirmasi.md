# Twitch, Kick ve YouTube Bağlantısı: OAuth ve Sohbet Araştırması

Tarih: 5 Kasım 2026

Durum: Araştırma notu. Resmi geliştirici belgeleri o gün okunarak derlendi;
her madde kaynağını taşır. Doğrulanamayan maddeler **DOĞRULANMADI** diye
işaretlidir. Uygulama kararı değildir; [çoklu platform planı](./multi-platform-streamer-plan.md)
için girdidir.

Hushle'ın ihtiyacı: (1) yayıncının kim olduğunu kanıtlamak ve kanal adı, görünen
ad, avatar, kanal adresini almak; (2) sonraki aşamada sohbeti okumak (izleyici
tahminleri) ve yayının açık olup olmadığını bilmek. Platformlara hiçbir şey
yazılmaz.

## 1. Twitch

**Kayıt.** Konsol: <https://dev.twitch.tv/console>. E-postası doğrulanmış hesap
ve **2FA zorunlu**. Uygulama adı Twitch genelinde benzersiz olmalı; Client ID
açık, Client Secret kod akışı için gerekli
([kayıt](https://dev.twitch.tv/docs/authentication/register-app/)). Yönlendirme
adresi için HTTPS şartı yazmıyor; resmi başlangıç rehberi `http://localhost:3000`
kaydettiriyor ([başlangıç](https://dev.twitch.tv/docs/api/get-started/)).
İstemci türü: "Confidential" (refresh token süresiz; secret gerekli) ya da
"Public" (refresh token 30 günde düşer)
([yenileme](https://dev.twitch.tv/docs/authentication/refresh-tokens/)).
Giriş için uygulama incelemesi yok; "doğrulanmış" kavramı yalnız sohbet botları
için ve şu an duraklatılmış ([sohbet](https://dev.twitch.tv/docs/chat/)).

**Akış.** Yetki: `https://id.twitch.tv/oauth2/authorize` (`client_id`,
`redirect_uri`, `response_type=code`, boşlukla ayrılmış `scope`, `state`
şiddetle önerilir, `force_verify`). Token: `POST https://id.twitch.tv/oauth2/token`
(`client_secret` ile). Yanıt: `access_token`, `expires_in`, `refresh_token`,
`scope[]` ([token alma](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/)).
PKCE resmi belgelerde geçmiyor (**DOĞRULANMADI**); secret'lı kod akışı planlanmalı.
Erişim token ömrü sabit değil (örnek ≈ 3,9 saat); Twitch "önceden yenileme,
401'de yenile" diyor. Refresh token döner (yenisi saklanmalı), bir refresh token
en çok 50 canlı access token besler; parola değişimi ya da bağlantı kesme
hepsini öldürür.

**Zorunlu doğrulama.** `GET https://id.twitch.tv/oauth2/validate`
(`Authorization: OAuth <token>`): uygulama açılışta ve **her saat** token
doğrulamak zorunda; Twitch denetliyor, uymayanı kısabilir ya da iptal edebilir
([doğrulama](https://dev.twitch.tv/docs/authentication/validate-tokens/)).
İptal: `POST https://id.twitch.tv/oauth2/revoke`.

**OIDC.** Var. Keşif `https://id.twitch.tv/oauth2/.well-known/openid-configuration`,
JWKS `https://id.twitch.tv/oauth2/keys`, RS256. `openid` kapsamı, `nonce`
önerilir. Varsayılan claim'ler `aud, azp, exp, iat, iss, sub`; `claims`
parametresiyle `email, email_verified, picture, preferred_username, updated_at`
istenebilir (e-posta için ayrıca `user:read:email`)
([OIDC](https://dev.twitch.tv/docs/authentication/getting-tokens-oidc/)).

**Kapsamlar.** Kimlik için **kapsam gerekmez** (e-posta istenirse
`user:read:email`). Sohbet okuma (EventSub): `user:read:chat`. IRC: `chat:read`.
Yayın durumu: kapsam yok ([kapsamlar](https://dev.twitch.tv/docs/authentication/scopes/)).

**Kimlik çağrısı.** `GET https://api.twitch.tv/helix/users` (kullanıcı token'ı,
parametresiz → kendisi). Alanlar: `id, login, display_name, broadcaster_type,
description, profile_image_url, offline_image_url, created_at`. `Authorization:
Bearer` **ve** `Client-Id` başlıkları zorunlu
([Get Users](https://dev.twitch.tv/docs/api/reference/#get-users)). Kanal adresi
`https://twitch.tv/<login>` (gelenek).

**Yayın durumu.** `GET helix/streams?user_id=…` (kapsam yok; `type: "live"`,
`viewer_count`, `started_at`). EventSub `stream.online` / `stream.offline`:
yetki gerekmez
([abonelik türleri](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/)).

**Sohbet.** EventSub `channel.chat.message` v1: sohbet eden kullanıcının
`user:read:chat` kapsamı; uygulama token'ıyla ayrıca `user:bot` + yayıncıdan
`channel:bot` gerekir. WebSocket `wss://eventsub.wss.twitch.tv/ws`: abonelikler
**kullanıcı token'ı** ister; Welcome'dan sonra 10 sn içinde abone olunmalı; en
çok 3 bağlantı, bağlantı başına 300 abonelik, maliyet tavanı 10; `reconnect`
mesajı işlenmeli; kaçan olay tekrar gönderilmez
([WebSocket](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/)).
IRC hâlâ çalışıyor ama Twitch "tercih edilen yol EventSub" diyor
([IRC](https://dev.twitch.tv/docs/chat/irc/)). Helix hız sınırı: istemci başına
token kovası, 429 ve `Ratelimit-*` başlıkları
([rehber](https://dev.twitch.tv/docs/api/guide/)).

**Politika ve marka.** Geliştirici sözleşmesi (<https://legal.twitch.com/legal/developer-agreement/>):
iptal, yetki daralması ya da istek üzerine tüm Twitch verisi silinir; herkese
açık gizlilik politikası şart; veri satışı yok; önbellek en çok 24 saat; hız
sınırı aşılmaz; markalar yalnız kaynak belirtmek için. Marka kuralları
(<https://www.twitch.tv/p/en/legal/trademark/>): "Twitch ile uyumlu" denebilir,
logo değiştirilemez, ortaklık ima edilemez, ürün adında Twitch geçemez.
Resmi görseller yalnız ZIP olarak <https://brand.twitch.com/>; mor `#9146FF`
resmi bir sayfadan **DOĞRULANMADI**. "Twitch ile giriş" düğme şartnamesi yok.

## 2. Kick

**Kayıt ve platform durumu.** Uygulama kick.com → Ayarlar → Developer'dan
açılır; **2FA zorunlu**; yönlendirme adresi girilir, Client ID + Secret alınır;
sayfa akışı "OAuth 2.0 Code Grant + PKCE" diye tanımlar (yan menüde "OAuth 2.1")
([kurulum](https://docs.kick.com/getting-started/kick-apps-setup)). HTTPS/localhost
kuralı yazmıyor. Platform aktif geliştiriliyor (25.11.2025 "refresh token'lar
yeniden kullanılabilir", 02.12.2025 uygulama silme) ([docs.kick.com](https://docs.kick.com/)).
Yayın öncesi inceleme belgelenmemiş; sözleşme Kick'e "herhangi bir uygulamayı
reddetme" hakkı verir (§3.5). İsteğe bağlı **uygulama doğrulaması**
(developers@kick.com'a Client ID, ad, gerekçe, kanıt): doğrulanmış bot rozeti ve
`chat.message.sent` abonelik tavanını 1.000'den 10.000'e çıkarır
([SSS](https://docs.kick.com/apis/faqs), [abonelik](https://docs.kick.com/events/subscribe-to-events)).

**Akış.** Yetki `GET https://id.kick.com/oauth/authorize` (`client_id`,
`response_type=code`, `redirect_uri`, `state` şu an zorunlu, `scope`,
`code_challenge`, `code_challenge_method=S256`). Token `POST
https://id.kick.com/oauth/token`: `code_verifier` **ve** `client_secret` birlikte
(PKCE + secret). Yenileme aynı uç nokta (`grant_type=refresh_token`, yeni access
+ refresh döner). İptal `POST /oauth/revoke`; introspect `POST
/oauth/token/introspect` (`active, client_id, scope, exp`). Uygulama token'ı
`client_credentials`. Yönlendirme adresi birebir eşleşmeli
([token akışı](https://docs.kick.com/getting-started/generating-tokens-oauth2-flow)).
Token ömürleri **DOĞRULANMADI** (`expires_in` dönüyor, değer belgelenmemiş; üçüncü
taraf rehberler ≈ 1 saat diyor). OIDC / id_token yok.

**Kapsamlar.** Kimlik `user:read`; kanal bilgisi ve canlı bayrağı
`channel:read`; sohbet okuma `events:subscribe` (ayrı okuma kapsamı yok;
`chat:write` yalnız yazma) ([kapsamlar](https://docs.kick.com/getting-started/scopes)).

**Kimlik, kanal, canlı.** `GET https://api.kick.com/public/v1/users` (id'siz →
yetkili kullanıcı): `user_id, name, email, profile_picture`
([users](https://docs.kick.com/apis/users)). `GET /public/v1/channels`
(parametresiz → kendi kanalı): `broadcaster_user_id, slug` (adres
`https://kick.com/<slug>`), `channel_description, banner_picture, stream_title,
category{}, stream{is_live, viewer_count, start_time}`
([channels](https://docs.kick.com/apis/channels)). Canlı için ayrıca
`/public/v1/users/livestreams?user_id=` ve `/public/v2/livestreams`;
`/public/v1/livestreams` kullanımdan kalktı ([livestreams](https://docs.kick.com/apis/livestreams)).

**Sohbet.** Resmi yol **yalnız webhook** (`method` tek değer: `"webhook"`).
`POST /public/v1/events/subscriptions` (`events:subscribe`); `chat.message.sent`
v1: `message_id, content, emotes[], sender{user_id, username, profile_picture,
identity{username_color, badges}}, broadcaster{}, created_at`;
`livestream.status.updated`: `is_live, title, started_at, ended_at`. Sınır:
olay türü başına 10.000 abonelik; doğrulanmamış uygulamada sohbet için 1.000
([olay türleri](https://docs.kick.com/events/event-types)). Webhook adresi
uygulamada "Enable Webhooks" ile tanımlanır, dışarıdan erişilebilir olmalı
(localhost için tünel); HTTPS şartı yazmıyor. Yük RSA-SHA256 imzalı
(`Kick-Event-Signature`, `Kick-Event-Message-Id`, `Kick-Event-Message-Timestamp`;
anahtar `GET /public/v1/public-key`, sabit kodlanmaz); bir günden uzun süre
düşen webhook otomatik aboneliksiz kalır
([giriş](https://docs.kick.com/events/introduction), [imza](https://docs.kick.com/events/webhook-security)).
Sohbet mesajı listeleyen REST ucu yok ([chat](https://docs.kick.com/apis/chat)).
Gayriresmî Pusher soketi topluluk araçlarında hâlâ var ama anahtar habersiz
dönüyor; sözleşme "belgelenmemiş materyale erişim" ve kazımayı yasaklıyor (§10.1,
§3.5) ([sözleşme](https://dev.kick.com/terms-of-service)). Uyumlu üründe
kullanılamaz. REST hız sınırları **DOĞRULANMADI** (belgede yok).

**Politika, marka, Türkiye.** Sözleşme: herkese açık gizlilik politikası; Kick
verisi satılmaz; iptal/yetki daralması/istek üzerine silme; önbellek en çok 24
saat; sohbet kayıtları "gerektiği kadar"; markalar yalnız kaynak belirtmek için;
hizmet Kick'in faaliyet gösterdiği her ülkede yasal olmalı. Açık bir marka
kılavuzu bulunamadı (**DOĞRULANMADI**). Türkiye: Şubat 2024'te erişim engeli,
kumar içeriği kaldırılınca günler içinde açıldı; Twitch daha uzun süre kapalı
kaldı (haber kaynakları). Güncel düzenleyici durum resmi kaynaktan **DOĞRULANMADI**.

## 3. YouTube / Google

**Kayıt.** Google Cloud projesi + OAuth onay ekranı. Dış kullanıcı tipi;
**Testing** durumunda en çok 100 test kullanıcısı, "doğrulanmamış uygulama"
uyarısı ve verilen izin (refresh token dahil) **7 günde düşer** (yalnız
ad/e-posta/profil kapsamlarıysa düşmez); **In production** herkes girer ama
doğrulama gerekebilir ([yayın durumu](https://support.google.com/cloud/answer/15549945)).
Yönlendirme adresi HTTPS (localhost hariç), ham IP yok, tam eşleşme, joker yok
([web-server](https://developers.google.com/identity/protocols/oauth2/web-server)).
Doğrulama: hassas olmayan kapsamlar için zorunlu değil; marka doğrulaması
(ad/logo göstermek için) otomatik dakikalar, elle 2–3 iş günü. Hassas kapsam
incelemesi yaklaşık 10 iş günü (kısıtlı: 6 hafta); doğrulanmamış uygulama hassas
kapsamla proje ömrü boyunca **100 yeni kullanıcı** ile sınırlı. Şartlar: Search
Console'da doğrulanmış alan adı, herkese açık ana sayfa (yalnız giriş sayfası
olmaz), aynı alanda gizlilik politikası (onay ekranında bağlantılı), kapsam
gerekçesi, demo video ([doğrulama](https://support.google.com/cloud/answer/13463073),
[hassas kapsam](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification),
[100 kullanıcı sınırı](https://support.google.com/cloud/answer/7454865)).
`youtube.readonly` kapsamının "hassas" sayılıp sayılmadığı Google metninden
**DOĞRULANMADI**; satıcı kaynakları tüm YouTube kullanıcı verisi kapsamlarını
hassas sayıyor ve Console kapsamı eklerken sınıfı gösteriyor. Hassas kapsam
incelemesi planlanmalı.

**Akış.** Yetki `https://accounts.google.com/o/oauth2/v2/auth`; token
`https://oauth2.googleapis.com/token`; iptal `https://oauth2.googleapis.com/revoke`;
`state` önerilir; refresh token için `access_type=offline` (yalnız ilk onayda
döner; yenisi için `prompt=consent`); `include_granted_scopes=true` ile artımlı
yetki. Refresh token ölümü: Testing'de 7 gün; 6 ay kullanılmazsa; istemci başına
hesapta 100'den fazla refresh token (en eskisi sessizce düşer); parola değişimi
(Gmail kapsamları). Erişim token'ı ≈ 1 saat
([OAuth2](https://developers.google.com/identity/protocols/oauth2)). OIDC:
`openid email profile`; keşif `https://accounts.google.com/.well-known/openid-configuration`;
claim'ler `sub, email, email_verified, name, picture, given_name, family_name,
locale, hd` ([OIDC](https://developers.google.com/identity/openid-connect/openid-connect)).
Politika: gömülü webview yok; ortam başına ayrı proje; en az kapsam, bağlam
içinde istek ([politikalar](https://developers.google.com/identity/protocols/oauth2/policies)).

**Kapsamlar.** Yalnız Google kimliği: `openid`, `userinfo.email`,
`userinfo.profile` (hassas değil, 7 gün sınırı yok). YouTube kanal kimliği /
canlı / sohbet: `https://www.googleapis.com/auth/youtube.readonly`
([kapsamlar](https://developers.google.com/identity/protocols/oauth2/scopes)).

**Kimlik çağrısı.** `GET https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true`
(1 birim): `id`, `snippet.title`, `snippet.customUrl` (tanıtıcı),
`snippet.thumbnails.default/medium/high` (88/240/800 px)
([channels.list](https://developers.google.com/youtube/v3/docs/channels/list)).
Kanal adresi `https://www.youtube.com/channel/<id>` ya da
`https://www.youtube.com/<customUrl>`. Google hesabının YouTube kanalı olmayabilir;
boş `items[]` ele alınmalı.

**Canlı ve sohbet.** Canlı: `GET /youtube/v3/liveBroadcasts?part=snippet,status&mine=true&broadcastStatus=active`
(1 birim) → `snippet.liveChatId`, `status.lifeCycleStatus`
([liveBroadcasts.list](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list)).
`search.list` kullanılmamalı (100 birim; günde 100 çağrı tavanı). Yoklama:
`GET /youtube/v3/liveChat/messages?liveChatId=&part=snippet,authorDetails`
**çağrı başına 5 birim**, `pollingIntervalMillis` ve `nextPageToken` döner;
hızlı yoklamada `rateLimitExceeded`
([liveChatMessages.list](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list)).
API anahtarı tek başına yeter mi **DOĞRULANMADI**. **Akış**: `liveChatMessages.streamList`
sunucu akışlı bağlantı, yeni mesajları anında iter; bağlantı başına 5 birim;
son `nextPageToken` ile devam; 14 Temmuz 2025'te kullanım kılavuzu güncellendi
([streamList](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/streamList)).
Kota: proje başına günde 10.000 birim; artış yalnız uyum denetimi + form, süre
taahhüdü yok ([kota](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)).
Hesap: 5 sn'de bir yoklama × 5 birim = saatte 3.600 birim; tek 3 saatlik yayın
günlük kotayı bitirir. Yoklama ölçeklenmez; tek geçerli yol `streamList`.

**Politika ve marka.** YouTube API Hizmet Politikaları: saklanan API verisi her
30 günde yenilenir ya da silinir; yetki 30 günde bir yeniden teyit edilir;
kullanıcı isteği ya da iptalde 7 gün içinde silme; bağlantı kesilince token
programatik iptal; gizlilik politikası her zaman erişilebilir; YouTube ile
etkileşimi teşvik etmek yasak (III.F.3.c)
([politikalar](https://developers.google.com/youtube/terms/developer-policies)).
Sınırlı Kullanım: yalnız kullanıcıya dönük özellik, reklam yok, aktarım yok
([Limited Use](https://developers.google.com/terms/api-services-user-data-policy)).
Marka: API verisinin göründüğü her yerde tıklanabilir YouTube logosu, renk
değiştirilmez, uygulama adında "YouTube" geçmez; giriş düğmesi Google
şartnamesine uymalı ve "YouTube kapsamı isteniyorsa YouTube düğmesi" kullanılmalı
([marka](https://developers.google.com/youtube/terms/branding-guidelines),
[giriş düğmesi](https://developers.google.com/identity/branding-guidelines)).

## 4. Yayın katmanı (OBS)

OBS Tarayıcı Kaynağı herhangi bir URL'yi yükler; platform onayı gerekmez
([OBS](https://obsproject.com/kb/browser-source)). Twitch Extensions ayrı,
incelemeli bir ürün; tarayıcı kaynaklı katman için gerekmez. Katmanda platform
logosu yukarıdaki marka kurallarına tabi: Twitch yalnız kaynak belirtme; YouTube
verisi gösteriliyorsa tıklanabilir, değiştirilmemiş YouTube logosu; Kick yalnız
kaynak belirtme.

## 5. Karşılaştırma

| Konu | Twitch | Kick | YouTube |
| --- | --- | --- | --- |
| Kayıt zorluğu | Düşük: hesap + 2FA, anında | Düşük: hesap + 2FA, anında | Orta: Cloud projesi, onay ekranı, doğrulanmış alan adı, gizlilik politikası, ana sayfa |
| Herkese açık giriş öncesi inceleme | Yok | Belgelenmemiş (Kick reddedebilir; isteğe bağlı doğrulama sohbet tavanını artırır) | Yalnız OIDC için yok; herhangi bir YouTube kapsamı için **hassas kapsam incelemesi** (~10 iş günü); doğrulanana dek 100 kullanıcı |
| PKCE | Belgelenmemiş (DOĞRULANMADI) | Zorunlu (S256) + client_secret | Web-server istemcide isteğe bağlı |
| Erişim token ömrü | ≈ 4 saat (örnek), 401'de yenile | DOĞRULANMADI | ≈ 1 saat (örnek) |
| Refresh token | Döner; confidential'da süresiz; bağlantı kesme/parola değişiminde ölür | Döner; "yeniden kullanılabilir"; ömür DOĞRULANMADI | Dönmez; Testing'de 7 gün; 6 ay boşta; hesap başına 100 |
| Zorunlu bakım | Açılışta ve her saat `/validate`; `Client-Id` başlığı | Belgelenmemiş | 30 günde bir yetki teyidi ve veri yenileme/silme |
| OIDC id_token | Var | Yok | Var |
| Kimlik kapsamı | Yok (`user:read:email` isteğe bağlı) | `user:read` (+ slug için `channel:read`) | `openid email profile` (Google) / `youtube.readonly` (kanal) |
| Canlı durumu | Get Streams (kapsamsız) ya da EventSub `stream.online` | `channels.stream.is_live` ya da `livestream.status.updated` webhook | `liveBroadcasts.list mine=true broadcastStatus=active` (1 birim) |
| Sohbet okuma | EventSub WebSocket `channel.chat.message` (`user:read:chat`, kullanıcı token'ı) ya da IRC | Yalnız webhook (`events:subscribe`), herkese açık HTTPS uç gerekir | `streamList` akışı (bağlantı başına 5 birim) ya da yoklama (çağrı başına 5 birim) |
| Kota / hız | Helix token kovası; WS: 3 bağlantı, 300 abonelik, maliyet 10 | Sohbet 1.000 (doğrulanmamış) / 10.000; REST sınırı belgelenmemiş | Günde 10.000 birim; artış yalnız denetimle |
| Veri politikası | İptal/istekte silme; 24 saat önbellek | İptal/istekte silme; 24 saat önbellek | 30 gün yenileme/silme; 7 gün içinde silme; Sınırlı Kullanım |

## 6. Hushle için önerilen sıra

1. **Önce Twitch (kimlik + canlı + sohbet).** İnceleme yok, kimlik için kapsam
   yok, temiz giriş için OIDC var; sohbet yayıncının kendi verdiği
   `user:read:chat` ile tek WebSocket aboneliği, bot hesabı gerekmez. Tek uyum
   işi saatlik `/validate` ve `Client-Id`. Dış risk: Twitch'in Türkiye erişim
   geçmişi.
2. **Sonra Kick (kimlik + canlı, ardından webhook ile sohbet).** Giriş basit
   (PKCE + secret, `user:read` + `channel:read`); `channels` tek çağrıda slug,
   `is_live` verir (avatar için `users.profile_picture`). Sohbet herkese açık
   webhook ucu ve imza doğrulaması ister; webhook altyapısı kurulunca eklenir.
   Türk yayıncı ağırlığı nedeniyle YouTube'dan önce. Uygulama doğrulamasını
   erken iste (e-posta, ücretsiz) ki 1.000 abonelik tavanı takılmasın.
3. **En son YouTube, iki aşamada.** A: yalnız `openid email profile` ile
   "Google ile devam et" (hassas değil, doğrulama yok, 7 gün sınırı yok). B:
   yayıncı sohbet/canlı özelliğini açınca `youtube.readonly` artımlı istenir;
   hassas kapsam doğrulaması paralel yürütülür (alan adı, ana sayfa, gizlilik
   politikası, demo video); yoklama değil `streamList` uygulanır çünkü günlük
   10.000 birim yoklamayı kaldırmaz. Birkaç yayıncıyı aşınca kota denetimi
   başvurusu beklenmeli.

Ortak: tek bir `streamer_connection` soyutlaması (provider, provider_user_id,
handle, display_name, avatar_url, channel_url, şifreli token'lar, kapsamlar,
last_validated_at) ve zamanlayıcı: Twitch saatlik doğrulama, YouTube 30 günlük
yeniden yetki, üçünde de bağlantı kesilince silme.

## 7. Riskler ve açık sorular

- Twitch'in Türkiye'de erişilebilirliği (Şubat 2024 engeli; güncel durum
  DOĞRULANMADI). Önceliklendirmeden önce Türk yayıncılarla teyit.
- Twitch PKCE belgelenmemiş; ileride mobil/public istemci gerekirse device-code
  akışı.
- Kick token ömrü ve REST hız sınırı belgelenmemiş; `expires_in` ve 429 savunmacı
  işlenmeli.
- Kick sohbet abonelik tavanı 1.000; doğrulama Kick'in takdirinde.
- Kick webhook için HTTPS şartı yazmıyor; HTTPS ve sabit herkese açık adres
  varsayılmalı.
- Kick sözleşmesi belgelenmemiş uçları yasaklıyor; Pusher soketi kullanılamaz.
- YouTube `youtube.readonly` hassaslığı Google metninden DOĞRULANMADI; hassas
  sayılmalı: ~10 iş günü inceleme, doğrulanana dek 100 kullanıcı, Testing'de
  7 günlük izin.
- YouTube kotası: `streamList` ucuz ama yeniden bağlanma fırtınası ya da yoklama
  kotayı yakar; artış denetim ister, SLA yok.
- YouTube politikası III.F.3.c ("YouTube ile etkileşimi teşvik yok"): sohbet
  tahminini ödüllendiren oyun bu maddeye karşı hukukçuyla gözden geçirilmeli.
- `liveChatMessages.list` OAuth'suz çalışır mı DOĞRULANMADI; tasarım yayıncı
  token'ını varsayar.
- Marka: Twitch'in HTML'de renk şartnamesi yok (yalnız ZIP); Kick marka sayfası
  bulunamadı; Google, YouTube kapsamı istenince YouTube markalı düğme ister.
- YouTube kanalı olmayan Google hesabı `channels.list mine=true` ile boş döner;
  arayüzde "kanal oluştur" yedeği gerekir.
