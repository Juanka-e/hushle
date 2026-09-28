# Kalan Isler

> Son guncelleme: 14 August 2026
> Durum: aktif uygulanabilir backlog

## Su Anki Oncelik Sirasi

2026-09-07 planlama notu: dahili sesli sohbet ertelendi. IP gizliligi,
P2P/TURN/SFU maliyetleri ve yeniden degerlendirme kosullari; ilk takim flip'i,
anlatici sirasi ve sade lobi icin henuz onaylanmamis branch onerileri:
[`voice-and-lobby-experience-roadmap.md`](../architecture/voice-and-lobby-experience-roadmap.md).
Bu not implementasyon veya mevcut kapasite ayari degisikligi degildir.

2026-09-08: ses disi lobi kapsami onaylandi. Ilk takim secimi/flip, yonetici
anlatici siralama, kompakt kelime dili ve kapali oyun ayarlari uygulandi.
Yeni kapasite varsayilani 10/5; kayitli admin degerleri degistirilmedi.
Yerel test kanitlari ve kalan cok istemcili mac/gercek cihaz kabul adimlari
yukaridaki yol haritasinin Implementation status bolumunde tutulur.

1. `manual/web-real-device-smoke`
2. `feature/web-launch-blocker-fixes` - yalniz dogrulamada bulunan gercek hatalar
3. `feature/post-launch-economy-observability-review`
4. `feature/post-launch-xp-level-foundation`
5. `feature/post-launch-missions-foundation`
6. `feature/post-launch-new-player-and-comeback-campaigns`
7. `feature/post-launch-events-foundation`
8. `feature/post-launch-night-market-foundation`
9. `feature/post-launch-collections-and-sets`
10. `feature/post-launch-free-cosmetic-containers`

`post-launch` branch'leri oyun acilip gercek saha verisi olusmadan
implementasyona alinmaz.

Native mobil API genisletmesi web acilisi stabil hale gelene kadar
duraklatildi. Tamamlananlar ve yeniden baslama sirasi
`apps/api/MOBILE_ROADMAP.md` icinde tutulur. Web'in mobil responsive testleri
bu ertelemenin disindadir.

E-posta doğrulama, hesap kurtarma ve teslimat operasyon temeli tamamlandı.
Provider'a özel doğrulanmış SES webhook adaptörü tamamlandı. Gerçek AWS SNS kabulü
ile consent tabanlı marketing gönderimi ayrı dar branch'lerde ele alınacaktır. Referans:
`docs/guides/email-delivery-operations-guide.md`.

OAuth karari: Google login launch blocker degildir fakat gercek kullanici verisi
olusmadan ayri migration ve explicit account-linking branch'inde eklenebilir.
Sessiz email-linking kullanilmayacak; Apple login native iOS plani aktif olana
kadar ertelendi. Referans: `docs/guides/oauth-provider-strategy.md`.

Merkezi observability kodu HTTP exporter'a kadar hazirdir. Production'da gercek
collector endpoint/token, external uptime monitor ve on-call kanali operator
tarafinda baglanip test alarmiyla kanitlanmalidir. Referans:
`docs/deploy/observability-exporter-operations.md`.

## Aktif Release Kapisi

### `manual/web-real-device-smoke`

Hedef:
- hazir LAN production harness'i ile fiziksel iOS Safari, Android Chrome ve
  laptop smoke kanitlarini kaydetmek
- safe-area, touch, sanal klavye, yon degisimi ve gercek WebSocket davranisini
  cihaz uzerinde kontrol etmek
- yalniz gercek bir blocker bulunursa `feature/web-launch-blocker-fixes`
  branch'ini acmak

Referans:
- `docs/guides/web-real-device-smoke.md`

Fiziksel iOS/Android/laptop smoke harness'i tamamlandi. Gercek cihaz sonucu
otomasyonla uretilemeyecegi icin release kaniti olarak manuel acik kalir:
- `docs/guides/web-real-device-smoke.md`

## Onceki Branch Kaydi
### `test/web-reconnect-readiness`
Tamamlananlar:
- iki guest UI akisinda host ve guest reload reconnect'i
- reconnect sonrasinda korunan playerId ve duplicate olmayan lobby kaydi
- host yetkisinin geri gelmesi ve pending otomatik devrin temizlenmesi
- reconnect sonrasinda oyun baslatma ve pause senkronunun korunmasi
- aktif oyun reconnect'inde rol, kart gorunurlugu ve oyun ekraninin sunucudan yeniden kurulmasi
- mobil host -> desktop guest oda koduyla katilim ve mobil takim panel kontrolleri
- Chromium ve WebKit disposable DB dogrulamasi

