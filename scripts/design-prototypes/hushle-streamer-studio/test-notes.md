# V4.1 zamanlayıcı şablonları doğrulaması

5 Kasım 2026. Aynı yerel sunucu ve Chromium/Playwright.

- Beş şablon (kum saati, mum, ışıklı pano, tütsü, halka) dört temada; hazır / tur /
  son 10 sn / ara / bildi / pas / süre doldu / oyun sonu anları yuva kırpımlarıyla
  (430×620) tek tek kontrol edildi. İlk turda iki sınıf adı çakışması çıktı: Stüdyo'nun
  kenar ampulleri `.bulbs` ve Gece Altını'nın dekoratif mumu `.candle` zamanlayıcı
  SVG'leriyle aynı adı taşıyordu (pano kare çıktı, mum hiç görünmedi); zamanlayıcılar
  `.board` / `.taper` oldu. Ampul "yanık" kuralı özgüllük yüzünden eziliyordu; ampuller
  `.bulb` sınıfı aldı.
- Sakura'nın yuvarlak damgasında "Deniz · 8,4 sn" kesiliyordu; damga 224 px, ayrıntı
  iki satıra sarılıyor.
- Sol yarı (kompakt) ve üst şerit düzenlerinde beş şablon da yuvaya sığıyor; skor
  başlığına değmiyor.
- Beşinci tema "Sade" ve altıncı şablon "sayaç" eklendi (5 Kasım, ikinci tur): Sade'nin
  on anı tam ekranda, sayaç dört diğer temada, diğer beş şablon Sade'de, sol yarı ve
  üst şerit kırpımlarıyla kontrol edildi. Şeritte başlık yuvası 64 px olduğu için kanal
  satırı her temada kırpılıyordu; yuva şeritte 84 px oldu.
- `node test-session.mjs`: 16/16 (`clock` alanı: boş = temanın şablonu, bilinmeyen
  değer boşa düşer). `node test-server.mjs`, panel smoke, uzun kelime ve canlı akış
  kontrolleri geçti; konsol hatası yok.

Yapılmadı: şablonlar panelden seçilemiyor (bilinçli: önce hazır şablon), düşük güçlü
cihazda beş animasyonun maliyeti ölçülmedi, azaltılmış hareket tercihinde yalnız
geçişler kapatıldı (görsel olarak doğrulanmadı).

# V4 yayın ekranı taslağı doğrulaması

4 Kasım 2026. Yerel sunucu (4318) ve Chromium/Playwright. Gerçek OBS, fiziksel
cihaz veya production backend testi değildir.

- Üç bağımsız eleştiri (düzen/kamera, yayıncı ihtiyaçları, oyun atmosferi/metin,
  toplam 58 bulgu) V3'e uygulandı; görsel tasarım, yayın grafiği, erişilebilirlik ve
  mühendislik bakışları kota nedeniyle tamamlanamadı, bu yüzden V4'te o alanlar
  yalnız kendi gözle incelendi.
- `node test-session.mjs`: 15/15. Kamera yuvaları ve boyları, kanal adı (25
  karakter, kontrol karakterleri temizlenir), pas geçilen kartın açılması ve yeni
  turun kartının kapalı kalması, bilinmeyen değerlerin güvenli varsayılana düşmesi.
- `node test-server.mjs`: geçti.
- Panelden sürülen Playwright kontrolü (betik repoya eklenmedi): kanal adı yayına
  geçiyor; OBS ölçüleri seçilen moda göre değişiyor (br/m 1290,695 560×315; tl/l
  70,70 640×360); sol yarı seçilince skor yığın varyantına geçiyor; tur sürerken
  kelime sayfada yok; doğru cevapta damga ve kart; sonraki turda kelime siliniyor;
  dört tur boyunca sızıntı yok; pasta damga "Pas" ve pas geçilen kelime görünüyor,
  yeni kelime görünmüyor; kamera ve kart adı kapatılabiliyor; sayfa hatası yok.
- Uzun kelime kontrolü dört temada geçti (bkz. V3 notu; aynı betik).
- 1920×1080 ekran görüntüleri: dört tema × tur / bildi / süre doldu / son 10 sn /
  ara / ilk açılış / oyun sonu / uzun adlar; kamera yok, dört köşe (orta ve büyük),
  sol ve sağ yarı, 960×1080 yarım kaynak, alt şerit. Hiçbir yuva kamera deliğine
  ya da birbirine binmiyor.
- Galerinin canlı akışı 34 saniye dört temada oynatıldı: konsol hatası yok.

Yapılmadı: gerçek OBS tarayıcı kaynağında saydamlık (OBS 30/31, Streamlabs), ekran
okuyucu, renk körlüğü ve tema başına ölçülmüş kontrast, düşük güçlü cihazda
animasyon performansı, gerçek sunucu bağlantısı (prototip BroadcastChannel kullanır).

# V3 yayın ekranı taslağı doğrulaması

3 Kasım 2026. Yerel sunucu (4318) ve Chromium/Playwright. Gerçek OBS, fiziksel
cihaz veya production backend testi değildir.

