# Hushle Kart Koleksiyonları, Mağaza ve Profil Değerlendirmesi

Tarih: 4 Ekim 2026. İncelenen çalışma ağacı:
feature/bilingual-announcements-and-word-locales.
**Kod incelemesi + sınırlı kontrat testleri; yeni kozmetik implementasyonu değil.**
Mevcut uncommitted oyun değişiklikleri incelendi ancak bu doküman/prototip commit'ine alınmadı.

## Kısa Karar

Görseldeki kartlar Hushle için iyi bir koleksiyon yönü. **Bugünkü sisteme aynen
yükleyip aynı sonucu beklememeliyiz.** Önce tam yüz art renderer, ortak kart
ölçüsü ve gerçek renk varyantı modeli gerekir.

Öneri: ilk aşamada 4 güçlü aile, aile başına 2-3 kontrollü renk, gerçek ön/arka
eşleşmesi. Mağazada bir rengin üç kopyası yerine tek koleksiyon ürünü ve renk
seçimi. Avatar/çerçeve ve kazanılabilir rozetler bunu tamamlasın. XP, kutu,
night market ve geniş profil sosyal sistemi ilk açılışın zorunlu parçası değil.

Sadece mağazayı büyütmek insanların satın almak isteyeceği anlamına gelmez.
Kozmetiğin oyunda görülmesi, görünümünün önizlemeyle aynı olması, fiyatın
anlaşılması ve ücretsiz oyuncunun da iyi görünmesi daha önemli.

## 1. Mevcut Koddan Doğrulanan Durum

| Alan | Bugünkü durum | İstenen deneyime etkisi |
| --- | --- | --- |
| Ürün tipleri | ShopItemType: avatar, frame, card_face, card_back | Oyuncu rozeti, başlık, profil arka planı henüz ayrı ürün tipi değil |
| Renderer | image/template, palette/pattern/glow/motion | Güvenli theme parametreleri var; keyfi HTML/CSS renderer yok |
| Sürüm | renderSpecVersion, desteklenen sürüm yalnız 1 | V2 full-art ayrı destek olarak eklenmeli; sadece sayıyı artırmak yetmez |
| Kart önü | GameCard görseli yalnız header alanında, image modunda opacity 0.18 | Tam kedi/ejderha kartını aynen göstermez; alt yasaklı alanı ayrı surface |
| Kart arkası | ActiveGame CardBackPanel tüm yüzeye overlay, ek dekorasyon/title | Resme daha yakın; ancak ek çerçeve, opacity ve yazılar art'ı değiştirebilir |
| Ölçü | Authoring spec 900x1200 / 3:4; gameplay doğal yükseklik ve 500px flip kabı | Doküman ve gerçek bileşen ölçüsü tek kontrat değil |
| Önizleme | 198x272 flip; karşı yüz mevcut üründen türetilmiş default theme | Bir card_face ürününü çevirince koleksiyonun gerçek eş arkası gösterilmiyor |
| Grid | 24 ürünlük artan batch, memo/static thumbnail, büyük preview modal | Her üründe canlı animasyon/flip çalışmıyor; bu iyi |
| Katalog | Web full catalog API; ortak Redis cache 30 saniye; ayrı paged core API de var | UI batch gerçek ağ pagination'ı değil; büyük katalog hâlâ tek payload |
| Sahiplik | InventoryItem: userId/shopItemId unique, renderSnapshot | Aynı ürünün renk seçimi/variant entitlement modeli yok |
| Kuşanma | Sunucuda item tipi + sahiplik, Serializable transaction; null ile çıkarma | Sağlam temel; varyant-parent/slot kontrolü eklenmeli |
| Profil | displayName/bio + avatar/frame/card face/back slotları | Tam public profil vitrini, rozet seçimi veya unvan sistemi kanıtlanmış değil |
| Paket | ShopBundle + ShopBundleItem, coin fiyatı, kupon/indirim/availability | Ön+arka set satılabilir; eşleşmiş renk seçimi ayrı geliştirme |
| Kısmi paket | UI ve backend, pakette zaten sahip olunan ürün varsa satın alımı reddediyor | 'Seti tamamla' deneyimi bugün yok; fiyatlandırma ayrıca tasarlanmalı |
| badgeText | Ürüne YENİ/LİMİTLİ benzeri mağazacılık etiketi | Oyuncunun kazandığı/kuşandığı rozet değil |
| XP/level | Eski plan dokümanında gelecekte eklenecek API alanları var | Planı mevcut özellik gibi göstermemeliyiz |

