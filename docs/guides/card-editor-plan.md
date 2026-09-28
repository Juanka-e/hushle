# Hushle Semi-Structured Card Editor Plan

Son guncelleme: 3 July 2026

## Amac

Bu editorun amaci, admin kullanicisinin ham JSON yazmadan kart tasarimi olusturabilmesi; ama isterse ileri duzey ayarlarla sistemi yine esnetebilmesidir.

Bu yuzden model:

- form tabanli kontrollu alanlar
- canli preview
- istege bagli gelismis override alani

## Neden Serbest JSON Yetmiyor

Serbest JSON textarea'nin sorunlari:

- yazim hatasi cok kolay
- ayni konsepti her admin farkli isimle yazar
- AI'dan gelen ciktinin tutarliligi dusuk olur
- dokulu/sahneli kartlar geldikce alan sayisi kontrolden cikar

## Editor Yapisi

### 1. Template Secimi

Alanlar:

- `surfaceType`
  - `card_face`
  - `card_back`
- `templateFamily`
  - `nature`
  - `coastal`
  - `library`
  - `royal`
  - `cosmic`
  - `volcanic`
  - `candy`
  - `tech`
- `templateKey`
  - registry'den secilir

### 2. Stil Panelleri

#### Renkler

- primary
- secondary
- surface
- border
- word
- taboo
- footer

#### Doku

- texture preset
  - `none`
  - `paper`
  - `grain`
  - `fabric`
  - `mist`
  - `gloss`
- texture opacity
- texture scale

#### Sahne

- scene preset
  - `none`
  - `mountains`
  - `waves`
  - `shelves`
  - `moon`
  - `embers`
  - `clouds`
  - `garden`
- scene intensity
- scene alignment

#### Süsleme

- ornaments preset
  - `none`
  - `flowers`
  - `stars`
  - `crowns`
  - `bubbles`
  - `sparkles`
- ornament density

#### Hareket

- motion preset
  - `none`
  - `pulse`
  - `drift`
  - `shimmer`
- motion speed
- trigger
  - `none`
  - `hover`
  - `always`

### 3. Asset Paneli

Hybrid veya image modda:

- scene image upload
- overlay image upload
- pair asset secimi

Bu bolum cicek, bulut, raf, dag, ay gibi literal ogeler icin gerekli.

### 4. Gelismis Override

En altta kucuk bir advanced alan kalir:

- `advancedTemplateConfig`

Ama bu alan:

- tum editor ciktisini degil
- sadece override block'unu yazar

Ornek:

```json
{
  "overlay": {
    "opacity": 0.22
  },
  "motion": {
    "speedMs": 4200
  }
}
```

## Onerilen Admin UX

### Sol kolon

- urun bilgileri
- type / rarity / render mode
- template secimi
- stil kontrolleri

### Sag kolon

- live preview
- front/back preview
- mobile crop preview
- shop card preview

Bu sayede admin sadece guzel masaustu gorunume bakip hata yapmaz.

## AI Entegrasyonu Nasil Olur

Editor icinde ekstra bir alan olabilir:

- `AI brief`

Admin brief yazar, AI su ciktiyi verir:

- onerilen family
- onerilen template key
- renkler
- texture
- scene
- ornaments
- motion

Sonra sistem bunu editor alanlarina map eder.

Yani AI dogrudan veritabani kaydi yazmaz; editor'e taslak doldurur.

Bu daha guvenli yaklasimdir.

## Onerilen Veri Akisi

1. registry kaydi secilir
2. editor yalniz o registry'nin izin verdigi alanlari acilir
3. admin ayarlari yapar
4. sistem `templateConfig` uretir
5. preview ayni resolver ile cizilir
6. kayit sirasinda validate edilir

## Validasyon Kurallari

Editor su hatalari UI seviyesinde yakalamali:

- gecersiz hex renk
- asiri dusuk kontrast
- desteklenmeyen texture preset
- desteklenmeyen scene preset
- `image` modda bos asset
- `template` modda bos key

## Neden Yarim Yapi

Tam kapali sistem istemiyoruz. Cunku:

- yarin yeni family ekleyecegiz
- bazen deneysel premium kart cikacak
- AI bazen iyi ama standart disi kombinasyonlar onerecek

Bu yuzden sistem:

- %80 kontrollu form
- %20 gelismis override

olmali.

## MVP Surumu

Ilk asamada editor bunlari yapsa yeter:

1. registry secimi
2. palette ayari
3. texture preset secimi
4. scene preset secimi
5. ornaments secimi
6. motion ayari
7. optional overlay upload
8. live preview

## Sonuc

Bu editor yapisi sayesinde:

- admin panel kullanimi kolaylasir
- AI destekli kart uretimi pratiklesir
- gorseldeki gibi dokulu ve sahneli kartlar kontrolsuz bir JSON batagina donusmeden sisteme girer
