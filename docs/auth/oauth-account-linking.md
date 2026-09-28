# OAuth ve Hesap Bağlama

## Mevcut Durum

- Google OAuth ortam değişkeniyle opt-in açılır.
- Kullanıcı ile giriş yöntemi ayrıdır. Oyun ekonomisi, envanter, audit ve
  moderasyon her zaman dahili sayısal `userId` üzerinden çalışır.
- Provider bağlantısı `(provider, providerAccountId)` ile bulunur. E-posta,
  provider kimliği olarak kullanılmaz.
- Access token, refresh token ve ID token veritabanında saklanmaz. Uygulama
  Google API kullanmadığı için bu tokenlara ihtiyaç yoktur.
- Google yalnız `email_verified=true` profilleri kabul eder.
- Oturum yokken aynı e-posta başka bir Hushle hesabında bulunursa otomatik
  birleştirme yapılmaz. Kullanıcı önce mevcut hesabına girip Ayarlar > Bağlı
  Hesaplar üzerinden açıkça bağlantı kurar.
- Son giriş yöntemi kaldırılamaz. Parolası olmayan OAuth hesabı önce mevcut
  parola kurtarma akışından parola oluşturur.
- Link ve unlink işlemleri audit'e yazılır; provider subject ve tokenlar UI'a,
  API yanıtına veya audit metadata'sına gönderilmez.

## Google Kurulumu

Google Cloud Console içindeki web client callback adresi:

```text
https://<public-web-origin>/api/auth/callback/google
```

Gerekli değişkenler:

```dotenv
PRODUCTION_OAUTH_POLICY=google
GOOGLE_OAUTH_ENABLED=true
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
```

Local geliştirmede provider kapalı kalabilir. Üç alan birlikte hazır değilse
Google butonu ve Settings bağlantı kartı gösterilmez.

## Güvenlik Kararları

1. `allowDangerousEmailAccountLinking` kapalıdır.
2. Linkleme Auth.js state/PKCE akışı ve aktif Hushle oturumu içinde yapılır.
3. Unlink API'si aktif session, trusted Origin, distributed rate limit,
   sahiplik ve son giriş yöntemi kontrolü yapar.
4. Provider hesabı başka bir `userId`'ye bağlıysa bağlantı reddedilir.
5. Bir kullanıcı aynı provider'dan en fazla bir hesap bağlayabilir.
6. Askıya alınmış kullanıcı OAuth ile oturum açamaz.

## Apple ve Yeni Provider Ekleme

Yeni provider için kullanıcı veya ekonomi tablosu değişmez:

1. `oauth-providers.ts` registry'sine provider descriptor ve Auth.js provider
   config'i eklenir.
2. Provider'a özel verified-email/profile kontrolü `signIn` callback'ine eklenir.
3. Production preflight'a provider secret ve açık politika kararı eklenir.
4. Settings aynı provider durum API'sini kullanır; provider subject istemciye
   açılmaz.
5. Apple için web Service ID, redirect URI, team/key kimlikleri ve döndürülen
   ad bilgisinin yalnız ilk onayda gelebilmesi ayrıca test edilir.

Apple, native iOS dağıtım kararı çıkmadan etkinleştirilmez. Altyapı provider
string'i ve registry kullandığı için yeni kolon veya ekonomi migrasyonu gerekmez.

## Operasyon Kontrolü

- Production deploy öncesi `npm run ops:preflight -- --env-file .env.production`
  çalıştırılır.
- Google kapatılacaksa `PRODUCTION_OAUTH_POLICY=disabled_risk_accepted` ve
  `GOOGLE_OAUTH_ENABLED=false` birlikte kullanılır.
- OAuth secret rotasyonu uygulama restart'ı gerektirir; mevcut Hushle JWT
  oturumları `AUTH_SECRET` değişmediği sürece korunur.
- Provider kesintisi parola ile girişi etkilemez. OAuth-only kullanıcılar için
  provider kesintisi operasyonel risk olarak izlenir.
