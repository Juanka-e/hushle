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
  bütün bağlantılarını platformda iptal eder ve `revoked` / `account_closed` yapar.
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

- `state` tek kullanımlığı çerezin silinmesine dayanır; sunucu tarafında kullanılmış
  state kaydı yok (10 dakika, yalnız aynı oturumda tekrar oynatılabilir).
- Token yazımları `status = active` koşuluyla yapılır; yarışı kaybeden yenileme yeni
  token'ları iptal eder. Aynı anda iki yenileme olursa biri yeniden bağlama ister;
  2. aşamada refresh token üzerinden karşılaştır-ve-yaz eklenmelidir.
- Platformda iptal sırası: saklı access token, saklı refresh token, ikisi de reddedilirse
  refresh ile taze bir access token alınıp o iptal edilir (Twitch yalnız access token kabul eder).
- `/streamer` her açılışta etkin bağlantıyı doğrular (gerekirse yeniler, Twitch'te
  `/validate` çağırır); geçersiz bağlantı `needs_reconnect` olur. Twitch'in saatlik
  doğrulama şartı yayın oturumu sürerken 2. aşamada uygulanacak.
