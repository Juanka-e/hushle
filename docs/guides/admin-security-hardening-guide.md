# Admin Security Hardening Guide

Bu rehber `fix/admin-security-hardening` branch'i icin kapsam, sinir ve hedefleri tanimlar.

## Branch Amaci

Admin panel ve admin API yuzeyinde:

- authz bosluklarini kapatmak
- write route'larda request korumasini guclendirmek
- rate limit kapsamini taramak
- IP / proxy / audit gorunurlugu gibi operasyonel guvenlik noktalarini netlestirmek
- admin operasyon tooling'ini injection ve fail-open risklerine karsi sertlestirmek

## Bu Branch'te Yapilacaklar

### 1. Admin API yuzeyi taramasi
- `requireAdminSession` kullanan route'lar
- eksik authz / role / ownership kontrolleri
- state-changing endpoint'ler
- admin panel icin gerekli request korumalari

### 2. Rate limit kapsami
- admin write route'lar
- pahali read route'lar
- admin search ve bulk aksiyon endpoint'leri
- gereksiz request spam ureten UI alanlari

### 3. Request guvenligi
- gerekli yerlerde origin / intent kontrolu
- fail-open davranislarin tespiti
- validation eksikleri
- admin panel tarafinda guvenli hata davranisi

### 4. Operasyonel guvenlik gorunurlugu
- IP goruntuleme mantigi
- reverse proxy arkasinda trusted IP beklentisi
- audit / note / actor bilgisinin operasyonel degerini arttirma

### 5. Content ops guvenlik notlari
- duyuru sistemi
- block/render modeli
- injection acisi dogurmadan daha compact yonetim modeli icin guardrail notlari

## Bu Branch'te Bilincli Olarak Yapilmayacaklar

- night market
- economy abuse kurallari
- Redis / cache foundation
- user-facing store veya gameplay UI redesign
- inventory domain genisletmesi

## Beklenen Ciktilar

- net bulgu listesi
- kapatilan admin API riskleri
- eksik rate limit'lerin tamamlanmasi
- gerekiyorsa docs'a production/admin security notlari

## Uygulama Notlari

### Ilk somut bulgu
- admin write route'lar icin ilk korku CSRF/fail-open idi
- ama mevcut `apps/web/src/proxy.ts` state-changing `/api/*` isteklerinde origin/fetch-site kontrolu uyguluyor
- yani ilk pratik acik write-origin degil, admin route'larda tutarsiz rate limit kapsami ve IP guven varsayimiydi

### Bu branch'te kapatilan temel riskler
- admin read route'larda rate limit bosluklari kapatildi
- admin write route'larda rate limit kapsami tum route setine yayildi
- `TRUST_PROXY=false` durumunda `x-forwarded-for` ve `x-real-ip` artik kor gorunurluk veya rate-limit anahtari olarak guvenilmiyor
- audit log IP kaydi ve request rate limit ayni trusted-proxy karar cizgisini kullanacak sekilde birlestirildi

### Operasyonel sonuc
- admin panelde route bazli request spam maliyeti dustu
- audit ve rate-limit IP verisi artik deployment kararina bagli
- ileride kullanici listesinde IP gosterilecekse ayni `TRUST_PROXY` kuralina sadik kalinmali

## Sonraki Bagli Branch'ler

Bu branch'ten sonra mantikli kisa fix alanlari:

1. `fix/admin-content-ops`
- duyuru duplicate render
- block count gorunurlugu
- content edit/gozumlenebilirlik
- toplu kelime yukleme kategori / alt kategori akisi

2. `fix/coin-grants-archive-lifecycle`
- archive davranisinin tutarli hale getirilmesi

3. `feature/admin-user-observability`
- kullanici listesinde IP / son gorulen veri gorunurlugu
- ama yalniz trusted proxy mantigi netse

## Guvenlik Karar Cizgisi

- sadece teorik best-practice degil, gercek exploit veya fail-open riski olan noktalar kapatilacak
- admin route'larda auth var diye otomatik guvenli kabul edilmeyecek
- audit / note / actor gorunurlugu operasyonel bir guvenlik ozelligi olarak ele alinacak
