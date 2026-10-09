# Hushle Proje Eksik ve Risk Analizi

Tarih: 6 Ekim 2026.
Kapsam: mevcut çalışma ağacı, web/API/jobs sınırları, oyun, kimlik, ekonomi,
mağaza, ödeme, deployment, test kapıları ve yerel servis durumu.

## Yönetici Özeti

### Sonraki Düzeltmeler

Bu raporun ilk bulgularından IP ingress zinciri, lint/i18n testleri, kalıcı
upload storage, DB+görsel backup/restore, CI deploy kapısı ve health beklemesi
uygulandı. Maç ödülünde cap okumalarından önce cüzdan kilidi ve Redis rate-limit
eklendi; oturum başına global suspension cleanup kaldırıldı. `/test` production'da
404 verir. Aşağıdaki ilk analiz bu düzeltmelerden önceki riski açıklar;
güncel durum/kanıtlar için
[veri güvenliği runbook'u](persistent-assets-and-data-backups.md) esas alınır.

Gerçek yerel backup izole MySQL'e geri yüklendi: 55 tablo, 9 kullanıcı,
30 kelime. Client bağımsız durable reward/outbox, atomik release/rollback,
gerçek offsite acceptance ve provider production kabulü henüz kapanmadı.
Docker'ın ilk `npm ci` çıktısı 50 advisory (1 critical, 16 high, 32 moderate,
1 low) bildirdi; tüm dependency ağacına aittir, runtime etkisi doğrulanmadı.
Detaylı dış servis taraması ayrıca izin/kabul gerektirir; kör `audit fix --force`
uygulanmadı. Docker install artık örtülü audit gönderimi yapmaz (`--no-audit`).

Hushle'ın temel problemi özellik azlığı değil. Önemli platform parçaları
uygulanmış; fakat güvenilir release, kalıcı asset saklama, maç sonucunun
dayanıklılığı ve gerçek ortam kabul kanıtları henüz tamamlanmış değil.

Karar: kontrollü geliştirme/alpha testlerine devam edilebilir. Bu rapor public
production veya gerçek para kabulü için GO belgesi değildir.

Öncelik sırası:

1. Proxy IP güven zinciri, lint ve i18n sonrası bozulan testler.
2. Kalıcı upload storage ve CI başarısına bağlı deployment.
3. Maç sonucunu client finalize isteğinden bağımsız, dayanıklı hale getirme.
4. Gerçek cihaz, DB/Redis entegrasyon, yük ve production operasyon kabulü.
5. İngilizce içerik, mağaza içeriği ve ekonomi fiyatlandırması.
6. Ayrı kapsam onayıyla full-art kartlar ve koleksiyon/renk varyantları.

XP, görev, night market, kutu, dahili ses ve native mobil ilk açılışın
zorunlu parçaları değildir. Yayıncı modu şu anda yalnız ayrı prototiptir.

## İncelemenin Sınırları

- Branch: `feature/bilingual-announcements-and-word-locales`.
- Yerel HEAD ve kayıtlı upstream commit karşılaştırması: `0 / 0`.
- Remote fetch yapılmadı; bu sonuç remote'un anlık değişmediğinin kanıtı değildir.
- İnceleme başında 16 tracked dosyada değişiklik ve 5 untracked dosya vardı.
  Dolayısıyla origin ile commit eşitliği, çalışma ağacının temiz olduğu anlamına gelmez.
- Mevcut oyun değişiklikleri korunmuştur. Bu incelemede uygulama kodu düzeltilmedi.
- Yerel DB sorguları yalnız okuma amaçlıdır. DB reset, migration, seed veya
  gerçek ödeme yapılmadı.
- Bu turda Playwright, çok oyunculu tam maç, yük testi, Docker image build,
  fiziksel cihaz ve staging/production testleri çalıştırılmadı.
- Dış Cloudflare, SMTP/SES, bucket, alarm ve merchant panelleri doğrulanmadı.

## 1. Öncelikli Teknik Bulgular

### P1: Proxy IP zinciri istemci değerini güvenilir IP kabul edebiliyor

Kanıt:

