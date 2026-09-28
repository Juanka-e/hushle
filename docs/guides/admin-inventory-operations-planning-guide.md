# Admin Inventory Operations Planning Guide

Bu rehber `feature/admin-inventory-operations` branch'inin kapsam sinirini netlestirir.

Amac, admin tarafinda oyuncu envanterini goruntuleme ve operasyonel olarak yonetme akisini kurmaktir.

## Branch Amaci

Bu branch su problemleri cozmelidir:

- admin panelden bir oyuncunun hangi kozmetiklere sahip oldugunun gorulememesi
- oyuncuya manuel item tanimlama akisinin olmamasi
- yanlis grant veya support kaynakli duzeltmelerde geri alma aracinin olmamasi
- grant / revoke / equip reset islemlerinin audit izinin daginik kalmasi

Bu branch sonunda admin panel su sorulara hizli cevap verebilmelidir:

1. Bu oyuncunun envanterinde hangi item'lar var?
2. Bu item nasil kazanildi?
3. Ne zaman verildi?
4. Admin manuel grant ettiyse nedeni neydi?
5. Yanlis grant geri alinabilir mi?
6. Equip durumu bozulursa operasyonel duzeltme yapilabilir mi?

## Kapsam

Planlanan ana isler:

1. oyuncu envanteri goruntuleme
- oyuncu bazli inventory listesi
- item type / rarity / source bilgisi
- acquired time
- equipped state

2. item grant
- admin belirli bir oyuncuya item tanimlayabilmeli
- grant nedeni zorunlu olmali
- ayni item tekrar grant edilmeye calisildiginda davranis net olmali

3. item revoke
- manuel grant geri alinabilmeli
- satin alinmis veya event ile kazanilmis item'larda hangi durumlarda revoke serbest oldugu net tanimlanmali

4. equip reset / operasyonel duzeltme
- bozuk equip state duzeltmesi
- gerekirse avatar / frame / card slot reset

5. audit izi
- kim verdi
- kime verdi
- hangi item verildi
- hangi gerekceyle verildi
- revoke varsa ne zaman ve neden yapildi

## Bilincli Kapsam Disi

Bu branch'te yapilmamasi gerekenler:

1. oyuncu-facing inventory redesign
- bu branch admin operasyonudur

2. magazada neyin satildigi
- bu konu `feature/admin-shop-ux` ve `feature/store-merchandising` alanidir

3. night market veya personalized offer

4. economy abuse kurallari

5. wallet ledger / gercek para odeme zinciri

## Ekran ve Akis Hedefleri

### Admin Inventory View

- oyuncu sec
- mevcut inventory'yi listele
- filtreler:
  - tumu
  - avatar
  - cerceve
  - kart arkasi
  - kart onu
  - equipped
  - manuel grant
  - purchase
  - event reward

### Grant Flow

- oyuncu sec
- item sec
- neden sec
- grant onayi
- sonuc toast / audit / inventory refresh

### Revoke Flow

- revoke sadece guvenli ve izinli durumlarda calismali
- satin alma gecmisi olan item'lar icin daha dikkatli kural gerekebilir
- support panelinden gelen duzeltme gibi acik reason tutulmali

## Acik Tasarim Kararlari

Bu branch icinde netlestirilecek noktalar:

1. ayni item ikinci kez grant edilmeye calisilinca:
- sessizce ignore mu
- acik hata mi
- audit'e "already owned" mi

2. revoke hakki hangi source'larda serbest olacak?
- manuel grant
- support compensation
- event reward
- purchase

3. equip reset item bazli mi olacak, slot bazli mi?

4. admin kullanicilarinin inventory operasyonu kisitlanacak mi?

## Model Guardrails

1. Inventory ownership ile store visibility ayni problem degildir
- `ShopItem` ve `InventoryItem` sorumluluklari ayri kalmali

2. Grant source ve audit metadata kaybolmamali
- inventory kaydina bakinca bu item'in nasil geldigi anlasilmali

3. Admin grant operasyonu gelecekte wallet ledger veya reward engine ile karismamali
- bu branch item sahipligi operasyonudur
- coin hareketi operasyonu degildir

4. Purchase ile gelen item'lar operasyonel olarak daha korumali ele alinmali
- yanlisla hard revoke yapilmasi ekonomiyi bozar

5. Night market / event / reward gibi ileriki alanlar source seviyesinde izlenebilir kalmali

## Merge Kriteri

Bu branch su durumda merge edilir:

1. admin bir oyuncunun inventory'sini gorebiliyorsa
2. item grant akisi calisiyorsa
3. revoke veya operasyonel duzeltme kurali netse
4. audit izi olusuyorsa
5. `npx tsc --noEmit` ve `npm run lint` temizse
6. gerekli smoke test geciyorsa

## Sonraki Branch Baglantisi

Bu branch tamamlandiktan sonra en dogru sonraki adim:

- `feature/night-market-foundation`

Sebep:
- once katalog ve inventory operasyonu netlesmeli
- sonra oyuncuya ozel offer ve personalized inventory/sales mantigi gelmeli