### `test/web-multiplayer-launch-readiness`
Tamamlananlar:
- iki izole guest browser context ile oda olusturma ve katilma
- lobby oyuncu senkronu, iki takim readiness ve oyun baslatma
- ilk hazirlik ekraninda pause durumunun iki oyuncuya yayilmasi
- Chromium ve WebKit projelerinde mobil guest overflow kontrolu
- disposable kategori/kelime fixture'i ve garantili cleanup

### `test/web-webkit-readiness`
Tamamlananlar:
- iPhone ve desktop Safari profillerinde WebKit public responsive kapisi
- disposable DB uzerinde tek mobil WebKit registered kullanici akisi
- HTTP LAN smoke ortaminda assetleri HTTPS'e zorlayan CSP uyumsuzlugunun duzeltilmesi
- HTTPS production ve eksik/gecersiz config icin guvenli CSP varsayiminin korunmasi

### `feature/web-real-device-responsive-smoke`
Tamamlananlar:
- yalniz RFC1918 origin kabul eden production LAN smoke sunucusu
- LAN bind, HTTP 200 ve process cleanup integration testi
- fiziksel cihaz GO/HOLD kanit sablonu ve uygulama rehberi
- harness kontratinin web launch-readiness CI kapisina eklenmesi

### `feature/web-responsive-device-matrix`
Tamamlananlar:
- kucuk telefon, modern Android, yatay telefon, tablet ve laptop Chromium matrisi
- public auth/room yuzeylerinde overflow ve aksiyon erisimi kontrolleri
- disposable DB dashboard/lobby akisinda 390px viewport dogrulamasi
- fiziksel cihaz sonucunu emulasyondan ayiran kabul standardi

### `feature/release-ops-docs`
Tamamlananlar:
- gercek deploy davranisini anlatan release gate ve kanit runbook'u
- manuel rollback/incident sinirlari ve destructive komut yasaklari
- ilk public acilis icin launch-day checklist
- production deploy concurrency, release SHA ve archive checksum dogrulamasi
- product/word analytics env'lerinin Compose app container parity duzeltmesi
- workflow, compose, health ve docs kontratini dogrulayan statik test

### `feature/word-analytics-liveops`
Tamamlananlar:
- kelime ve kategori performansi icin PII'siz gunluk Redis aggregate
- dogru, tabu, pas ve timeout sonucunu server-owned aktif karttan uretme
- pause suresini dislayan server timer tabanli exposure olcumu
- admin kelime listesinde 7/30 gunluk bounded `HMGET` reader
- dusuk ornek uyarisi ve otomatik karar vermeyen liveops gorunumu
- Redis/config arizasinda oyunu etkilemeyen best-effort kayit
- health telemetry ve retention ayarlari

### `feature/analytics-event-foundation`
Tamamlananlar:
- versiyonlu `server_verified` ve `client_observed` event kontrati
- item ve bundle satin alimlari icin PII'siz gunluk Redis aggregate
- strict enum ve rate limit kullanan navigation collector
- ham event, user id, IP, oda kodu ve serbest metadata tutmama
- Redis/config arizasinda business request'i bozmayan dropped telemetry
- health endpoint ve retention operasyon dokumani

### `feature/admin-cosmetic-authoring`
Tamamlananlar:
- frame, kart onu ve kart arkasi icin tur bazli guvenli preset katalogu
- preset aciklamasi, template key ve JSON'i birlikte uygulayan admin akisi
- isim, fiyat, yayin ve aktiflik alanlarini koruyan dar preset islemi
- mevcut gercek renderer ile anlik canli onizleme
- tum preset'leri write schema uzerinden dogrulayan regresyon testi

### `feature/cosmetic-render-upgrade`
Tamamlananlar:
- nullable `thumbnailUrl` katalog alani ve admin upload/editor yuzeyi
- magaza, envanter ve dashboard discovery alaninda ortak statik thumbnail
- grid'de animasyon/motion calistirmayan hafif fallback renderer
- magaza ve envanterde ilk 24 urun + kontrollu "Daha fazla goster" akisi
- buyuk renderer'i yalniz detay modalinda mount eden ayrim