Kod referansları:
- [Şema](../../prisma/schema.prisma): ShopItemType, ShopItem, ShopBundle, InventoryItem, UserProfile.
- [Kart önü](../../apps/web/src/components/game/game-card.tsx).
- [Ön yüz theme resolver](../../apps/web/src/lib/cosmetics/card-face.ts).
- [Gameplay ön/arka yüz](../../apps/web/src/app/room/[code]/_components/active-game.tsx).
- [Thumbnail ve detay preview](../../apps/web/src/components/game/cosmetic-preview.tsx).
- [Mağaza UI](../../apps/web/src/components/game/dashboard-pages/shop-content.tsx).
- [Katalog core](../../packages/platform-store/src/index.ts).
- [Kuşanma core](../../packages/platform-inventory/src/index.ts).
- [Paket satın alma](../../apps/web/src/lib/economy.ts).
- [Profil/sidebar](../../apps/web/src/components/game/dashboard-profile-sidebar.tsx).

## 2. Kullanıcının Gönderdiği Kartlar

Referans collage [prototipte saklandı](../../scripts/design-prototypes/hushle-streamer-studio/reference-cards.png).
Bu görsel tasarım referansıdır; lisans/menşe onayı veya hazır satış asset'i değildir.
Prototip crop'ları SVG viewBox ile yapılır; görsel dosyası değiştirilmedi.

| Aile | Ön yüz değerlendirmesi | Üretim değişikliği |
| --- | --- | --- |
| Gece Altını | Ortası sakin, güçlü metal çerçeve; iyi başlangıç | Koyu merkezde açık metin; kırmızı enerji kenarlarda kalsın |
| Parşömen | Sakin açık yüz, uzun kelimeler için en güvenli aday | Koyu metin; açık altın metin kullanma |
| Gece Mavisi | Premium ve okunabilir zemin | Sol alt metal dekor yasaklı listeye taşmasın |
| Prizma | Karbon texture çekici ama küçük ölçüde gürültü yapabilir | Desen kontrastı azaltılsın; rainbow çerçeve hareket etmesin |
| Rüya Tozu | Pastel/unicorn karakteri güçlü | Her palette ayrı kontrast; beyaz metin otomatik güvenli değil |
| Sakura | Güçlü koleksiyon karakteri; kedi alt listede metne çarpabilir | Ön yüzde kedi/kiraz çiçekleri kenar-alt bölgede, orta metin şeridi sakin |
| Ejderha | Siluet çok dikkat çekici | Büyük karakter arka yüzde; ön yüzde orta metin alanı açılmalı |
| Bastet | İkonik ama ön yüzde hiyeroglif ve karakter kalabalık | Tam figür arka yüzde; ön yüzde sakin papirüs/çerçeve, desen kenarda |

Arka yüzlerde H amblemi veya karakter serbestçe büyük olabilir; anlatılacak
kelime/yasaklı metin basılmaz. Zorluk ikonuna ayrılan sağ üst yuvarlak alan
gelecekte kullanılabilir, fakat boş bir dekor halkası gerçek UI badge'iyle üst
üste gelmemeli. Art ve UI aynı işareti iki kez çizmemeli.

Referans crop'ların oranı yaklaşık 0.67-0.72; spec 0.75. Bunları 3:4'e zorla
esnetmek karakterleri ve metal çerçeveyi bozar; object-cover da önemli kenarları
kesebilir. Nihai ön/arka yüzleri **aynı 900x1200 tuvalde yeniden export/üretmek**
gerekir. Collage'daki düşük çözünürlüklü tek kart crop'ı final master değildir.

