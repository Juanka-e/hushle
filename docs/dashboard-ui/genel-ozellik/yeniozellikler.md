# Yeni Ozellikler Yol Haritasi

> Son guncelleme: 31 March 2026
> Durum: aktif roadmap dokumani

## Kullanim Kurali
- Her branch tek konu tasir.
- Her branch icin `review`, `test`, `refactor`, `docs` kapanisi zorunludur.
- Is baslamadan once kapsam netlestirilir.
- Merge sonrasi sayisal durum bu dosyada guncellenir.

## Tamamlanan Feature Branch'ler
1. `feature/liveops-system-settings-foundation`
2. `feature/security-entry-gates`
3. `feature/admin-table-foundation`
4. `feature/moderation-foundation`
5. `feature/economy-liveops-controls`
6. `feature/user-email-foundation`
7. `feature/admin-user-operations`
8. `feature/admin-audit-viewer`
9. `feature/coin-grant-campaigns`
10. `feature/support-desk-foundation`
11. `feature/system-notifications-foundation`
12. `feature/admin-access-gateway`
13. `feature/branding-seo-settings`
14. `feature/branding-assets-upload`
15. `feature/integration-hub`
16. `feature/dashboard-visual-polish`
17. `feature/store-merchandising`
18. `feature/admin-shop-ux`
19. `feature/admin-inventory-operations`

## Aktif Teknik Kararlar

### Config Stratejisi
- Secret ve infra baglantilari `.env` icinde kalir.
- Runtime business ayarlari `system_settings` tablosundan yonetilir.
- Kod guvenli fallback degerleri saglar.
- Ayarlar cache ile okunur.

### Captcha Stratejisi
- Birincil provider: `Turnstile`
- Alternatif provider: `reCAPTCHA v3`
- Key'ler `.env` icinde kalir.
- Admin panel sadece davranisi ve aktiflik durumunu yonetir.

### Email Stratejisi
- Yeni kayitlarda email zorunlu.
- Legacy kullanicilar icin email nullable kalir.
- `normalizedEmail` unique alan olarak kullanilir.
- Email verification ve password reset sonraki branch'lere birakildi.

### Coin Guvenligi Stratejisi
- Store discount coupon ile coin dagitim sistemi ayridir.
- Wallet'a deger enjekte eden her akista transaction, actor audit, reason, duplicate claim korumasi, limit ve budget kontrolu zorunludur.
- Coin economy ve anti-abuse katmanlari icin planning rehberleri:
  - `docs/guides/economy-abuse-strategy-guide.md`
  - `docs/guides/night-market-and-missions-strategy-guide.md`

### Gelecek Odeme Stratejisi
- Gercek para ile coin satin alma sistemi, store coin harcamasindan ayri bir domain olarak ele alinacak.
- `feature/wallet-ledger-foundation` ile wallet ledger omurgasi kuruldu.
- Bakiye ve immutable hareket kaydi ayni MySQL transaction'inda yaziliyor.
- `feature/payment-orders-foundation` ile siparis snapshot, state machine, provider registry ve idempotency temeli kuruldu.
- `feature/payment-webhook-inbox` ile durable webhook dedupe, retry/dead-letter ve raw-body verifier kontrati kuruldu.
- Siradaki odeme branch'leri:
  - `feature/payment-checkout-ui`
  - ilk provider signature/checkout adapter'i
- Provider-neutral ödeme sırası ve güvenlik kontratı:
  - `docs/architecture/provider-neutral-payments.md`
- İlk sürüm checkout/top-up modelidir; oyuncu cash-out/payout kapsam dışıdır.
- `feature/payment-checkout-ui` ile responsive checkout, legal metin ayrimi,
  surumlu kabul kaydi ve owner-only siparis durumu tamamlandi; provider olmadigi
  icin gercek tahsilat halen fail-closed durumdadir.
- Amac, `payment_topup`, `purchase_spend`, `coin_grant`, `match_reward`, `refund` gibi hareketleri tek muhasebe zincirinde izlemek.

### Cache ve Veri Ayrimi Stratejisi
- MySQL kalici `source of truth` olarak kalir.
- Redis veya Valkey sadece cache, rate limit ve gecici koordinasyon verisi icin kullanilir.
- Room/lobi state'i PM2 multi-instance uretim ortaminda saf process-memory olarak birakilmayacak.
- Bu konu icin ana mimari not:
  - `docs/cache-and-storage-strategy.md`

### Store ve Liveops Stratejisi
- cosmetic definition, store offer, inventory ownership ve personalized offer alanlari ayrilacak.
- Night market, event reward, admin grant ve normal store satisi ayni modelin icine sikistirilmayacak.
- Ana referanslar:
  - `docs/guides/store-liveops-strategy-guide.md`
  - `docs/guides/night-market-and-missions-strategy-guide.md`

