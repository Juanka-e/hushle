# Hushle: yayıncı stüdyosu ve kart koleksiyonları

Durum: projeden bağımsız etkileşimli tasarım ve analiz, V2. Tarih: 4 Ekim 2026.

Prototip önce repo dışında hazırlandı, ardından `scripts/design-prototypes/hushle-streamer-studio` altında bağımsız tasarım arşivi olarak kaydedildi. Uygulama, veritabanı, ödeme sistemi ve production bundle'a entegre edilmedi. Mevcut çalışma ağacındaki diğer değişiklikler korunuyor.

## Karar özeti

1. Ortak ekran, platformdan bağımsız **yayıncı anlatır / sohbet tahmin eder** akışı olsun. İlk beta Twitch + Kick; YouTube aynı arayüze sonradan eklenebilir. TikTok bağlantısı resmî LIVE chat erişimi doğrulanana kadar aktif vaat edilmesin.
2. Özel yayıncı masası ile yayın ekranı ayrı olsun. Yayına cevap, yasaklı kelime veya ham sohbet geçmişi gönderilmesin. OBS için tam ekran ve şeffaf katman aynı güvenli veri sözleşmesini kullansın.
3. İlk sürüm tek aktif platform, süre, pas, duraklat/devam, skor ve bağlantı durumu ile sınırlı olsun. Coin, bağışla avantaj, çapraz platform yarış ve karmaşık abonelik kuralları eklenmesin.
4. Görseldeki kartlara hedef kelime ve yasaklı kelimeler yazılabilir. Metin, çizimin içine gömülmek yerine ayrı HTML katmanı olmalı.
5. Kart setinin 2–3 renk varyantı aynı satın alımla açılsın. Renkler ayrı çizimler/asset'ler olarak saklansın; renk başına mağaza ürünü çoğaltılmasın.

## 1. Ortak arayüzün sınırı

Ortak olan OAuth izin ekranı değil, oyun deneyimidir. Sağlayıcı bağlantısını ayrı adapter yönetir; stüdyo normalize edilmiş durum ve yetenekleri gösterir.

| Platform | Doğrulanan resmî yol | Arayüzdeki fark | Üretim ön koşulu |
| --- | --- | --- | --- |
| Twitch | EventSub sohbet olayları. Yetkilendirme kullanılan taşıma ve bot modeline göre değişir. | Kanal bağla, bot/sohbet iznini açıkla, abonelik durumunu göster. | Uygulama kaydı ve doğru token modeli. Cloud bot yaklaşımında bot ve yayıncı yetkileri ayrı değerlendirilir. |
| Kick | `chat.message.sent` olayları, `events:subscribe` kapsamı, imzalı webhook teslimatı. | Kanal bağla, webhook aboneliği sağlıklı mı göster. | OAuth akışı, callback ve RSA-SHA256 imza doğrulaması; mesaj kimliği ile dedup. |
| YouTube | Aktif yayın keşfi ve `liveChatMessages.streamList`. | Kanal bağlantısından sonra aktif yayını seç; canlı sohbet sona erdiğinde oturumu duraklat. | Yayın keşfi için uygun OAuth kapsamı; canlı sohbet kimliği, kesinti sonrası resume, kota ve erişim hataları. |
| TikTok | İncelenen açık geliştirici ürünleri içinde genel LIVE chat erişimi doğrulanamadı. | Planlanan platform, bağlan butonu yok. | Erişim ve şartları resmî yoldan doğrulamadan gayriresmî scraping/connector kullanma. |