## 3. Full-Art Renderer Kararı

Bu bir 'her kartın layout'u değişsin' talebi değil. Oyun metni ve zorluk slotu
sabit; yüzey çizimi tüm karta yayılır:

1. Ortak 3:4 yüzey ve border geometry.
2. Tam yüz art asset'i.
3. Artist tarafından sakin bırakılan bölge veya kontrollü readability mask.
4. HTML hedef kelime + yasaklı liste + gerçek zorluk ikonu.
5. İsteğe bağlı, düşük bütçeli efekt; metnin üzerinde partikül yok.

Başlangıç boyutu 900x1200, büyük preview/gameplay asset WebP; 240x320 statik
thumbnail. Master dosyası ayrı saklanır. Hedef dosya bütçesi ürüne göre ölçülür;
örneğin thumbnail 100KB altı mevcut authoring hedefi, garanti değil.

Metni çizime gömmeyelim. TR/EN ve sonraki diller için uzun kelime, Unicode,
iki satırlı başlık, 5 yasaklı kelime ve çeviri genişliği kontrol edilmeli.
Fontu sınırsız küçültmek yerine önce satır kırılımı, sonra alt font sınırı;
sığmayan metin üretim fixture'larıyla yakalanmalı.

Her palette normal metin için en az 4.5:1, büyük metinde en az 3:1 kontrast
hedefi ayrı ölçülmeli. Resimdeki dokulu bölgede tek bir renk örneği almak yetmez.
Kaynak: [W3C kontrast açıklaması](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
Bu referans görseller için henüz kontrast sertifikasyonu yapılmadı.

Renderer V1 korunur, V2 desteklenir. Eski envanter snapshot'ları otomatik V2
art'a çevrilmez. Eski client'ın yeni sürümü tanımaması için sadece mevcut
effectiveVersion fallback'ine güvenmeyelim: asset alanlarının eski renderer'da
nasıl görüneceği için compatibility fixture/fallback gerekir. Version handshake
ve rolling deployment planı ayrı test edilir.

Görsel versiyonları immutable URL/content hash ile; dosyanın eski URL'sinin
içine sessizce yeni çizim yazılmaz. Aktif maç cosmetics snapshot'ı ile sürer;
kuşanma değişikliği kelime görünürlüğünü veya rol yetkisini değiştirmez.

## 4. Renkler: Tek Ürün, Birden Fazla Seçim

**Bir renk = ayrı ShopItem** yaklaşımını kalıcı çözüm olarak önermiyorum.
Katalog, sahiplik, indirim, iade ve eşleşme gereksiz çoğalır.

Mevcut front/back ayrı slotları bozmadan önerilen model:
- ShopItem parent: card_face veya card_back ürün sahipliği/fiyatı.
- CosmeticVariant: parentItemId + stable variantKey + paletteKey +
  imageUrl/thumbnailUrl + renderSpecVersion + assetVersion + selectable.
- CosmeticCollection: aynı aileye ait ön/arka ürün ve vitrin bilgisi.
- ShopBundle: aile ön/arka parent haklarının birlikte satışı.
- UserProfile: mevcut parent itemId + o slota ait seçili variantId.
- InventoryItem parent sahipliği; ilk sette ilan edilen renkler bu hakla açılır.
- Ön/arka eşleşmesi paletteKey ile; iki yüzde farklı renk seçimi istersek ayrı
  slotlarda açıkça sunulur, gizli otomatik değiştirme olmaz.

Örnek: Sakura koleksiyonu, ön+arka set; Orijinal / Gece / Ay Işığı.
Satın alan setin ilan edilmiş 3 rengini seçebilir. Mağaza kartında tek ürün
ve 3 renk göstergesi; detayda tüm renklerin ön/arka görünümü. Aynı set için
rastgele 3 ayrı fiyat/indirim sayfası yok.

Eski envanter migrasyonu default variant'a; parent fiyat/satın alma/iade zinciri
korunur. Sonradan yeni renk eklerken mevcut sahipler için hak politikası önceden
tanımlanır. Başlangıç önerisi: o aileye eklenen standart renkler sahiplerine
açılsın; ayrı premium renk satışı gerekirse ileride açık entitlement modeli.

Temel sunucu doğrulamaları:
- Oturum userId'si server session'dan; request'te gönderilen owner'a güvenme.
- Parent sahipliği, doğru tip/slot, variant'ın parent'a ait olması.
- Geçerli palette/asset/spec; kaldırılmış varyantta belirlenmiş default.
- Satışın bitmesi sahipliği bitirmez. 'Satışta değil' ile 'kuşanılamaz/revoked'
  ayrı politika; mevcut isActive alanına bütün anlamları yükleme.
- İade/geri alma ilgili hakları ve kuşanılmış varyantı transaction içinde düzeltir.
- Eşzamanlı satın alma/kuşanma/iade, duplicate callback ve eski client alanları
  test edilir. Fiyat/indirim/award listesi client'tan kabul edilmez.

## 5. İnsanları Heveslendiren Mağaza

Önerilen düzen:
- Bir hero aile: tam ön/arka set, seçili renk, kullanımda görünüm.
- Koleksiyonlar: Gece Altını, Sakura, Bastet gibi belirgin karakter farkları.
- Avatarlar/çerçeveler: kart koleksiyonuyla uyumlu, ama paket zorunluluğu yok.
- Sana ait olanlar: dürüst sahiplik, 'Kullanımda', renk seç, çıkar.
- Detayda büyük preview: ön/arka gerçek eş, mevcut avatar/frame ile uyum.
- Paket içeriği: kaç ürün/renk, kalıcı mı süreli mi, tam fiyat.
- Wishlist ve koleksiyon ilerlemesi: ileride; ilk sürümü bloklamasın.

Nadirlik sadece fiyat rengi değil, çizim/işçilik farkı olmalı. Her ürün
legendary ve her kart neon/parlak olursa nadirlik anlamını kaybeder. Birkaç
iyi sade common ürün ücretsiz oyuncuyu da iyi gösterir. Erişilebilir kaliteli
görünüm, premium'u değersizleştirmek zorunda değildir.

Etkili ilk katalog önerisi: Gece Altını, Parşömen, Sakura, Bastet.
Bu seçim kullanıcı araştırması sonucu değil, çeşitlilik ve metin güvenliği
üzerine tasarım önerisidir. Sırf ürün sayısı için 30 hue kopyası çıkarmayalım.
Satış dönüşümü garanti edilemez; launch sonrası preview açılma, wishlist,
purchase ve equip oranları kişisel veri minimizasyonuyla ölçülür.

'3 renk dahil' etiketi; rarity yanında temiz swatch ve isim. Renk körlüğü için
sadece renk noktası değil seçili işareti ve yazılı palette adı da olur.

Yapay countdown, uydurma indirim, sahte stok ve 'tek şans' baskısı olmasın.
Süreli satış pencerenin gerçekten bitmesini temsil eder; alınmış ürünün
kendiliğinden silinmesi anlamına gelmez. Rarity oyun puanına avantaj vermez.

Fiyatı şu an sayıya bağlamayalım. Gerçek maç süresi, medyan coin/saat,
guardrail'e takılmayan olağan oyuncu kazancı ve satın alma/equip oranı ölçülüp
bir basit ürün / aile seti / özel çizim basamağı kurulur. Abuse hızındaki
kazanç fiyatlandırma referansı olamaz. Coin alışverişi oyuna erişimin şartı değil.

## 6. Rozet ve Profil

Bugünkü badgeText ürün etiketi; gerçek rozet sistemi ayrıca gerekir.

Başlangıç için **kazanılmış başarı rozeti** ve **satın alınmış dekorasyon**
görsel olarak ayrı:
- Kazanılmış: kurucu/beta katılımcısı, belirli sayıda tamamlanmış maç,
  belirli topluluk etkinliği. Gerekli olaylar sunucudan doğrulanır.
- Dekoratif: koleksiyon arması veya profil süsü; beceri/başarı diye sunulmaz.
- Moderasyon/verified/admin/support işaretleri satışa konmaz; dekoratif
  rozet hiçbir biçimde resmî yetki işaretini taklit etmez.
- 'Faul yapmadı' veya abuse risk puanı gibi güvenlik çıkarımları public rozet olmaz.
  Güncel gameplay'ın doğrulayamadığı bireysel başarıya rozet verme.

Önerilen sade profil vitrini: avatar + frame, görünen ad, bir kısa bio,
bir seçili unvan, en fazla 3 rozet, favori kart seti. Lobide en fazla bir küçük
işaret veya profil açma; bütün vitrini oyuncu listesine yığmayalım. Public
profil gerekiyorsa email/login/audit kimliği ve raw match geçmişi çıkmaz;
ayrı DTO, privacy tercihi ve report/moderasyon gerekir.

İleride BadgeDefinition / UserBadge (unique userId+badgeId, earnedAt,
source/reference) + profile showcase seçimi. İsim/unvan/bio düz metin;
server tarafında uzunluk/sahiplik/uygunluk ve grant idempotency. Socket tüm
rozet geçmişini değil seçili küçük appearance snapshot'ını taşır.

XP/level zorunlu değil. İlk önce birkaç dürüst milestone rozeti; XP eklemek
yeniden ekonomi ve abuse yüzeyi açar. Level coin ödülü future reward source
üzerinden gelir; mağaza satın alımı ile gameplay cap/counter karışmaz.

## 7. Sonraki Özellikler / Öncelik

| Öncelik | Özellik | Neden |
| --- | --- | --- |
| Şimdi | 3:4 full-art preview/gameplay parity + kontrast | Satın alınan şey oyunda aynı görünmeli |
| Sonra | Koleksiyon + variant + set sahipliği | Renkler katalog/ödeme modelini şişirmesin |
| Sonra | Vitrin ve birkaç kazanılmış rozet | Kendini ifade etme ve gerçek emeğin görünürlüğü |
| Gözlem sonrası | Wishlist, loadout preset, seti tamamla | İlk oyuncu davranışına göre değerli olabilir |
| Gözlem sonrası | Night market, newcomer/returning serisi, sezon görevleri | Ayrı offer/eligibility/reward source altyapısı; admin kontrollü |
| Daha sonra | Kutu/paket açılımı, nadirlik olasılıkları | Ayrı ödül havuzu/RNG/audit; özellikle ücretli modelde kapsam ve uygunluk ayrıca değerlendirilir |
| Şimdilik yok | Trading, cashout, paid advantage, sürekli animasyon | Launch riskini ve operasyon maliyetini gereksiz büyütür |

Night market/etkinlik, ürün tanımını veya sahipliği kopyalamaz: mevcut ürüne
süreli offer ve gerekirse server-side grant ekler. Kutu varsa kozmetik seçim
olasılığı ve duplicate politikası açık; client RNG/ödül yazımı olamaz.
Bu rapor ücretli kutu implementasyonu veya uygunluk onayı değildir.

## 8. Performans ve Güvenlik Sınırları

Şimdi iyi olanlar: statik/lazy thumbnail, memo, 24'lük DOM batch, yalnız açılan
detayda büyük preview, ortak katalog Redis cache. Fakat lazy image bütün
katalog JSON'unu küçültmez; DB cache browser decode/GPU/DOM yükünü çözmez.
Kaynak: [browser-level lazy loading](https://web.dev/articles/browser-level-image-lazy-loading).

Gerçek katalog büyürken:
- Web'i mevcut cursor paged core'a bağla; arama/filter server-side cursor ile.
- Featured alanı sınırlı; bütün bundle listesi de sayfalansın.
- Color asset'lerini grid açılışında hepsini indirme; seçili thumb, detayda
  aktif ön/arka variant; gerekirse tek sonraki variant prefetch.
- Thumbnail/full art ayrı WebP export, immutable CDN URL, doğru cache.
- Büyük katalogda virtualization ancak ölçüm ihtiyaç gösterirse.
- Full preview tek modal; offscreen motion durur, grid statik.
- Reduced-motion desteklensin. Kaynak: [W3C etkileşim animasyonu](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).
- Upload MIME/byte/pixel sınırı, SVG sanitizasyonu veya raster export,
  HTTPS/origin politikası ayrı kontrol. Sadece URL şema validasyonu
  içerik/lisans/SVG güvenliği kanıtı değildir.

## 9. Branch Planı (Henüz Oluşturulmadı)

1. codex/cosmetic-full-art-v2: V1'i koruyan renderer, tek geometry, gerçek
   ön/arka preview ve authoring fixture'ları. DB variant migration yok.
2. codex/cosmetic-collections-and-variants: parent/variant/collection,
   backward-compatible migration, admin authoring, slot eşleşmesi,
   entitlement ve iade/kuşanma yarış testleri.
3. codex/store-collection-merchandising: koleksiyon vitrin/swatch/detail,
   paged catalog/search, ownership/price states. Seti tamamla ayrı karar.
4. codex/profile-showcase-and-earned-badges: minimal public DTO, rozet tanımı,
   idempotent grant, showcase ve abuse/privacy kontrolleri.

Her branch başında kapsam onayı. İlk gate yeni art + okunurluk; daha fazla
ürün/satış özelliği bu bozukluğu örtemez.

## 10. Test Sonuçları ve Açık İşler

Geçenler: shop-items schema, cosmetic-authoring preset, card-face,
card-back, inventory-core kontrat testleri.

**Mevcut cosmetic-render-upgrade testi başarısız:** script kaynak içinde
'Daha fazla göster' literal'ini arıyor; UI artık t('shop.showMore') /
t('inventory.showMore') kullanıyor ve metin dictionary'de. Assertion yeni
i18n kontratına uyarlanmalı; bu sonuç tek başına grid davranışının bozuk olduğunu
kanıtlamıyor. Runtime dosyaları ve test bu arşiv commit'inde değiştirilmedi.

Prototip session 10/10; kopya HTTP testi, syntax ve browser smoke sonuçları
[prototip test notlarında](../../scripts/design-prototypes/hushle-streamer-studio/test-notes.md).
Ayrı gerçek ödeme/refund/DB integration veya production build yapılmadı.
Bu rapor 'kusursuz ödeme' ya da production-ready sertifikası değildir.

Kabul checklist'i:
- TR/EN en uzun başlık + 5 yasaklı, 320px telefon, zoom, açık/koyu tema.
- Tüm renklerde kontrast; metin üzerindeki dekor ve ikonda çift çizim yok.
- Shop/admin/preview/gameplay aynı yüz ve geometri.
- Eski render snapshot ve bilinmeyen spec güvenli fallback.
- Parent sahip değilken variant equip, yanlış parent/slot, stale variant reddi.
- Duplicate satın alma/grant, eşzamanlı equip/refund, removed asset fallback.
- Katalog büyük fixture, ağ payload/decode/DOM/motion ölçümü.
- Public rozet/profil DTO'sunda güvenlik mantığı veya hassas kimlik yok.

## İlgili Planlar

- [Authoring spec](./cosmetic-authoring-spec.md)
- [Kozmetik uygulama planı](./cosmetics-implementation-plan.md)
- [Kart tasarım rehberi](../guides/card-design-guide.md)
- [Store/liveops ayrımı](../guides/store-liveops-strategy-guide.md)
- [Yayıncı prototipi](../../scripts/design-prototypes/hushle-streamer-studio/README.md)

Yeni kararlar gelecekte bu belgelerle birlikte ele alınır; mevcut render
spec sessizce V2 oldu diye yorumlanmaz.
