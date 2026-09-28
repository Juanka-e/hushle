# Magaza + Dashboard Altyapi Notlari

## Hedef
- Misafir girisi korunur.
- Kayitli kullaniciya dashboard, profil ve magaza acilir.
- Altyapi yeni oyun modlari icin genisleyebilir kalir.

## Yapilan Kritik Duzeltmeler
1. Auth ayrimi
- Credentials auth artik hem `user` hem `admin` rolleri ile calisiyor.
- `portal` parametresi eklendi: `portal=user` ve `portal=admin`.
- User login ve admin login ayri akislarla dogrulaniyor.

2. Session modeli
- Session'a `user.id` ve `user.role` eklendi.
- Middleware user ve admin pathlerini ayri koruyor.

3. Socket disconnect bug fix
- Disconnect'te oda referansi silinmeden once aliniyor.
- `socketToRoom.delete` sirasi duzeltildi.

4. Hibrit kimlik
- Oyun kimligi: `playerId` (misafir dahil).
- Hesap kimligi: `userId` (giris yapan kullanici).
- Socket `odaIsteği` payload'ina opsiyonel `authUserId` eklendi.

## Yeni Veri Modelleri (Prisma)
- `UserProfile`
- `Wallet`
- `ShopItem`
- `InventoryItem`
- `Purchase`
- `MatchResult`
- `GuestProgress`
- Enum'lar: `ShopItemType`, `ItemRarity`, `InventorySource`, `PurchaseStatus`

## Yeni API Katmani
### User
- `GET /api/user/me`
- `PATCH /api/user/profile`
- `GET /api/user/dashboard`

### Store
- `GET /api/store/items`
- `POST /api/store/purchase`
- `POST /api/store/equip`

### Game
- `POST /api/game/match/finalize`
  - Oyun bitisinde idempotent odul claim.
  - `roomCode + userId` tekilligi ile tekrar odul engeli.

## Yeni Sayfalar
- `/dashboard`
- `/profile`
- `/store`

## Ekonomi (MVP)
- Tek para birimi: coin.
- Mac sonu odul:
  - Kazanma: `120`
  - Kaybetme/berabere: `40`
- Satin alma tek transaction ile yapiliyor.

## Mimari Notlar
- Misafir akisi bozulmadi; oyun kayitsiz oynanabilir.
- Profil/magaza/dashboard sadece girisli kullanicida acik.
- `MatchResult` modelinde `gameType` alani var, ileride farkli oyun modlari icin hazir.

## Sonraki Adimlar
1. `prisma db push` ile yeni tablolari olustur.
2. Magaza baslangic seed'i ekle (6 avatar, 4 cerceve, 4 kart arkasi).
3. Room UI'da equip edilen kozmetiklerin gorunur yansitmasini tamamla.
4. Guest-to-account merge kuralini (coin snapshot aktarim) aktif et.

## Economy LiveOps Controls (March 13, 2026)

- Runtime economy artik sadece baslangic coin ve mac odullerinden ibaret degil.
- Admin panel `Sistem Ayarlari > Ekonomi Temeli` bolumunden su alanlari yonetiyor:
  - `startingCoinBalance`
  - `winRewardCoin`
  - `lossRewardCoin`
  - `drawRewardCoin`
  - `matchCoinMultiplier`
  - `weekendCoinMultiplierEnabled`
  - `weekendCoinMultiplier`
  - `storePriceMultiplier`
  - `bundlesEnabled`
  - `discountCampaignsEnabled`
  - `couponsEnabled`

### Runtime Etki

- Mac odulleri artik:
  - baz galibiyet/maglubiyet/beraberlik odulu
  - global mac coin carpani
  - opsiyonel weekend carpani
  katmanlariyla hesaplanir.
- Store katalog fiyatlari artik DB fiyatinin birebir kopyasi degil; `storePriceMultiplier` ile runtime'da olusturulur.
- Discount campaign ve coupon mantigi ayni efektif liste fiyatinin ustunde calisir.
- Bundle satislari, kupon kullanimi ve campaign discount'lari ayri ayri liveops kill-switch ile kapatilabilir.

### UI Yansima

- `/api/store/catalog` artik `liveops` ozetini de doner.
- Dashboard magazasi:
  - aktif store multiplier'i
  - aktif mac multiplier'i
  - weekend boost durumu
  - campaign pause durumu
  - coupon / bundle gate durumu
  bilgilerini oyuncuya gosterir.

### Bilincli Sinirlar

- Bu slice coupon / discount / bundle admin CRUD mantigini degistirmez; sadece runtime davranisini kontrol eder.
- Weekend carpani platform timezone olarak `Europe/Istanbul` uzerinden hesaplanir.
- Daha ileri event sistemi (tarih aralikli kampanya scheduler, sezon mantigi, per-segment economy rollout) sonraki liveops branch'lerine birakildi.
## CI / Workflow Notes (March 2, 2026)

- Reviewed `.github/workflows/ci.yml`.
- CI requires: `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npx prisma db push --skip-generate`, `npm run build`.
- Current branch changes compile with TypeScript.
- Repo still has pre-existing lint violations outside this feature scope; CI lint job will fail until those are cleaned.

## Hotfix - Hydration Error (March 2, 2026)

- Issue: Theme toggle icon in `apps/web/src/app/page.tsx` rendered different SVG trees on server/client (`Sun` vs `Moon`), causing hydration mismatch.
- Root cause: Conditional icon render used a theme value that differs before/after hydration.
- Fix: Rendered both icons with CSS dark-mode transitions and removed theme-conditional JSX branching.
- Verification: `npm run lint` and `npm run build` both pass after the change.


## Mevcut Durum Detayi (March 2, 2026)

Bu bolum, su an kodda calisan gercek davranisi ve local DB snapshot'ini aciklar.

### 1) Coin Yonetimi - su an ne var?