Kaynaklar:
- [Twitch sohbet yetkilendirmesi](https://dev.twitch.tv/docs/chat/authenticating/)
- [Twitch webhook güvenliği ve teslimat davranışı](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/)
- [Kick olay türleri](https://github.com/KickEngineering/KickDevDocs/blob/main/events/event-types.md)
- [Kick OAuth kapsamları](https://github.com/KickEngineering/KickDevDocs/blob/main/scopes/scopes.md)
- [Kick webhook güvenliği](https://github.com/KickEngineering/KickDevDocs/blob/main/events/webhook-security.md)
- [YouTube aktif yayın keşfi](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list)
- [YouTube sohbet akışı](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/streamList)
- [TikTok geliştirici ürünleri](https://developers.tiktok.com/products)

Bu tespitler UI'nin teknik ortak paydasını belirler; uygulama onayı, ticari kullanım, hesap uygunluğu ve güncel platform şartlarının tamamının onaylandığı anlamına gelmez. Gerçek adapter geliştirilmeden önce yeniden kontrol edilmeli.

Hushle video yayını taşımaz, stream key istemez. Yayıncı mevcut OBS yayınına tarayıcı kaynağı ekler. OBS Browser Source URL, tuval ölçüsü ve şeffaf arka planı destekler: [resmî OBS kaynağı](https://obsproject.com/kb/browser-source). Önerilen ilk tam ekran tuvali 1920×1080, katman tuvali 1280×240; bunlar bizim tasarım tercihlerimiz, platform zorunluluğu değil.

### Akış

Kanal bağla → kelime paketi/kategori/süre seç → yayın ekranını önizle → turu başlat → sohbetten doğru tahmini kabul et → sonraki tur.

Bağlı hesap ile aktif sohbet bağlantısı ayrı durumdur. Token var diye bağlantı yeşil gösterilmez. Yayın bulunamadı / izin eksik / yeniden bağlantı gerekli / tur duraklatıldı durumları görünür olmalı. Kopma halinde tur otomatik durur; bağlantı geri gelince yayıncı devam ettirir.

Arayüz dili ve kelime paketi bağımsızdır. Prototipin arayüzü Türkçedir; Türkçe/İngilizce paket seçimi kelimeleri değiştirir. Tam arayüz i18n entegrasyonu burada yapılmadı. Pakete göre kategori listesi üretimde katalogdan gelmeli. Demo iki pakette ortak iki kategori içeriyor.

Twitch/Kick/YouTube kartları prototipte deneyimi göstermek için seçilebilir. Gerçek hesap bağlantısı kurulmaz; YouTube'un prototipte bulunması ilk betaya dahil edildiği anlamına gelmez.

## 2. Görsel yön

Yön: **Hushle oyun masası / yayına hazır**. Önceki bağımsız editoryal/serif yaklaşımı bırakıldı. Mevcut oyundaki kalın sans başlıklar, mavi/sky vurgular, slate paneller ve yuvarlatılmış yüzeyler temel alındı. Inter seçimi burada yeni bir marka üretmek için değil, mevcut ürün kimliğini korumak için. Kullanılan HUSHLE yazısı metin fallback'idir; final marka logosu yeniden tasarlanmış sayılmaz. Entegrasyonda admin ayarındaki gerçek logo gelir.

DFII değerlendirmesi: etki 4, bağlam 5, uygulanabilirlik 4, performans 4, tutarlılık riski 3; toplam 14. Bu tasarım yargısıdır, kullanıcı testi değildir. Hatırlanacak öğe oyun kartı, büyük süre ve okunaklı Top 3 birlikte. Rekabet bireysel sohbet yarışıdır; gerçek takım modu olmadığında A/B takım renkleri veya takım skorları gösterilmez. Lider değişimi ve son bilen için kısa, tek olaylık animasyon; sürekli parıldama yok. Reduced-motion tercihine uyulur.

### V2 bilgi hiyerarşisi ve rekabet

- Tam yayın ekranı: Hushle, tur/kalan süre, kart arka yüzü ve tahmin çağrısı, belirgin Top 3, son bilen, katılımcı sayısı. Ham sohbet akışı yayına taşınmaz.
- Kompakt katman: aynı logo/renk/yazı ailesi; süre + Top 3 + son bilen. Büyük kart/çağrı alanı yok. Şeffaf dış zemin ve kontrollü panel zemini OBS içeriğini boğmaz.
- Özel panel: gizli kelime, yasaklılar, başlat/pas/duraklat, bağlantı ve ayarlar. Test araçları ayrı demo bölümü; gerçek panelde yer almaz.
- Son bilen tur kazananından ayrı snapshot'tır. Yeni tur, pas, ayar değişimi veya reconnect bu bilgiyi silmez. Yeni doğru cevap günceller. Oturum sonu skorlar kalır, yeni oturum temiz başlar.
- İlk geçerli doğru cevap +1 oturum puanı. Coin değil. Streak, ücretli avantaj ve karmaşık katsayı ilk sürümde yok; izleyici neyin puan getirdiğini hemen anlamalı.
- Eşit puan aynı sıra: 1, 1, 3. Deterministik sıralama yalnız görsel düzen için; eşitlik kazananı ilan etmek için değil. Top 3 üç slotla sınırlı; üçüncülükte çok kişi eşitse hepsini sığdırma iddiası yok. Tam sıralama sonraki özellik olabilir.
- Puan anahtarı provider + providerUserId; görünen ad yalnız metin. Son bilen adı o andaki olay snapshot'ıdır. Demo dört farklı oyuncu kimliğiyle bunu canlandırır.
- Yarışmayı güçlendirmek için öncelik okunaklı liderlik ve son bilendir. Tüm zamanlar liderliği, seri bonusu, hareketli chat yağmuru ve bildirim kalabalığı ilk sürüme alınmaz. Sonraki adaylar: oturum sonu podyum, liderle puan farkı, katılım hedefi. Kullanıcı geri bildirimiyle seçilir.
- Panel teması ile yayın teması ayrıdır. Yayıncı açık panel kullanırken yayın koyu kalabilir; açık/koyu yayın teması açıkça seçilir. Tema değişikliği OBS görüntüsünü istemeden değiştirmez.
- Küçük gömülü önizleme dar/yatay alanda kartı kaldırıp logo/süre/skor/son bilene odaklanır. Asıl yayın tuvali 16:9; dikey telefonda tam sayfa görünüm alt alta akar.

Özel panelde cevap var. Ekran paylaşımı yanlışlıkla bu pencereyi yakalarsa yazılım bunu engelleyemez; belirgin uyarı ve ayrı yayın penceresi bu insan hatasını azaltır. “Gizle” butonu ya da CSS blur bir güvenlik sınırı değildir.

## 3. Kart görselleri: evet, ama doğru katmanla

Önerilen render sırası:

1. Full-card front/back asset; bütün yüzeye yayılan, doğru oranlı çizim.
2. Temaya özel okunabilirlik maskesi; tercihen çizime tasarım aşamasında işlenmiş sakin bölge.
3. Dinamik hedef kelime, yasaklı kelimeler ve gerekirse küçük bilgi işaretleri.

Metin neden görsele gömülmemeli: her tur değişir, iki dil farklı uzunlukta kelimeler getirir, mobilde kırılım/font ölçeği değişir, metin seçilebilir ve erişilebilir kalır. Her kelime için görsel üretmek bakım ve depolamayı gereksiz büyütür.

### Mevcut kodun durumu

`apps/web/src/components/game/game-card.tsx`: image overlay hedef kelimenin başlık alanında; yasaklı kelimeler ayrı zemin üstünde. Tam illüstrasyonlu kart yüzeyi gibi davranmıyor ve tek sabit ön/arka yüz oranı burada uygulanmıyor.

`apps/web/src/lib/cosmetics/card-face.ts`: renkler ve image overlay çözümleniyor; image modunda overlay opacity 0.18. `renderSpecVersion` altyapısı mevcut. Bu görüntüleri mevcut `imageUrl` alanına eklemek tasarımın tamamını aynen göstermeye yetmez.

`prisma/schema.prisma`: `ShopItem`, `InventoryItem`, ayrı kart önü/arkası kuşanma ilişkileri ve `ShopBundle` var. İncelenen şemada bir ürüne bağlı renk varyantı ve ayrı kuşanılmış varyant ilişkisi yok. Renk seçimi hazırmış gibi davranamayız.

Mevcut planların dayanakları: `docs/dashboard-ui/cosmetic-authoring-spec.md`, `docs/guides/card-template-registry-plan.md`, `docs/stream/multi-platform-streamer-plan.md`.

### Çizim üretimi

- Ön ve arka yüz ayrı dosya; aynı oran ve safe area. Kolaj mağazada/oyunda üretim asset'i olarak kullanılmaz.
- Mevcut spec 900×1200 / **3:4**. Referans kolajdaki kartlar yaklaşık **2:3**, bazı satırlarda da farklı oran var. Rastgele `object-cover` ile kesersek çerçeve ve karakter kaybolabilir. **Öneri: 3:4 yeniden çizim/export; referansı körlemesine kırpma.** 2:3'e geçilecekse bütün renderer ve authoring spec birlikte güncellenmeli.
- Örnek hedef alanı: x140, y200, 620×220. Yasaklı kelime alanı: x140, y470, 620×480. Bu koordinatlar bir taslak öneri; metin boyutu ve mobil testten sonra sabitlenmeli.
- Alt yaklaşık 220–250 px, köşeler ve yan kenarlar dekorasyona ayrılabilir. Ejderha gibi çizimleri metin alanından uzaklaştır; Sakura/Bastet gibi açık kartlarda yazı koyu olsun. Süs, metnin üstüne çıkmasın.
- Hedef için iki satır ve kontrollü font küçültme; çok uzun birleşik kelimeler için ek kırılım testi. Yasaklı kelimeler için iki satır gerekebilme ihtimalini unutma. Küçük yazıya sonsuz küçültme uygulama.
- Normal metinde en az 4.5:1, büyük metinde 3:1 kontrast hedefi. Her varyant ayrı denetlenmeli; prototipte tüm temalar için otomatik kontrast sertifikasyonu yapılmadı.
- WebP/AVIF teslimi, PNG/katmanlı kaynak saklama. 900×1200 başlangıçta yeterli olabilir; 2× yüksek çözünürlüklü export gerekli ekranlarda seçilmeli. Keskin çerçevelerde kaliteye bakmadan tek dosya boyutu dayatma.
- Kullanım hakları ve ticari lisans alınmalı; çizimleri platform logosu/başka markanın karakteriyle karıştırma.

Bu prototip referans PNG'yi değiştirmeden SVG viewBox ile gösteriyor. Render sırasında renk filtresi ve okunabilirlik maskesi kullanılıyor. Bu, hazır final asset veya yeni üretilmiş renk çizimi değildir. Kolajın 2.67 MB dosyası sadece tasarım denemesinde kullanılıyor.

## 4. Renkler ve satın alma modeli

Önerim: renk başına ayrı mağaza kartı yerine bir koleksiyon kartı, içinde üç renk. Alıcı hangi renklerin dahil olduğunu satın almadan görür; önizleme serbest, kuşanma sahiplikle sınırlandırılır. Sonradan renk değiştirmek yeni ödeme gerektirmez. İlk aşamada renklerin farklı gameplay/rarity avantajı olmasın.

Mevcut ön/arka yüz slotlarını koruyabiliriz: her yüzün parent ShopItem'ı aynı collectionKey'e bağlı olsun; ShopBundle ön ve arka yüzü birlikte satsın. Kullanıcı isterse mevcut slot mantığıyla yüzleri ayrı kuşanabilsin. “Seti kuşan” kısayolu seçilirse iki slot tek atomik işlemde eşleşen renge güncellensin. Böylece mevcut envanterin anlamını bozmadan koleksiyon deneyimi kurulabilir.

Önerilen veri ilişkileri, henüz implement edilmedi:

```text
ShopItem (kart önü veya kart arkası, mevcut sahiplik birimi)
  -> CosmeticVariant (variantId, parentItemId, stable variantKey,
       locale-independent palette key, assetUrl, thumbnailUrl,
       renderSpecVersion, assetVersion, active)

InventoryItem -> parent ShopItem sahipliği
UserProfile -> mevcut equippedItemId + yeni equippedVariantId
ShopBundle -> iki parent yüzün birlikte satın alımı
```

Bir rengin ön ve arka yüz varyantı aynı stable palette key ile eşleşir. Parent satın alımı başlangıçta bütün ilan edilmiş renkleri açar. İleride ayrı satılan renkler gerekirse bunu açık varyant entitlement modeliyle ekleriz; başlangıçta bu karmaşıklığa ihtiyaç yok.

Server kuşanırken sahiplik, yüz/slot uyumu, varyantın parent'a bağlı oluşu ve kullanılabilirlik doğrulanır. F12'den başka ürünün varyantId'sini göndererek kuşanma mümkün olmamalı. Satın alma parent/bundle seviyesinde transaction ve idempotency ile kalır. İade/geri alma bütün ilgili hakları kapatır, kuşanılmış ürün/varyantı güvenli default'a geçirir.

Eski envanter satırları migrate edilirken default varyanta düşer. Bilinmeyen yeni renderSpecVersion eski istemcide güvenli fallback kullanır. Asset URL'leri içerik hash'i/versiyonla sabitlenir; eski URL'nin içine sessizce yeni tasarım yazılmaz. Aktif maç aynı render spec snapshot'ı ile devam eder.

Renk filtresini üretimde önermiyorum: metal, karakter, çerçeve ve arka plan birlikte kayar. Aynı çizimi 2–3 kontrollü palette ayrı export et. Fiyat, sadece renk sayısına değil çizim kalitesi/set içeriğine göre verilsin; mevcut coin ekonomisi gözlenmeden tutar uydurmayalım.

## 5. Güvenlik, adalet ve ölçek: üretim için gerekenler

- Host: Hushle oturumu ve sunucu sahiplik kontrolü. Platform bağlantısı siteye giriş OAuth hesabıyla aynı kayıt olmak zorunda değil; ayrı bağlantı/izin kaydı olsun, Hushle userId sabit kalsın.
- OAuth state/PKCE sağlayıcı gereksinimine göre; tokenlar şifreli sunucu saklaması, loglara token yazmama, callback redirect allowlist, revoke ve refresh yönetimi.
- Twitch webhook HMAC ve Kick raw-body RSA imzası; tekrar teslim ve geçmiş olay replay kontrolü. Callback WAF/rate-limit tasarımı gerçek platform teslimatını bozmasın.
- Public DTO v2: yalnız phase, süre, tur, yayın teması, paket kodu, bağlantı/katılımcı özeti, Top 3 (ad/puan/sıra/eşitlik), son bilen olay snapshot'ı ve allowlist kart arka yüzü referansı. Monoton revision eski snapshot'ı reddeder; yeni bağlantıda güncel snapshot alınır. Gizli kelimeler HTML, JavaScript bundle, initial payload, socket state, cache ve reconnect cevabına girmemeli. Bu yerel demo v1 istemcilerle uyum iddiasında değildir; üretimde protokol geçişi/fallback ayrıca tasarlanır.
- OBS için scope'u yalnız okuma olan döndürülebilir/revoke edilebilir credential. URL/log/referrer sızıntısını azalt; public bağlantıyla yönetim endpoint'lerine erişim verme. Hushle private API'de CORS wildcard açma.
- Tur state machine ve monoton roundId; eşzamanlı doğru cevaplarda tek winner geçişi sunucuda atomik. Geçmiş roundId mesajı, bot kendi mesajı ve replay skor yazmamalı. “Dünyada ilk yazan” değil, geçerli turda sunucunun ilk kabul ettiği doğru tahmin kazanır.
- Pause/resume aralığında gelen tahminler kabul edilmez. Kesinti sonrası geçmiş sohbet topluca yeni tura puan yazmaz. YouTube başlangıç geçmişini ve resume cursor'unu özellikle ele al.
- Provider userId kimliktir; nickname puan anahtarı değil. Platformlar arası eşit nickname aynı kişi sayılmaz. TR/EN eşleştirme Unicode normalizasyonu ile yapılır; aşırı gevşek fuzzy match ilk betada olmasın.
- Chat gövdeleri ve görünen adları HTML olarak render etme. Sürekli ham chat'i DB/audit'e dökme. Kısa, sınırlı kuyruk; Redis TTL dedup ve skor; DB'de oturum/tur özeti. İnceleme gereken tetiklemeler ayrı sınırlı retention ile kalır.
- Kuyruk geride kalırsa bunu panelde göster; gerekirse turu duraklat. Rastgele olay atarken sorunsuz/adaletli yarış iddiası verme. Lag, dropped/dedup sayısı, worker health ve bağlantı durumu operasyon panelinde ölçülsün.
- Her saniye DB write veya dashboard fetch yok. İstemci sayacı server deadline'dan yürüsün; olay tabanlı güvenli snapshot/delta. Tek chat mesajını bütün seyircilere fanout etmeye gerek yok.

**Önemli sınır:** bu bir local UI simülatörü. Local BroadcastChannel, bellekte puan ve front-end demo satın alımı gerçek auth/entitlement/atomik DB güvenliği sağlamaz. Demo app.js örnek kelimeleri içerir, bütün statik dosyalar local sunucuda okunabilir. Sadece `public.js` ve gönderilen public projection cevap içermez. Bu klasör üretime bu haliyle deploy edilmemeli.

Şeffaf OBS sayfası aynı tarayıcı bağlamındaki BroadcastChannel ile çalışır. Ayrı OBS process'iyle senkronize gerçek ağ servisi yapılmadı; gerçek OBS testi yapıldığı iddia edilmiyor.

## 6. Önerilen parçalı uygulama sırası

1. UI/akış onayı: platform bağlama, kelime paketi, private/public ayrımı; uygulamaya henüz taşıma yok.
2. `codex/streamer-session-foundation`: server state machine, sahiplik, private/public DTO, versioning; sahte adapter ile güvenlik testleri.
3. `codex/streamer-twitch-kick-adapters`: OAuth, doğrulanmış teslimat, worker ve Redis bounded processing; gerçek test hesaplarıyla bağlantı/kopma/replay testleri.
4. `codex/streamer-obs-and-launch-validation`: gerçek OBS tarayıcı kaynağı, mobil kontrol, gecikme/yük, token revoke, audit retention. Ardından YouTube adapter ayrı branch.
5. `codex/cosmetic-card-art-and-variants`: 3:4 final art contract, hibrit renderer, front/back geometry, ownership/equip migration, parent/bundle satış ve server doğrulamaları. Streamer adapter'ına bağımlı değil, ayrı ele alınabilir.

Bu isimler öneridir; branch oluşturulmadı. İlk aşamayı onaylamadan repoya taşımayalım. Çoklu platform aynı yarış, abonelik/gift avantajları, ses ve geniş oyun modları bu kapsamın dışında.

## 7. Prototipi deneme

`node server.cjs` bu klasörde çalıştırıldığında yalnız 127.0.0.1:4318 dinler; ayrı paket kurulumu gerekmez. Deneme URL'si: http://127.0.0.1:4318. Port argümanı verilebilir. Eski repo dışı kopya 4317'de kaldı. Güncel çalıştırma ve kapsam bilgisi `README.md` içinde.

- Twitch/Kick/YouTube kartına bas, demo bağlantısını onayla.
- Türkçe veya İngilizce paketi seç, turu başlat, doğru tahmin dene.
- Bağlantıyı kes, sayaç durur; yeniden bağla, kendi kendine başlamaz; devam et.
- Yayın ekranını aç, hedef/yasaklı kelimelerin bulunmadığını karşılaştır.
- Kart laboratuvarında temaları, uzun kelimeyi ve ön/arka yüzü değiştir.
- Demo seti satın al, renk seç ve kuşan; yayıncı masasında seçtiğin görünüm uygulanır.
- Örnek yarış / eşitlik senaryosu yükle. Luna ile turu başlatıp doğru tahmin dene: eşitlikten tek lidere geçişi gör. Aynı mesajı tekrar gönder: puan değişmez.
- Sonraki turda son bilenin kaldığını gör. Oturumu bitir, yeni oturumu başlat: skorlar temizlenir.
- Panel temasını değiştir: yayın görünümü sabit kalır. Yayın teması seçimi iki public görünümü birlikte değiştirir.
- Kart rengini kuşan: özel panelde ön, yayın ekranında yalnız arka yüz uygulanır.

Gerçek OAuth, ödeme, chat API testi veya Hushle production build'i bu görevin parçası olarak çalıştırılmadı. Prototip test bulguları test-notes.md içinde.
