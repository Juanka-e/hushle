# Guides

Bu klasor tekrar kullanilacak operasyonel rehberleri toplar.

## Mevcut Rehberler

1. `card-design-guide.md`
- kart ve kozmetik authoring referansi
- AI brief ve admin panel asset/template standardi

2. `branding-assets-guide.md`
- logo, favicon ve Open Graph asset export rehberi
- hangi dosyanin hangi yuzey icin uygun oldugunu netlestirir

3. `deployment-security-guide.md`
- production deployment guvenlik rehberi
- reverse proxy, `AUTH_TRUST_HOST`, backend portlarini kapatma ve topology standardi

4. `store-liveops-strategy-guide.md`
- magaza, liveops, inventory ve personalized offer alanlarini ayirma rehberi
- night market, merchandising ve admin operasyon sinirlarini tanimlar

5. `economy-abuse-strategy-guide.md`
- coin ekonomisi, reward eligibility ve abuse minimizasyonu rehberi
- gunluk cap, tekrarlayan grup analizi ve gorev sistemi risklerini tartisir

6. `admin-shop-ux-planning-guide.md`
- admin shop, bundle ve promotion operasyonlarini toparlama rehberi
- bu branch'te neyin yapilacagini ve neyin bilincli olarak sonraya birakilacagini netlestirir

7. `admin-inventory-operations-planning-guide.md`
- admin tarafinda oyuncu inventory'sini goruntuleme ve yonetme rehberi
- grant / revoke / equip reset / audit sinirlarini tanimlar

8. `admin-security-hardening-guide.md`
- admin panel API guvenligi ve rate limit sertlestirme rehberi
- authz, request korumasi, IP/trusted proxy ve admin operasyon risklerini tarar

9. `admin-content-ops-guide.md`
- duyuru ve bulk content operasyonlarini toparlama rehberi
- compact render/editor ve kategori destekli bulk upload sinirlarini tanimlar

10. `coin-grants-archive-lifecycle-guide.md`
- coin grant campaign ve code tarafindaki archive semantigini esitleme rehberi
- `Tum`, `Pasif`, `Arsiv` davranislarini ayni lifecycle modeline ceker

11. `night-market-and-missions-strategy-guide.md`
- night market, gorev sistemi ve oyuncu motivasyon katmanlarini birlikte planlama rehberi
- hangi kosullarda implement edilmesi gerektigini ve neden acele edilmemesi gerektigini aciklar

12. `admin-user-observability-guide.md`
- admin kullanici listesi ve detayinda operasyonel gozlem sinyallerini guclendirme rehberi
- IP, son gorulme, trusted proxy ve abuse review'a temel olacak observability sinirlarini tanimlar

13. `economy-abuse-hardening-guide.md`
- reward eligibility, coin cap ve suphe skoru uygulama rehberi
- false positive riski yuksek oldugu icin branch sinirlarini ve guardrail'leri netlestirir

14. `economy-progression-and-pricing-guide.md`
- coin pacing, magazadaki fiyat ladder'i, XP/level ayrimi ve gorev zamanlamasi rehberi
- ekonomiyi yalniz bugunku match reward tablosuna degil, gelecekteki source ayrimina gore kurar

15. `economy-abuse-validation-checklist.md`
- economy guardrail branch'i icin manuel kontrol listesi
- system settings, audit review, repeated-group ve ceiling davranislarini dogrulamak icin kullanilir

16. `player-display-name-and-audit-strategy-guide.md`
- kayitli oyuncunun gorunen adi, hesap username'i ve audit snapshot ayrimini tanimlar
- displayName degisikligi ile gameplay UI polish backlog'unu ayni cercevede toplar

17. `wallet-ledger-foundation-guide.md`
- coin bakiyesi ile immutable hareket zincirinin transaction kontratini tanimlar
- legacy snapshot, eszamanli harcama, admin reconciliation ve production rollout adimlarini aciklar

18. `mobile-api-foundation-guide.md`
- apps/api runtime, surumlu JSON kontrati ve transport guvenlik sinirlarini tanimlar
- mobile auth foundation, opaque token rotation ve cihaz oturumu revoke modelini tanimlar
- mobile player core, `/v1/me` ve ortak profile update servisini tanimlar
- bearer auth gate'i ile profile/inventory/economy route tasima sirasini aciklar

17. `mobile-inventory-and-equip-guide.md`
- bounded mobil inventory pagination ve equip/unequip kontratini tanimlar
- web ve mobil runtime'in ortak sahiplik/tur dogrulamasini aciklar

18. `mobile-store-catalog-guide.md`
- bounded item/bundle katalog pagination ve cache revision modelini tanimlar
- ortak fiyatlandirma ile server-owned purchase sinirini aciklar

19. `web-launch-readiness-guide.md`
- web acilisi icin core, Playwright, disposable DB ve Redis integration
  kapilarini tanimlar
- otomatik test ile manuel coklu oyuncu/gercek cihaz smoke sinirini ayirir

20. `web-responsive-device-matrix.md`
- kucuk telefon, Android, yatay telefon, tablet ve laptop Playwright
  profillerini tanimlar
- Chromium emulasyonu ile fiziksel iOS/Android cihaz kaniti arasindaki siniri
  aciklar

21. `web-real-device-smoke.md`
- fiziksel iOS, Android ve laptop smoke sunucusu kurulumunu tanimlar
- cihaz, browser, release SHA ve GO/HOLD kanit standardini belirler

22. `web-webkit-readiness.md`
- WebKit iPhone ve desktop public responsive projelerini tanimlar
- disposable DB registered akisiyla fiziksel Safari kaniti arasindaki siniri belirler

23. `web-multiplayer-launch-readiness.md`
- iki guest browser context ile lobby, start ve hazirlik senkronunu tanimlar
- disposable kategori/kelime fixture yasam dongusunu ve kapsam sinirini belirler

24. `oauth-provider-strategy.md`
- Google ve Apple login zamanlamasi, email verification ve guvenli account
  linking sinirlarini tanimlar

25. `paytr-iframe-adapter.md`
- PayTR token/callback HMAC kontratini ve veri minimizasyonu sinirini tanimlar
- checkout aktivasyonu, processor, fulfillment ve sandbox smoke kapilarini ayirir

26. `payment-fulfillment-operations.md`
- paid order icin atomik coin/kozmetik teslimati ve duplicate korumasini tanimlar
- failure, partial rollback ve refund/chargeback kapsam sinirini aciklar

27. `payment-checkout-and-legal-readiness.md`
- PayTR sandbox checkout gate'ini, transient iletisim verisini ve legal surumlemeyi tanimlar
- live aktivasyonundan once gereken webhook, reversal ve operasyon kontrollerini ayirir

28. `payment-reconciliation-and-reversal.md`
- PayTR durum sorgusu, uzlaştırma worker'ı ve admin operasyon yolunu tanımlar
- kozmetik reversal, çift admin onayı ve ücretli coin lot geri alma sınırını açıklar

29. `paytr-refund-adapter.md`
- PayTR iade HMAC/transport kontratını ve production fail-closed sınırını tanımlar
- timeout retry, idempotency ve durable provider attempt gereksinimini açıklar

30. `ses-feedback-webhook.md`
- SES/SNS signature, topic ve source identity doğrulamasını tanımlar
- permanent bounce/complaint suppression ile production kabul sınırını ayırır

31. `i18n-announcements-and-word-packs.md`
- Türkçe/İngilizce arayüz tercihi ile oda kelime dilinin ayrı sınırlarını tanımlar
- güvenli çift dilli duyuru/SSS modelini ve locale izole kelime paketlerini açıklar
