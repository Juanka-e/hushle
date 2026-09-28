# Hushle Image-Only Card Generation Brief

Bu dosya sadece gorsel ureten yapay zeka araclari icindir.

Ornek:

- ChatGPT image
- Gemini image
- Midjourney
- Leonardo
- Firefly
- benzeri text-to-image araclari

Bu araclar icin Stitch brief'i birebir kullanma.
Cunku bunlar HTML veya yapisal editor mantigiyla degil, dogrudan tek kare gorsel uretimi ile calisir.

## Ana Hedef

Hushle icin premium, koleksiyonluk, satin alinabilir kart skinleri uret.

Ama:

- tam poster tasarlama
- arka plan sahnesi yapma
- tam illustre kapak yapma
- kartin ustune final oyun metinlerini basma

Onun yerine:

- kart skin'i uret
- premium materyal dili uret
- okunakli safe area birak

## En Dogru Uretim Tipi

Image-only AI icin en iyi cikti:

### 1. Clean Skin

Bu ana dosyadir.

Sart:

- ana kelime yazma
- yasakli kelimeleri yazma
- lorem ipsum yazma
- sahte UI yazilari koyma
- gereksiz ikon kalabaligi yapma

Bos kalmasi gereken alanlar:

- ortadaki ana kelime alani
- alt bolgedeki 5 satirlik yasakli kelime alani
- sag ustteki zorluk ikonu alani

### 2. Preview Mock

Ikinci alternatif olarak ayni tasarimin preview mock versiyonu alinabilir.

Bu versiyonda:

- ornek ana kelime olabilir
- 5 satirlik ornek kelime olabilir
- ama bu sadece onizleme icin olur

Oyuna asil entegre edecegimiz dosya clean skin olmalidir.

## En Onemli Kural

Text alanlarini AI'a yazdirmak yerine bos birakmak daha profesyoneldir.

Cunku:

- oyun ici kelimeler dinamik gelecek
- yasakli kelimeler degisecek
- localization olabilir
- responsive davranis lazim
- ayni skin birden fazla kartta kullanilacak

Bu nedenle ana tercih:

- `clean skin first`
- `preview mock optional`

## Tasarim Dili

Su hisleri ver:

- premium
- modern
- collectible
- boutique
- elegant
- tactile
- expensive

Su materyal dillerine odaklan:

- obsidian glass
- pearl lacquer
- linen paper
- gold foil
- velvet finish
- carbon fiber
- holographic film
- satin metallic

## Kacinilacaklar

- generic mobile game look
- cocuksu tasarim
- asiri kalin ve tombik kart
- asiri parlak ucuz glow
- poster gibi background illustration
- metni bozan texture
- asiri detayli sahne
- fake small text blocks
- random symbols that look like fake UI

## Safe Area Kurallari

Kart orani:

- `3:4`

Bos tutulmasi gereken alanlar:

### Top-right icon safe area

- sag ustte kucuk temiz alan
- zorluk ikonu sonradan eklenecek

### Main word safe area

- kartin ust-orta ile orta arasinda buyuk temiz alan
- premium baslik icin uygun alan

### Forbidden words safe area

- alt yariya dogru 5 satirlik rahat okunur alan
- bu bolgede texture ve kontrast cok agresif olmamali

## Export Kurallari

Onerilen boyut:

- minimum `900x1200`
- tercihen `1800x2400`

Format:

- `PNG`
- `WebP`

Kart tam dikdortgen export olsun.
Radius ve efektleri gerekirse sonradan kodla veririz.

## AI Prompt Template

```text
Design a premium collectible card skin for a party word game called Hushle.

Important:
- Do not create a poster or a scenic illustration
- Focus on the card surface itself
- Emphasize material quality, texture, premium border treatment, lacquer, foil, pearl, velvet, carbon, holo, or linen-like finishes
- Keep the layout clean and premium

The card anatomy is fixed:
- small difficulty icon area in the top-right
- header / brand zone near the top
- large main word area in the upper-middle / center
- five forbidden-word lines in the lower half

Very important:
- leave the main word area visually clean
- leave the 5 forbidden-word rows visually clean
- do not place final text content there
- do not generate lorem ipsum or fake UI copy
- do not fill the card with busy illustration

Target mood:
premium, collectible, elegant, modern, tactile, desirable, expensive

Avoid:
generic mobile game UI, childish style, noisy background scenes, cheap gradients, bloated card proportions

Output:
a clean front card skin with safe empty areas for later text placement
```

## Back Face Prompt Template

```text
Design a premium collectible card back skin for a party word game called Hushle.

Focus on:
- premium material language
- collectible feel
- elegant center composition
- not childish
- not poster-like

Avoid:
- noisy scenes
- cheap gradients
- excessive symbols
- fake text blocks

Output:
a clean card back design that feels premium and pairs with a luxury game cosmetic system
```

## Ozet Karar

Image-only AI icin dogru cozum:

- metinsiz clean skin uret
- istersek ayri preview mock da urettir
- oyuna clean skin dosyasini bagla
- metni, ikonlari ve efektleri biz kodla ekleyelim
