# Hushle Card Template Registry Plan

Son guncelleme: 3 July 2026

## Amac

Bu dokumanin amaci, Hushle kart tasarimlarini serbest JSON karmasasindan cikarip daha yonetilebilir bir registry modeline baglamaktir.

Hedef:

- admin panelde her seferinde sifirdan key dusunmemek
- AI ile uretilen tasarimlari kontrollu alanlara oturtmak
- eski satin alimlari bozmadan yeni capability eklemek

## Temel Fikir

Bugun sistem `templateKey + templateConfig + renderSpecVersion` ile calisiyor.

Bir sonraki adim:

- `templateKey` sadece string olmasin
- arkasinda resmi bir "template registry" olsun

Bu registry sunlari tanimlar:

- template ailesi
- hangi kart yuzlerinde kullanilabilir
- hangi alanlar zorunlu
- hangi varyantlar destekli
- hangi `renderSpecVersion` ile uyumlu

## Onerilen Registry Kaydi

```ts
type CardTemplateRegistryEntry = {
  key: string;
  label: string;
  family: "nature" | "coastal" | "royal" | "library" | "cosmic" | "volcanic" | "candy" | "tech";
  surfaces: Array<"card_face" | "card_back">;
  renderSpecVersion: number;
  mode: "template" | "image" | "hybrid";
  schema: {
    palette: boolean;
    pattern: boolean;
    texture: boolean;
    scene: boolean;
    ornaments: boolean;
    motion: boolean;
    overlay: boolean;
  };
  presets?: string[];
  notes?: string;
};
```

## Onerilen Ana Alanlar

### `family`

Tasarimin stil ailesi.

Ornek:

- `nature`
- `coastal`
- `library`
- `cosmic`
- `royal`
- `volcanic`

Bu alan analytics, filtreleme ve admin UX icin degerli.

### `mode`

- `template`
  - saf JSON tabanli
- `image`
  - gorsel tabanli
- `hybrid`
  - image + template overlay

Gorseldeki dokulu sahneler icin uzun vadede en dogru mod genelde `hybrid`.

### `schema`

Her template her ozelligi desteklemek zorunda degil.

Ornek:

- `library` ailesi:
  - texture: `true`
  - scene: `true`
  - ornaments: `false`
- `signal_grid` ailesi:
  - texture: `false`
  - scene: `false`
  - pattern: `true`

Bu sayede admin panelde sadece ilgili alanlar acilir.

## Onerilen Theme Slots

Bu slotlar kart layout'unu degistirmez, sadece gorunumu degistirir.

### `palette`

- `primary`
- `secondary`
- `surface`
- `border`
- `word`
- `taboo`
- `footer`
- `title`
- `detail`

### `pattern`

- `type`
- `opacity`
- `scale`

### `texture`

Yeni slot.

Onerilen degerler:

- `none`
- `paper`
- `grain`
- `fabric`
- `mist`
- `gloss`
- `dust`

Not:

- ilk asamada bu alan sadece metadata veya CSS class secici gibi kullanilabilir
- daha sonra gercek texture overlay assetlerine baglanabilir

### `scene`

Yeni slot.

Kart arka planindaki tema sahnesini tanimlar.

Onerilen degerler:

- `none`
- `mountains`
- `waves`
- `shelves`
- `moon`
- `embers`
- `clouds`
- `garden`

Bu slot, gorseldeki gibi "plaj", "doga", "kutuphane", "lav ocagi" hissini veren ana katmandir.

### `ornaments`

Yeni slot.

Decoratif oge ailesi.

Onerilen degerler:

- `none`
- `flowers`
- `stars`
- `crowns`
- `bubbles`
- `sparkles`

### `motion`

- `preset`
- `speedMs`
- ileride:
  - `trigger`: `hover` | `always` | `inspect`

## Registry Ornekleri

### `nature_meadow`

```json
{
  "key": "nature_meadow",
  "label": "Nature Meadow",
  "family": "nature",
  "surfaces": ["card_face", "card_back"],
  "renderSpecVersion": 2,
  "mode": "hybrid",
  "schema": {
    "palette": true,
    "pattern": true,
    "texture": true,
    "scene": true,
    "ornaments": true,
    "motion": true,
    "overlay": true
  },
  "notes": "Soft meadow scene with flower ornaments and low mist motion."
}
```

### `library_amber`

```json
{
  "key": "library_amber",
  "label": "Library Amber",
  "family": "library",
  "surfaces": ["card_face", "card_back"],
  "renderSpecVersion": 2,
  "mode": "hybrid",
  "schema": {
    "palette": true,
    "pattern": true,
    "texture": true,
    "scene": true,
    "ornaments": false,
    "motion": false,
    "overlay": true
  },
  "notes": "Paper + shelves atmosphere, no mandatory motion."
}
```

### `coastal_breeze`

```json
{
  "key": "coastal_breeze",
  "label": "Coastal Breeze",
  "family": "coastal",
  "surfaces": ["card_face", "card_back"],
  "renderSpecVersion": 2,
  "mode": "hybrid",
  "schema": {
    "palette": true,
    "pattern": true,
    "texture": true,
    "scene": true,
    "ornaments": true,
    "motion": true,
    "overlay": true
  },
  "notes": "Beach sky + wave bands + airy grain."
}
```

## `renderSpecVersion` Ile Iliski

### `v1`

Bugunku sistem:

- palette
- pattern
- glow
- motion
- overlay

### `v2`

Bir sonraki mantikli asama:

- `texture`
- `scene`
- `ornaments`
- `layout` degismeden ek decorative slots

Bu tam olarak gorseldeki tipte daha zengin ama kontrollu kartlara kapi acar.

### `v3`

Ilerde:

- layered masks
- back/front pair presets
- hover behavior metadata
- scene asset token system

## Geriye Donuk Uyumluluk

Kural:

- eski itemlari registry'siz birakabilirsin
- ama yeni itemlar registry uzerinden gitmeli

Pratik strateji:

1. mevcut `templateKey` degerlerini registry'ye map et
2. yeni tasarimlari registry-first ekle
3. eski satin alim kayitlarini migration ile bozmadan surdur

## Teknik Oneri

Kod tarafinda ilk adimda su dosya mantigi yeterli:

- `apps/web/src/lib/cosmetics/card-template-registry.ts`

Icinde:

- statik registry listesi
- `getCardTemplateRegistryEntry(key)`
- `getTemplatesBySurface(type)`
- `getTemplatesByFamily(family)`

Bu sayede admin panel select ve preview mantigi ortak bir kaynaktan beslenir.

## Sonuc

Bu registry yapisi sayesinde:

- AI ile uretim daha kontrollu olur
- admin panelde alanlar kendini template'e gore acip kapatir
- doku, sahne, cicek, bulut gibi daha karakterli tasarimlar sisteme daha temiz girer
- versiyonlama daha duzgun yonetilir