### `feature/offsite-backup-object-storage`
Tamamlananlar:
- local dump yaninda SHA-256 checksum uretimi
- R2, Amazon S3 ve B2 icin ortak S3-compatible ops kontrati
- dump ve checksum upload'i ile remote object size dogrulamasi
- checksum zorunlu local/remote restore
- production veritabanina dokunmayan gecici restore smoke testi
- backup secret'larini app/jobs container'larindan ayiran ops compose

### `feature/admin-promotions-ux`
Tamamlananlar:
- yeni/duzenle formlarini responsive operasyon sheet'ine tasima
- silme ve pasife alma icin sonucu aciklayan onay dialogu
- mobil kart/header aksiyonlarini ve erisilebilir secimleri iyilestirme
- coklu PUT firtinasi yerine rate-limitli, audit'li tek bulk status endpoint
- statik regresyon ve gercek admin oturumlu Playwright testi

### `feature/admin-match-history-review`
Tamamlananlar:
- kullanici listesinden lazy acilan, sayfalanmis mac gecmisi
- skor, takim, sonuc, coin, kadro dagilimi ve oyun modu gorunumu
- yeni maclar icin server-owned bitis, sure, format ve hedef snapshot'i
- hot/archive finalize audit metadata ile guard ve lineup zenginlestirmesi
- audit snapshot yoksa bilinmeyen veriyi uydurmayan fallback
- gercek MySQL hot -> archive entegrasyon testi

Acik kalanlar:
- anlatici rotasyon gecmisi bugun room state'te kalici tutulmuyor
- rotasyon ihtiyaci ayri game telemetry/snapshot tasariminda ele alinacak

### `feature/packages-extraction-foundation`
Tamamlananlar:
- `@hushle/platform-db` ve `@hushle/platform-cache`
- compatibility re-export'lari
- Next.js, Docker ve boundary test entegrasyonu
- platform package ADR ve migration dokumantasyonu

### `feature/gameplay-ui-polish`
Tamamlananlar:
- kayitli kullanici icin `displayName -> username` fallback akisi
- settings ve lobby quick edit arasinda canli isim senkronu
- bos `displayName` temizlendiginde kayitli kullanicida hesap adina donus
- guest isim akisinin lobby bazli kalmasi
- oyun basladiktan sonra isim duzenlemeyi kilitleme
- audit lineup identity snapshot yapisi
- audit tarafinda guest / kayitli kimlik ayrimi
- room ust bari ve mobil yardimci menu sadelestirmesi
- pause sirasinda sag ust modallari erisilebilir kilma
- lobby branding logosunu system settings ile dinamik kullanma
- hazirlik ekraninin sadelestirilmesi ve ilk gecis mesajlarinin duzeltilmesi
- dashboard profil alaninda avatar + frame gorunumunun toparlanmasi
- stale `tabu_activeRoomCode` yuzunden olusan yanlis `lobidesin` blokajinin kaldirilmasi
- bildirim sheet basliginin ve close aksiyonunun yeniden duzenlenmesi
- hizli kusan alaninin tekrar tek satira cekilmesi
- kayitli kullanici icin server-side aktif oda kontrolu
- process-local `userId -> roomCode` room index optimizasyonu
- envanterde kusanilan kozmetigi dogrudan cikarabilme
- room / lobby logosunun ust merkezde daha dengeli konumlanmasi
- `apps/` yonelimi, Docker veri kaliciligi ve modularizasyon plani dokumantasyonu
- npm workspace sinirlarinin `apps/*` ve `packages/*` icin acilmasi
- Redis retry, health, graceful shutdown ve ortam bazli key prefix altyapisi
- Redis destekli rate limit, room membership, action lock ve admin handoff koordinasyonu
- MySQL 8.4 ve izole local Redis portlariyla kalici Docker gelistirme altyapisi

Acik kalanlar:
- bildirim sheet, toast, header ve hizli kusan iyilestirmelerini gercek cihazlarda son bir tur kontrol etmek
- aktif oda korumasini coklu sekme / reconnect senaryolarinda son bir tur dogrulamak
- `docs/guides/gameplay-ui-polish-smoke-checklist.md` uzerinden gercek cihaz smoke turu yapmak
- Socket.IO event fan-out icin Redis adapter ihtiyacini multi-instance asamasinda ele almak
- kart kozmetik art direction konusu arastirma bekliyor; premium tasarim yonu netlesene kadar sistem tarafi not seviyesinde tutulacak

