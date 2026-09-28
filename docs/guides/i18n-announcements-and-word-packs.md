# i18n, Duyuru ve Kelime Paketi Rehberi

## Kapsam

Web istemcisi ilk aşamada yalnız `tr` ve `en` arayüz dillerini destekler. Yeni
bir dil, sözlük anahtarları tamamlanmadan desteklenen locale listesine eklenmez.
Admin operasyon ekranlarının dili Türkçe kalabilir; oyuncuya açık ana akışlar
aynı sözlük kontratını kullanır.

Oyuncuya açık dashboard, envanter, mağaza, hesap ayarları, bildirim, destek,
hesap kurtarma ve checkout yüzeyleri de `tr|en` sözlüğünü kullanır. API/socket
katmanındaki serbest metin hataları yeni geliştirmelerde çoğaltılmamalı; istemci
tarafından locale'e çevrilen kararlı hata kodlarına geçiş geriye uyumlu ve
endpoint bazlı yapılmalıdır.

Arayüz dili ve oyun içeriği dili birbirinden ayrıdır:

- arayüz tercihi `hushle_locale` cookie/localStorage değeriyle saklanır;
- aynı tarayıcıdaki sekmeler `storage` olayıyla senkronize olur;
- oda kelime dili `RoomSettings.wordLocale` alanıdır ve sunucu otoritesindedir;
- yalnız oda yöneticisi lobide kelime dilini değiştirebilir;
- oyun başladıktan sonra kelime dili değiştirilemez;
- eski istemci alanı göndermezse güvenli varsayılan `tr` olur.

## Duyuru Modeli

`announcements` kaydı yayınlama, sabitleme, tip, medya ve tarih gibi dil bağımsız
verileri taşır. Metinler `announcement_translations` içinde `(announcement_id,
locale)` tekilliğiyle tutulur. Bu model her yeni dil için kolon ekleme ihtiyacını
ortadan kaldırır.

- Türkçe içerik zorunludur.
- İngilizce içerik isteğe bağlıdır.
- İngilizce eksikse public API Türkçe içeriğe döner.
- `guncelleme`, `duyuru` ve `sss` aynı güvenli yayın akışını kullanır.
- İçerik ham HTML olarak kabul edilmez. Başlık, paragraf, alıntı, liste ve ayraç
  gibi doğrulanan bloklar kullanılır.
- Medya mevcut URL allowlist/sanitizer, admin oturumu, rate limit ve audit
  sınırlarını korur.
- Duyuru okuma ve admin yazma limitleri Redis varsa instance'lar arasında ortak,
  Redis yoksa process-local güvenli fallback ile çalışır.
- Medya URL'si 2048 karakterle sınırlıdır; YouTube adresi doğrulanmış tek video
  kimliğine normalize edilir ve serbest embed path/query parametreleri korunmaz.
- Oyuncu modalı ve admin önizlemesi ayrı tema state'i tutmaz. Kök
  `next-themes` provider'ının `dark` sınıfını izler; açık/koyu tema düğmesi
  duyuru yüzeyini de aynı render döngüsünde günceller.

Kopyalanan referans sistemdeki TipTap/raw HTML ve process-local rate limit
doğrudan alınmadı. Mevcut yapılandırılmış blok editörü daha dar XSS yüzeyi ve
daha öngörülebilir mobil render sağladığı için korundu. Referans sistemden üç
sekme yaklaşımı, FAQ akışı ve çift dil editör deneyimi alındı.

Ödeme hukuki belgelerinin TR/EN gövdeleri aynı readiness ve sürüm kapısını
kullanır. Hukuki anlamı değiştiren çeviri revizyonunda ilgili belge sürümü
artırılmalı ve production ödeme açılmadan önce iki dil de hukuk kontrolünden
geçmelidir.

## Kelime Paketleri

`words.locale` ve `categories.locale` alanları paket sınırıdır. Kelime tekilliği
global değil `(locale, wordText)` bazındadır; aynı yazım farklı paketlerde
bulunabilir.

Türkçe ve İngilizce için ayrı fiziksel tablolar oluşturulmaz. Bütün diller tek
`words`, `taboo_words`, `categories` ve `word_categories` modelini paylaşır;
paket ayrımı indeksli `locale` alanıyla yapılır. Bu sayede onuncu dil de yeni bir
tablo veya kolon migration'ı gerektirmez. Dil başına ayrı tablo kullanmak CRUD,
istatistik, audit, import ve socket sorgularını her dilde çoğaltacağı için
yasaktır.

Desteklenen oyun içeriği dilleri `@hushle/domain-game` paketindeki
`GAME_CONTENT_LOCALES` ve `GAME_CONTENT_LOCALE_DEFINITIONS` kayıtlarından gelir.
Arayüz dili kayıt listesiyle aynı olmak zorunda değildir. Örneğin oyuncu İngilizce
arayüz kullanırken odada Türkçe kelime paketi seçebilir.

