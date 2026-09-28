# Hushle Card Design Guide

Son guncelleme: 3 July 2026

## Amac

Bu rehberin amaci, Hushle icin kart on/arka tasarimlarini:

1. AI ile hizli uretebilir hale getirmek
2. admin panelden risksiz eklenebilir hale getirmek
3. ileride tasarim sistemi degisse bile eski satin alimlari bozmadan yasatmak

Bu rehber operasyon odaklidir. Teknik sinirlar ve JSON kurallari icin ana referans:

- `docs/dashboard-ui/cosmetic-authoring-spec.md`
- `docs/guides/card-template-registry-plan.md`
- `docs/guides/card-editor-plan.md`

## Mevcut Durum

Kart kozmetik sistemi su an zaten bu omurgaya sahip:

- `renderMode`: `image` veya `template`
- `templateKey`: stil ailesi kimligi
- `templateConfig`: tasarimin degiskenleri
- `renderSpecVersion`: renderer davranisinin surumu

Bu iyi haber. Yani yeni kart tasarimlari eklemek icin oyunun ana kart komponentini her seferinde bastan yazmak zorunda degiliz.

## En Onemli Prensip

Kartta her sey degismemeli. Sadece tema degismeli.

Sabit kalmasi gereken alanlar:

- ana kelime alani
- yasakli kelimeler listesi
- sag ust zorluk ikonu
- temel okunurluk hiyerarsisi

Degisebilecek alanlar:

- renk paleti
- border karakteri
- arka plan pattern'i
- glow
- motion
- overlay image
- header/footer karakteri

Bu ayrim kritik. Cunku Hushle oyun mantigi metin okunurlugune bagli; kartin kendisi bir "skin", bilgi duzeni degil.

## Kod Tarafinda Bugunku Sabit Slotlar

Bugun oyun karti bu sabit iskeletle render ediliyor:

- `apps/web/src/components/game/game-card.tsx`
  - ust header
  - sag ust zorluk ikonu
  - ortada `card.word`
  - altta `card.taboo`
- `apps/web/src/lib/cosmetics/card-face.ts`
  - kart on yuz theme resolver
- `apps/web/src/lib/cosmetics/card-back.ts`
  - kart arka yuz theme resolver

Yani AI veya admin panel yeni bir kart cikardiginda aslinda su anki sistem "layout degistirmiyor", "tema enjekte ediyor".

Bu su anda dogru yon.

## Ne Yapmaliyiz

Kisa cevap:

- kart layout engine'i sabit kalmali
- kart theme engine'i buyumeli
- yeni tasarimlar `templateKey + templateConfig + renderSpecVersion` ile gelmeli

Boylece:

- bugunku satin alimlar bozulmaz
- yarin daha zengin template sistemi eklenebilir
- ileride cok daha cesitli kart aileleri desteklenebilir

## Onerilen Mimari

Kart tasarimlarini 3 katmana ayir:

### 1. Layout Layer

Oyunun zorunlu bilgi yerlesimi.

Ornek:

- `difficultyBadge`
- `wordBlock`
- `tabooList`
- `footerStrip`

Bu katman oyun UX'ine ait oldugu icin kolay kolay degismemeli.

### 2. Theme Layer

Kartin stil dili.

Ornek:

- `palette`
- `pattern`
- `glow`
- `motion`
- `overlay`
- `frame-like border behavior`

Bu katman admin panel ve AI ile surekli genisleyebilir.

### 3. Spec Layer

Renderer'in o temayi nasil yorumladigi.

Bunu `renderSpecVersion` temsil eder.

Ornek:

- `renderSpecVersion = 1`
  - bugunku basic theme parser
- `renderSpecVersion = 2`
  - ekstra decorative slots
- `renderSpecVersion = 3`
  - template regions, layered masks, richer motion budget

Bu sayede eski urunler `v1` gibi kalir, yeni urunler `v2/v3` ile calisir.

Bugunku implementasyon durumu:

- yalniz v1 parser'i desteklenir
- resolver requested/effective version ve fallback bilgisini tasir
- bilinmeyen snapshot version'i oyunu bozmak yerine v1'e duser
- admin API, renderer eklenmeden v2/v3 item kaydetmez
- yeni version acma sirasi
  `docs/architecture/release-compatibility-and-versioning.md` icindedir