Bilincli olarak bu branch'te yapmiyoruz:
- admin detayli mac gecmisi yuzeyi
- room sifre sistemi
- oda kapasitesi ve oyuncu sirasi kural paneli
- XP / gorev / event runtime
- yeni bir `apps/api` runtime'i; mobil veya bagimsiz API ihtiyaci dogana kadar acilmayacak

## Yakin Sonraki Branch'ler

### `manual/shopier-live-acceptance`
- acceptance CLI tamamlandı; gerçek credential ve operatör ödemesi otomasyonla üretilemez
- Shopier panelinde webhook subscription ve worker/scheduler heartbeat doğrulanacak
- düşük tutarlı initialize -> payment checkpoint -> iki adminli refund -> verify akışı çalıştırılacak
- final manifest off-image evidence dizinine alınıp production preflight ile doğrulanacak
- hukuki/operasyon onayı olmadan `SHOPIER_LIVE_ACCEPTANCE_RECORDED=true` yapılmayacak

### Gelecek ekonomi genişlemeleri - ihtiyaç oluşunca
- ikinci asset onaylandığında asset definition + asset-code ledger migration/dual-write
- mixed bundle gerektiğinde yeni product kind ve effect-bazlı fulfillment/reversal result v2
- loot/container için immutable table version, CSPRNG open receipt, pity ve provenance
- oran/hukuk/refund politikası onaylanmadan loot runtime veya admin aktivasyon yüzeyi açılmayacak
- campaign -> eligibility -> progress -> claim -> versioned grant ortak akışı ilk gerçek
  liveops ihtiyacında minimum kapsamla kurulacak; kullanılmayan generic tablolar önceden açılmayacak
- yeni oyuncu serisi, comeback serisi, görev, etkinlik ve sezon kaynakları ayrı provenance,
  eligibility, cooldown ve cap politikaları taşıyacak
- seriler tek gün kaçırınca varsayılan olarak sıfırlanmayacak; salt login yerine
  server-verified anlamlı aktivite tercih edilecek
- night market immutable kullanıcı teklif snapshot'ı, sahip olunmayan ürün filtresi,
  süre/fiyat doğrulaması ve rotasyon sınırlarıyla ele alınacak
- katalog büyüdüğünde season/set, koleksiyon albümü, profil vitrini ve gerekirse
  sürümlü shard/crafting dönüşümü değerlendirilecek
- ilk kutu adayı ücretli rastgele ürün değil, oyun veya etkinlikle kazanılan ücretsiz
  kozmetik container olacak
- tüm kartlar tek loot havuzuna konmayacak; set/season havuzu, açık oran, pity,
  duplicate compensation ve immutable open receipt birlikte tasarlanacak
- ücretli rastgele içerik yaş/bölge, tüketici hukuku, oran gösterimi ve refund politikası
  ayrıca onaylanmadan backlog'dan implementasyona alınmayacak
- aday ek özellikler: ücretsiz sezon yolu, topluluk hedefi, alternatif görev/yenileme,
  etkinlik mağazası/token, kozmetik deneme bileti, profil unvanı ve takım başarı kartı
- her branch öncesi çözülen problem, başarı metriği, admin yayın/geri alma UX'i,
  kapatma davranışı ve abuse/refund sınırı yazılı olarak onaylanacak

### Ilk payment provider adapter'i
- PayTR iFrame kriptografik ve transport adapter temeli tamamlandi
- provider-neutral atomik coin/kozmetik fulfillment temeli tamamlandi
- checkout gecici iletisim alanlari, verified account email ve sandbox session create tamamlandi
- webhook verifier registry baglantisi ve idempotent order processor tamamlandi
- fulfillment sonrasi idempotent notification/cache invalidation tamamlandi
- sandbox refund/chargeback yerel reversal, ikinci admin onayı, notlu vaka çözümleme,
  coin-lot reversal ve PayTR refund transport adapter foundation tamamlandı
- provider refund durable attempt, belirsiz timeout recovery ve sandbox admin
  orkestrasyonu tamamlandı; gerçek merchant sandbox kabulü kaydedilmeden ve ayrıca
  onaylanmadan production/live `PAYTR_REFUND_MODE` açılmayacak
- harcanmış ücretli coin `manual_review` kayıtları için otomatik ceza vermeyen,
  notlu operatör çözüm/uyarı akışı tamamlandı
