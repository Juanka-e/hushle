# Admin User Observability Guide

Bu rehber, `feature/admin-user-observability` branch'inin kapsam ve sinirlarini tanimlar.

## Problem

Admin panelde kullanici operasyonlari var, ancak gozlem katmani zayif:

- kullanici listesinde IP gorunurlugu yok
- trusted proxy arkasinda gercek istemci IP'si ile spoof edilebilir header ayrimi yeterince acik degil
- support / moderation / abuse review sirasinda admin tek bakista yeterli baglam alamiyor
- son aktiflik ve temel risk sinyalleri ayrik gorunuyor

Bu branch'in amaci ceza vermek degil, dogru gozlem zemini kurmak.

## Branch Hedefi

1. Kullanici listesi ve detayinda operasyonel gozlem sinyallerini arttirmak
2. IP verisini trusted proxy kurallarina uygun sekilde gostermek
3. Support, moderation ve economy review akislarina temel baglam saglamak
4. Sonraki `feature/economy-abuse-hardening` branch'i icin temiz bir gozlem zemini hazirlamak

## Bu Branch'te Yapilacaklar

### 1. Kullanici listesi observability artisi

- kullanici listesinde IP alani
- gerekiyorsa `son gorulen IP` ve `kayit IP` ayrimi
- son aktif zaman / son gorulen zamanin daha okunur sunumu
- support / moderation akislarinda degerli temel sinyalleri liste seviyesinde gostermek

### 2. Trusted IP cozumu

- `TRUST_PROXY` kararina uygun IP secimi
- app private degilse spoof edilebilir forwarded header'lari gercek istemci IP gibi gostermeme
- admin ekraninda gosterilen IP ile audit/rate-limit tarafindaki IP mantiginin ayni kaynaktan beslenmesi

### 3. Kullanici detay baglami

- kullanicinin temel operasyon ozetini ayni yerde gorebilme
- moderation, support, inventory veya wallet akislarina hizli gecis noktalarini netlestirme
- gerektiğinde son operasyon veya son sistem sinyalini baglama uygun formatta sunma

### 4. Gozlem dili

- admin copy'si teknik ama okunur olacak
- `bilinmiyor`, `proxy`, `son gorulme`, `risk sinyali` gibi kavramlar net ayrilacak
- oyuncuya donuk metin degil, operasyon dili kullanilacak

## Bu Branch'te Bilincli Olarak Yapilmayacaklar

1. Abuse ceza kurallari
- otomatik reward kesme
- IP/subnet bazli bloklama
- tekrar eden grup cezasi

2. Yeni moderation policy
- yeni ban/suspend modeli
- policy tabanli karar motoru

3. Night market veya gorev sistemi

4. Wallet ledger refactor

## Teknik Guardrail'ler

1. IP tek basina suclayici sinyal degil
- ayni IP, tek basina abuse karari vermek icin yeterli degil
- sadece yumusak gozlem sinyali olarak kullanilacak

2. Spoof edilebilir header gosterilmeyecek
- `TRUST_PROXY=false` iken `x-forwarded-for` ve `x-real-ip` ham veri olarak guvenilmeyecek

3. UI'da "supheli" dili dikkatli kullanilacak
- yalnizca ham gozlem verisi gostermek tercih edilecek
- otomatik karar dili sonraki branch'e birakilacak

## Sonraki Branch'e Hazirlik

Bu branch tamamlandiginda:

- `feature/economy-abuse-hardening` daha saglam baslar
- admin karar verirken daha iyi baglama sahip olur
- support / moderation / economy review ayni kullanici ustunde daha az sekme gezerek ilerler

## Beklenen Dosya Alanlari

- `apps/web/src/app/admin/(dashboard)/users/page.tsx`
- `apps/web/src/app/api/admin/users/route.ts`
- ilgili admin user service / type dosyalari
- gerekirse ortak security / request IP helper'lari