- `nginx/nginx.conf:34`: `X-Forwarded-For $proxy_add_x_forwarded_for`.
- `apps/web/src/lib/security/client-ip.ts:43`: zincirin ilk değeri kullanılıyor.
- `docker-compose.yml`: production uygulaması için `TRUST_PROXY=true` varsayımı.
- İzole helper testinde forwarded zinciri `198.51.100.123, 203.0.113.7`,
  real IP `203.0.113.7` iken sonuç `198.51.100.123` oldu.

Etki: gelen header upstream tarafından temizlenmiyorsa IP bazlı rate-limit,
captcha risk sinyali ve audit IP yanlış kişiye bağlanabilir. Bu kendi başına
session, admin rolü veya ödeme imzası bypass'ı değildir. Production Cloudflare
header davranışı bu incelemede ölçülmedi; repo Nginx konfigürasyonu tek başına
güven zincirini tamamlamıyor.

Gerekli iş:

- Cloudflare/origin bağlantı modeli açıkça seçilmeli ve origin kilitlenmeli.
- Yalnız güvenilen proxy CIDR'lerinden canonical IP alınmalı.
- Nginx, client supplied forwarded header'ını canonical değerle değiştirmeli.
- Doğrudan origin, sahte forwarded zinciri, IPv6 ve NAT senaryoları test edilmeli.
- Aynı ev/IP, farklı kullanıcılar için otomatik ceza gerekçesi olmamalı.

### P1: Production upload'ları container yeniden oluşturulunca kaybolabilir

Kanıt:

- Kozmetik upload: `apps/web/src/app/api/admin/shop-items/upload/route.ts:99`.
- Branding upload: `apps/web/src/app/api/admin/branding-assets/upload/route.ts:93`.
- İkisi de runtime `public/` altında dosya yazıyor.
- `docker-compose.yml:157` uygulama servisinde upload volume yok.
- DB/Redis volume'ları var; dosya upload'ları bu kalıcılıktan yararlanmıyor.

Etki: admin panelinde yüklenen dosyanın URL'si DB'de kalırken yeni container'da
dosya bulunmayabilir. Logo, kart, avatar ve thumbnail kırılabilir. MySQL dump'ı
asset dosyalarının yedeği değildir.

Gerekli iş:

- Kalıcı asset dizini + kontrollü servis route'u veya ayrı object-storage/CDN.
- Asset backup/restore ve orphan cleanup.
- Immutable/versioned URL, byte ve pixel/decode sınırı, thumbnail üretimi.
- Upload -> container recreate -> asset HTTP 200 kabul testi.
- Backup bucket ile public cosmetic asset bucket aynı erişim politikasını taşımamalı.

### P1: Deploy workflow CI sonucunu beklemiyor

Kanıt:

- `.github/workflows/deploy-production.yml:6`: bağımsız `push: main` tetikleyicisi.
- CI completion/başarılı test sonucu bu workflow için dependency değil.
- `scripts/ops/deploy.sh:72`: migration çalıştırılıyor.
- `scripts/ops/deploy.sh:73`: `up -d --build`; ardından HTTP readiness/smoke yok.
- Kaynak arşivi mevcut dizinin üzerine açılıyor; eski release otomatik saklanmıyor.

Etki: `main` push'u CI devam ederken deployment başlatabilir. Docker build
typecheck yapar fakat lint/E2E başarısı yerine geçmez. Workflow tamamlanması
uygulamanın gerçekten sağlıklı olduğunu garanti etmez. Silinen eski kaynak
dosyaları üzerine açılan arşivle dizinde kalabilir.

Gerekli iş:

- Başarılı CI'nin test ettiği aynı SHA/artifact üzerinden deploy.
- Branch protection ve production approval ayarlarını GitHub'da ayrıca doğrulama.
- Release dizini veya immutable image, health/smoke gate ve tested rollback.
- Migration öncesi restore edilmiş backup kanıtı ve backward-compatible schema planı.
- Aktif maç varken yeni oda admission'ını kapatıp mevcut maçları drain etme.

### P1: Maç ödülü ve geçmişi client finalize isteğine bağımlı

Kanıt:

- `apps/web/src/app/room/[code]/page.tsx:535`: oyun bitişinden sonra HTTP finalize.
- Retry yalnız bazı 404/409 durumları için; ağ hatası, 429 ve 5xx için kalıcı retry yok.
- `apps/web/src/app/api/game/match/finalize/route.ts`: sonuç process-local oda
  snapshot'ından üretiliyor, MatchResult bu istekte yazılıyor.