- Coin bakiyesi `wallets.coin_balance` alaninda tutulur.
- Her kullanici icin `wallet` ve `userProfile` kaydi `ensureUserCore(userId)` ile garanti edilir.
- Yeni kayit olan kullaniciya baslangicta `0 coin` verilir.
- Mac odul sistemi aktif:
  - Kazanan oyuncu: `120 coin` (`WIN_REWARD`)
  - Kaybeden / berabere: `40 coin` (`LOSS_REWARD`)
- Mac odulu `/api/game/match/finalize` endpoint'i ile yazilir:
  - `match_results` tablosuna kayit olusur
  - Ayni anda `wallet.coin_balance` arttirilir
  - `roomCode + userId` unique oldugu icin cift odul engellenir (idempotent)

### 2) Profil Yonetimi - su an ne var?

- Profil bilgileri `user_profiles` tablosunda:
  - `displayName`
  - `bio`
  - `avatarItemId`, `frameItemId`, `cardBackItemId` (kusanilan kozmetikler)
- `/api/user/me`:
  - session user bilgisi
  - profile
  - inventory
  - wallet
  birlikte doner.
- `/api/user/profile` (PATCH):
  - `displayName` (max 60)
  - `bio` (max 300)
  gunceller.
- Profil sayfasi (`/profile`) su an:
  - profil metin alanlarini kaydetme
  - envanterdeki urunleri kategoriye gore listeleme
  - envanterdeki urunu kusanma (`/api/store/equip`)
  akisini icerir.

### 3) Magaza Yonetimi - su an ne var?

- Magaza urun modeli: `shop_items`
  - `code`, `type`, `name`, `rarity`, `price_coin`, `image_url`, `is_active`, `sort_order`
- Urun tipleri:
  - `avatar`
  - `frame`
  - `card_back`
- `/api/store/items`:
  - sadece `isActive=true` urunleri listeler
  - opsiyonel type filtresi var
- `/api/store/purchase`:
  - login zorunlu
  - urun var mi kontrolu
  - daha once alinmis mi kontrolu
  - coin yeterli mi kontrolu
  - basariliysa tek transaction icinde:
    - coin duser
    - `inventory_items` kaydi olusur
    - `purchases` kaydi olusur
- `/api/store/equip`:
  - urun envanterdeyse profile'daki aktif kozmetik alanina set eder

### 4) Satin Alinan Kozmetikler (Sales/Purchase) - su an ne var?

- Satin alinan urunler iki yerde izlenir:
  - `inventory_items` (kullanici urune sahip mi?)
  - `purchases` (islem kaydi / ne kadara alindi?)
- `inventory_items` tablosunda `(userId, shopItemId)` unique oldugu icin ayni urun ikinci kez alinmaz.
- `purchases.status` su an `completed`/`reverted` enumuna sahip olsa da mevcut akista sadece `completed` yaziliyor.

### 5) Dashboard - su an ne var?

- `/dashboard` ve `/api/user/dashboard` su metrikleri verir:
  - `coinBalance`
  - `totalMatches`
  - `totalCoinEarned`
  - `winRate`
  - son 5 mac kaydi (`recentMatches`)
- UI tarafinda hizli linkler var (oda olustur, odaya katil, magazaya git).

### 6) Local DB Snapshot (anlik durum)

Local veritabani (su anki ortam) icin sayilar:

- `shop_items`: `0`
- `active shop_items`: `0`
- `inventory_items`: `0`
- `purchases`: `0`
- `match_results`: `0`
- `user_profiles`: `1`
- `wallets`: `1` (gorulen bakiye: `userId=1 -> 0 coin`)

Sonuc:
- Magaza satin alma kodu mevcut ama urun olmadigi icin satin alma pratikte calisamaz.
- Coin artisi mac finalize ile geliyor; mac kaydi olmadigi surece bakiye artismaz.

### 7) Bilinen Eksikler / Net Gap Listesi

- ~~Shop seed yok (urun katalogu bos).~~ → Admin panelden ekleme artik mumkun (8 Mart 2026).
- Baslangic bonusu / gunluk odul gibi ek coin kaynagi yok.
- ~~Admin panelde kullanici-wallet-envanter yonetimi sayfasi yok.~~ → `/admin/shop-items` eklendi (8 Mart 2026).
- ~~Satin alma/kusanma akisi API tarafinda var, ama oyun ici kozmetik yansitma halen sinirli.~~ → Overlay sistemi ile magaza/envanter/equip UI tamamlandi (8 Mart 2026).

---

## Dashboard Overlay Sistemi (8 Mart 2026)

### Ne Yapildi?
Stitch tasarim dosyalarindaki (7 HTML) glassmorphism overlay tasarimi React/Next.js bilesenlerine donusturuldu.
Oyun ecrani uzerinde acilan 3-sutunlu overlay: sol icon nav, orta icerik, sag profil sidebar.

### Yeni Dosyalar
- `apps/web/src/components/game/dashboard-overlay.tsx` — ana overlay container
- `apps/web/src/components/game/dashboard-nav.tsx` — sol icon sidebar (Dash/Inv/Shop/Settings)
- `apps/web/src/components/game/dashboard-profile-sidebar.tsx` — sag profil: avatar, XP, Quick Equip
- `apps/web/src/components/game/dashboard-pages/dash-content.tsx` — stat kartlari + son aktivite
- `apps/web/src/components/game/dashboard-pages/inventory-content.tsx` — envanter + preview + equip
- `apps/web/src/components/game/dashboard-pages/shop-content.tsx` — magaza + daily offers + bundles
- `apps/web/src/components/game/dashboard-pages/settings-content.tsx` — profil/oyun/gizlilik ayarlari

### Degisiklikler
- `apps/web/src/app/globals.css` — `.glass-overlay`, `.glass-panel`, `.animate-fade-in-up` eklendi
- `apps/web/src/app/room/[code]/page.tsx` — `showDashboard` state + LayoutDashboard butonu + overlay render
- `docs/dashboard.md` — detayli dokumantasyon

### Entegrasyon
- Dashboard butonu yalnizca giris yapan kullanicilara gorunur (misafir girisi etkilenmez)
- Overlay ESC, backdrop click ve X butonu ile kapanir
- Sayfalar dynamic import ile code-splitting uygulanir

---

