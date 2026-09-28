# Kozmetik, Kart ve Admin Yonetimi Uygulama Plani

## Amac

Bu plan, dashboard overlay tasarimini mevcut oyun akisina guvenli sekilde entegre etmek icin hazirlandi.
Hedef:

- Oyun ici dashboard ile inventory/shop/settings akisini kalici hale getirmek
- Avatar, frame, kart on yuzu ve kart arka yuzu sistemlerini ayri ve olceklenebilir modellemek
- Admin panelden kolay urun, indirim ve kupon yonetimi saglamak
- Mock veri ve mock asset yapisini gercek sisteme gecisi zorlastirmadan kurmak

## Temel Kararlar

### 1. Kozmetik tipleri ayri tutulacak

Asagidaki tipler tek bir "kozmetik" kavrami altinda toplanmayacak, cunku oyun ici kullanim yerlari farkli:

- `avatar`
- `frame`
- `card_back`
- `card_face`
- `bundle`

Neden:

- `avatar` oyuncu kutularinda ve profil alaninda kullanilir
- `frame` avatari cevreler, bagimsiz kusanilir
- `card_back` kart acilmadan once veya preview alaninda kullanilir
- `card_face` aktif Tabu kartinin on yuz temasini degistirir

## Progress Checkpoint (9 March 2026)

Bu planin ilk uygulanan kismi:
- `card_face` tipi eklendi
- `renderMode`, `templateKey`, `templateConfig` alanlari eklendi
- admin CRUD image/template urunleri kabul eder hale getirildi
- `GameCard` tarafinda equipped `card_face` tema resolve akisi kuruldu
- smoke test ve audit dogrulamasi eklendi
- `bundle` tek urun degil, urun grubu oldugu icin ayri iliski ister

### 2. Kart on yuzu ve kart arka yuzu ayri sistem olacak

- Kart on yuzu:
  - `GameCard` icindeki baslik, govde, border, difficulty badge, footer dekorasyonu degistirir
  - aktif gameplay ile birebir temas eder
- Kart arka yuzu:
  - kart reveal, inventory preview, transition ekranlari ve koleksiyon gorunumleri icin kullanilir
  - gameplay bilgisini dogrudan etkilemez

Bu ayrim yapilmadan "tek kart kozmigi" modeli kurulursa ileride kural kartlari, event kartlari ve animasyonlu arka yuzler sorun cikarir.

### 3. Asset sistemi iki modlu olacak

Her urun sadece resim yukleme mantigina baglanmayacak.
Iki ayri render yolu olacak:

- `image`
  - PNG / WebP / SVG / GIF dosyasi
  - avatar gibi gorsel agirlikli urunlerde uygun
- `template`
  - kodla uretilen tema
  - frame, card_back, card_face gibi tekrar kullanilabilir sistemlerde uygun

## Onerilen Veri Modeli

### ShopItem genisletmesi

Mevcut `ShopItem` modeli asagidaki alanlarla genisletilmeli:

- `type`
  - enum: `avatar | frame | card_back | card_face | bundle`
- `renderMode`
  - enum: `image | template`
- `thumbnailUrl`
  - magazada, envanterde ve discovery alaninda gosterilecek hafif kapak gorseli
  - asil asset veya immutable satin alma snapshot'inin parcasi degildir
- `assetUrl`
  - dosya tabanli urunlerde gercek asset yolu
- `templateKey`
  - kodla render edilen urunde hangi sablonun kullanilacagi
- `templateConfig`
  - JSON alan; renk, glow, pattern, border kalinligi, icon, overlay gibi parametreler
- `isFeatured`
  - vitrine cikacak urun isareti
- `availableFrom`
  - zamanli kampanyalar icin baslangic
- `availableTo`
  - zamanli kampanyalar icin bitis

### Thumbnail-first render karari

- Grid kartlari `thumbnailUrl` varsa yalniz bu optimize asset'i lazy-load eder.
- Thumbnail yoksa motion/flip calistirmayan statik bir fallback kullanilir.
- Tam template renderer yalniz kullanici detay/onizleme modalini actiginda mount edilir.
- Magaza ve envanter ilk 24 urunu render eder; devam eden urunler kullanici
  "Daha fazla goster" dediginde 24'luk partilerle eklenir.
