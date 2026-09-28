# AI Agents Security Review

> Son guncelleme: 15 March 2026
> Branch: `fix/security-review-remediation`
> Kapsam: auth redirect zinciri, duyuru olusturma/yayinlama zinciri, promotion/coupon limit mantigi, captcha policy, public/admin read endpoint abuse dayanimi, proxy/origin korumalari

## Ozet
- Dogrulanan yuksek guven bulgu: `1`
- Dogrulanmayan AI false positive: `2`
- Policy/config riski: `1`
- Bu branch'te tamamlanan hardening/refactor kalemi: `3`
- Genel risk seviyesi: `Medium -> Low`

## Dogrulanan Bulgular

### [SEC-001] Untrusted `callbackUrl` ile client-side redirect sink (High) - Fixed
- **Konum:** `apps/web/src/app/login/page.tsx`, `apps/web/src/app/admin/login/page.tsx`
- **Guven:** High
- **Sorun:** `callbackUrl` query parametresi dogrudan istemci yonlendirme sink'ine gidiyordu.
- **Etki:** Login sonrasi acik redirect veya guvensiz URL sink davranisi olusabilirdi.
- **Duzeltme:** `apps/web/src/lib/security/safe-callback-url.ts` eklendi. Sadece internal/same-origin path'ler kabul ediliyor.
- **Durum:** Fixed

## Bu Branch'te Tamamlanan Savunma Iyilestirmeleri

### [HARDEN-001] Structured announcement modeli ve safe render zinciri
- **Neden yapildi:** Regex sanitizer zinciri tek basina profesyonel savunma siniri degildi.
- **Yapilan:**
  - `announcements.content_blocks` JSON alani eklendi
  - admin duyuru olusturma/düzenleme akisi blok semasina tasindi
  - oyuncu tarafi artik `dangerouslySetInnerHTML` kullanmiyor
  - duyurular React blok bilesenleriyle render ediliyor
  - eski HTML duyurular `normalizeAnnouncementBlocks(...)` ile legacy uyumlulukla okunuyor
- **Durum:** Completed

### [HARDEN-002] Public ve admin read endpoint'lere abuse hardening
- **Yapilan endpoint'ler:**
  - `/api/store/catalog`
  - `/api/admin/words`
  - `/api/admin/categories`
  - `/api/admin/announcements`
  - `/api/announcements/visible`
- **Yapilan:** Memory-based read rate limit + standard rate-limit header'lari eklendi.
- **Durum:** Completed

### [HARDEN-003] `/api/support/*` ve `/api/coin-grants/*` proxy origin korumasi kapsamina alindi
- **Konum:** `apps/web/src/proxy.ts`
- **Not:** Bu review'de bunu ayri bir yuksek guven acik olarak raporlamadim. Buna ragmen state-changing endpoint'ler merkezi origin gate altina alindi.
- **Durum:** Completed

## AI Raporlarindaki Tartismali Maddelerin Dogrulama Sonucu

### 1. `tx.discountCampaign.fields.usageLimit` / `tx.couponCode.fields.usageLimit`
- **Karar:** Report false positive. Yuksek guven acik olarak dogrulanmadi.
- **Neden:** AI raporu bu Prisma field API'sini "gecersiz syntax" olarak yorumluyordu. Bu repo/runtime icinde field accessor gercekten mevcut.
- **Kanıt:** `scripts/test-promotion-field-references.ts` smoke testi gecti.
- **Ek not:** Bu, limit mantiginin her durumda kusursuz oldugunu tek basina ispatlamaz; ama AI raporundaki "syntax invalid -> unlimited bypass" iddiasi yanlisti.

### 2. Captcha `soft_fail`
- **Karar:** Uygulama acigi olarak raporlanmadi.
- **Neden:** Bu attacker-controlled bypass degil; operator/config policy riski.
- **Dogru yorum:** Production'da `soft_fail` acik birakilmasi yanlis bir operasyon karari olabilir, ama bu bir exploit kaniti degil.

### 3. Regex tabanli announcement sanitizer
- **Karar:** Ayrica exploit olarak raporlanmadi; bunun yerine yapisal refactor ile kaldirildi.
- **Neden:** Review sirasinda somut bir exploitable XSS payload'i yuksek guvenle dogrulanmadi.
- **Son durum:** Render zinciri artik HTML sink'ine dayanmiyor.

### 4. GET route rate limiting eksikligi
- **Karar:** Yuksek guven app vuln degil; abuse dayanimi/hardening konusu.
- **Son durum:** Ana agir read endpoint'ler rate limit altina alindi.

## Kendi Baslangictan Sona Review Tarafimdan Tekrar Taranan Alanlar
1. login ve admin login redirect zinciri
2. announcement create/update/visible/render akisi
3. promotion/coupon usage limit rezervasyon mantigi
4. captcha enforcement ve fail mode politikasi
5. proxy origin gate kapsami
6. support ve coin-grant state-changing endpoint'leri
7. public/admin agir GET endpoint'ler
8. guest identity ve admin auth sinirlari

## Sonuc
- Bu review turunda **1 adet gercek yuksek guven bulgu** tespit edildi ve kapatildi.
- Announcement sistemi profesyonel yapisal modele tasindi; HTML sink zinciri kaldirildi.
- AI tarafindan raporlanan coupon/discount "invalid Prisma syntax" iddiasi smoke test ile yanlislandi.
- GET abuse yuzeyi ve proxy origin kapsami sertlestirildi.

## Bu Branch'te Dogrulanan Testler
- `npm run test:auth-redirect-security`
- `npm run test:announcement-security`
- `npm run test:announcement-structure`
- `npm run test:promotion-field-references`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`
