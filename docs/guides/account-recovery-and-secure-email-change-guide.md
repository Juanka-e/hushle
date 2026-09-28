# Hesap Kurtarma ve Güvenli E-posta Değişimi

> Branch: `feature/account-recovery-and-secure-email-change`
>
> Kapsam: parola kurtarma, doğrulamalı e-posta değişimi, oturum iptali,
> transactional e-posta ve güvenlik sınırları.

## Parola Kurtarma

`/forgot-password` kullanıcı adı veya e-posta kabul eder. API, hesabın varlığından
bağımsız olarak aynı `202` mesajını döndürür. Böylece kullanıcı/e-posta enumeration
yüzeyi oluşturulmaz.

- IP limiti: 5 istek / 15 dakika
- normalize edilmiş identifier hash limiti: 3 istek / 30 dakika
- captcha politikası: login aksiyonuyla aynı admin ayarını kullanır
- token süresi: 1 saat
- token: hash'li, tek kullanımlık ve yeni istekte önceki tokenları iptal eden yapı
- parola: ortak zxcvbn politikası ve Pwned Passwords kontrolü

Outbox payload'ında plaintext token bulunmaz. Worker, token ID ile
`EMAIL_TOKEN_SECRET` üzerinden teslimat anında deterministik token üretir.

Başarılı reset işlemi tek transaction içinde:

1. tokenı tüketir,
2. parola hash'ini değiştirir,
3. web `sessionVersion` değerini artırır,
4. bütün mobil session ve token ailelerini revoke eder,
5. parola değişikliği güvenlik bildirimini kuyruğa alır.

Kayıtlı oyun socket'leri kullanıcıya özel server-only odaya katılır. Route,
işlem tamamlanınca bu odadaki socket'leri disconnect eder. Socket.IO Redis adapter
açıkken komut diğer web instance'larına da yayılır.

## E-posta Değişimi

Profil PATCH'i artık e-posta kabul etmez. E-posta yalnız
`/api/auth/email-change/*` akışıyla değişebilir.

1. Oyuncu yeni adresi ve mevcut parolasını girer.
2. Yeni adres `pendingEmail` olarak tutulur; canonical adres değişmez.
3. Yeni adrese doğrulama bağlantısı, eski adrese güvenlik bildirimi gider.
4. Yeni adres doğrulanınca canonical alanlar atomik olarak değiştirilir.
5. Web, mobile ve aktif oyun socket oturumları iptal edilir.
6. Eski adrese tamamlanma bildirimi gönderilir.

`pendingNormalizedEmail` unique olduğu için aynı adres iki hesap tarafından
eşzamanlı rezerve edilemez. Confirm transaction'ı canonical adres sahipliğini
tekrar kontrol eder. Bekleyen istek mevcut parola ile iptal edilebilir. İki günden
eski pending adresler retention job tarafından temizlenerek adreslerin süresiz
rezerve kalması engellenir.

Zorunlu e-posta doğrulama modundaki pending hesap yeni adresi doğrularsa hesap
`active` durumuna geçer.

## Güvenlik ve Audit

- bütün state-changing endpoint'lerde origin/fetch-site kontrolü vardır
- public confirm endpoint'leri IP bazlı dağıtık rate limit kullanır
- authenticated request/cancel işlemleri hesap + IP anahtarıyla sınırlıdır
- token, parola ve e-posta adresi audit metadata'sına yazılmaz
- yalnız başarılı güvenlik işlemleri audit edilir; her reset isteği audit
  tablosunu şişirmez
- eski JWT'ler `sessionVersion` uyuşmazlığında sunucu tarafında reddedilir

Production'da Redis rate limit ve Socket.IO adapter birlikte açık olmalıdır.
Redis geçici olarak yoksa rate limit process-local fallback'e döner; socket
disconnect yalnız aynı process için garanti edilir.

## Retention

Mevcut `email-retention` job şu kayıtları bounded batch ile temizler:

- e-posta doğrulama tokenları
- parola reset tokenları
- e-posta değişim tokenları
- iki günden eski pending e-posta rezervasyonları
- sent/dead-letter outbox kayıtları
- 90 günden eski provider delivery event kayıtları; suppression kayıtları korunur

Production önerisi:

```bash
docker compose --profile jobs run --rm jobs \
  npm run jobs:run -- email-retention execute
```

Job günde bir çalıştırılmalıdır.

## Doğrulama

```bash
npm run test:account-recovery-integration
npm run test:account-recovery-e2e
npm run test:email-verification-e2e
npm run test:player-core
npm run test:jobs-runtime
npm run typecheck:packages
npm run typecheck:web
npm run build
```

Integration testi local MySQL ister:

```powershell
$env:ACCOUNT_RECOVERY_INTEGRATION="true"
npm run test:account-recovery-integration
```

## Bilinçli Sınırlar

- Native mobile reset/e-posta değişim transport endpoint'leri web stabilitesinden
  sonra eklenecek. Mobile profil PATCH'i e-posta değiştiremez.
- MFA/passkey ve recovery code bu branch'in kapsamı değildir.
- Admin dead-letter retry ve provider-bağımsız suppression temeli tamamlandı.
  SES imza doğrulamalı webhook adaptörü ayrı provider branch'ine aittir.
- Pazarlama consent, segmentasyon ve unsubscribe transactional güvenlik
  e-postalarından ayrı tutulacaktır.