## Admin Kozmetik Yonetimi (8 Mart 2026)

### Ne Yapildi?
Admin panelden kozmetik CRUD islemleri yapilabilir hale getirildi.

### Yeni API Rotalari
- `GET/POST /api/admin/shop-items` — liste + olustur
- `GET/PUT/DELETE /api/admin/shop-items/[id]` — detay, guncelle, soft-delete
- `POST /api/admin/shop-items/upload` — gorsel yukleme (2MB, PNG/JPEG/WebP/GIF)

### Yeni Sayfalar
- `/admin/shop-items` — kozmetik yonetim sayfasi (tablo, filtre, modal, gorsel yukleme)

### Degisiklikler
- `apps/web/src/components/admin/admin-sidebar.tsx` — "Kozmetikler" nav linki eklendi

### Kozmetik Ekleme Akisi
1. Admin → `/admin/shop-items` → "Yeni Ekle"
2. Kod, isim, tur, nadirlik, fiyat + gorsel yukle
3. Kaydet → magazada otomatik gorunur (`isActive=true`)
4. Oyuncu overlay'den satin alir → envanterde equip eder

---

## Ana Sayfa Dashboard (8 Mart 2026)

### Ne Yapildi?
Login olan kullanicinin ana sayfasi (`/`) in-game overlay ile ayni glassmorphism 3-sutun dashboard layout'una donusturuldu.

### Degisiklikler
- `apps/web/src/components/game/dashboard-overlay.tsx` — `DashboardLayout` shared bilesenine ayrildi
- `apps/web/src/app/page.tsx` — login kullanici: tam sayfa dashboard + compact header bar
  - Header: Logo + Yeni Oda + Oda Kodu + Duyurular + Tema + Admin + Cikis
  - Body: `DashboardLayout` (Nav | Content | Profile Sidebar)
  - Misafir gorunumu: degismedi (eski basit kart)

### Mimari
```
page.tsx (login user)
  ├── Header bar (compact: logo, Yeni Oda, oda kodu, utils)
  └── glass-panel (full page)
      └── DashboardLayout (shared)
          ├── DashboardNav
          ├── DashboardContent (Dash/Inv/Shop/Settings)
          └── DashboardProfileSidebar
```

---

## Bug Fix — Shop items.slice (8 Mart 2026)

- **Sorun:** `items.slice is not a function` hatasi — `/api/store/items` `{ items: [...] }` donduruyor ama kod `setItems(await res.json())` yapiyor.
- **Problem:** Response objesi dogrudan array olarak kullaniliyordu.
- **Cozum:** `Array.isArray(data) ? data : data.items ?? []` ile her iki formata uyum saglandi.
- **Dosya:** `apps/web/src/components/game/dashboard-pages/shop-content.tsx`
## 8 Mart 2026 Plan Referansi

Bu dokuman mevcut durum ve yapilan isler icin tutulur.
Detayli uygulanabilir plan ayri dokumanda yazildi:

- `docs/dashboard-ui/cosmetics-implementation-plan.md`

Bu planda netlestirilen ana kararlar:

- kart on yuzu ve kart arka yuzu ayri sistem olacak
- `card_face` yeni tip olarak eklenecek
- avatar agirlikli `image`, frame ve kart temalari agirlikli `template` olacak
- admin panelden kozmetik, bundle, indirim ve kupon yonetimi yapilacak
- settings ekranindaki ses/muzik alanlari mock ama stateful kalacak
- mock veri final API kontratina uyacak, gecici hack mantiginda olmayacak

---

## Dashboard Contract Alignment Update (8 March 2026)

### Bu turda tamamlananlar
- `GET /api/user/inventory` eklendi ve overlay inventory bu endpoint'e gecirildi.
- Overlay inventory artik yalnizca sahip olunan urunleri gosteriyor.
- Equip akisi `/api/store/equip` uzerinden `shopItemId` ile calisiyor.
- Overlay shop artik `/api/store/items` cevabindaki `owned` ve `equipped` alanlarini kullaniyor.
- Satin alma akisi `/api/store/purchase` cevabindaki `coinBalance` alanina baglandi.
- Profile sidebar artik fake `level`, `xp`, `equippedAvatar` gibi alanlari beklemiyor.
- Sidebar veri kaynagi olarak `/api/user/dashboard` + `/api/user/me` birlikte kullaniliyor.
- Settings ekraninda profil alanlari gercek API ile, ses/muzik/dil alanlari ise local-state mock olarak calisiyor.
- `/profile`, `/store` ve `/dashboard` sayfalari yeni economy tipleri ile uyumlu hale getirildi.

### Dogrulama
- `npm run lint` = gecti
- `npx tsc --noEmit` = gecti
- `npm run build` = gecti

### Sonraki teknik faz
- `card_face` modelini eklemek
- kart on / kart arka sistemini ayirmak
- template tabanli kozmetik tanimlarini admin paneline acmak
- bundle / discount / coupon yonetimini eklemek
- production-shaped mock katalog ve kampanya seed'lerini eklemek

---

## Card Face + Template Slice (9 March 2026)

### Veri modeli
- `ShopItemType` artik `card_face` tipini de iceriyor.
- `ShopItem` artik `renderMode`, `templateKey`, `templateConfig` alanlarini tasiyor.
- `UserProfile` artik `cardFaceItemId` ile aktif kart on temasini sakliyor.

### Admin tarafi
- `/admin/shop-items` artik image ve template tabanli urun olusturabiliyor.
- Template urunlerde `templateKey` ve `templateConfig` JSON alanlari formdan yonetiliyor.
- JSON config sadece primitive degerler kabul ediyor; nested serbest veri alinmiyor.
- `avatar` urunleri icin template modu bilerek kapali tutuldu.

### Oyun tarafi
- Ilk slice'ta room sayfasi giris yapan kullanicinin `card_face` item'ini `/api/user/me` uzerinden okuyordu.
- Secili `card_face` icin guvenli resolver calisiyor:
  - destekli renkler yalnizca hex formatinda
  - destekli texture anahtarlari whitelist ile sinirli
  - overlay opacity clamp ediliyor
