# Cosmetic Authoring Spec

Son guncelleme: 9 March 2026

## Amac

Bu dokumanin amaci iki seyi standart hale getirmektir:

1. Yapay zekaya verilecek kozmetik tasarim brief'leri tutarli olsun.
2. Uretilen kozmetik veya template efektleri admin panelden guvenli sekilde eklenebilsin.

Bu spec hem gorsel asset tabanli urunler hem de `template + JSON` ile render edilen urunler icin referanstir.

Operasyon akisi, AI promptablonlari ve Hushle kart sabit slot prensibi icin ek rehber:

- `docs/guides/card-design-guide.md`

## Thumbnail Standardi

- Her urun icin `thumbnailUrl` opsiyoneldir ancak buyuk kataloglarda onerilir.
- Avatar ve frame: kare WebP, onerilen `256x256`, hedef en fazla `80 KB`.
- Card face ve card back: `3:4` WebP, onerilen `240x320`, hedef en fazla `100 KB`.
- Thumbnail animasyon, flip veya gameplay metni tasimaz; grid icin statik kapaktir.
- Asil `imageUrl` detay ve oyun kalitesini korur. Thumbnail bunun yerine gecmez.
- Admin thumbnail yuklemezse sistem hafif statik fallback uretir; runtime'da
  thumbnail dosyasi render edip depolayan bir image-processing job'u yoktur.

## Admin Preset Akisi

- Frame, card face ve card back editorleri test edilen iki baslangic preseti sunar.
- Preset secimi yalniz `templateKey` ve `templateConfig` alanlarini degistirir.
- Isim, code, fiyat, rarity, yayin penceresi ve aktiflik bilgisi korunur.
- Preset uygulandiktan sonra admin sagdaki canli preview'da gercek resolver sonucunu
  kontrol eder; preset kaydetme islemini otomatik baslatmaz.
- Avatar yalniz image render destekledigi icin template preset gostermez.
- Preset katalogu `apps/web/src/lib/cosmetics/authoring-presets.ts` dosyasindadir;
  sayfa icine kopya JSON eklenmemelidir.

## Kozmetik Turleri

### 1. Avatar
- Render mode: `image`
- Kullanim yeri: oyuncu kutusu, profil, dashboard sidebar
- Su an template desteklenmez

### 2. Frame
- Render mode: `image` veya `template`
- Kullanim yeri: oyuncu avatar cevresi, sidebar, profil
- Desteklenen farklilastirma:
  - ring style
  - pattern
  - glow
  - motion

### 3. Card Face
- Render mode: `image` veya `template`
- Kullanim yeri: aktif oyun kartinin on yuzu
- Desteklenen farklilastirma:
  - palette
  - pattern
  - glow
  - motion
  - overlay opacity

### 4. Card Back
- Render mode: `image` veya `template`
- Kullanim yeri: transition screen, ileride kart arkasi preview
- Desteklenen farklilastirma:
  - palette
  - pattern
  - glow
  - motion
  - overlay opacity

---

## Gorsel Asset Kurallari

### Avatar Asset
- Onerilen canvas: `512x512`
- Format: `PNG`, `WebP`, `SVG`
- Arka plan:
  - tercihen transparan
  - zorunlu ise tek parca temiz arka plan
- Safe area:
  - asil karakter veya ikon `384x384` icinde kalmali
  - kenarlarda minimum `48px` bosluk birakilmali

### Frame Asset
- Onerilen canvas: `768x768`
- Format: `PNG`, `WebP`, `SVG`
- Orta acik alan:
  - ic bosluk avatarin ustunu kapatmamalidir
  - ic guvenli pencere: merkezde yaklasik `520x520`
- Cizim mantigi:
  - koseler guclu olabilir
  - merkez acik kalmali
  - alpha channel temiz olmali

### Card Face Asset
- Onerilen canvas: `900x1200`
- Aspect ratio: `3:4`
- Format: `PNG`, `WebP`, `SVG`
- Safe area:
  - ust badge alani: ustten `120px`
  - ana kelime alani: merkezde `620x220`
  - alt taboo listesi alani: alttan `220px` yukari kadar okunabilirlik korunmali
- Tasarim kurali:
  - kelime ve taboo text kontrasti her zaman yuksek olmali
  - arka plan deseni text okunurlugunu bozmamali

### Card Back Asset
- Onerilen canvas: `900x1200`
- Aspect ratio: `3:4`
- Format: `PNG`, `WebP`, `SVG`
- Safe area:
  - merkez rozet/ikon alani: `360x360`
  - ust title badge alani: ustten `120px`
  - alt dekorasyon alanlari kenarlara yakin olabilir

---

## Template JSON Kurallari

### Kok yapi

Root her zaman bir JSON object olmalidir.

Desteklenen nesting:
- maksimum derinlik: `3`
- object basina maksimum key: `24`
- array basina maksimum eleman: `12`