- `apps/web/src/lib/socket/game-socket.ts:1248`: reset state'i ve katılımcıları temizliyor.
- Aktif oda state'i process-local; server restart'ında geri yüklenmiyor.

Etki: maç bitişinde isteğin kaybolması, host'un lobiye erken dönmesi veya
server restart'ı durumunda kullanıcı ödülü/geçmişi sonradan güvenilir biçimde
tamamlanamayabilir. Duplicate claim koruması, hiç ulaşmayan claim sorununu çözmez.

Gerekli iş:

- Server-owned immutable match ID ve bitiş snapshot'ını önce kalıcılaştırma.
- Katılımcı bazlı unique/idempotent reward, bounded outbox/worker veya retry.
- Client finalize yalnız teslimat/status okuma veya idempotent tamamlayıcı olsun.
- Ağ kesintisi, 429/500, anında reset, yeni maç ve restart testleri.
- Guest maçları için kalıcı geçmiş gerekip gerekmediğini ayrı belirleme.

Bu risk kod yolundan çıkarılmıştır; bu turda canlı ödül kaybı yeniden üretilmedi.

### P1: Kalite kapıları şu an tamamen yeşil değil

- `scripts/design-prototypes/hushle-streamer-studio/server.cjs:1`:
  3 adet `@typescript-eslint/no-require-imports` hatası.
- `scripts/test-payment-checkout-foundation.ts:57`: Türkçe literal arıyor;
  UI `t("checkout.privacyNotice")` kullanıyor.
- `scripts/test-cosmetic-render-upgrade.ts:35`: `Daha fazla göster` literal'ini
  arıyor; UI dictionary kullanıyor.

İki test sonucu tek başına checkout veya pagination runtime'ının bozuk olduğunu
kanıtlamıyor. Test kontratları i18n'e uyarlanmalı, testler silinmemeli. Prototip
için dar CJS lint override veya ESM dönüşümü; tüm uygulamaya geniş ignore değil.

## 2. Performans ve Veri Ömrü Eksikleri

### Oturum okumasında global suspension cleanup

`apps/web/src/lib/session.ts:11`, her geçerli session okumasında
`clearExpiredSuspensions()` çağırıyor. Bu fonksiyon User üzerinde global
`updateMany` çalıştırıyor; sonra ayrıca kullanıcı okunuyor.

Bu gereksiz DB write/query yüküdür. Okunacak kullanıcı için süre kontrolü
yapılabilir; genel cleanup bounded jobs'a taşınabilir. Session revoke/role
kontrolü optimizasyon bahanesiyle kaldırılmamalı.

### Mağazadaki 24 ürün batch'i gerçek API pagination değil

- UI `/api/store/catalog` üzerinden bütün katalog alıyor.
- Ortak katalog cache'i 30 saniye, bu DB maliyetini azaltıyor.
- Grid yalnız 24 ürün render ediyor; ağ JSON'u ve per-user overlay yine tüm katalog.
- `packages/platform-store/src/index.ts:828` cursor paged core mevcut, web'e bağlanabilir.

Katalog büyümeden web arama/filter/pagination bu core'a geçirilmeli. Statik
thumbnail ve lazy image korunmalı; her renk asset'i grid açılışında indirilmemeli.
Redis browser decode, GPU, DOM veya JSON payload maliyetini çözmez.

### Economy counter'ları hâlâ MySQL sorgusu

- Safety ceiling: user/window `matchResult.aggregate`.
- Repeated group: user/lineup/window `matchResult.count`.
- İlgili kullanıcı/zaman ve kullanıcı/lineup/zaman indeksleri mevcut.

Bu ilk sürüm için makul temel; gerçek query süreleri/EXPLAIN/yük ölçümü olmadan
kaç online oyuncu taşıyacağı söylenemez. Redis'e taşınacaksa ledger source of
truth kalmalı, atomic reservation/idempotency, recovery ve SQL fallback birlikte
tasarlanmalı. Cache eklemek transaction tutarlılığının yerine geçmez.

### Audit archive sonsuz saklama sorununu çözmüyor

