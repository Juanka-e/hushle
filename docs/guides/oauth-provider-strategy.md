# OAuth Provider Strategy

## Karar

- Google login faydali fakat web public acilis blocker'i degil. Schema henuz
  gercek kullanici verisiyle dolmadan launch oncesi eklenmesi de makuldur.
- Apple login native iOS/App Store plani aktif olana kadar ertelenir.
- Credentials login ve email verification mevcut haliyle korunur.
- OAuth girisi marketing email izni anlamina gelmez.

Oyunun guest-first yapisi nedeniyle OAuth olmadan da hizli oda katilimi vardir.
Erken OAuth; hesap linking, username onboarding, provider outage, email
collision, silme/export ve destek yukunu acilistan once gereksiz buyutur.

## Email Verification

OAuth-only hesapta provider token'i server-side dogrulanmis ve provider acikca
`email_verified=true` benzeri guvenilir bir claim vermisse ikinci bir Hushle
verification maili zorunlu degildir. Bu durumda `emailVerifiedAt` provider
dogrulamasindan uretilir.

Provider email vermiyorsa veya dogrulanmislik sinyali yoksa hesap otomatik
verified sayilmaz. Credentials ile acilan hesaplar admin paneldeki mevcut email
verification politikasina uymaya devam eder.

## Account Linking

- yalniz email eslesmesine bakarak sessiz hesap birlestirme yapilmaz
- Auth.js `allowDangerousEmailAccountLinking` acilmaz
- mevcut kullanici login durumundayken acik bir "hesap bagla" adimi onerilir
- provider `subject` kimligi kalici anahtar olarak saklanir
- provider degistirmek `userId`, wallet, inventory veya audit kimligini degistirmez
- collision durumunda yeni hesap acmak yerine guvenli recovery/support akisi gerekir

Mevcut semada OAuth `Account` modeli yoktur ve `User.password` zorunludur.
Implementasyon; nullable/ayri credential modeli, provider account tablosu,
unique provider subject, username secim adimi ve migration gerektirir.

### Ayni Email Senaryosu

1. `(provider=google, providerAccountId=sub)` zaten varsa bagli `userId` ile
   login tamamlanir.
2. Provider kaydi yok, fakat normalized email ile credentials hesabi varsa
   login durdurulur. Kullaniciya mevcut sifresiyle girip Ayarlar > Hesaplar
   bolumunden Google'i baglamasi soylenir.
3. Kullanici sifresini unuttuysa mevcut password recovery akisi kullanilir;
   Google tiklamasi recovery yerine gecmez.
4. Email de yoksa yeni Hushle user'i ve provider account ayni transaction'da
   olusturulur; username/display name onboarding tamamlanir.
5. Unique `(provider, providerAccountId)` ve normalized email constraint'i race
   condition'da iki ayri wallet/user olusmasini engeller.

Google emaili ana kimlik degildir. Kalici provider anahtari Google `sub`, Hushle
tarafindaki ana kimlik ise mevcut integer `userId` olmaya devam eder. Gmail
olmayan ucuncu taraf adreslerde `email_verified` otomatik account linking icin
yeterli kabul edilmez.

## Uygulama Sirasi

1. production email/Turnstile ve observability temeli stabil olsun
2. Google provider schema/linking altyapisini staging'de ekle
3. yeni OAuth kullanicisina benzersiz username/display name onboarding uygula
4. mevcut credentials hesabi icin explicit account-linking uygula
5. duplicate/collision, revoke ve provider outage E2E testlerini tamamla
6. native iOS plani netlesince Apple Services ID/private key ve relay mail
   operasyonunu ayri branch'te ekle

Apple kullanicisi emailini gizleyebilir. Relay adrese transactional mail
gonderilecekse outbound domain ve sender Apple Private Email Relay tarafinda
ayrica yapilandirilmalidir.