### Admin paket iş akışı

- kategori ve kelime ekranlarında önce aktif paket seçilir;
- listeleme, arama, düzenleme, silme ve sıralama yalnız seçilen `locale` içinde
  çalışır;
- her dilin kategori ağacı ve `sortOrder` değerleri bağımsızdır;
- tekli kelime ekleme/düzenleme seçilen paketin kategorilerini kullanır;
- sabit kategori ve CSV-kategori toplu yükleme modları seçilen `locale` değerini
  API'ye taşır;
- tek import en fazla 2 MB ve 1000 veri satırıdır; kelime/yasaklı kelime alanları
  veritabanı uzunluklarıyla uyumlu biçimde sunucuda doğrulanır;
- geçersiz locale sunucuda reddedilir; bilinmeyen değer sessizce Türkçe pakete
  yazılmaz;
- aynı kelime farklı dillerde bulunabilir, fakat aynı dilde ikinci kez eklenemez;
- bir kelimenin ana metni, yasaklı kelimeleri, zorluğu ve kategorileri diğer
  dillerden bağımsızdır. Birebir çeviri zorunlu değildir.

Lobide yönetici kelime dilini değiştirdiğinde önce eski kategori seçimi ve oda
kelime havuzu temizlenir. Sunucu yeni locale'in görünür kategorilerini
`sortOrder` ile getirir ve sonraki kelime SQL sorgularına oda `wordLocale`
filtresini zorunlu olarak ekler. Böylece eski kategori ID'leri veya başka dildeki
kelimeler istemci manipülasyonuyla oyuna taşınamaz.

### On dile büyüme

Üçüncü dil eklenirken merkezi oyun içeriği locale kayıtlarına kod, yerel ad,
admin etiketi ve `Intl` locale değeri eklenir. Admin seçicileri, lobi seçicisi,
Zod doğrulamaları ve locale'e duyarlı metin normalizasyonu aynı kayıttan beslenir.

İçerik operasyonu büyüdüğünde aşağıdakiler ayrı bir migration ile eklenebilir:

- paket bazında `draft`, `review`, `published`, `disabled` yayın durumu;
- minimum yayınlanabilir kategori/kelime sayısı ve paket hazırlık raporu;
- CSV/JSON dışa aktarma, dry-run import ve satır bazlı hata raporu;
- isteğe bağlı `conceptGroupId` ile diller arası karşılıkları editörde yan yana
  gösterme;
- çevirmen/reviewer rolü ve içerik revizyon geçmişi.

`conceptGroupId` yalnız editör yardımı ve raporlama içindir. Bir kelimenin başka
bir dilde birebir karşılığı olmayabilir; bu nedenle eksik karşılık oyunu veya
paket yayınını otomatik olarak engellemez.

Sunucu kontrolleri:

- kelime yalnız aynı locale kategorilerine bağlanabilir;
- parent/child kategoriler aynı locale içinde kalır;
- kategori taşıma/silme iki dil arasında yapılamaz;
- reorder isteği locale taşır ve yalnız o paketin köklerini kapsar;
- socket başlangıcında kategori ID'leri odanın locale görünür listesine göre
  yeniden doğrulanır;
- locale değişince eski kategori seçimi ve kelime havuzu temizlenir.

İngilizce paket boş olabilir. Bu durumda oyuncuya boş kategori durumu gösterilir
ve kategori olmadan oyun başlatılamaz; Türkçe kelimeler sessizce karıştırılmaz.

## Yeni Dil Ekleme

1. Kelime paketi için `GAME_CONTENT_LOCALES` ve locale tanım kaydını genişlet.
2. Arayüz de bu dili destekleyecekse ayrıca `SUPPORTED_LOCALES` ve sözlükteki tüm
   anahtar kontratını genişlet; kelime paketi eklemek bunu zorunlu kılmaz.
3. Duyurular bu dile çevrilecekse admin çeviri sekmesini ve fallback sırasını ekle.
4. Kelime/kategori import, reorder, taşıma ve socket testlerini yeni locale ile çalıştır.
5. Web ve gelecekteki mobile API locale sözleşmesini aynı sürümde yayınla.

`wordLocale` additive socket alanıdır. Eski istemciler Türkçe varsayılanla
çalışır. Desteklenen değerleri veya event semantiğini kıran değişiklikte socket
protokol sürümü artırılmalıdır.

## Test Kapıları

- `npm run test:i18n-content-locales`
- `npm run test:i18n-content-locales-integration`
- `npm run test:announcement-security`
- `npm run test:announcement-structure`
- `npm run test:domain-game`
- `npm run test:room-socket-security`
- `npm run typecheck:web`
- `npm run build`

Migration gerçek MySQL test veritabanında uygulanmalı; mevcut duyuru sayısı ile
backfill edilen Türkçe translation sayısı karşılaştırılmalıdır.