- Normal finalize, uygun olduğunda Redis rollup'a gidiyor.
- Review flag veya guard trigger varsa detailed audit yazılıyor.
- Guest çoğunluğu tek başına review flag: normal 1 registered + 3 guest
  arkadaş grubu da detailed audit üretebilir. Bu abuse kanıtı değildir.
- Retention job hot kayıtları aynı MySQL'deki archive tablosuna taşıyor.
- Archive için export/purge/legal hold döngüsü henüz yok.
- Retention taraması createdAt/id ile; hot tablodaki mevcut compound indekslerin
  bu genel tarama için uygunluğu EXPLAIN ile ölçülmeli.

Gerekli iş: action bazlı retention, örnekleme/aggregate ayrımı, archive export,
hold korumalı purge, job heartbeat ve disk/growth alarmı. Archive'ı başka tabloya
taşımak DB'nin toplam boyutunu sınırlamaz.

### Realtime tek instance sınırı

Redis fan-out ve ownership temelinin bulunması yatay ölçekleme desteği değildir.
`realtime-topology.ts` bilinçli olarak replica sayısını 1 tutuyor. Owner routing,
command forwarding, room recovery ve failover testleri tamamlanmadan replica
artırılmamalı. Önce tek instance kapasitesi ölçülmeli; yeni microservice şart değil.

## 3. Güvenlikte Mevcut Temel ve Açık Kapılar

Doğrulanan temel:

- HTTP origin/CSP ve socket origin/payload/role kontratları.
- Admin session/RBAC, account capability ve sessionVersion kontrolleri.
- Yeni parola politikası, login limitleri, recovery ve explicit OAuth linking.
- Client'tan fiyat/ödül yerine server-owned kurallar.
- Wallet ledger ve duplicate/idempotency sınırları.
- Payment signature, inbox ve provider-specific doğrulama temeli.

Eksik veya doğrulama bekleyen:

- Proxy header zinciri yukarıdaki P1.
- Cloudflare Access uygulama tarafında imzalı JWT/JWKS doğrulamıyor;
  header güveni yalnız origin lock ve edge sanitization ile anlamlı.
- Uygulama içi admin MFA/WebAuthn yok; gerçek Access MFA aktivasyonu kanıtlanmalı.
- Bazı HTTP limitleri process-local; tüm limitler Redis'e taşınmış değil.
- Redis fallback tek instance için tasarlanmış; attack/degraded alarmı gerekli.
- Upload pixel/decode bütçesi ve production persistence kabulü eksik.
- Registered kimliği userId ile sabit; guest kimliği değişince exact lineup
  değişebilir. Repeated-group guard tek başına Sybil/fake-group çözümü değil.
- Server-side rol kontrolü gerçek insanların dürüst oynadığını kanıtlamaz;
  kontrollü hesaplarla çok hızlı maçlar için mevcut ceiling + telemetry'nin
  gerçek saha false-positive/false-negative oranı ölçülmeli.

Salt IP/fingerprint ile ağır veya otomatik ceza önerilmiyor.
Bu inceleme penetrasyon testi veya tüm güvenlik açıklarının yokluğu garantisi değildir.

## 4. Yerel Kurulumun Gerçek Durumu

Bu sayılar production içeriğinin veya repo seed kataloğunun sayısı değildir;
6 Ekim'deki çalışan local DB'den okunan değerlerdir.

| Alan | Local durum |
| --- | --- |
| Türkçe kelime | 30 |
| Türkçe kategori | 1 |
| İngilizce kelime/kategori | 0 / 0 |
| Aktif mağaza ürünü | 0 |
| Aktif payment offer | 0 |
| Hot audit / archive | 4 / 0 |
| Redis | Bağlantı testi başarılı, ölçülen ping 21 ms |
| Payments | Disabled |
| Email provider / jobs | Disabled / false |
| Turnstile keys | Yapılandırılmamış |
| Google OAuth | Disabled |
| Observability export | Disabled |
| Offsite backup | Disabled |

İngilizce arayüz desteği İngilizce kelime paketini otomatik üretmez. Başlangıç
için anlam/yasaklı kelime/difficulty editör incelemesinden geçmiş gerçek TR/EN
paketleri ve minimum oynanabilir içerik hedefi gerekiyor.

## 5. Ekonomi ve Ürün Hazırlığı

Yerel DB'de economy override olmadığı için schema varsayılanları:

- Galibiyet 120; mağlubiyet ve beraberlik 40 coin.
- Tek rolling pencere varsayılan 24 saat; soft cap 3600, hard cap 5200.
- Gentle damping, minimum multiplier 0.35; hard cap'te kazanç 0.
- Repeated group 12 saat, threshold 8, minimum multiplier 0.55.

Üç bağımsız saatlik/günlük/haftalık hard cap uygulanmış gibi anlatılmamalı.
Mevcut guard ayarlanabilir tek rolling pencere kullanıyor.

Eksik: mağaza fiyatı ile gerçek maç süresi/galibiyet dağılımına dayalı satın
alma süresi hedefi. Örneğin eşit galibiyet/mağlubiyet varsayımı altında tam
ödül ortalaması 80 coin/maçtır; süre, boost ve guard etkisi eklenmeden bu
değer coin/saat değildir. İlk fiyatlar gerçek alpha maçlarından hesaplanmalı.

Önerilen ürün önceliği:

- Kullanılabilir ücretsiz başlangıç görünümü.
- Az sayıda güçlü ve gerçekten oyunda aynı görünen premium aile.
- Fiyat ve paket içeriğinin açık olması.
- İlk iyi kozmetiğe ulaşma hedefi ve guard'a giren meşru grupların ölçümü.
- Sonradan XP/görev/event; erken otomatik ceza ve zorunlu grind yok.

## 6. Ödeme Hazırlığı

| Provider | Kod durumu | Açık iş |
| --- | --- | --- |
| Shopier V2 registry kimliği | Custom-listing, webhook, reconciliation/refund temeli var | Gerçek düşük tutarlı payment/refund kabulü, credential ve evidence |
| PayTR | Sandbox checkout/webhook/refund orkestrasyonu | Merchant sandbox kabulü ve ayrıca live-mode işi |
| iyzico | Sandbox-only credential/transport ve orkestrasyon | Merchant sandbox kabulü ve ayrıca live-mode implementasyonu |
| Stripe | Sandbox adapter temeli; registry unavailable | Webhook/fulfillment bağlantısı ve ayrı kapsam kararı |
| Lemon Squeezy | Registry | Adapter ve uçtan uca orkestrasyon yok |

Bu turda test API key'leriyle provider'a gerçek istek veya gerçek ödeme/iade
yapılmadı. Mock/contract test başarıları merchant kabulü değildir. Hukuki belge
sürümleri, onay evidence'i, email verification, worker heartbeat, checkout
rollout ve acil durdurma production'da birlikte doğrulanmalı.

Tüm provider'ları birden açmak yerine ilk gerçek provider için dar kabul turu
yapılması daha düşük operasyon riski taşır.

## 7. Kozmetik, Profil ve Yayıncı Eksikleri

- Kart image modu bugünkü renderer'da tam yüz art değildir; full-art V2 gerekir.
- Ön/arka geometri ve preview/gameplay eşleşmesi tek ortak kontrata bağlanmalı.
- ShopItem parent + CosmeticVariant/Collection modeli yok.
- Satın alınan 2-3 rengin seçimi için entitlement, slot, refund ve migration işi var.
- UserProfile avatar/frame/front/back içeriyor; public profil vitrini ve earned
  badge sistemi ayrı kapsam. `badgeText` mağaza etiketi, oyuncu rozeti değildir.
- Web katalog pagination'ı ve thumb/full asset ayrımı mağaza büyümeden ele alınmalı.
- Yayıncı prototipi gerçek platform OAuth/chat veya ayrı OBS sürecine bağlı değil.
- Public/private projeksiyon, platform kimliği, idempotent tahmin ve message flood
  kuralları gerçek streamer backend'i için ayrıca uygulanmalı.
- Prototip internet-facing production deployment olarak kullanılmamalı.

Detaylı mevcut planlar:

- `docs/dashboard-ui/card-collections-and-profile-review.md`
- `docs/stream/multi-platform-streamer-plan.md`
- `scripts/design-prototypes/hushle-streamer-studio/README.md`

## 8. i18n ve Doküman Borcu

Dictionary leaf-key eşitliği ve TR/EN locale kontratı geçti. Bu her ekrandaki
her metnin çevrildiği anlamına gelmez. Örnek: shop discount detail'da hâlâ
`coin indirim`; socket/HTTP hata metinleri de birçok yerde server tarafından
Türkçe string üretiliyor.