## Neden Versiyonlama Sart

Asagidaki durumlar ileride kesin olacak:

- yeni pattern tipleri eklenecek
- daha cesitli decorative elementler eklenecek
- image + template hibrit urunler artacak
- belki seasonal kart aileleri gelecek

Eger versiyonlama olmazsa:

- eski urunler yeni renderer altinda farkli gozukebilir
- satin alinmis kartlar kirilabilir
- admin panelde eski JSON'lar yeni semayla carpisabilir

Bu yuzden kural:

- mevcut urunlerin `renderSpecVersion` degeri korunur
- yeni renderer davranisi gerekiyorsa yeni version acilir
- var olan satin alim kayitlari migrasyon zorunluluguna itilmez

## AI Ile Kart Tasarimi Uretme Akisi

AI'a direkt "bana guzel kart yap" demek kotu sonuc verir.

Her zaman su formatta brief ver:

```text
Urun tipi: card_face
Marka: Hushle
Rarity: epic
Tasarim amaci: premium ama okunakli oyun karti
Sabit alanlar:
- sag ust zorluk ikonu
- ortada ana kelime
- altta yasakli kelimeler listesi
Degisebilecek alanlar:
- palette
- pattern
- glow
- motion
- overlay
Istenen his:
- modern
- ayirt edilebilir
- oyun icinde okunakli
Kacinilacaklar:
- metin altinda asiri hareket
- kontrasti dusuren texture
- generic mobil oyun gradienti
Teslim:
1. templateKey oner
2. renderSpecVersion oner
3. JSON templateConfig ver
4. 2-3 cumlelik tasarim aciklamasi yaz
Kurallar:
- sadece destekli pattern tiplerini kullan
- sadece destekli motion presetlerini kullan
- HTML/CSS/JS uretme
- layout degistirme, sadece tema uret
```

## AI Promptablonlari

### Card Face Promptablonu

```text
Hushle icin card_face template tasarla.
Bu bir oyun karti kozmetigi; layout sabit kalacak.
Sadece tema katmanini tasarla.

Rarity: legendary
Tema: celestial archive
Ana renkler: #0f172a, #38bdf8, #e0f2fe, #f59e0b
Istenen his: premium, temiz, modern, hafif gizemli
Sabit alanlar:
- top-right difficulty icon
- centered main word
- forbidden words list below
- footer strip
Kacinilacaklar:
- text readability loss
- noisy full-surface texture
- childish gradients

Teslim:
1. templateKey
2. renderSpecVersion
3. templateConfig JSON
4. neden oyunda iyi calisacagina dair kisa not
```

### Card Back Promptablonu

```text
Hushle icin card_back template tasarla.
Bu yuzde bilgi yok; marka karakteri ve premium hissi onemli.

Rarity: epic
Tema: storm vault
Ana renkler: #111827, #7c3aed, #c4b5fd, #f8fafc
Istenen his: guclu, teknolojik, temiz
Kacinilacaklar:
- ortada anlamsiz logo yigini
- asiri glow
- dusuk kontrast

Teslim:
1. templateKey
2. renderSpecVersion
3. templateConfig JSON
4. kart on yuzuyle nasil eslesecegine dair kisa not
```

## Admin Panelden Ekleme Kurali

Admin panelde su alanlar zaten var:

- `type`
- `renderMode`
- `renderSpecVersion`
- `imageUrl`
- `templateKey`
- `templateConfig`

Kart tasarimi eklerken operasyon sirasi:

1. once tasarimin `card_face` mi `card_back` mi oldugunu netlestir
2. image mi template mi karar ver
3. `code` ve `templateKey` isimlerini kalici olacak sekilde sec
4. ilk denemede yeni renderer yazma; mevcut spec icinde kal
5. admin preview'da kontrol et
6. oyun kartinda okunurluk testi yap
7. inventory ve shop gorunumlerinde de kontrol et

## Naming Kurallari

Kodlar gecici dusunulmemeli.

Oneri:

- urun kodu: `celestial_archive_face`
- template key: `celestial_archive`
- eslesik back: `celestial_archive_back`

Kural:

