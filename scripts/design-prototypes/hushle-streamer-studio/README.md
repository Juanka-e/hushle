# Hushle Streamer Studio / V3 Design Prototype

Hushle görsel diliyle özel yayıncı paneli, dört temalı yayın ekranı, OBS alt
şeridi ve kart/renk laboratuvarı. Yayın ekranı V3 taslağıdır; panel ve kart
laboratuvarı V2 görünümünde kaldı. **Çalışan yerel demo;
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
4. Panelde yayın temasını, yayın kartını ve kamera alanını seç; tam yayın ekranını,
   OBS alt şeridini veya tema galerisini paneldeki bağlantıdan aç.
5. Kart laboratuvarında seti açmayı simüle et, renk kuşan, ön/arka yüzü karşılaştır.

Public sayfa bağlantısı aktif paneldeki session parametresiyle kullanılmalı.
Panelin yeniden yüklenmesi yeni yerel oturum oluşturur; eski public bağlantı
yeni oturumu takip etmez. Skorlar sayfa belleğindedir, kalıcı değildir.

## V4 Yayın Ekranı Taslağı

Tema galerisi: http://127.0.0.1:4318/themes.html. Beş tema yan yana; oyun anı,
kamera alanı (yedi seçenek), kamera boyu, kart ve kaynak türü seçilebilir.

- Tek düzen tablosu, beş tema. Beşincisi "Sade": tek koyu yüzey, Inter, tek mavi vurgu,
  dekor yok; skor düz satırlar, son bilen ve kazanan düz paneller, damga mavi rozet.
  Kartı Hushle Klasik, zamanlayıcısı sayaç. Düzen (`public.css` başındaki tablo) her yuvanın
  (başlık, kart, zamanlayıcı, skor, son bilen, yönerge, kamera) yerini ve varyantını
  verir; temalar yalnız yuvanın içini boyar. Kamera yuvası `--cam-*` değişkenleriyle
  tanımlıdır; maske ve çerçeve aynı değişkenleri okur.
- Kamera alanı: yok, dört köşe (küçük 480×270 / orta 560×315 / büyük 640×360,
  kenardan 70 px) ve sol/sağ dikey yarı (960×1080). Köşe modlarında yuvalar deliğin
  etrafına yeniden dizilir; yarı modlarında oyun 960 px'lik sütuna sığar (kart
  400×600, kompakt kum saati, üç satırlık skor, iki satırlık son bilen).
  `?layout=half` aynı sütunu 960×1080'lik ayrı bir tarayıcı kaynağı olarak verir.
- Panel seçilen mod için OBS kamera kaynağının konum ve boyutunu (1080p ve 720p)
  gösterir ve panoya kopyalar; yayın bağlantıları tema, kamera ve boyu URL'de taşır,
  bağlantısı kopan kaynak yine seçilen görünümde açılır.
- Yayına kartın arka yüzü gider. Tur bitince kart döner; kelime ve yasaklı kelimeler
  ancak o an projeksiyona girer (`schemaVersion: 4`, `reveal`). Pas geçilen kart da
  masaya açılır (`passed`). Sıra: önce kum saatinin üstüne damga (Bildi! / Süre doldu /
  Pas, bilen ve süresi), 0,4 sn sonra kart, 1,2 sn sonra skor, not ve yönerge.
- Zamanlayıcı şablonları (`data-clock`): kum saati, mum, ışıklı pano, tütsü, halka,
  sayaç. Her tema biriyle gelir (Oyun Gecesi kum saati, Stüdyo pano, Gece Altını mum,
  Sakura tütsü, Sade sayaç); projeksiyondaki `clock` alanı boşsa temanın şablonu kullanılır. Panel henüz
  seçim sunmaz (önce hazır şablonlar; özelleştirme sonra), galeri hepsini her temada
  gösterir. Beşi de aynı yuvaya, aynı `--p` (kalan pay) değişkeniyle çizilir: kum
  akar, mum erir ve alev tepesinde kalır, ampuller tepeden saat yönünde söner, tütsü
  çubuğu kısalır ve kül birikir, halka boşalır, sayacın altındaki 20 parçalı çubuk
  sağdan söner. Dar sütun ve şeritte hepsi 164 px'lik
  kompakt boya iner.
- Son 10 saniye: rakam nabız atar ve uyarı rengine döner; kum/mum alevi/ampuller/
  kor/halka da. Yönerge "Son 10 saniye!" olur. Oyun sonu: kum saati yana yatar,
  mum söner ve tüter, pano kararır, tütsü küle döner, halka boşalır; kazanan (ya da
  beraberlik) kartın yerine temanın notuyla büyük yazılır, skor başlığı "Gecenin
  skoru" olur.
- "+1" yalnız bilinen tur ekrandayken görünür. Boş durumda "Son bilen" notu
  "Henüz kimse bilmedi" der; isim yuvasına cümle girmez.
- Uzun sohbet adları (25 karakterlik Twitch, 40 karakterlik YouTube) önce küçülür,
  sonra kısaltılır; kürsü ve levhalar `minmax(0, 1fr)` ile tuval dışına taşmaz.
- Yazı tabanları (1080p): yönerge 44 px (yarıda 40), saniye 128 px, tur 30, skor adı
  40–50, puan 44+, son bilen adı 48–52, kart ön yüzünde yasaklı kelimeler kart
  genişliğinin %9'u (400 px kartta 36 px). Kart ön yüzünde tek etiket kaldı
  ("Yasak kelimeler"); koleksiyon kartlarında sağ üstteki halka tur numarasını taşır.
- Başlıkta yayıncının kanalı ve platformu (`channel`); yönerge platforma göre
  "Twitch sohbetine yaz" der.
- OBS şeridi: `?overlay=bottom|top`, 1920×220. Çözülen kelime ve yasaklılar bir çipte,
  tur sürerken tek satır yönerge.
- Yazı tipleri Google Fonts'tan gelir (Bricolage Grotesque, Kalam, Big Shoulders
  Display, Cormorant Garamond, Shippori Mincho). Üretimde yalnız seçili temanın
  fontu, kendi sunucumuzdan yüklenmeli.

## Güvenlik Ve Kapsam

- Public sayfa gizli kelime scriptini import etmez, yalnız allowlist snapshot alır.
  Tur sürerken, duraklatılmışken ve oturum bitince snapshot kelime taşımaz.
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