Desteklenen deger tipleri:
- `string`
- `number`
- `boolean`
- `null`
- scalar array
- nested object

Desteklenmeyenler:
- function benzeri stringler isletilmez
- HTML veya script bir anlam tasimaz
- object array desteklenmez

### Desteklenen ana bloklar

#### `palette`
Renk ailesini tanimlar.

Ornek:
```json
{
  "palette": {
    "primary": "#22c55e",
    "secondary": "#bbf7d0",
    "surface": "#0f172a",
    "border": "#6ee7b7",
    "word": "#ffffff",
    "taboo": "#fca5a5",
    "footer": "#dcfce7",
    "title": "#ffffff",
    "detail": "#cbd5e1"
  }
}
```

Not:
- Tum renkler hex olmalidir.
- Guvenli format: `#RGB` veya `#RRGGBB`

#### `pattern`
Desen tipini tanimlar.

Desteklenen `pattern.type` degerleri:
- `none`
- `grid`
- `dots`
- `diagonal`
- `chevrons`
- `rings`
- `noise`

Desteklenen alanlar:
- `type`
- `opacity`
- `scale`

Ornek:
```json
{
  "pattern": {
    "type": "rings",
    "opacity": 0.22,
    "scale": 16
  }
}
```

#### `glow`
Parlama ve etki yogunlugunu tanimlar.

Desteklenen alanlar:
- `color`
- `blur`
- `opacity`

Ornek:
```json
{
  "glow": {
    "color": "#4ade80",
    "blur": 28,
    "opacity": 0.24
  }
}
```

#### `motion`
Animasyon karakterini tanimlar.

Desteklenen `motion.preset` degerleri:
- `none`
- `pulse`
- `drift`
- `shimmer`

Desteklenen alanlar:
- `preset`
- `speedMs`

Ornek:
```json
{
  "motion": {
    "preset": "shimmer",
    "speedMs": 3600
  }
}
```

#### `frame`
Sadece frame template'lerinde kullanilir.

Desteklenen `frame.style` degerleri:
- `solid`
- `double`
- `ornate`

Desteklenen alanlar:
- `style`
- `thickness`
- `radius`

Ornek:
```json
{
  "frame": {
    "style": "ornate",
    "thickness": 3,
    "radius": 20
  }
}
```

#### `overlay`
Card face ve card back image blend yogunlugunu tanimlar.

Desteklenen alanlar:
- `opacity`

Ornek:
```json
{
  "overlay": {
    "opacity": 0.24
  }
}
```

---

## Tip Bazli JSON Rehberi

### Frame Template Ornegi
```json
{
  "palette": {
    "primary": "#22c55e",
    "secondary": "#bbf7d0"
  },
  "pattern": {
    "type": "rings",
    "opacity": 0.22,
    "scale": 14
  },
  "glow": {
    "color": "#4ade80",
    "blur": 24,
    "opacity": 0.24
  },
  "frame": {
    "style": "ornate",
    "thickness": 3,
    "radius": 20
  },
  "motion": {
    "preset": "pulse",
    "speedMs": 4200
  }
}
```

### Card Face Template Ornegi
```json
{
  "palette": {
    "primary": "#8b5cf6",
    "secondary": "#ddd6fe",
    "surface": "#1e1b4b",
    "border": "#c4b5fd",
    "word": "#ffffff",
    "taboo": "#fda4af",
    "footer": "#ede9fe"
  },
  "pattern": {
    "type": "noise",
    "opacity": 0.18,
    "scale": 16
  },
  "glow": {
    "color": "#a855f7",
    "blur": 28,
    "opacity": 0.2
  },
  "motion": {
    "preset": "shimmer",
    "speedMs": 3400
  }
}
```

### Card Back Template Ornegi
```json
{
  "palette": {
    "surface": "#111827",
    "border": "#38bdf8",
    "primary": "#22d3ee",
    "secondary": "#93c5fd",
    "title": "#f8fafc",
    "detail": "#cbd5e1"
  },
  "pattern": {
    "type": "chevrons",
    "opacity": 0.2,
    "scale": 18
  },
  "glow": {
    "color": "#38bdf8",
    "blur": 30,
    "opacity": 0.22
  },
  "motion": {
    "preset": "drift",
    "speedMs": 6200
  },
  "overlay": {
    "opacity": 0.24
  }
}
```

---

## Animasyon ve Efekt Butcesi

UI'nin dagilmamasi icin su sinirlar korunmali:

- Ayni anda tek kozmetikte maksimum:
  - `1 pattern`
  - `1 glow`
  - `1 motion preset`
- Asiri hizli animasyon kullanma:
  - minimum `1800ms`
  - onerilen aralik `3200ms - 7200ms`
- Pattern opacity:
  - ideal aralik `0.12 - 0.26`
- Glow blur:
  - frame icin ideal `18 - 28`
  - card icin ideal `24 - 36`

---