- `thumbnailUrl` sunum/cache alanidir. Gameplay ve satin alma kimligi halen
  `renderMode`, `renderSpecVersion`, `imageUrl`, `templateKey` ve
  `templateConfig` snapshot'i ile korunur.

### UserProfile genisletmesi

Kullanici aktif kusanimlari burada tutulmaya devam edecek:

- `avatarItemId`
- `frameItemId`
- `cardBackItemId`
- `cardFaceItemId`

### Bundle iliski modeli

Yeni tablolar:

- `ShopBundleItem`
  - `bundleId`
  - `itemId`
  - `quantity`

Bu sayede bundle satin alininca bagli itemler envantere dagitilabilir.

### Indirim ve kupon modeli

Yeni tablolar:

- `DiscountCampaign`
  - ad, aciklama, aktiflik, tarih araligi
  - hedef tipi: `shop_item`, `category`, `bundle`, `global`
  - indirim tipi: `percentage`, `fixed_price`
  - deger
  - one cikan badge metni
- `CouponCode`
  - kod
  - aktiflik
  - kullanim limiti
  - kisi basi limit
  - baslangic / bitis tarihi
  - etkisi: coin indirimi, yuzde indirim, bedava urun, bedava bundle
- `CouponRedemption`
  - `couponId`
  - `userId`
  - `purchaseId`

Bu ayrim gerekli, cunku kupon ve kampanya ayni sey degil:

- kampanya otomatik uygulanir
- kupon kullanici tarafindan girilir

## Render Mantigi: Kod mu Gorsel mi?

### Onerilen strateji: hibrit

- Avatarlar:
  - agirlikli olarak `image`
  - cunku karakter, maskot, portre, ikon gibi iceriklerde gorsel daha dogal
- Frame'ler:
  - agirlikli olarak `template`
  - border, glow, gradient, corner ornament gibi seyler kodla daha iyi olceklenir
- Card back:
  - agirlikli olarak `template`
  - tekrar eden pattern, sezon deseni, rarity glow gibi yapilar kodla daha iyi yonetilir
- Card face:
  - agirlikli olarak `template`
  - `GameCard` ile dogrudan uyum icin CSS/SVG token mantigi daha saglikli
- Nadir premium urunler:
  - `image` veya `image + template overlay`

### Neden frame ve karti kodla yapmak daha dogru?

- Farkli ekran boyutlarina daha iyi uyum saglar
- Rarity glow ve renk varyasyonlari kolay uretilir
- Bir sablondan onlarca urun cikarmak mumkun olur
- Admin panelde renk, pattern, border, glow degistirerek hizli urun uretilebilir

## Kod Tabanli Tasarim Mantigi

### Template tabanli urun ornekleri

#### Frame template ornekleri

- `neon_ring`
- `crystal_corner`
- `minimal_gold`
- `glitch_arcade`
- `forest_vine`

`templateConfig` ornegi:

```json
{
  "primary": "#7c3aed",
  "secondary": "#06b6d4",
  "glow": true,
  "thickness": "md",
  "cornerStyle": "bevel"
}
```

#### Card back template ornekleri

- `grid_pulse`
- `cosmic_dust`
- `royal_emblem`
- `warning_stripe`
- `paper_stamp`

#### Card face template ornekleri

- `clean_classic`
- `neon_competitive`
- `royal_dark`
- `playful_arcade`
- `minimal_editorial`

`card_face` temasi su alanlari kontrol eder:

- baslik arka plani
- ana kelime font stili
- yasakli kelime satir stili
- difficulty badge
- footer bezeme
- kart dis border ve glow

## Admin Panelde Kodla Olan Tasarimlar Nasil Eklenecek?

### Admin urun formu iki modlu olacak

- `Render Mode = Image`
  - gorsel yukleme veya URL
  - previewImageUrl otomatik olusur
  - assetUrl kaydedilir
- `Render Mode = Template`
  - admin bir `templateKey` secer
  - form dinamik olarak ilgili alanlari acilir
  - secilen degerler `templateConfig` JSON olarak kaydedilir
  - preview panel canli onizleme verir