- `node test-session.mjs`: 15/15. Yeni kontroller:
  - kelimenin yalnız tur bitince açılması (hazır, tur, ara, pas, yeni tur ve oturum
    sonunda kapalı);
  - açılan kartın sınırları (40 karakter, en çok 5 yasaklı kelime, 24 karakter);
  - bilme süresinin aradaki duraklamayı saymaması;
  - bilinmeyen tema ve kamera değerlerinin güvenli varsayılana düşmesi;
  - pasın bir kez işaretlenmesi.
- `node test-server.mjs`: geçti. `themes.html` sunuluyor; `public.js` panel
  betiğini ya da kelime paketini içermiyor.
- Panelden sürülen Playwright kontrolü (betik repoya eklenmedi):
  - tema ve kart seçimi önizlemeye geçiyor;
  - tur sürerken önizleme sayfasında kelime yok; doğru cevapta kart dönüyor,
    kelime ve "Bildi!" görünüyor;
  - sonraki turda kart kapanıyor ve eski kelime sayfadan siliniyor. Bu kontrol,
    silme kodu kapatılınca düşüyor, açılınca geçiyor;
  - deste dört tur dönerken canlı kelime sayfada hiç görünmüyor;
  - kamera alanı ve kart adı kapatılabiliyor; pas animasyonu çalışıyor;
  - sayfa hatası yok.
- Uzun kelime kontrolü (dört tema ve açık renkli kart önü): "ELEKTROENSEFALOGRAFİ",
  çok kelimeli 36 karakterlik bir ifade ve 35 harflik tek kelime kartın içinde
  kalıyor. Tek kelime en küçük boyutta da sığmazsa satır sonunda bölünüyor.
- 1920x1080 ekran görüntüleriyle dört tema; tur, son 10 saniye, bildi, süre doldu,
  ara, ilk açılış, oturum sonu, kamerasız düzen ve alt şerit tek tek incelendi.
- Galerinin canlı akışı 34 saniye dört temada oynatıldı: konsol hatası ya da
  uyarısı yok.

Yapılmadı: gerçek OBS tarayıcı kaynağında saydamlık, ekran okuyucu, renk körlüğü
ve tema başına kontrast ölçümü, düşük güçlü cihazda animasyon performansı.

# V2 prototip doğrulaması

4 Ekim 2026. V2 UI testleri önce repo dışındaki kopyada yapıldı; prototip sonradan bağımsız tasarım arşivi olarak repoya alındı. Codex in-app browser / Chromium üzerinde Playwright locator, DOM ölçümleri ve ekran görüntüleri. Fiziksel cihaz veya production backend testi değildir. Repo kopyasının ek doğrulamaları aşağıda ayrı belirtilir.

## Otomatik model kontrolleri

Komut: bu klasörde node test-session.mjs. 10/10 geçti.

1. Bağlantı olmadan tur başlayamıyor.
2. Bir turda tek kazanan; sonraki turda son bilen korunuyor.
3. Aynı mesaj ve eski tur mesajı yeni puan yazamıyor.
4. Eşit skorlar aynı sırayı alıyor; yeni doğru cevap liderliği değiştiriyor.
5. Duraklatılmış tur tahmin kabul etmiyor; yeniden bağlantı manuel devam gerektiriyor.
6. Süresi dolmuş tahmin interval çalışmadan da reddediliyor; sayaç negatif olmuyor.
7. Pas son bileni ve duraklatılmış durumu koruyor.
8. Aynı nickname farklı oyuncu kimliklerini birleştirmiyor.
9. Public projection üç skorla sınırlı; gizli alanlar ve örnek secret/token çıkmıyor.
10. Yeni oturum skor ve son bilen bilgisini temizliyor.

node --check app.js, public.js, server.cjs geçti. Skor sıralaması O(n log n), eşitlik/sıra hesabı O(n); her oyuncu için tekrar tam liste tarama kaldırıldı. Bu hesap ve demo belleği gerçek yüksek hacimli chat worker'ının yerine geçmez.

## UI üzerinden doğrulananlar