## AI Prompt Kurali

Yapay zekaya tasarim cikarirken su format kullanilmali:

```text
Urun tipi: frame
Tema: neon archive / sci-fi museum / elite reward
Rarity: legendary
Ana renkler: #22d3ee, #93c5fd, #0f172a
Istenen his: premium, temiz, teknolojik, tek bakista ayirt edilebilir
Kacinilacaklar: generic gradient, fazla parlak bloom, metin okunurlugunu bozan pattern
Teslim:
1. JSON templateConfig
2. kisa templateKey onerisi
3. bu efektin oyunda nasil gorunecegine dair 2-3 cumle
Kurallar:
- desteklenen pattern tiplerinden birini kullan
- motion preset sadece none/pulse/drift/shimmer
- frame style sadece solid/double/ornate
- JSON 3 nested seviyeyi gecmesin
```

---

## Admin Panelden Ekleme Akisi

### Image tabanli urun
1. `/admin/shop-items` ac
2. `type` sec
3. `renderMode = image`
4. gorsel yukle veya URL gir
5. merchandizing alanlarini belirle:
   - `sortOrder`: magazadaki ana sira
   - `isFeatured`: sag dashboard `Shop Radar` havuzuna girsin mi?
   - `badgeText`: gerekiyorsa `YENI`, `LIMITLI`, `PREMIUM`
6. `templateKey` ve `templateConfig` bos birak
7. kaydet

### Template tabanli urun
1. `/admin/shop-items` ac
2. `type` sec
3. `renderMode = template`
4. `templateKey` gir
5. bu dokumandaki uygun JSON'u `templateConfig` alanina yapistir
6. merchandizing alanlarini belirle:
   - `sortOrder`
   - `isFeatured`
   - `badgeText`
7. `Ornek Doldur` ile baslangic json'u al, sonra ozellestir
8. kaydet

### Canli preview
- `/admin/shop-items` modal'i artik kaydetmeden once canli preview gosterir.
- Preview mantigi, oyun tarafinda kullanilan ayni resolver'lari kullanir:
  - `frame`
  - `card_face`
  - `card_back`
- Bu nedenle admin panelde gordugun stil, oyunda cikacak gorunume yakindir.
- JSON gecersiz ise preview sag panelinde hata mesaji gorunur ve fallback preview devam eder.
- Preview alaninda iki seviye vardir:
  - `Stage`: urunun oyun ici karakteri
  - `Shop Card Snapshot`: magazadaki merchandising gorunumu

---

## Merchandising Kurallari

### `sortOrder`
- Tum magaza grid'i bu alana gore siralanir.
- Daha kucuk deger daha yukari demektir.
- Onerilen artis: `10, 20, 30...`
- Yeni urun eklerken araya girebilmek icin bosluk birak.

### `isFeatured`
- `true` ise urun dashboard sag panelindeki `Shop Radar` havuzuna girebilir.
- `Shop Radar` tum featured urunleri ayni anda gostermez; kullanicinin sahip olmadigi featured urunlerden secim yapar.
- Bu nedenle featured flag, "magazada one cikan urun havuzu" anlamina gelir.

### `badgeText`
- Maksimum `24` karakter.
- Onerilen kullanimlar:
  - `YENI`
  - `LIMITLI`
  - `PREMIUM`
  - `SEZON`
- Rozet, hem magaza kartinda hem `Shop Radar` rail'inde gorunur.
- Her urunde rozet kullanma; sadece dikkat cekmek istedigin urunlerde kullan.

---

## Naming Kurallari

### `code`
- benzersiz olmali
- regex:
  - `^[a-z0-9_-]+$`
- onerilen format:
  - `ember_vault_back`
  - `royal_ring_frame`
  - `signal_noise_face`

### `templateKey`
- kisa, tekrar kullanilabilir, stil ailesini anlatsin
- onerilen format:
  - `ember_vault`
  - `royal_ring`
  - `signal_grid`
  - `frost_archive`

---

## Tasarim Kalite Kurallari

- Kozmetik tek bakista ayirt edilebilir olmali.
- Sadece renk tonu degistiren kopya urun cikarma.
- Her rarity farkli siluet veya etki karakteri tasimali.
- `legendary` urunler:
  - daha belirgin ikincil renk
  - daha zengin pattern
  - glow + motion kombinasyonu
- `common` urunler:
  - sade
  - dusuk pattern opacity
  - motion yok veya cok hafif

---

## Mevcut Teknik Sinirlar

Su an sistem bunlari destekler:
- nested template JSON
- pattern
- glow
- motion
- frame style
- image overlay opacity

Su an sistem bunlari desteklemez:
- particle system
- custom shader
- arbitrary CSS injection
- JS tabanli ozel animasyon
- object array tabanli procedural shape listesi

Bu sinir bilincli konuldu; amac admin paneli guvenli tutmak ve XSS/CSS injection yuzeyi acmamaktir.
