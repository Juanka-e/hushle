# Mobil API Yol Haritası

> Son güncelleme: 29 Temmuz 2026
> Durum: duraklatıldı, aktif ürün önceliği web açılışı

Bu dosya native mobil uygulama ve bağımsız public API için yapılanları ve
ertelenen işleri tek yerde tutar. Web uygulamasının mobil responsive davranışı
bu backlog'un parçası değildir; `apps/web` kapsamında test edilmeye devam eder.

## Neden Duraklatıldı?

İlk ürün web olarak açılacak. Bu nedenle yeni mobil endpoint eklemek yerine
geliştirme ve test kapasitesi aşağıdaki web hedeflerine ayrılır:

1. kayıt, giriş, oda oluşturma/katılma ve reconnect akışlarının doğrulanması
2. lobby, hazırlık, oyun, pause ve maç bitiş akışlarının uçtan uca testi
3. reward finalize, duplicate claim ve economy guard davranışlarının testi
4. mağaza, envanter, kuşanma ve bildirim yüzeylerinin responsive kontrolü
5. admin, health, backup, rollback ve launch-day operasyon kapılarının kontrolü

Mobil API runtime'ı public Nginx route'una bağlanmayacak ve production'da
explicit olarak açılmayacak.

## Tamamlanan Altyapı

- bağımsız `apps/api` Node HTTP runtime'ı
- sürümlü response/error kontratları ve request ID
- exact CORS allowlist ve native istemciler için originless transport desteği
- opaque access/refresh token, rotation ve session revoke
- Web parola kurtarma ve doğrulamalı e-posta değişimi hazırdır. Native mobile
  request/confirm endpoint'leri eklenene kadar `/v1/profile` e-posta değiştirmez.
- `/v1/me` ve profile read/write
- cursor tabanlı `/v1/inventory`
- server-side doğrulamalı equip/unequip
- cursor tabanlı `/v1/store/catalog`
- ortak katalog fiyatlandırması ve revision tabanlı Redis/memory cache
- kullanıcı coin/ownership overlay'inin paylaşılan cache dışında tutulması

Bu altyapı korunur. Web önceliği nedeniyle geri alınmaz veya web runtime'ına
yeniden kopyalanmaz.

## Ertelenen Mobil Dilimler

Önerilen yeniden başlama sırası:

1. notifications read ve unread count
2. notification read/archive mutasyonları
3. support ticket read/write
4. server-side fiyatlama, wallet ledger ve idempotency ile store purchase
5. shared presence hazır olduğunda active-room read
6. bağımsız, owner-aware realtime mimari hazır olduğunda oyun bağlantısı

### Ertelenen Payment Checkout Parity

Web tarafında server-priced `PaymentOffer`, owner-only order status ve sürümlü
legal acceptance sözleşmesi hazırdır. Native mobile ödeme eklenirken bunlar yeniden
tasarlanmayacak; `packages/platform-payments` çekirdeği kullanılacaktır.

- native istemci tutar, currency veya grant snapshot gönderemez,
- checkout create mobile user + trusted remote IP için ayrı distributed limit kullanır,
- idempotency key kullanıcıya bağlanır,
- provider SDK/hosted checkout dönüşü ödeme kanıtı değildir,
- legal belge sürümleri API cevabından alınır ve stale acceptance reddedilir,
- App Store / Google Play dijital ürün ödeme kuralları ayrıca doğrulanmadan web
  provider'ı native uygulamaya taşınmaz.

XP, level, görev, event claim ve night market mobil API'ye web ürününde
kanıtlanmadan eklenmez.

## Değişmez Güvenlik Sınırları

- İstemciden fiyat, bakiye, sahiplik, ödül veya maç sonucu kabul edilmez.
- Purchase işlemleri idempotency key ve wallet ledger olmadan açılmaz.
- Admin route'ları web BFF'de kalır.
- `apps/api`, `apps/web` veya Next.js modüllerini import etmez.
- MySQL kalıcı source of truth, Redis cache/counter/coordination katmanıdır.
- Room state process-local kaldığı sürece realtime writer ayrıştırılmaz.
- Mobil response yalnız ekran için gerekli alanları taşır.

## Yeniden Başlatma Kapısı

Mobil geliştirme ancak aşağıdaki koşullardan biri oluştuğunda tekrar aktif
önceliğe alınır:

- native mobil istemci için onaylı ürün takvimi oluşması
- bağımsız API tüketicisi veya ikinci web yüzeyi ihtiyacının kesinleşmesi
- web launch blocker'larının kapanması ve stabil saha verisinin oluşması

Yeniden başlarken önce bu dosya, `apps/api/README.md` ve
`docs/implement docs/remaining.md` birlikte güncellenmelidir.

## İlgili Belgeler

- `apps/api/README.md`
- `docs/guides/mobile-api-foundation-guide.md`
- `docs/guides/mobile-auth-foundation-guide.md`
- `docs/guides/mobile-player-core-guide.md`
- `docs/guides/mobile-inventory-and-equip-guide.md`
- `docs/guides/mobile-store-catalog-guide.md`
- `docs/architecture/apps-migration-plan.md`
# Locale compatibility note

Web'deki UI locale ile oda `wordLocale` alanı ayrıdır. Mobile player/game
contract genişletildiğinde `tr|en` UI tercihi istemciye ait kalmalı;
`wordLocale` ise room snapshot/event içinden okunmalı ve yalnız host komutuyla
değişmelidir. Duyuru endpoint'i locale isteğini ve Türkçe fallback bilgisini
versioned response içinde taşımalıdır. Ayrıntı:
`docs/guides/i18n-announcements-and-word-packs.md`.