- Twitch demo bağlantı dialog'u açılıyor ve simüle kanal bağlanıyor; gerçek OAuth yapılmıyor.
- Eşitlik senaryosu Deniz 6, Luna 6, Mert 4 için sıralar 1, 1, 3.
- Luna doğru tahmin ile 7 puana ve tek liderliğe geçiyor; yayın ekranında lider değişimi metni görünüyor.
- Aynı mesajı tekrar gönder düğmesi puanı değiştirmiyor.
- Sonraki turda son bilen Luna olarak kalıyor.
- Bağlantı kesme aktif turu duraklatıyor. Yeniden bağlanma turu kendiliğinden başlatmıyor; devam düğmesi gerekiyor.
- Panel temasını açık yapmak public temayı değiştirmiyor. Yayın teması seçimi iki public görünümün temasını değiştiriyor.
- Oturumu bitir public özeti gösteriyor; yeni oturum boş skorla başlıyor.
- HTML biçimli görünen ad düz metin olarak kalıyor; img node'u oluşmuyor.
- Sonradan açılan public sayfa güncel snapshot/son bilen/Top 3 alıyor. Bu bağlantıda eski kazanç olayı tekrar animasyon olarak oynatılmıyor.
- Public DOM'da hedef kelime yok. Public sayfanın yüklediği script public.js; app.js veya özel kelime paketi scripti yüklenmiyor.
- Sakura seti demo satın alımıyla açılıyor, Ay Işığı rengi kuşanılabiliyor.
- Özel kart ön yüz değişirken public SVG yalnız arka yüz koordinatını (800 759 252 348) kullanıyor.
- 320 px kart laboratuvarında uzun hedef metin kartın yatay sınırları içinde; tüm sayfada yatay taşma yok.
- 320/390 px yayıncı panelinde yatay taşma yok.
- 1920x1080, 1280x720, 640x360 public tam görünüm: tuval içine sığıyor. İlk 1280 ve 640 dikey taşmaları giderilip tekrar ölçüldü.
- Masaüstü gömülü önizleme 755x425 ve mobil önizleme 294x166: scrollHeight tuval yüksekliğiyle aynı; son bilen görünür.
- 390 px public sayfada yatay taşma yok; mobilde içerik alt alta.
- 1280x240 overlay tuvale sığıyor; body arka planı rgba(0, 0, 0, 0). JPEG kaydı alpha taşımaz, CSS dış zemin şeffaftır.

## Konsol ve kapsam sınırı

- Son açılan V2 public sekmesinde error/warn log'u yok.
- Panel otomasyonu sırasında kaynak URL'siz iki MutationObserver observe hatası görüldü. Prototip kodu MutationObserver kullanmıyor; kaynağı doğrulanamadı. Tüm tarayıcı konsolunun hatasız olduğu iddia edilmiyor.
- Gerçek Twitch/Kick/YouTube/TikTok API, OAuth, token refresh, kota, platform onayı, OBS ayrı process'i ve ağ reconnect testi yapılmadı.
- BroadcastChannel yalnız aynı browser storage context'i için. Ayrı OBS uygulaması için sunucu read-only yayın bağlantısı gerekecek.
- Demo sessionId yetkilendirme credential'ı değildir. Statik demo özel kelimeleri app.js içinde içerir ve dosyalar local sunucudan okunabilir. Üretim güvenlik sınırı değildir; bu haliyle deploy edilmemeli.
- Model testleri production server-side atomiklik/Redis idempotency/race güvenliği kanıtı değildir.
- Kart renkleri CSS filtreli deneme; üretimde ayrı kontrollü görseller gerekli.
- Gerçek cihaz, ekran okuyucu ve bütün sanat varyantlarında kontrast ölçümü yapılmadı.
- V2 hazırlanırken Hushle runtime/build/veritabanı değiştirilmedi. Arşivleme sırasında yalnız bağımsız prototip ve doküman dosyaları eklendi; önceki dirty runtime dosyaları commit'e dahil edilmedi.

## V2 görsel kayıtlar

- v2-studio-desktop.jpg: özel panel, Top 3 ve gömülü yayın ekranı.
- v2-public-desktop.jpg: 1280x720 koyu tam yayın.
- v2-public-light.jpg: 1280x720 açık tam yayın.
- v2-public-small.jpg: 640x360 tam yayın.
- v2-public-mobile.jpg: 390 px dikey public.
- v2-overlay.jpg: 1280x240 kompakt şeffaf katman.
- v2-mobile.jpg: 390 px yayıncı paneli.
- v2-cards-desktop.jpg: kozmetik/metin güvenli alan.
- v2-cards-mobile.jpg: 390 px uzun kelime denemesi.

V1 dosya adları eski tasarımdır; V2 kanıtı olarak kullanılmamalı.

Yerel sunucu kapanırsa bu klasörde node server.cjs ile tekrar açılabilir.

## Repo Kopyası Ek Kontrolleri

- Varsayılan port 4318; eski dış kopyanın 4317 portuyla çakışmıyor. CLI port argümanı ve ephemeral test portu destekleniyor; yalnız 127.0.0.1 dinleniyor.
- test-session.mjs yeniden çalıştırıldı: 10/10.
- test-server.mjs geçti: statik asset/MIME, HEAD, POST 405, dosya allowlist'i, path traversal, favicon ve public HTML.
- app.js/public.js syntax kontrolü ve diff whitespace kontrolü geçti.
- 4318 kopyasında Chromium/Playwright smoke: Twitch demo bağlantı, eşitlikten Luna 7 puan tek liderliğe geçiş, public iframe sync, duplicate mesajda aynı puanın korunması.
- repo-copy-smoke.jpg bu kopyanın yeni browser kanıtı; v2-*.jpg önceki dış kopyadan arşivlendi.
- Hushle kontrat testleri: shop-items, cosmetic-authoring, card-face, card-back, inventory-core geçti.
- Mevcut cosmetic-render-upgrade testi, i18n sonrası UI source'unda Türkçe literal arayan eski assertion nedeniyle başarısız. Ayrıntı kozmetik raporunda; bu commit'te runtime/test kodu değiştirilmedi.
- Arşivleme kapsamında production build veya gerçek ödeme/DB integration testi çalıştırılmadı.