- ayni stil ailesi ayni `templateKey` kokunden turemeli
- `code` urune ozgu olmali
- `templateKey` stil ailesine ozgu olmali

## Hangi Durumda `image`, Hangi Durumda `template`

`template` kullan:

- hizli iterasyon istiyorsan
- renk/pattern/glow/motion ile fark yaratabiliyorsan
- AI'dan JSON tabanli varyasyon almak istiyorsan
- admin panelden kolay yonetim istiyorsan

`image` kullan:

- cicek, bulut, altin isleme, mascot gibi ozel cizim gerekiyorsa
- siluet ve dekoratif detaylar kritikse
- standart pattern seti yetersiz kaliyorsa

Pratikte en saglikli yol:

- temel sistem `template-first`
- premium ozel setler `image + template hybrid hissi`

Bugunku sistemde image urunler overlay gibi davraniyor; bu da yeterince esnek.

## Cicek, Bulut, Ozel Gorsel Oge Nasil Eklenir

Bunun iki yolu var:

### 1. Image Tabanli

En temiz yol.

- kart yuzune veya arkasina ozel ilustrasyonlu asset hazirlanir
- admin panelde `renderMode = image`
- `imageUrl` ile eklenir
- text safe area korunur

Bu yontem:

- cicek
- bulut
- altin ornament
- kagit dokusu
- anime benzeri shape language

gibi detaylar icin en uygunudur.

### 2. Template Tabanli

Sadece soyutlastirilmis versiyonlarda uygundur.

Ornek:

- bulut hissi icin yumusak `noise`
- cicek hissi icin rings/dots tabanli ritim
- luxe his icin glow + ornate border mantigi

Ama literal "cicek cizimi" veya "bulut illustrasyonu" icin template tek basina yeterli degil.

## Uzun Vadeli Esneklik

Evet, bu yapidan daha sonra kolayca cikabiliriz; dogru yonetirsek versiyonlama sorun cikarmaz.

Bunun icin kural seti:

- eski itemlari silme yerine pasife al
- mevcut `templateKey` anlamini geriye donuk bozma
- yeni yorumlama gerekiyorsa `renderSpecVersion` artir
- gerekirse yeni decorative capability'leri sadece yeni version'da ac

Bu sayede kullanicinin gecmiste aldigi urun:

- envanterde kalir
- ayni kimlikle render edilir
- yeni sistem ciksa bile kirilmaz

## Onay Checklist'i

Yeni kart tasarimini yayina almadan once:

1. `GameCard` uzerinde masaustu test et
2. mobil genislikte test et
3. zorluk ikonunun kaybolmadigini kontrol et
4. ana kelime kontrastini kontrol et
5. yasakli kelime listesinin okunurlugunu kontrol et
6. shop preview ile oyun ici preview arasinda bariz fark olmadigini kontrol et
7. narrator ve takim oyuncusu akislarinda bilgi sizmasi olmadigini kontrol et
8. flip kapaliyken kartin dogru default yuzu gosterdigini kontrol et

## Sonraki Teknik Adim

Kart sistemi sinirsiz ceside yaklasacaksa bir sonraki mantikli evrim:

1. kart face/back icin resmi bir `template registry` eklemek
2. her `templateKey` icin desteklenen varyant alanlarini tanimlamak
3. admin panelde serbest JSON yerine yari-yapilandirilmis editor vermek
4. `renderSpecVersion` bazli preview farklarini gostermek
5. AI prompt ciktisini direkt iceri alacak bir import workflow hazirlamak

Bugun icin sonuc net:

- kart tasarim sistemi yapilmadi degil
- cekirdek altyapi yapildi
- buyuk "template catalog / AI authoring flow" parcasi eksik kalmisti
- bu rehber o eksigi kapatmak icin yazildi

## Prototip Dosyalari

Dokulu ve sahneli kart denemeleri icin:

- `scripts/design-prototypes/card-designs.html`
- `scripts/design-prototypes/card-designs-extended.html`
- `scripts/design-prototypes/card-design-textured.html`

Not:

- `card-design-textured.html` artik arka plan sahnesi degil, dogrudan kart materyaline odaklanir.
- hedef dil: folyo, lak, keten, inci, kadife, karbon, holo gibi daha premium ve koleksiyonluk hisler.
