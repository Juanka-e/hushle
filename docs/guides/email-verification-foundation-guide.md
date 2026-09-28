# E-posta Doğrulama Temeli

> Branch: `feature/email-verification-foundation`
>
> Kapsam: transactional e-posta, doğrulama tokenı, pending hesap yetkileri,
> retention ve operasyon sınırları.

## Çalışma Modları

| Mod | Yeni hesap davranışı |
| --- | --- |
| `off` | Yeni doğrulama çağrısı gösterilmez. Daha önce zorunlu pending açılan hesaplar kilitlenmemek için resend kullanabilir. |
| `optional` | Hesap doğrudan aktiftir. Otomatik e-posta gönderilmez; oyuncu Ayarlar'dan ister. |
| `required_for_new_accounts` | Hesap pending açılır, doğrulama e-postası otomatik kuyruğa alınır ve doğrulanana kadar yalnız verification-only oturum kullanılır. |

Varsayılan `optional` moddur. Mod değişikliği mevcut aktif ve doğrulanmamış
hesapları geriye dönük olarak pending yapmaz. Zorunluluk, hesap satırındaki
`emailVerificationRequiredAt` snapshot'ıyla izlenir.

Admin paneli `required_for_new_accounts` seçimini ancak SMTP, public site URL,
gönderici ve token secret hazırsa kaydeder. Secret değerleri panele gönderilmez.
Integration Hub yalnız provider durumu ve eksik alan adlarını gösterir.

## Sunucu Tarafı Yetkiler

Pending zorunlu hesap şunları yapabilir:

- oturum açma ve çıkma
- doğrulama durumu, resend ve confirm
- profil ekranına erişim

Şunları yapamaz:

- oda kurma veya odaya katılma
- mağaza satın alma, bundle satın alma veya kuşanma
- coin grant kullanma
- maç ödülü finalize etme

Karar `@hushle/platform-auth` içindeki ortak capability politikasıyla verilir.
Web route, mobile API ve Socket.IO aynı hesap alanlarını kullanır. Frontend
butonlarının görünürlüğü güvenlik kararı değildir.

## Token ve Outbox

- Token 24 saat geçerlidir, tek kullanımlıktır.
- DB'de yalnız SHA-256 token özeti tutulur.
- Outbox payload'ı plaintext token içermez; worker token ID ve server secret ile
  gönderim anında deterministik token üretir.
- Resend önceki aktif tokenları iptal eder ve henüz gönderilmemiş eski mesajları
  superseded olarak dead-letter'a taşır.
- Confirm işlemi token tüketimi, e-posta snapshot kontrolü ve hesap aktivasyonunu
  tek transaction içinde yapar.
- Resend limitleri hesap+IP için 3/15 dakika, hesap için 5/gündür.
- Confirm limiti IP için 20/10 dakikadır.
- Pazarlama sınıfındaki outbox mesajları consent altyapısı gelene kadar fail-closed
  dead-letter olur.

## SMTP ve Mailpit

Uygulama route'ları SMTP'ye doğrudan bağlanmaz. `apps/jobs` outbox mesajlarını
`@hushle/platform-email` içindeki Nodemailer SMTP adaptörüyle gönderir.
Amazon SES SMTP'ye geçiş kod değişikliği değil env değişikliğidir.

Local altyapı:

```bash
npm run infra:up
```

Mailpit SMTP: `127.0.0.1:1025`

Mailpit UI: `http://127.0.0.1:8025`

Local `.env` için:

```dotenv
EMAIL_PROVIDER=smtp
EMAIL_FROM="Hushle <no-reply@local.test>"
EMAIL_TOKEN_SECRET=replace_with_at_least_32_random_characters
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
```

Production'da app container SMTP parolasını almaz. SMTP credential yalnız jobs
container'ına verilir. App; provider readiness, token üretimi ve enqueue için
host/port, sender, site URL ve token secret değerlerini kullanır.

## Job Operasyonu

Mutating job'lar `JOBS_ENABLED=true`, Redis ve explicit `execute` ister.

```bash
# Kuyruk durumunu değiştirmeden kontrol
npm run jobs:email-delivery
npm run jobs:email-retention

# Production scheduler komutları
docker compose --profile jobs run --rm jobs \
  npm run jobs:run -- email-delivery execute
docker compose --profile jobs run --rm jobs \
  npm run jobs:run -- email-retention execute
```

Önerilen sıklık:

- `email-delivery`: dakikada bir
- `email-retention`: günde bir

Varsayılan retention:

- sent outbox: 30 gün
- dead-letter outbox: 90 gün
- süresi dolmuş token: ilave 7 gün
- doğrulanmamış pending hesap: 7 gün

Pending hesap temizliği yalnız `pending_email_verification`,
`emailVerifiedAt=null` ve cutoff'tan eski `emailVerificationRequiredAt`
satırlarını bounded batch ile siler. Audit/outbox geçmişi kullanıcı bağı
`SetNull` edilerek korunur.

## Doğrulama

```bash
npm run db:generate
npm run typecheck:packages
npm run typecheck:web
npm run test:email-verification
npm run test:email-verification-integration
npm run test:jobs-runtime
npm run test:integration-hub
npm run test:encoding-integrity
npm run test:email-verification-e2e
```

Gerçek SMTP smoke turunda Mailpit'te yalnız en son resend bağlantısının çalıştığı,
eski bağlantının generic hata verdiği ve ikinci confirm'in hesap durumunu
değiştirmediği kontrol edilir.

## Bilinçli Olarak Sonraya Bırakılanlar

- native mobile parola kurtarma ve e-posta değiştirme transport yüzeyi
- SES API adaptörü ve imza doğrulamalı webhook transport'u
- marketing consent modeli, segmentleme ve unsubscribe
- suppression kaldırma için ayrı admin yetkisi ve inceleme akışı
- native mobile verification request/confirm transport yüzeyi