## Sonraki Oncelikli Branch'ler
20. `feature/economy-abuse-hardening`
21. `feature/cache-and-rate-limit-foundation`
22. `feature/night-market-foundation`
23. `feature/admin-promotions-ux`
24. `feature/cosmetic-render-upgrade`
25. `feature/admin-cosmetic-authoring`
26. `feature/gameplay-ui-polish`
27. `feature/analytics-event-foundation`
28. `feature/word-analytics-liveops`
29. `feature/release-ops-docs`
30. `docs/encoding-cleanup`
31. `feature/wallet-ledger-foundation`

## Admin Shop UX Slice (30 March 2026, completed)
- `feature/admin-shop-ux`
  - admin `shop-items` ve `promotions` ekranlari toparlandi
  - relation visibility:
    - paket
    - kampanya
    - kupon
    baglantilari gorunur hale geldi
  - `availabilityMode`, `startsAt`, `endsAt` ile future liveops zemini acildi
  - `event_only`, `seasonal`, `limited`, `scheduled` merchandising modeli admin tarafinda yonetilebilir oldu
  - promotion lifecycle:
    - pasife al
    - guvenliyse sil
    olarak netlestirildi

## Admin Inventory Operations Slice (30 March 2026, completed)
- `feature/admin-inventory-operations`
  - admin inventory inspect sayfasi eklendi
  - grant / revoke / equip reset akisleri geldi
  - protected source revoke mantigi eklendi
  - inventory route'larina rate limit eklendi
  - riskli inventory aksiyonlari icin onay modallari eklendi
  - secili oyuncu icin son operasyon notlari gorunur oldu
  - audit ekraninda not kolonu acildi

## Security Hardening Slice (30 March 2026, completed)
- `fix/admin-security-hardening`
  - admin API read/write route kapsami boyunca rate limit tamamlandi
  - `TRUST_PROXY` request rate limit ve audit IP kaydinda gercekten uygulanir hale geldi
  - deployment security rehberi `TRUST_PROXY + Nginx + private backend` karariyla guncellendi
  - oyuncu tarafinda:
    - `user/me`
    - `user/dashboard`
    - `user/inventory`
    - `support/tickets`
    - `store/items`
    read route'larina rate limit eklendi

## Admin Content Ops Slice (30 March 2026, completed)
- `fix/admin-content-ops`
  - duyuru kart dili sade ve compact hale getirildi
  - duplicate metin ve block count gibi ic metadata kaldirildi
  - `YENI` rozeti 7 gunluk gorunum mantigiyla korundu
  - tarih meta alani sag uste tasindi
  - admin preview oyuncu kartina yaklastirildi
  - kelime bulk upload iki modlu hale geldi:
    - `csv_categories`
    - `fixed_categories`
  - duplicate / skipped / error sonuclari gorunur hale geldi
  - kelimelerde yalniz gorunen sayfayi secen bulk selection ve guvenli bulk delete eklendi
  - eski sidebar `Toplu Yukleme` girisi kaldirildi, eski URL `Kelime Yonetimi`ne yonlenir

## Coin Grants Archive Lifecycle Slice (31 March 2026, completed)
- `fix/coin-grants-archive-lifecycle`
  - campaign ve code tarafindaki archive semantigi tek modele cekildi
  - `Tüm operasyonel`, `Aktif`, `Pasif`, `Arşiv` filtrelerinin ne gosterdigi netlesti
  - archive, pasiflestirme ve restore davranisi tutarli hale getirildi
  - campaign/code kart yogunlugu azaltildi ve code summary guclendirildi

## Admin User Observability Slice (31 March 2026, completed)
- `feature/admin-user-observability`
  - kullanici listesi ve operasyon yuzeyine trusted access sinyalleri eklendi
  - support, inventory ve audit tarafina derin link akisi kuruldu
  - support ve inventory detail panelleri daha zengin baglam kartlariyla guclendirildi
  - local development auth host trust kirilmasi kapatildi

## Economy Abuse Hardening Slice (31 March 2026, active)
- `feature/economy-abuse-hardening`
  - reward eligibility kurallari merkezi hale getirilecek
  - coin cap ve diminishing returns temeli kurulacak
  - repeated-group sinyalleri yumusak suphe skoruna baglanacak
  - audit ve admin review icin aciklanabilir ekonomi metadata'si eklenecek

## Night Market Ve Gorev Sistemi Notu
- `feature/night-market-foundation` acele uygulanmayacak
- once economy guardrail, admin observability ve reward mantigi olgunlasacak
- gorev sistemi, rozetler, profil banner ve geri donus motivasyonu birlikte planlanacak
- planning rehberleri:
  - `docs/guides/economy-abuse-strategy-guide.md`
  - `docs/guides/night-market-and-missions-strategy-guide.md`

## Sayisal Durum
- Tamamlanan feature branch sayisi: 19
- Planli toplam feature branch sayisi: 31
- Kalan feature branch sayisi: 12

## Notlar
- `fix/*` branch'ler bu sayiya dahil degildir.
- `docs/*` planning branch'leri de feature sayisina dahil degildir.
- Room regression ve dependency hotfix gibi duzeltmeler roadmap count icinde tutulmaz.
- Bu dosya karar dokumanidir; eski brainstorming metinleri burada tutulmaz.