- provider redirect basari kaniti sayilmayacak; webhook/reconciliation dogrulamasi korunacak
- fulfillment ve refund/chargeback davranışı gerçek merchant sandbox kabulü olmadan
  production'a açılmayacak
- iyzico Checkout Form HMAC, bounded sandbox transport ve `buyer-data-v1` request-only
  veri sözleşmesi tamamlandı; kimlik, telefon ve adres değerleri profile/order/audit'e
  veya hash biçiminde yazılmıyor
- iyzico durable initialize/retrieve orchestration, Signature V3 webhook processor ve
  provider-specific reconciliation tamamlandı; owner-only session/callback foundation da
  tamamlandi. Request-only just-in-time buyer-data UI, sandbox kabul araci, scheduler
  heartbeat/alarmlari, systemd deployment sablonlari ve kanita bagli aktivasyon
  manifestleri ile kademeli rollout/acil durdurma kontrolu de baglandi. Siradaki
  dilimler manifestleri uretecek gercek
  merchant/aktarim hukuki onayi, gercek merchant sandbox kabulu ve ayri incelenecek
  live-mode implementasyonu
- Shopier güncel v1 API için siparişe özel, stok 1 `customListing` dijital ürün
  checkout foundation'ı tamamlandı. Exact server price, hosted URL allowlist,
  concurrent create lease ve belirsiz sonuçta kör retry yapmayan mutabakat kapısı var.
  HS256 webhook, replay/account/dedupe, exact ödeme kanıtı, e-posta uyuşmazlığı
  incelemesi, idempotent fulfillment, Order API reconciliation ve refund orkestrasyonu
  tamamlandı. Operasyon alarmları ve gerçek düşük tutarlı ödeme+iade kabul kanıtı
  tamamlanmadan registry fail-closed kalacak
- Stripe Checkout Session bounded sandbox transport temeli tamamlandı; provider
  idempotency ve API version pin mevcut, ancak webhook/fulfillment bağlı değil
- Stripe resmi merchant ülke listesinde Türkiye olmadığı için production aktivasyonu
  planlanmıyor; yalnız uygun gerçek tüzel kişilik ve ayrı sandbox kabulüyle yeniden değerlendirilir
- referans: `docs/guides/payment-checkout-and-legal-readiness.md`,
  `docs/guides/paytr-iframe-adapter.md`, `docs/guides/iyzico-checkout-adapter-foundation.md`,
  `docs/guides/stripe-checkout-adapter-foundation.md`,
  `docs/guides/shopier-custom-listing-checkout-foundation.md`

### `feature/google-oauth-account-linking-foundation` - tamamlandi
- Google ile giris ve Settings icinden explicit hesap baglama
- mevcut ayni e-postayi otomatik birlestirmeyen provider-neutral adapter
- token saklamayan `OAuthAccount` modeli ve son giris yontemi korumasi
- Apple ve diger provider'lar icin registry/preflight genisleme noktasi
- referans: `docs/auth/oauth-account-linking.md`

### `feature/admin-match-history-review` - tamamlandi
- admin kullanici inceleme akisina mac gecmisi yuzeyi
- mac suresi, skor tipi, takim dagilimi, anlatici rotasyonu ve ekonomi etkisi gorunurlugu
- audit ile mac detayi arasinda daha adil moderasyon gecisi
- anlatici rotasyonu icin veri uydurulmadi; kalici event/snapshot modeli sonraya
  birakildi

### `feature/admin-categories-dnd-polish` - tamamlandi
- gercek mouse drag ve mobil ok kontrolu Playwright ile dogrulandi
- hata rollback'i, server canonical order dogrulamasi, cache invalidation ve audit eklendi
- kategoriler sayfasi UTF-8, responsive ve erisilebilirlik bakimindan temizlendi

### `feature/room-rules-and-capacity-controls`
- aktif branch; yukaridaki kapsam uygulanmis durumda
- oda sifresi bu branch'e alinmadi; gerekirse ayri ve sade bir akis olacak
- manuel izleyici modu launch kapsaminda degil; altyapi rolu ve reward dislama hazir
- minimum katilim yuzdesi launch kapsaminda degil; saha verisi olmadan eklenmeyecek

