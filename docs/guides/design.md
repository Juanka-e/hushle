# Hushle Premium Card Design Brief

Bu dosya Stitch benzeri arayuz/tasarim araci icin ana brief'tir.

Kullanim amaci:

- Stitch'e dogrudan `design.md` olarak vermek
- HTML mock + PNG export mantigiyla calismak
- kart anatomisini koruyup premium skin yonu cikarmak

Sadece image ureten araclar icin ayri brief:

- `docs/guides/design-image-generation.md`

## Proje

Marka: Hushle

Urun: Kelime oyunu icin premium kart kozmetik tasarimlari

Amac: Oyuncularin gercekten para vermek isteyecegi kadar kaliteli, koleksiyonluk, premium kart skinleri uretmek

## Temel Karar

Bu tasarimlar:

- arka plan sahnesi odakli olmayacak
- poster gibi davranmayacak
- kartin kendi yuzey malzemesine odaklanacak

Yani odak su olacak:

- materyal hissi
- premium border
- texture
- lak / foil / holo / linen / pearl / velvet / carbon gibi yuzey karakteri
- tipografi hiyerarsisi
- premium collectible hissi

## Tasarim Dili

Kartlar su hisleri vermeli:

- premium
- modern
- koleksiyonluk
- temiz
- ayirt edilebilir
- pahali hissettiren
- oyuncularin satin almak isteyecegi kadar cekici

Referans hissi:

- boutique board game component
- luxury trading card
- premium cosmetic skin

## Kacinilacak Seyler

Sunlari yapma:

- generic mobil oyun gradienti
- cocuksu gorunum
- fazla tombik kart hissi
- gereksiz kalinlik
- asiri parlak ve ucuz duran efektler
- metni bozan texture
- dikkat dagitan arka plan sahnesi
- full illustration poster mantigi
- stok mobil game UI estetiği

## Sabit Kart Anatomisi

Kart layout'u degismeyecek. Sadece tasarim skin'i degisecek.

Kartta sabit kalacak alanlar:

- sag ustte kucuk zorluk ikonu alani
- ustte marka / header alani
- ortada ana kelime alani
- altta 5 yasakli kelime alani
- altta ince footer strip olabilir

Yani yeni layout icat etme.
Yeni skin tasarla.

## En Onemli Kurallar

1. Okunurluk bozulmayacak.
2. Ana kelime her zaman net okunacak.
3. Yasakli kelimeler her zaman net okunacak.
4. Texture ve malzeme hissi metnin onune gecmeyecek.
5. Tasarim oyunda hover/tilt/shine gibi efekt alabilecek kadar temiz katman mantigina sahip olacak.

## Uretim Tipleri

Bu brief ile iki tip cikti uretebilirsin:

### 1. Clean Skin

Bu asil teslimdir.

Kartin uzerinde:

- gercek kelime yazmayacak
- yasakli kelimeler yazmayacak
- ornek dummy text yazmayacak

Sadece skin olacak.

Bos kalmasi gereken alanlar:

- ana kelime alani
- 5 yasakli kelime alani
- zorluk ikonunun oturacagi alan

Header markasi istenirse cok hafif placeholder olabilir ama tercihen bos veya cok sade kalmali.

### 2. Preview Mock

Bu opsiyoneldir ama cok faydalidir.

Ayni tasarimin ikinci versiyonu:

- ornek ana kelime ile
- ornek 5 yasakli kelime ile
- zorluk ikonu yerlesimi gorunur sekilde

Bu sadece onizleme icin.
Oyunda kullanilacak asil dosya clean skin olacaktir.

## Stitch Icin Ozel Not

Stitch hem layout dusunebilir hem de PNG/export uretebilir.
Bu nedenle Stitch'te su mantikla ilerle:

- kart anatomisini yeniden icat etme
- mevcut sabit anatomiyi koru
- asil deger kart materyali ve premium detay dili olsun
- HTML mock uretebilir
- ama ciktiyi clean skin export mantigina uygun planla

Beklenen sonuc:

- premium kart yuzeyi
- uygulamaya entegre edilebilir temiz export
- gerekiyorsa ayrica preview mock

## Teknik Export Kurallari

Onerilen boyut:

- minimum `900x1200`
- tercihen `1800x2400`

Format:

- `PNG`
- veya `WebP`

Tercih:

- transparan gerekmiyorsa opak olabilir
- ama text alanlari temiz kalmali
- cok agresif noise export etme

Kart tam dikdortgen export olsun.
Kose radius'unu gerekirse biz oyunda veririz.

## Safe Area Kurallari

Kart orani: `3:4`

Tasarlarken su alanlari temiz tut:

### 1. Zorluk Ikonu Alani

- sag ustte
- yaklasik `80x80 px` alan
- cok karisik olmamali

### 2. Ana Kelime Alani

- kartin ust-orta ile tam orta arasinda
- genis ve sakin bir alan
- buyuk ve guclu tipografi icin yer olmali

### 3. Yasakli Kelime Alani

- alt yariya dogru 5 satirlik net alan
- her satir rahat okunmali
- texture bu bolgede agresif olmamali

### 4. Footer Strip

- altta ince bir bant olabilir
- ama zorunlu degil

## Istenen Tasarim Yonleri

Asagidaki gibi farkli aileler uretebilirsin:

- obsidian glass
- pearl lacquer
- linen archive
- foil crown
- velvet ember
- carbon drive
- vellum mist
- holo tide

Ama birebir bunlara bagli kalma.
Onemli olan premium collectible kalite.

## Teslim Paketleri

Her tasarim icin ideal teslim:

1. `face-clean`
2. `face-preview`
3. `back-clean`
4. `back-preview`
5. kisa stil notu

Ornek dosya isimleri:

- `obsidian-prism-face-clean.png`
- `obsidian-prism-face-preview.png`
- `obsidian-prism-back-clean.png`
- `obsidian-prism-back-preview.png`

## Card Back Kurali

Kart arkasi:

- on yuz kadar kalabalik olmamali
- marka karakteri tasimali
- koleksiyonluk his vermeli
- merkezde premium bir odak noktasi olabilir
- ama cocuksu veya ucuz durmamalı

## Son Teslim Beklentisi

Lutfen su formatta teslim et:

1. 4 farkli premium card face direction
2. 2 farkli premium card back direction
3. her biri icin clean skin version
4. mumkunse preview mock version
5. her tasarim icin 1 satirlik materyal/stil aciklamasi

## Tek Cumlelik Ozet

Hushle icin arka plan sahnesi degil, kartin kendi malzemesi premium hissettiren; okunakli, koleksiyonluk, modern ve satin alinabilir kart skinleri tasarla.