### Admin deneyimi

Admin panelde yeni "Kozmetik Olustur" formu asagidaki sekilde calisacak:

1. Tip secilir: avatar / frame / card_back / card_face / bundle
2. Render modu secilir: image / template
3. Template ise uygun preset listesi acilir
4. Renkler, glow, ikon, pattern, rarity gibi alanlar dolurulur
5. Canli preview gorulur
6. Kaydedildiginde urun magazada kullanilabilir hale gelir

### Bundle olusturma

Bundle urunu admin panelde farkli sekme ile yonetilmeli:

1. Bundle temel bilgileri
2. Icine eklenecek item secimi
3. Toplam piyasa degeri
4. Bundle indirimli satis fiyati
5. Vitrin badge'i

## Oyun Ici Gorunum Nerelere Baglanacak?

### Faz 1: Profil ve dashboard

- Dashboard sag sidebar avatari
- Quick Equip slotlari
- Inventory preview paneli
- Home dashboard profile alani

### Faz 2: Oda ve lobi

- `Sidebar` oyuncu avatarlari
- avatar etrafindaki frame
- oyuncu host crown alani ile cakismayacak sekilde frame layering
- lobby oyuncu listesinde kusanilan avatar/frame gosterimi

### Faz 3: Kart sistemi

- `card_back`
  - inventory ve shop preview
  - transition ekranlari
  - reveal animasyonunda arka yuz
- `card_face`
  - `GameCard` bileseninde aktif kart temasi
  - kategori rengi ile cakismayacak bir token hiyerarsisi

### Faz 4: Mac sonu ve vitrin

- game over ekraninda MVP kart onizleme
- kazanilan veya yeni satin alinan kozmetigin toast / reward card gosterimi

## Mock Veri Stratejisi

### Mock veriler gecici degil, gercek kontrata uygun olacak

Bu kisim kritik.
Mock veri sadece ekrani doldurmak icin yazilmayacak; gelecekteki API ile ayni sekli kullanacak.

### Mock asset kaynaklari

- `public/cosmetics/avatars/*`
- `public/cosmetics/frames/*`
- `public/cosmetics/card-backs/*`
- `public/cosmetics/card-faces/*`

Template tabanli urunlerde ise:

- `apps/web/src/lib/cosmetics/templates/*`
- `apps/web/src/components/game/cosmetics/*`

### Mock catalog

Ilk kurulumda en az:

- 8 avatar
- 6 frame
- 6 card_back
- 4 card_face
- 2 bundle
- 3 discount campaign
- 3 coupon code

### Mock settings

Settings ekranindaki su alanlar mock kalabilir:

- muzik acik / kapali
- ses efektleri
- master volume
- ambient volume
- titresim / vibration
- language secimi

Ancak mock olsalar bile:

- component state ile calismali
- localStorage veya tek bir local settings object uzerinden saklanmali
- sonra backend baglamak kolay olmali

## API Kontrati Plani

### Mevcut route'lar revize edilecek

- `GET /api/user/dashboard`
  - mevcut metriklere ek:
  - level, xp, xpNeeded
  - equippedAvatar
  - equippedFrame
  - equippedCardBack
  - equippedCardFace
- `GET /api/user/me`
  - profile + wallet + inventory + equipped item detaylari
- `POST /api/store/purchase`
  - `shopItemId`, `couponCode?`
  - response:
    - `coinBalance`
    - `purchase`
    - `awardedItems`
- `POST /api/store/equip`
  - `shopItemId`
  - response:
    - `equippedSlots`

### Yeni route'lar

- `GET /api/user/inventory`
- `POST /api/store/coupon/validate`
- `POST /api/store/coupon/redeem`
- `GET /api/store/offers`
- `GET /api/store/bundles`
- `GET /api/store/featured`

### Admin route'lari

- `GET/POST /api/admin/discount-campaigns`
- `GET/PUT/DELETE /api/admin/discount-campaigns/[id]`
- `GET/POST /api/admin/coupons`
- `GET/PUT/DELETE /api/admin/coupons/[id]`
- `GET/POST /api/admin/card-templates`
  - opsiyonel, eger admin panelden template preset de yonetilecekse

