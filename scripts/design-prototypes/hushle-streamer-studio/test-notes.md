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
