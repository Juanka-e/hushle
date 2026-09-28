# `@hushle/platform-auth`

Web cookie session'ından bağımsız mobil/API kimlik doğrulama çekirdeğidir.

## Güvenlik modeli

- access ve refresh tokenlar 256-bit rastgele opaque değerlerdir
- veritabanında yalnız SHA-256 token hash'i tutulur
- access token kısa ömürlüdür ve refresh sırasında iptal edilir
- refresh token her kullanımda rotate edilir
- tüketilmiş refresh tokenın tekrar kullanımı tüm cihaz oturumunu iptal eder
- eski access satırları rotation sırasında silinir; tüketilmiş refresh kanıtı
  retention penceresi boyunca tutulur
- kullanıcı başına aktif cihaz oturumu sayısı 10 ile sınırlıdır
- askıya alınmış kullanıcıların login, refresh ve access doğrulaması reddedilir
- `lastSeenAt` yazımı en fazla beş dakikada bir yapılarak write amplification
  sınırlandırılır

Redis yalnız rate-limit sayaçlarında kullanılır. Token revocation için kalıcı
kaynak MySQL'dir; Redis kaybı oturum güvenliğini düşürmez.

Süresi dolmuş veya iptal edilmiş cihaz oturumları
`mobile-auth-retention` job'ı ile grace süresinden sonra silinir. Grace süresi
refresh token tekrar kullanımını tespit edebilmek için gereklidir.
