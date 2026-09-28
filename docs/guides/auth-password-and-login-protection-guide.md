# Parola ve Login Koruması

> Branch: `feature/auth-password-policy-and-login-limits`
>
> Durum: web kayıt, web login ve mobile API login için uygulanmıştır.

## Parola Politikası

Yeni hesap parolaları tarayıcı ve sunucunun ortak kullandığı
`@hushle/auth-policy` paketiyle değerlendirilir:

- minimum 8 karakter
- bcrypt uyumluluğu için maksimum 72 UTF-8 byte
- `zxcvbn-ts` skoru en az 3
- kullanıcı adı, e-posta yerel kısmı ve ürün terimleri tahmin girdisi
- zorunlu büyük harf, sayı veya sembol kompozisyon kuralı yok

Kayıt ekranındaki gösterge yalnız kullanıcı deneyimidir. Kabul kararı sunucuda
aynı paketle tekrar verilir. Eski bcrypt hashleri ve mevcut kullanıcıların
parolaları değiştirilmez.

## Sızdırılmış Parola Kontrolü

Yerel politika geçen yeni parolalar HIBP Pwned Passwords range API ile kontrol
edilir. Parolanın kendisi gönderilmez; SHA-1 özetinin yalnız ilk 5 karakteri
gönderilir ve padded cevap içinden kalan özet yerelde eşleştirilir.

- bilinen sızdırılmış parola reddedilir
- servis timeout süresi 2,5 saniyedir
- servis erişilemezse güçlü yerel politika uygulanmaya devam eder
- `PASSWORD_BREACH_CHECK_ENABLED=false` yalnız kontrollü geliştirme veya acil
  provider kesintisi için kullanılmalıdır

## Login Rate Limit

Web Auth.js ve mobile API aynı Redis sayaçlarını kullanır. Sayaçlar yalnız
geçersiz kullanıcı adı/parola sonucunda artar:

| Sayaç | Eşik | Pencere |
| --- | ---: | ---: |
| Normalize hesap adı | 8 başarısızlık | 15 dakika |
| IP | 30 başarısızlık | 10 dakika |

Hesap sayacı IP'den bağımsızdır; dağıtık saldırıyı sınırlar. IP sayacı hesaptan
bağımsızdır; tek kaynaktan farklı hesaplara credential stuffing girişimini
sınırlar. Başarılı giriş hesap sayacını temizler, IP sayacını temizlemez.
Üçüncü hesap başarısızlığından sonra gecikme 250 ms adımlarla artar ve en
fazla 1,5 saniyeye ulaşır.

Redis yoksa 10.000 anahtarla sınırlı process-local fallback devreye girer.
Production'da Redis sağlık ve fallback uyarıları izlenmelidir.

## Gizlilik ve Hata Davranışı

- Login cevabı kullanıcı adının varlığını açıklamaz.
- Var olmayan kullanıcı için de bcrypt karşılaştırması yapılır.
- Sayaç anahtarlarında kullanıcı adı ve IP yerine SHA-256 özet kullanılır.
- Parola, token veya hash loglanmaz.
- Askıya alınmış hesaplar generic login başarısızlığı almaya devam eder.

## E-posta Doğrulama Kararı

E-posta doğrulaması `feature/email-verification-foundation` branch'inde provider
bağımsız olarak uygulanmıştır. Güncel runtime, operasyon ve retention ayrıntıları:
`docs/guides/email-verification-foundation-guide.md`.

Varsayılan mod `optional` olacaktır. Yeni hesap aktif açılır; otomatik e-posta
gönderilmez. Oyuncu dashboard veya settings içindeki "E-postanı doğrula"
çağrısını kullandığında doğrulama e-postası gönderilir.

Admin ayarı boolean yerine aşağıdaki modları kullanmalıdır:

| Mod | Davranış |
| --- | --- |
| `off` | Doğrulama gönderimi ve oyuncu çağrısı kapalıdır. |
| `optional` | Hesap ve oyun açıktır; oyuncu isterse doğrulama gönderimini başlatır. |
| `required_for_new_accounts` | Yalnız ayar açıldıktan sonra kayıt olan hesaplar doğrulanana kadar kısıtlıdır. |

`required_for_new_accounts` mevcut doğrulanmamış hesapları geriye dönük
kilitlemez. Böyle bir migration gerekirse ayrı, ön izlemesi ve geri dönüşü olan
bir admin operasyonu olmalıdır.

Doğrulanmamış hesaplar `optional` modda oda kurabilir, oyuna katılabilir, normal
maç coin'i kazanabilir ve mağazayı kullanabilir. E-posta doğrulaması ekonomi
guardrail'inin yerine geçmez. Gelecekte aşağıdaki yüksek riskli işlemler
doğrulama gerektirebilir:

- native mobile parola kurtarma ve e-posta değiştirme transport yüzeyi
- oyuncular arası coin veya eşya transferi
- hediye, takas ve gerçek para işlemleri
- yüksek değerli promosyonlar
- hesap sahipliğinin kritik olduğu destek işlemleri

Zorunlu mod yalnız frontend butonlarını gizleyerek uygulanmaz. Ortak bir
server-side account capability politikası web API, mobile API ve Socket.IO
komutlarında aynı kararı vermelidir. Kullanıcı verification-only session ile
giriş yapabilmeli, e-postayı yeniden gönderebilmeli ve hesabından çıkabilmelidir.

Gönderim altyapısı:

- route'lardan doğrudan Nodemailer çağrılmaz
- domain akışı ortak bir transactional email provider arayüzü kullanır
- ilk adaptör Nodemailer SMTP, geliştirme adaptörü Docker Mailpit olabilir
- Amazon SES SMTP geçişi yalnız provider ayarlarını değiştirir
- SES API gerekirse ayrı adaptör eklenir; hesap akışı değişmez
- tokenlar hash'li, süreli ve tek kullanımlık tutulur
- DB outbox kaydı `apps/jobs` tarafından gönderilir ve kontrollü retry edilir
- yeniden gönderim hesap ve IP bazında rate-limit edilir
- e-posta değişikliği mevcut parola ile step-up doğrulama ister; yeni adres
  doğrulanana kadar hesapta doğrulanmış adres olarak kullanılmaz

## Doğrulama

```bash
npm run test:auth-password-policy
npm run test:auth-login-rate-limit
npm run test:package-boundaries
npm run typecheck:packages
npx tsc --noEmit -p tsconfig.json
```

## Sonraki Güvenlik Dilimleri

1. Parola kurtarma ve güvenli e-posta değişimi tamamlandı; production SMTP ve
   retention scheduler operasyonunu doğrula
2. Adaptif Turnstile `CAPTCHA_REQUIRED` step-up akışı
3. Admin için Cloudflare Access MFA
4. Mevcut bcrypt hashlerinin başarılı login sırasında Argon2id'e kademeli
   yükseltilmesi
