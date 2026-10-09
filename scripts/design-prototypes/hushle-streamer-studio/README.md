# Hushle Streamer Studio / V2 Design Prototype

Hushle görsel diliyle özel yayıncı paneli, güvenli veri projeksiyonlu izleyici
ekranı, kompakt OBS tarzı katman ve kart/renk laboratuvarı. **Çalışan yerel demo;
production özelliği değil.** Next.js uygulamasına, API'ye veya veritabanına bağlı
değildir. Bu klasör workspace paketi değildir ve uygulama build'ine girmez.

## Çalıştırma

Repo kökünden, Node.js 22 ile:

```powershell
node scripts/design-prototypes/hushle-streamer-studio/server.cjs
```

Tarayıcıda http://127.0.0.1:4318/#studio açılır. Sunucu yalnız loopback dinler.
Port doluysa son argümanla değiştirilebilir:

```powershell
node scripts/design-prototypes/hushle-streamer-studio/server.cjs 4320
node scripts/design-prototypes/hushle-streamer-studio/test-session.mjs
node scripts/design-prototypes/hushle-streamer-studio/test-server.mjs
```

Paket kurulumu gerektirmez. Font için Google Fonts isteği vardır; ağ kapalıysa
sans-serif fallback kullanılır. Referans kart görseli yereldir.

## Deneme Akışı

1. Twitch/Kick/YouTube kartına basıp demo kanalı bağla; gerçek giriş yapılmaz.
2. Örnek yarış veya eşitlik senaryosunu yükle. Oyuncu seç, başlat, tahmin dene.
3. Aynı mesajı tekrar gönder, sonraki tura geç, bağlantıyı kes/yeniden bağla.
4. Tam yayın ekranını veya kompakt katmanı paneldeki bağlantıdan aç.
5. Kart laboratuvarında seti açmayı simüle et, renk kuşan, ön/arka yüzü karşılaştır.

Public sayfa bağlantısı aktif paneldeki session parametresiyle kullanılmalı.
Panelin yeniden yüklenmesi yeni yerel oturum oluşturur; eski public bağlantı
yeni oturumu takip etmez. Skorlar sayfa belleğindedir, kalıcı değildir.

## Güvenlik Ve Kapsam

- Public sayfa gizli kelime scriptini import etmez, yalnız allowlist snapshot alır.
- **Bu demo bir auth sınırı değildir.** Statik app.js örnek kelimeleri içerir ve
  sunucudan okunabilir. İnternete deploy etmeyin; gerçek host/public ayrımı
  sunucu yetkilendirmesiyle kurulmalıdır.
- BroadcastChannel aynı browser storage context'iyle sınırlıdır. Ayrı OBS
  process'iyle gerçek ağ bağlantısı, platform sohbeti veya OAuth kurulmadı.
- Satın alma/sahiplik/puan işlemleri simülasyon. Gerçek ödeme, coin ve envanter yok.
- TikTok resmî erişim doğrulaması gerektiren plan olarak gösterilir.
- Renkler CSS filtreli deneme; üretim paletleri ayrı, kontrollü export olmalı.
- reference-cards.png kullanıcının sağladığı tasarım referansıdır; üretim ürünü
  veya ticari kullanım lisansı onayı sayılmaz. Lisans/menşe kontrolü yapılmadı.
- v2-*.jpg önce repo dışındaki V2 testlerinden arşivlenen kanıttır; gerçek OBS veya
  Hushle production testi değildir. HUSHLE yazısı marka logo fallback'idir.

## Belgeler

- [Akış ve platform analizleri](./analysis.md)
- [Test sonuçları ve sınırlar](./test-notes.md)
- [Mevcut kozmetik sistemi değerlendirmesi](../../../docs/dashboard-ui/card-collections-and-profile-review.md)

UI onayı sonrasında gerçek implementasyon ayrı branch'lerde ele alınacak;
arşivleme sırasında oyun renderer'ı, Prisma şeması veya mağaza değişmedi.
