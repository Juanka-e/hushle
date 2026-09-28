# Economy Abuse Validation Checklist

Bu rehber `feature/economy-abuse-hardening` branch'i icin manuel dogrulama listesidir.

Amac:

- guardrail davranisinin beklenen urun mantigiyla calistigini gormek
- false positive riskini acilis oncesi azaltmak
- admin review akisinin gercekten kullanilabilir oldugunu dogrulamak

## 1. System Settings Kontrolu

`/admin/system-settings` -> `Ekonomi`

Kontrol:

1. `Odul Koruma Tavani`
- `matchRewardGuardEnabled`
- `matchRewardWindowHours`
- `matchRewardSoftCapCoin`
- `matchRewardHardCapCoin`
- `matchRewardMinMultiplier`
- `matchRewardDampingProfile`

2. `Tekrar Eden Grup`
- `repeatedGroupEnabled`
- `repeatedGroupWindowHours`
- `repeatedGroupThreshold`
- `repeatedGroupMinMultiplier`

Beklenen:

- alanlar anlasilir olmali
- helper metinler oyuncu etkisini anlatmali
- ayarlar security/captcha ile karismamali

## 2. Guest + Authenticated Mac

Senaryo:

- 1 authenticated oyuncu
- 3 guest oyuncu
- mac gercekten tamamlanir

Beklenen:

- authenticated oyuncu coin alir
- guest oldugu icin odul kesilmez
- audit'te `single_authenticated_player_room` ve `guest_majority_room` review flag gorunebilir
- oyuncuya ekstra hata/uyari gosterilmez

## 3. Duplicate Claim

Senaryo:

- ayni authenticated oyuncu ayni oda icin ikinci kez finalize dener

Beklenen:

- ikinci istek yeni coin yazmaz
- sistem mevcut odulu dondurur veya duplicate claim davranisi uygular
- wallet iki kez artmaz

## 4. Repeated Group Damping

Senaryo:

- ayni authenticated oyuncu
- ayni lineup ile
- `repeatedGroupWindowHours` icinde
- `repeatedGroupThreshold` ustunde odullu mac tamamlar

Beklenen:

- ilk esige kadar tam odul
- esik asildiktan sonra odul kademeli duser
- odul `repeatedGroupMinMultiplier` altina inmez
- audit preset `Tekrar Grup` ile bu kayit gorulebilir

## 5. Rolling Safety Ceiling

Senaryo:

- oyuncu ayni `matchRewardWindowHours` penceresinde cok yuksek coin biriktirir

Beklenen:

- soft cap ustunde odul kademeli duser
- hard ceiling ustunde gerekirse `0` coin olabilir
- mac sonucu yine kayit altina alinabilir
- audit preset `Ceiling` ile bu kayit gorulebilir

## 6. Rolling Reset Davranisi

Senaryo:

- oyuncunun onceki odulleri pencere disina cikar

Beklenen:

- oyuncu takvim gunu degil, rolling window mantigiyla yeniden tam banda doner
- gece yarisi reset gibi yapay davranis yoktur

## 7. Audit Review

`/admin/audit`

Preset kontrolleri:

1. `Mac Odulleri`
- yalniz `game.match.finalize` kayitlari gelmeli

2. `Koruma Tetikleri`
- ceiling veya repeated-group etkisi alan kayitlar gelmeli

3. `Ceiling`
- yalniz reward guard tetigi alan kayitlar gelmeli

4. `Tekrar Grup`
- yalniz repeated-group tetigi alan kayitlar gelmeli

Satir bazinda beklenen:

- `Koruma` kolonunda
  - kaynak
  - istenen odul
  - verilen odul
  - kesilen coin
  - tekrar grup veya ceiling bilgisi
gorunmeli

## 8. Oyuncu Deneyimi

Beklenen:

- oyuncuya guardrail nedeniyle ekstra uyari/toast gosterilmez
- sistem coin kesintisini goze sokmaz
- koruma tamamen backend + audit seviyesinde kalir

## 9. Yuk Ve Operasyon Notu

Su anki modelde authenticated her finalize icin tipik maliyet:

1. repeated-group icin `count`
2. rolling ceiling icin `aggregate`
3. `matchResult.create`
4. `wallet.update`
5. `auditLog.create`

Neden su an kabul edilebilir:

- sorgular `userId + createdAt`, `userId + lineupKey + createdAt` ve `action + createdAt` indekslerine dayanir
- guest oyuncular finalize/wallet yazimi yapmaz
- asil ek yuk audit tablosu buyumesidir, CPU degil

Ne zaman tekrar ele alinmali:

- canli trafik buyurse
- audit tablo boyutu hizli buyurse
- finalize throughput belirgin artarsa

O noktada sonraki adimlar:

- audit retention / arsivleme
- non-triggered finalize audit'ini ayri telemetriye tasima
- Redis/Valkey ile rolling counter yardimi
- cache-and-rate-limit foundation sonrasi hafifletme
