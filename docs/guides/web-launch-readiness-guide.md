# Web Launch Readiness Rehberi

> Branch: `feature/web-launch-readiness-validation`
> Amaç: ilk web açılışının kritik akışlarını tekrarlanabilir kapılara bağlamak

## Katmanlar

### 1. Core

MySQL veya Redis gerektirmez:

```bash
npm run test:web-launch-readiness:core
```

Bu komut güvenlik, auth redirect, captcha, admin/health guard, oyuncu kimliği,
cross-tab presence, room membership, host handoff, kapasite, admission,
spectator reward, realtime topology, ekonomi, wallet, mağaza, envanter ve
bildirim kurallarını kapsayan testleri tek raporda çalıştırır.

Runner ilk hatada durmaz. Tüm kontrolleri çalıştırır ve başarısız alanları
sonuçta birlikte listeler.

### 2. Browser Smoke

Önce production build gerekir:

```bash
npm run build
npm run test:web-launch-readiness
```

Varsayılan Playwright akışı:

- ana sayfa oda aksiyonları
- guest isim/oda kodu doğrulaması
- erişilebilir duyuru ve tema kontrolleri
- login ve kayıt formları
- korumalı dashboard redirect'i
- room guest prompt
- 390x844 görünümde ana sayfa, login, kayıt ve room overflow kontrolü
- küçük telefon, modern Android, yatay telefon, tablet ve laptop cihaz matrisi

Cihaz matrisi ayrıntıları:
`docs/guides/web-responsive-device-matrix.md`.
WebKit motoru otomatik kapısı:
`docs/guides/web-webkit-readiness.md`.
İki guest multiplayer açılış kapısı:
`docs/guides/web-multiplayer-launch-readiness.md`.
Fiziksel cihaz kurulumu ve kanıt standardı:
`docs/guides/web-real-device-smoke.md`.

`WEB_LAUNCH_DB_E2E=true` verilmezse kayıtlı kullanıcı mutasyon testi kontrollü
olarak skip edilir.

### 3. Disposable DB Auth E2E

Yalnız adı `tabu_test` içeren geçici veritabanında çalışır:

```bash
WEB_LAUNCH_DB_E2E=true npm run test:web-launch-readiness
```

Test geçici hesap oluşturur, login olur, kayıtlı kullanıcıyla oda açar, lobby'ye
ulaşır ve kullanıcı kaydını temizler. Production veritabanında çalıştırılmaz.

### 4. MySQL + Redis Integration

Bu kapı çalışan build sunucusu, geçici MySQL ve Redis ister:

```bash
WEB_LAUNCH_INTEGRATION_TEST=true \
DATABASE_URL="mysql://root:root@127.0.0.1:3307/tabu_test" \
REDIS_URL="redis://127.0.0.1:6380" \
SOCKET_TEST_URL="http://127.0.0.1:3201" \
npm run test:web-launch-readiness:integration
```

Kapsam:

- wallet ledger concurrency
- application/store/notification/dashboard cache invalidation
- Redis room ownership lease
- finalize telemetry rollup
- audit retention transaction
- canlı Socket.IO room capacity akışı
- kayıtlı oyuncu minimum başlangıç kuralı
- admission closed reconnect ve late spectator reward akışları

Runner yanlışlıkla normal veya production DB'ye yazmamak için
`DATABASE_URL` içinde `tabu_test` arar.

## CI Kapısı

CI sırası:

1. lint ve kök TypeScript
2. MySQL üzerinde schema push ve wallet concurrency
3. production build
4. web launch readiness core
5. Playwright UI ve disposable DB auth/room E2E
6. beş profilli responsive cihaz matrisi

Build veya readiness başarısızsa PR merge edilmez.

## Manuel Kalanlar

Otomasyon aşağıdakilerin yerine geçmez:

- dört veya daha fazla gerçek istemciyle tam maç
- doğru, tabu, pas ve timeout'un görsel/işitsel değerlendirmesi
- pause/resume ve ağ kesintisi sonrası reconnect
- gerçek mobil cihazlarda klavye, viewport ve touch davranışı
- production Cloudflare, TLS, health token ve port izolasyonu
- backup upload ve geçici DB restore smoke kanıtı
- admin Access/MFA ve production approval

Bu maddeler `docs/deploy/launch-day-checklist.md` üzerinden kapanır.

## Başarı Kuralı

- Otomatik core ve browser kapıları yeşil olmalı.
- DB/Redis integration sonucu launch kanıtına eklenmeli.
- Manuel smoke'ta bilinmeyen `5xx`, yanlış coin veya yetki sızıntısı varsa
  sonuç `GO` olamaz.
