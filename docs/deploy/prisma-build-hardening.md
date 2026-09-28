# Prisma Build Hardening

> Status: Docker build gürültüsü giderildi, build-safe branding snapshot karari gelecege acik.

Bu not aktif bir production bug degil, build ve runtime DB davranisinin
birbirinden nasil ayrildigini kaydeder.

Semptom:

- `next build` sirasinda cok kez `prisma.systemSetting.findMany()` uyarisi goruluyor
- build tamamen dusmuyor
- uygulama varsayilan ayarlara fallback ederek devam ediyor

Kaynak:

- `apps/web/src/lib/system-settings/service.ts` icindeki `getSystemSettings()`
- build-time metadata veya layout cagrilari
- ozellikle:
  - `apps/web/src/app/layout.tsx`
  - `apps/web/src/app/room/[code]/layout.tsx`
  - `apps/web/src/app/login/layout.tsx`
  - `apps/web/src/app/register/layout.tsx`
  - `apps/web/src/app/store/page.tsx`

Muhtemel neden:

- build ortaminda Prisma datasource tam uygulama runtime'i ile ayni degil
- `getSystemSettings()` build sirasinda DB'ye erismeye calisiyor
- mevcut fallback sadece belirli database erisim hatalarini yumusatiyor
- log'daki `the URL must start with the protocol prisma:// or prisma+postgres://` mesaji ayri bir hata sinifi oldugundan sessizce onlenmiyor

Neden ayri gorev:

- bu konu Redis rollout'tan ayri
- burada alinacak karar SEO / metadata / build cache davranisini etkileyebilir
- yanlis bir "hemen sustur" cozumuyla runtime hata gorunurlugu zarar gorebilir

Uygulanan cozum:

- Docker image buildi `SKIP_DATABASE_DURING_BUILD=true` ile calisir
- `getSystemSettings()` bu explicit build kontratinda Prisma sorgusu yapmadan
  normalize edilmis varsayilan ayarlari dondurur
- normal local build, CI ve production runtime bu bayrak verilmedikce DB
  gorunurlugunu ve mevcut fallback davranisini korur
- bu bayrak kalici runtime environment degiskeni olarak verilmemelidir

Gelecekte degerlendirilecek cozumler:

1. build-time metadata icin DB bagimli branding okumayi azalt
2. branding gibi nadir degisen ayarlari build-safe snapshot veya env tabanli kaynakla ayir
3. log seviyesini dusurmeden, tanimli hata siniflari icin tek seferlik warning davranisini koru

Karar verilmesi gereken nokta:

- metadata ve layout katmanlari build sirasinda DB'den mi beslenecek
- yoksa branding/runtime ayarlari ayrilip build-safe bir kaynak mi kullanilacak