Gerekli iş: server error code -> locale message ayrımı; checkout/legal,
bildirim, destek ve admin kapsamı için çeviri envanteri. Legal metin çevirisi
kod çevirisi gibi otomatik onaylanmamalı.

Eski rapor/backlog bölümlerinde tamamlanmış özellikler gelecekte yapılacak
gibi, eski branch'ler aktif gibi görünebiliyor. Örneğin production raporunun
yönetici özeti email verification/recovery'yi eksik listelerken aynı raporun
matrisi bunların uygulanmış olduğunu söylüyor. Tek güncel release durumu ve
kanıt matrisi tutulmalı; eski kararlar tarihli history olarak ayrılmalı.

`/test` card QA route'u production build'e dahil; gerçek gizli veri görülmedi,
fakat QA yüzeyinin dev-only veya admin-only olması daha temiz bir release sınırı.

## 9. Bu Turun Test Sonuçları

| Kontrol | Sonuç |
| --- | --- |
| Package/API/jobs TypeScript | PASS |
| Web TypeScript | PASS |
| Production Next.js build | PASS |
| Web launch core | 31 / 31 PASS |
| Ek contract/security suite | 12 / 14 PASS |
| Redis connection | PASS |
| `git diff --check` | PASS; mevcut CRLF uyarıları whitespace hatası değil |
| Lint | FAIL: prototip CJS import, 3 hata |
| Payment checkout contract | FAIL: i18n sonrası eski literal assertion |
| Cosmetic render-upgrade contract | FAIL: i18n sonrası eski literal assertion |
| Dependency vulnerability audit | BLOCKED: dış npm metadata aktarımı onayı gerekli |
| Playwright / DB mutation E2E / provider acceptance | Bu turda çalıştırılmadı |
| Fiziksel cihaz / production / yük | Bu turda çalıştırılmadı |

Çalışan development sunucusunda HTTP smoke: ana sayfa, admin login ve auth
session `200`; oturumsuz admin users, user me ve store catalog `401`.
Health `200` development davranışıdır; production token'sız `404` kabulü
bu local sonuçla kanıtlanmış değildir.

Build'in ilk denemesi Google Fonts indirme bağlantısında başarısız oldu.
Ağ erişimli tekrar başarılıdır. Fontu local/pinned asset yapmak build'in bu
harici erişim bağımlılığını kaldırabilir; bu runtime Turbopack bug'ı kanıtı değildir.

Ek suite: announcement-security, i18n-content-locales, auth-password-policy,
auth-login-rate-limit, oauth-account-foundation, production-preflight,
room-socket-security, socket-protocol-version, release-compatibility,
payment-checkout, payment-webhook, payment-orders, payment-fulfillment,
cosmetic-render-upgrade.

## 10. Önerilen Dar Çalışma Dilimleri

Branch isimleri öneridir; bu incelemede branch oluşturulmadı.

1. `codex/release-quality-and-proxy-trust`: IP zinciri, dar lint düzeltmesi,
   i18n-aware testler, QA route sınırı; mevcut reconnect değişikliklerini önce doğrulama.
2. `codex/persistent-asset-storage`: asset provider/persistence, thumb/decode
   sınırı, backup ve recreate acceptance.
3. `codex/ci-gated-deployment`: aynı SHA, immutable release/image, readiness,
   rollback ve match drain.
4. `codex/durable-match-finalization`: kalıcı result snapshot, idempotent reward
   ve ağ/reset/restart senaryoları.
5. `codex/web-beta-acceptance`: disposable DB/Redis E2E, 2v2/5v5 tam maç,
   gerçek cihaz, kontrollü yük; SMTP/Turnstile/backup/alarm staging kanıtı.
6. `codex/store-content-and-economy-calibration`: gerçek TR/EN içerik, başlangıç
   katalogu, maç süresine dayalı fiyat hedefleri ve paged web katalog.
7. İhtiyaç ve kapsam onayına göre cosmetic full-art/variants veya streamer beta;
   ikisini aynı büyük branch'e doldurmama.

Başarı ölçütü daha çok feature değil: güvenilir giriş/oda/maç, kaybolmayan ödül
ve asset, adil ekonomi, gözlenebilir arıza ve güvenle geri alınabilen release.