- `GameCard` artik tema prop'u aliyor ve baslik/govde/footer gorunusunu buna gore degistirebiliyor.
- `card_back` ile `card_face` artik veri modelinde ve equip akisinda ayrik.

### Test ve guvenlik
- Test script eklendi: `npm run test:card-face`
- Dogrulama:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run build`
  - `npm audit --omit=dev`
- Audit bulgusu:
  - `multer < 2.1.1` high severity DoS riski
  - cozum: `multer` `^2.1.1` seviyesine yukseltildi
  - sonuc: `0 vulnerabilities`

### Hala kalanlar
- frame ve `card_back` icin template renderer yuzeyini oyunda kullanmak
- bundle / discount / coupon CRUD
- oyuncu sidebari icin diger kullanicilarin avatar/frame snapshot'larini socket state'e tasimak

## Room Kozmetik Senkronu ve Socket Guvenligi (9 March 2026)

### Tamamlananlar
- Oyun odasindaki `oyuncular` snapshot'ina `cosmetics` alani eklendi.
- Sidebar artik oyuncunun equip ettigi avatar ve frame bilgisini dogrudan room snapshot'inden render ediyor.
- Frame template'leri icin guvenli accent-color resolver eklendi.
- `scripts/test-frame-theme.ts` smoke testi ve `npm run test:frame-theme` komutu eklendi.

### Guvenlik Duzeltmesi
- Socket join akisinda istemciden gelen `authUserId` artik guven kaynagi olarak kullanilmiyor.
- Server, kullanici kimligini session cookie + `AUTH_SECRET` ile dogruluyor.
- Client bir baska `authUserId` gonderirse bu deger yok sayiliyor ve warning log uretiliyor.
- Boylece baska bir kullanicinin kozmetigini veya hesap bagini spoof etme yolu kapatildi.

### Etki
- Login kullanicisinin equip ettigi avatar/frame oyun odasinda gorunur hale geldi.
- Misafir akisinda davranis degismedi; cosmetics alani bos snapshot ile devam ediyor.
- Room UI tasarimi korunarak veri akisi server-dogrulanmis hale getirildi.

### Bu Turdaki Dogrulama
- `npm run test:frame-theme`
- `npm run test:card-face`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Card Back Transition Slice (9 March 2026)

### Tamamlananlar
- `card_back` icin ayri resolver eklendi: `apps/web/src/lib/cosmetics/card-back.ts`.
- Gecis ekrani artik giris yapan kullanicinin equip ettigi `card_back` temasini gosterebiliyor.
- `scripts/test-card-back-theme.ts` smoke testi ve `npm run test:card-back` komutu eklendi.

### Misafir Akisi Garantisi
- Ilk rollout'ta misafir kullanicida `card_back` yuklenmiyordu.
- Bu davranis sonradan narrator-broadcast modeline gecmeden once geciciydi.

### Guvenlik ve Mantik
- Ilk rollout'ta kozmetik verisi `/api/user/me` uzerinden geliyordu; bu route login gerektiriyordu.
- Sonraki narrator-broadcast slice'inda bu local fetch kaldirildi ve kart temalari socket payload'i ile server-resolved sekilde yayildi.
- Image/template varyantlari whitelist/sanitize kurallari ile resolve ediliyor.

### Bu Turdaki Dogrulama
- `npm run test:card-back`
- `npm run test:card-face`
- `npm run test:frame-theme`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Bundle, Indirim ve Kupon Yonetimi (9 March 2026)

### Veri modeli
- `ShopBundle` ve `ShopBundleItem` eklendi.
- `DiscountCampaign` eklendi.
- `CouponCode` eklendi.
- Yeni enumlar: `PromotionTargetType`, `PromotionDiscountType`.

### Admin katmani
- Yeni admin sayfasi: `/admin/promotions`.
- Yeni admin API rotalari:
  - `GET/POST /api/admin/promotions/bundles`
  - `GET/PUT/DELETE /api/admin/promotions/bundles/[id]`
  - `GET/POST /api/admin/promotions/discounts`
  - `GET/PUT/DELETE /api/admin/promotions/discounts/[id]`
  - `GET/POST /api/admin/promotions/coupons`
  - `GET/PUT/DELETE /api/admin/promotions/coupons/[id]`

### Guvenlik
- Yeni promosyon route'lari `requireAdminSession()` ile server tarafinda admin role dogruluyor.
- Mevcut `shop-items` admin route'larina da ayni koruma eklendi.
- Upload route'unda `category` ve dosya uzantisi sanitize edildi.

### Mantik siniri
- Bu slice tanimlama ve yonetim altyapisini kurar.
- Fiyat hesaplama ve checkout'ta bundle/discount/coupon uygulama akisi sonraki slice'ta baglanacak.
- Misafir girisi ve oyun akisi etkilenmedi.

### Bu Turdaki Dogrulama
- `npx prisma db push`
- `npx prisma generate --no-engine`
- `npm run test:promotions`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Mock Catalog Seed ve Coin Ikon Standardi (9 March 2026)

### Mock catalog
- `apps/web/src/lib/store/mock-catalog.ts` eklendi; shop item, bundle, discount ve coupon mock verileri tek yerde toplandi.
- `scripts/seed-store-catalog.ts` eklendi; katalog verisi Prisma CLI `db execute` ile idempotent olarak local DB'ye yaziliyor.
- `scripts/test-mock-catalog.ts` eklendi; kod tekilligi, bundle referanslari ve image asset dosyalari dogrulaniyor.
- Yeni komutlar:
  - `npm run seed:catalog`
  - `npm run test:catalog`

### Eklenen local mock asset'ler
- `/public/cosmetics/mock/avatars/pulse-fox.svg`
- `/public/cosmetics/mock/avatars/neon-owl.svg`
- `/public/cosmetics/mock/frames/arctic-gate.svg`
- `/public/cosmetics/mock/card-backs/ember-vault.svg`
- `/public/cosmetics/mock/card-faces/ember-glow.svg`

### Mock UI coin ikon standardi
- `scripts/design-prototypes/*` ve `scripts/stitichdesign/*` altindaki HTML mock dosyalarinda coin ikonlari tek `coin-mark` sinifina normalize edildi.
- Emoji, material icon ve custom coin gorunumleri kaldirildi; artik tum mock tasarimlarda ayni coin isareti kullaniliyor.
- Bu degisiklik sadece mock/prototype HTML dosyalarini etkiler; oyun ici gercek UI akisinda davranis degisikligi yaratmaz.

### Bu Turdaki Dogrulama
- `npm run test:catalog`
- `npm run seed:catalog`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Store Pricing, Bundle Checkout ve Kupon Preview (9 March 2026)

### Tamamlananlar
- Yeni typed katalog cevabi eklendi: `GET /api/store/catalog`.
- Store item fiyatlari artik aktif campaign'lere gore server tarafinda hesaplanip UI'a `pricing` alani ile gidiyor.
- Bundle satin alma endpoint'i eklendi: `POST /api/store/bundles/purchase`.
- Kupon onizleme endpoint'i eklendi: `POST /api/store/coupons/preview`.
- Item satin alma endpoint'i `couponCode` kabul edecek sekilde genislendi.
- Standalone `/store` sayfasi ve in-game dashboard shop ayni `ShopContent` akisini kullanacak sekilde refactor edildi.

### Fiyatlama mantigi
- Aktif indirim kampanyalari icinden hedefe uyan en iyi tek campaign seciliyor.
- Campaign ile kupon birlikte sadece `stackableWithCoupon = true` ise kullaniliyor.
- Kupon indirimi campaign sonrasi fiyat uzerinden hesaplanıyor.
- Bundle satin almada kullanicinin bundle icindeki tum urunlere sahip olmamasi gerekiyor.
- Kullanici bundle icindeki urunlerden bir kismina zaten sahipse satin alma bloklaniyor; bu kasitli bir guard.

### Satin alma kaydi
- `Purchase` modeli genislendi:
  - `bundleId`
  - `couponCodeId`
  - `listPriceCoin`
  - `discountCoin`
- Tekil item satin almalari da artik efektif indirimli fiyat + liste fiyati ile kayit altina alinabiliyor.

### UI notlari
- Dashboard shop mevcut tasarim dilini koruyarak canli fiyat, bundle kartlari ve kupon alani kazandi.
- Coin gostergeleri icin ortak `CoinBadge` / `CoinMark` component'i eklendi.
- Boylesiyle mock HTML coin standardi kod tarafindaki gercek UI ile de hizalandi.

### Misafir akisi garantisi
- Misafir girisi bozulmadi.
- `/store` ve `/api/store/*` akisi halen login gerektiriyor.
- Kozmetik satin alma, kupon kullanimi ve bundle islemleri sadece session kullanicisi icin aktif.

### Security ve CI
- Middleware tarafinda auth config edge-safe olacak sekilde ayrildi; Prisma artik middleware bundle'ina tasinmiyor.
- Bu sayede Next.js build yeniden yesil duruma getirildi.
- Kupon gecerliligi, aktiflik penceresi, kullanim limiti ve hedef uyumu server tarafinda dogrulaniyor.
- Bundle satin alma transaction icinde yurutuluyor; cuzdan dusumu ve inventory yazimi atomik kaldi.

### Bu Turdaki Dogrulama
- `npx prisma db push`
- `npx prisma generate --no-engine`
- `npm run test:store-pricing`
- `npm run test:catalog`
- `npm run test:promotions`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Security Hardening - Identity and Request Guards (9 March 2026)

### Tamamlananlar
- Oyun odasi socket akisinda client `playerId` guveni kaldirildi.
- Misafir kullanici icin imzali `guestToken` kullaniliyor; token `sessionStorage` tarafinda tutuluyor.
- Giris yapan kullanici icin oda kimligi dogrudan server-side `userId` temelli uretiliyor.
- Match reward finalize artik body'den `playerId` almiyor; odadaki auth katilimci `userId` ile dogrulaniyor.
- Middleware, state-changing API isteklerinde same-origin kontrolu uyguluyor.
- Register/store/profile/finalize akislarinda HTTP rate limiting aktif.

### Misafir akisi etkisi
- Misafir girisi bozulmadi.
- Misafir oyuncu hala oda olusturup katilabiliyor.
- Misafir kimligi artik localStorage UUID yerine server-imzali guest token ile devam ediyor.
- Kozmetik ve store kisitlari degismedi; bu alanlar halen login gerektiriyor.

## Promotion Usage Limits ve Atomic Reservation (9 March 2026)

### Tamamlananlar
- `DiscountCampaign` modeli artik `usageLimit` ve `usedCount` alanlarini tasiyor.
- Admin panelde hem indirim kampanyasi hem kupon icin kullanim limiti tanimlanabiliyor.
- `/admin/promotions` ekraninda kullanilan adet ve limit birlikte gosteriliyor.
- Seed edilen mock kampanyalar da artik limitli olarak olusturuluyor.

### Checkout davranisi
- Store pricing resolver, limiti dolan kampanyalari kullanilabilir teklif olarak saymiyor.
- Item ve bundle satin alma transaction'larinda secilen kampanya ve kupon kullanimi atomik olarak reserve ediliyor.
- Reserve basarisiz olursa satin alma `promotion_unavailable` veya `invalid_coupon` ile geri donuyor.
- Boylesiyle ayni anda gelen isteklerde limit asinimi engelleniyor.

### Guvenlik etkisi
- Onceki `coupon usageLimit race` acigi kapatildi.
- Indirim kampanyalari icin de ayni concurrency korumasi eklendi.
- Misafir akisi degismedi; promosyon kullanimi halen login zorunlu store akisinda kaldi.

### Bu Turdaki Dogrulama
- `npx prisma db push`
- `npx prisma generate --no-engine`
- `npm run test:store-pricing`
- `npm run test:promotions`
- `npm run test:catalog`
- `npm run seed:catalog`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Audit Logging ve Islem Izlenebilirligi (9 March 2026)

### Tamamlananlar
- Guvenlik ve ekonomi acisindan kritik mutation endpoint'leri icin kalici audit kaydi eklendi.
- Yeni `AuditLog` modeli su alanlari tutuyor:
  - actor user id
  - actor role
  - action
  - resource type / resource id
  - ip address
  - user agent
  - summary
  - primitive metadata
- Ortak helper: `apps/web/src/lib/security/audit-log.ts`

### Loglanan admin islemleri
- announcement create / update / delete
- shop item create / update / delete
- cosmetic asset upload
- bundle create / update / delete
- discount create / update / delete
- coupon create / update / delete

### Loglanan kullanici ve ekonomi islemleri
- profile update
- item purchase
- bundle purchase
- match reward finalize

### Guvenlik mantigi
- Metadata sadece primitive alanlar ve primitive array'ler ile sinirlandi.
- Serbest nested obje veya potansiyel hassas payload dump'i audit kaydina alinmiyor.
- Bu katman misafir akisina ve login zorunluluguna dokunmadan izlenebilirlik ekler.

### Bu Turdaki Dogrulama
- `npx prisma db push`
- `npx prisma generate --no-engine`
- `npm run test:audit-log`
- `npm run test:player-identity`
- `npm run test:request-security`
- `npm run test:store-pricing`
- `npm run test:promotions`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Proxy ve Nonce CSP Hardening (9 March 2026)

### Tamamlananlar
- Next.js 16 uyumlulugu icin edge guard katmani `apps/web/src/proxy.ts` dosyasina tasindi.
- `apps/web/src/middleware.ts` kaldirildi; build warning temizlendi.
- HTML page request'lerinde artik per-request nonce uretiliyor.
- Root layout nonce degerini `x-nonce` header'i ile okuyup iki kritik inline script yuzeyine uyguluyor:
  - hydration warning suppression script
  - `next-themes` theme bootstrap script

### Guvenlik etkisi
- Sayfa uzerindeki script calistirma yuzeyi nonce tabanli CSP ile sinirlandi.
- Announcement sanitization'a ek olarak, olasi residual HTML injection durumunda nonced olmayan script'ler bloklanir.
- YouTube iframe yuzeyi CSP `frame-src` ile sinirlandi.

### Bu Turdaki Dogrulama
- `npm run test:csp`
- `npm run test:request-security`
- `npm run test:player-identity`
- `npm run test:audit-log`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Rich Cosmetic Authoring ve Tasarim Rehberi (9 March 2026)

### Tamamlananlar
- Template config yapisi flat primitive map olmaktan cikarildi; nested JSON authoring destekleniyor.
- Guvenli authoring bloklari:
  - `palette`
  - `pattern`
  - `glow`
  - `motion`
  - `frame`
  - `overlay`
- Frame renderer artik daha zengin stil tasiyor:
  - `frameStyle`
  - `pattern`
  - `glow`
  - `motion`
  - `thickness`
  - `radius`
- Card face ve card back renderer'lari da artik:
  - ikinci renk
  - desen yogunlugu
  - glow
  - motion
  mantigini okuyabiliyor.
- Admin panelde template urun olustururken `Ornek Doldur` yardimcisi eklendi.
- Ayrica AI ve manuel authoring icin kalici rehber yazildi:
  - `docs/guides/card-design-guide.md`

### Guvenlik mantigi
- JSON nesting `3` seviye ile sinirli.
- Object basina key sayisi ve array uzunlugu sinirli.
- Sadece scalar veya scalar-array degerler kabul ediliyor.
- Arbitrary CSS/JS injection desteklenmiyor.

### Bu Turdaki Dogrulama
- `npm run test:template-config`
- `npm run test:frame-theme`
- `npm run test:card-face`
- `npm run test:card-back`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Shop Radar, Featured Sira ve Hydration Fix (9 March 2026)

### Veri modeli
- `ShopItem` artik iki yeni alan tasir:
  - `badgeText`
  - `isFeatured`
- `StoreItemView` ve `InventoryItemView` kontratlari bu alanlarla guncellendi.
- Seed edilen mock katalog da artik:
  - featured urunler
  - rozet metinleri
  - tekil `sortOrder`
  bilgisini ayni kontratta tasir.

### Admin panel
- `/admin/shop-items` ekraninda artik admin:
  - urun sirasi
  - `featured` durumu
  - `badgeText`
  alanlarini ayni modal uzerinden yonetebilir.
- `badgeText` alani `YENI`, `LIMITLI`, `PREMIUM` gibi rozetler icin kullanilir.
- `sortOrder` magaza grid'inin ana sirasini belirleyen tek alandir.
- `isFeatured` ise sag dashboard rail'inde one cikacak urun havuzunu belirler.

### Dashboard UI
- Sag profil sidebar icine `Shop Radar` adli kayan bir urun rail'i eklendi.
- Rail davranisi:
  - sadece login kullanicida aktif
  - `Quick Equip` altinda render edilir
  - `featured && !owned` urunleri tercih eder
  - featured havuz bos ise aktif urunlerden fallback secim yapar
  - kartlar otomatik kayar, hover ile durur
  - tiklaninca `Shop` tabina gecis yapar
- Bu alanin amaci gameplay-first dashboard dilini bozmadan merak uyandiran bir merchandizing yuzeyi olusturmaktir.

### Shop kartlari
- Featured urunler daha guclu border / arka plan ile vurgulanir.
- `badgeText` varsa kart ustunde rozet olarak gorunur.
- Grid sirasini backend `sortOrder` belirlemeye devam eder; admin tam kontrol sahibidir.

### Hydration hotfix
- `apps/web/src/app/layout.tsx` icindeki inline nonce script'i kaldirildi.
- `nonce=""` / `nonce="..."` uyusmazligindan dogan hydration hatasi kapanmis oldu.
- CSP nonce akisi bozulmadi; `next-themes` nonce ile calismaya devam eder.

### Bu Turdaki Dogrulama
- `npx prisma db push`
- `npx prisma generate --no-engine`
- `npm run test:catalog`
- `npm run test:csp`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Admin Cosmetic Live Preview (9 March 2026)

### Ne yapildi
- `/admin/shop-items` modal'i daha genis bir authoring yuzeyine cevrildi.
- Formun sagina canli `preview` paneli eklendi.
- Preview su katmanlari gosterir:
  - `Stage` -> urunun oyun ici karakteri
  - `Shop Card Snapshot` -> magazadaki merchandising gorunumu

### Teknik mantik
- Preview ayri bir sahte stil sistemi kullanmaz.
- Asagidaki resolver'lar dogrudan tekrar kullanilir:
  - `resolveFrameTheme`
  - `resolveCardFaceTheme`
  - `resolveCardBackTheme`
- Pattern, glow ve motion efektleri de ortak `effects.ts` helper'lari ile uretilir.
- Boylece admin panel ile runtime oyun arasinda stil drift'i azaltildi.

### Authoring etkisi
- Admin:
  - image URL degistirince
  - rarity degistirince
  - `badgeText` ve `isFeatured` ayarlayinca
  - `templateKey` veya JSON config girince
  sonucu aninda gorebilir.
- Gecersiz template JSON varsa preview paneli bunu acik hata mesaji ile bildirir.

### Guvenlik ve risk
- Yeni API eklenmedi.
- Yeni preview katmani tamamen client-side ve mevcut sanitize edilmis resolver'lar ustunden calisir.
- JSON execution veya CSS injection yuzeyi acilmaz; preview sadece izinli alanlari yorumlar.

### Bu Turdaki Dogrulama
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Admin Promosyon Stabilizasyonu ve Dashboard Kopya Duzenlemesi (9 March 2026)

### Runtime hata nedeni
- Admin promosyon ve shop-item route'lari bir noktada `@prisma/client` enum'larini runtime degeri olarak yuklemeye calisiyordu.
- `z.nativeEnum(...)` ile yapilan bu baglilik dev/build sirasinda su tip hatalara yol aciyordu:
  - `Cannot convert undefined or null to object`
- Kapanan bozuk endpointler:
  - `/api/admin/promotions/bundles`
  - `/api/admin/promotions/discounts`
  - `/api/admin/promotions/coupons`
  - `/api/admin/shop-items`

### Uygulanan cozum
- Runtime enum bagimliligi local typed constant setlerine tasindi.
- `promotion-schema.ts`, `shop-item-schema.ts`, `store/items route`, `admin shop-items route` ve `pricing.ts` buna gore guncellendi.
- Boylece:
  - admin sayfalari yeniden veri cekebilir hale geldi
  - promosyon create/update akisi tekrar calisir duruma geldi
  - pricing import zinciri daha stabil oldu

### Admin form duzeni
- Promosyon ekraninda artik ayri editor bloklari var:
  - `BundleEditor`
  - `DiscountEditor`
  - `CouponEditor`
- Her editor su mantikla tasarlandi:
  - hedef secimi kendi blokunda
  - indirim tipi kendi blokunda
  - limit / takvim kendi blokunda
  - coupon stacking sadece discount editorunde
- Bu ayrim, adminin yanlis payload gonderme riskini azaltir.

### Dashboard kopya duzenlemeleri
- Sag profil sidebar'daki bos radar mesaji admin odakli icerikten cikarildi.
- Yeni metin oyuncuya yonelik notr bir bos durum kopyasi kullanir.
- Full-page dashboard `play` butonuna `Oyna` etiketi eklendi.

### Bu Turdaki Dogrulama
- `npm run test:promotions`
- `npm run test:shop-items`
- `npm run test:store-pricing`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Drag-and-Drop Siralama ve Rarity-First Vitrin (9 March 2026)

### Siralama araci
- `/admin/shop-items` ekranina `Catalog Order` adli ayri bir drag-and-drop panel eklendi.
- Bu panel:
  - sadece aktif urunleri listeler
  - mevcut `sortOrder` sirasina gore yuklenir
  - surukle-birak sonrasi toplu update gonderir
- Yeni endpoint:
  - `/api/admin/shop-items/reorder`
- Bu endpoint:
  - admin auth ister
  - zod ile update listesini validate eder
  - transaction ile `sortOrder` yazar
  - audit log uretir

### Rarity-first karari
- `season` mantigi bu asamada bilerek eklenmedi.
- Sebep:
  - baslangicta merchandising mantigini sade tutmak
  - oyuncuya once net bir rarity dili vermek
  - admin paneli gereksiz metadata ile sisirmemek
- Bugunku yon:
  - `common`
  - `rare`
  - `epic`
  - `legendary`
  renk, glow, badge ve buton diliyle ayristirilir.

### Shop UI etkisi
- Shop item kartlari artik rarity'ye gore:
  - border
  - arka plan gradienti
  - ust strip rengi
  - rarity badge tonu
  - satin alma butonu
  farklilastirir.
- Bundle kartlarindaki item chip'leri de item rarity'sini gosterir.
- Boylece featured ve badge text disinda rarity de karar verici bir gorsel sinyal olur.

### Admin UI etkisi
- Drag siralama kartlari rarity tonunu admin tarafinda da korur.
- Admin, urunu sadece text tablo olarak degil merchandising objesi olarak gorur.

### Bu Turdaki Dogrulama
- `npm run test:shop-order`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Prisma Enum Mapping Hotfix (9 March 2026)

### Problem
- Admin panelden shop item olustururken Prisma su hatayi veriyordu:
  - `Invalid value for argument type. Expected ShopItemType.`
- Benzer risk promosyon create/update katmaninda da vardi.

### Koku neden
- UI ve validator katmaninda local string union kullanimi dogruydu.
- Ancak Prisma create/update asamasinda bu stringler runtime'da her ortamda guvenilir kabul edilmedi.
- Sonuc olarak:
  - validation geciyor
  - route icinde Prisma create/update patliyordu

### Uygulanan cozum
- Validator tarafindaki local typed sabitler korundu.
- Prisma'ya yazmadan hemen once explicit enum map uygulandi:
  - `StoreItemType -> Prisma ShopItemType`
  - `StoreItemRarity -> Prisma ItemRarity`
  - `StoreItemRenderMode -> Prisma CosmeticRenderMode`
  - `PromotionTargetType -> Prisma PromotionTargetType`
  - `PromotionDiscountType -> Prisma PromotionDiscountType`
- Shop item admin filtre sorgusu da ayni map ile guncellendi.

### Neden bu yontem
- UI ve API kontratlari string union ile sade kalir.
- Prisma client'a geciste runtime-safe enum degeri garanti edilir.
- Bu yaklasim onceki `nativeEnum` kaynakli kiriklarla da celismez.

### Bu Turdaki Dogrulama
- `npm run test:promotions`
- `npm run test:shop-items`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Card Face / Card Back Behavior (9 March 2026)

### Current behavior
- `card_face` ve `card_back` artik aktif turun anlaticisi baz alinarak socket payload'i ile tum client'lara yayilir.
- Bu nedenle:
  - anlatici login ise equip ettigi `card_face` karti goren herkeste ayni tema olarak gorunur
  - anlatici login ise equip ettigi `card_back` transition ekraninda ve tahminci/izleyici placeholder panelinde gorunur
  - guest oyuncular kendi kozmetiklerini kullanamaz ama login oyuncunun kuşandigi aktif kart temasini gorur
- Tahminci ekranindaki `Tahmin Et!` kutusu artik narrator `card_back` dilini kullanabilen temali placeholder paneldir.

### Neden boyle
- Kozmetik equip ve satin alma hakki halen sadece login kullanicidadir.
- Gorunum verisi ise narrator bazli server-resolved payload ile yayinlandigi icin guest kullaniciya yeni bir equip/satin alma yetkisi acilmaz.
- Bu model, urun degerini gorunur kilar ama auth sinirlarini bozmaz.

### Su an satin alinan kartta renk mantigi
- Default kartlarda kategori rengi `card.categoryColor` ile header'a uygulanir.
- Eger `card_face` equip edildiyse:
  - kart temasi border, glow, pattern, footer, word/taboo renklerini degistirir
  - kategori rengi varsa header'da hala kategori rengi onceliklidir
- Yani bugunku model:
  - kategori rengi = gameplay bilgisi
  - cosmetic tema = premium stil katmani

### Onerilen kalici yol
- `card_face` icin iki katmanli sistem daha dogru:
  - gameplay layer: kategori/difficulty sinyali korunur
  - cosmetic layer: border, texture, glow, frame, footer, overlay uygular
- Boylece satin alinan kart temasi karti premium hissettirir ama gameplay okunurlugunu bozmaz.

## Narrator Card Theme Broadcast (9 March 2026)

### Tamamlananlar
- `card_face` ve `card_back` local `/api/user/me` fetch'inden cikarildi.
- Room server artik anlaticinin equip ettigi kart kozmetiklerini DB'den okur, server tarafinda resolve eder ve socket payload'ina ekler.
- `yeniTurBilgisi` payload'i:
  - `cardFaceTheme`
  - `cardBackTheme`
  alanlarini tasir.
- `turGecisiBaslat` payload'i:
  - `cardBackTheme`
  alanini tasir.
- `ActiveGame` artik narrator kart temasini herkes icin tutarli sekilde kullanir:
  - anlatici ve gozetmen `card_face` ile `GameCard` gorur
  - tahminci ve izleyici `card_back` diliyle temalanmis placeholder panel gorur

### Misafir politikasi
- Misafir kullanici:
  - kozmetik satin alamaz
  - kozmetik equip edemez
  - ama login oyuncunun aktif tur kozmetigini gorur
- Boylece auth siniri korunur, vitrin etkisi ise oyunda gorunur kalir.

### Test ve dogrulama
- Yeni smoke test: `npm run test:room-card-themes`
- Bu slice'ta gecen kontroller:
  - `npm run test:room-card-themes`
  - `npm run test:card-face`
  - `npm run test:card-back`
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run build`

## Room UI Stability (10 March 2026)

### Fixed in this slice
- Room username bootstrap now uses a client snapshot pattern so the server and first client render start from the same null state.
- Guest join no longer hydrates from full room layout into `UsernamePrompt`; the prompt appears only after client readiness is established.
- Room role labels are now normalized through shared constants:
  - `Anlatici`
  - `Gozetmen`
  - `Tahminci`
  - `İzleyici`
- Active narrator team color now comes from `gameState.anlatici.takim` first, so:
  - narrator and inspector colors stay aligned with the real active team
  - timer number and timer bar use the real active narrator team color
- Guess panel copy and username prompt copy were rewritten in clean UTF-8-safe source files.

### Expected gameplay behavior after the fix
- Login narrator equips `card_face` and `card_back`.
- All clients in the room, including guests, can see those narrator cosmetics.
- Guests still cannot purchase or equip cosmetics.
- Narrator and inspector see the front card.
- Guesser and spectator see the narrator-themed back/placeholder panel.

### Verification
- `npm run test:room-display`
- `npm run test:room-card-themes`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`


### Single Inspector Enforcement (10 March 2026)
- The opponent side now has exactly one active primary inspector per turn.
- Only that primary inspector can use the `TABU` action.
- Other opponent players fall back to non-inspector gameplay visibility and cannot mutate round state.
- This was fixed in both places:
  - client UI button visibility
  - server-side `oyunVerisi` authorization guard

## 13 March 2026 Update - Store and Economy Runtime Gates

- Store access is now controlled by runtime system settings instead of hardcoded-only behavior.
- The following store routes now respect `features.storeEnabled` and maintenance state:
  - `/api/store/catalog`
  - `/api/store/items`
  - `/api/store/coupons/preview`
  - `/api/store/purchase`
  - `/api/store/bundles/purchase`
  - `/api/store/equip`
- Registration and match rewards are now partially runtime-configurable through system settings:
  - `economy.startingCoinBalance`
  - `economy.winRewardCoin`
  - `economy.lossRewardCoin`
  - `economy.drawRewardCoin`
- This removes the last hardcoded-only behavior from the most visible economy entry points.