### `feature/cache-and-rate-limit-foundation`
- mevcut Redis abstraction'i uzerinde atomik counter/lock sertlestirmesi
- development memory fallback davranisini fault testlerle genisletme
- production shared cache ve rate limit store gozlemlenebilirligi
- dashboard summary short TTL cache
- store catalog cache
- notification unread counter
- economy guard rolling counters
- repeated-group keyed counters
- Socket.IO Redis adapter ile multi-instance event fan-out
- Redis destekli registered `userId -> roomCode` shared presence index'i load test etme
- referans: `docs/cache-and-storage-strategy.md`

### `feature/audit-retention-and-telemetry-foundation`
- hot audit ve archive audit ayrimi
- scheduled retention / archive job
- signal-first audit siniflandirmasi
- non-triggered high-volume event'leri telemetry hattina tasima
- economy finalize audit hacmini kontrollu hale getirme
- admin review icin archive read path - tamamlandi
- non-triggered finalize Redis gunluk rollup - tamamlandi
- guard/review sinyalli finalize detayli audit korumasi - tamamlandi
- Redis arizasinda detayli audit fallback - tamamlandi

### `feature/jobs-runtime-foundation` - tamamlandi
- `apps/jobs` one-shot runtime ve audit archive job'u eklendi
- mutating calisma explicit gate ve Redis lease gerektiriyor
- archive purge, telemetry rollup ve admin archive read path ayri tutuldu
- admin archive read path sonraki dar branch'te tamamlandi
- production retention schedule yine explicit operasyon karariyla acilacak

### `feature/mobile-api-foundation`
- runtime ve ilk transport kontratlari tamamlandi
- mobile auth, player core, inventory/equip ve store catalog read tamamlandi
- yeni endpoint gelistirmesi web acilisi stabil hale gelene kadar duraklatildi
- ertelenen notifications, support ve purchase sirasi
  `apps/api/MOBILE_ROADMAP.md` icinde korunuyor

### `feature/post-launch-economy-observability-review`
- canlidan sonra gercek coin kazanimi gozlemi
- magaza satin alma hizi
- retention ve pacing ayarlari
- economy guard tetiklerinin saha verisiyle yeniden tuning edilmesi

## Uzun Vadeli Notlar
- Web i18n temeli ile ana oyun/auth/lobi, dashboard, mağaza, envanter, hesap
  ayarları, bildirim/destek, hesap kurtarma ve checkout/legal yüzeyleri `tr|en`
  çalışır. Kalan borç, eski socket/API serbest hata metinlerini endpoint bazında
  kararlı hata kodlarına dönüştürmektir. Bu tamamlanmadan üçüncü dil açılmamalıdır.
- mevcut modularizasyon fazi tamamlandi: web runtime `apps/web`, paylasilan DB/cache
  katmani `packages/platform-*`, one-shot isler `apps/jobs` altinda calisiyor.
- `apps/api` runtime ve mobile auth temeli tamamlandi; production deploy explicit
  flag ile kapali. `/v1/me`, profile read/write, bounded inventory read ve
  equip/unequip ve store catalog read tamamlandi. Mobil genisleme web acilisi
  stabil hale gelene kadar duraklatildi.
- modularizasyon plani icin referans: `docs/architecture/adr-001-apps-workspace-and-runtime-split.md`
- detayli migration fazlari: `docs/architecture/apps-migration-plan.md`
- Redis geldiginde source of truth yine MySQL olacak; Redis yalniz cache / counter / coordination katmani olacak.
- bugunku registered room index tek-instance icin process-local yeterlidir; multi-instance asamasinda shared presence katmanina tasinmalidir.
- non-triggered finalize kayitlari PII'siz Redis gunluk telemetry rollup'ina
  tasindi; match result kalici truth olarak MySQL'de kalir.
- siradan `game.match.finalize` kayitlarini signal-first telemetry hattina ayirma
  isi retention'dan ayri ele alinmali.
- admin kullanici mesajlasma sistemi ayri bir operasyon branch'i olarak dusunulmeli.
- kart kozmetikleri icin profesyonel yon `image/hybrid first`, `template second` olarak korunmali; gorsel research tamamlanmadan render sistemi acele buyutulmemeli.

## Referans Rehberler
- `docs/guides/economy-abuse-hardening-guide.md`
- `docs/guides/economy-progression-and-pricing-guide.md`
- `docs/guides/player-display-name-and-audit-strategy-guide.md`
- `docs/cache-and-storage-strategy.md`
- `docs/architecture/apps-migration-plan.md`