## Uygulama Fazlari

### Faz A - Veri Kontrati ve Mock Duzeltme

- overlay componentlerindeki yanlis route ve body alanlarini duzelt
- mock inventory mantigini gercek inventory API kontratina cevir
- dashboard data yapisini UI'nin bekledigi alanlarla uyumlu hale getir
- settings ekranini local mock state ile stabil hale getir

Teslim sonucu:

- Dashboard overlay bug'siz acar
- Shop satin alma ve equip akisi dogru request/response ile calisir
- Mock veri gercek API kontratina uyar

### Faz B - Prisma ve Admin Data Layer

- `ShopItem` genisletmesi
- `DiscountCampaign`, `CouponCode`, `CouponRedemption`, `ShopBundleItem`
- migration / db push
- admin CRUD route'lari

Teslim sonucu:

- admin urun ekler
- admin kampanya tanimlar
- admin kupon tanimlar
- admin image ve template bazli urun olusturur

### Faz C - Kozmetik Renderer Katmani

- avatar renderer
- frame renderer
- card back renderer
- card face renderer
- preview renderer

Teslim sonucu:

- tek merkezli render mantigi olusur
- shop, inventory, sidebar ve game card ayni kaynaktan beslenir

### Faz D - Oyun Ici Entegrasyon

- room sidebar avatar + frame
- dashboard profile sidebar equipped item gosterimi
- transition screen card back
- `GameCard` card face tema entegrasyonu

Teslim sonucu:

- kullanici satin aldigi urunu oyunda gorur
- diger oyuncular da bu kozmetigi gorur

### Faz E - Store UX ve Promotion Sistemi

- offers
- bundles
- coupon input
- discount badges
- expired / scheduled item davranisi

### Faz F - Temizlik ve Stabilizasyon

- dokuman guncelleme
- seed script
- admin validation
- lint/build/test

## Dosya Bazli Uygulama Haritasi

### Veri ve Prisma

- `prisma/schema.prisma`
- `prisma/seed.ts` veya `scripts/seed-cosmetics.ts`
- `apps/web/src/lib/economy.ts`

### User API

- `apps/web/src/app/api/user/dashboard/route.ts`
- `apps/web/src/app/api/user/me/route.ts`
- `apps/web/src/app/api/user/profile/route.ts`
- `apps/web/src/app/api/user/inventory/route.ts`

### Store API

- `apps/web/src/app/api/store/items/route.ts`
- `apps/web/src/app/api/store/purchase/route.ts`
- `apps/web/src/app/api/store/equip/route.ts`
- `apps/web/src/app/api/store/offers/route.ts`
- `apps/web/src/app/api/store/coupon/*`

### Admin API

- `apps/web/src/app/api/admin/shop-items/*`
- `apps/web/src/app/api/admin/discount-campaigns/*`
- `apps/web/src/app/api/admin/coupons/*`

### Render katmani

- `apps/web/src/lib/cosmetics/*`
- `apps/web/src/components/game/cosmetics/*`
- `apps/web/src/components/game/game-card.tsx`
- `apps/web/src/components/game/sidebar.tsx`
- `apps/web/src/components/game/dashboard-profile-sidebar.tsx`
- `apps/web/src/components/game/dashboard-pages/inventory-content.tsx`
- `apps/web/src/components/game/dashboard-pages/shop-content.tsx`

## Teknik Riskler

- UI, su anda backend'in donmedigi alanlari bekliyor; once kontrat sabitlenmeli
- `card_face` ile kategori renginin cakismamasi icin tema fallback sirasi tasarlanacak
- image ve template urunlerin ayni preview sisteminde birlestirilmesi dikkat ister
- kupon ve indirimler transaction icinde hesaplanmali

## Karar Ozeti

- Avatar: agirlikli `image`
- Frame: agirlikli `template`
- Card back: agirlikli `template`
- Card face: agirlikli `template`
- Bundle: ayri iliski modeli
- Kupon ve indirim: ayri tablolarda
- Settings ses/muzik: mock ama stateful
- Mock veri: gercek kontrata uygun, gecici hack degil
