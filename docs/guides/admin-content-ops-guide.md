# Admin Content Ops Guide

Bu rehber `fix/admin-content-ops` branch'i için kapsam ve karar çizgisini tanımlar.

## Branch Amacı

Admin içerik operasyonlarını daha okunur, daha compact ve daha az hata üretir hale getirmek.

Odak:
- duyuru player-facing render akışındaki duplicate hissi
- block count gibi oyuncuya anlamsız iç metadata'yı gizlemek
- duyuru admin yüzeyini daha derli toplu yapmak
- toplu kelime yükleme için kategori / alt kategori seçim akışlarını eklemek

## Bu Branch'te Yapılacaklar

### 1. Duyuru oyuncu görünümü
- oyuncuya duplicate metin hissi vermeyen compact kart dili
- expanded halde preview ile tam metin tekrarını tamamen kaldırmak
- oyuncuya block count göstermemek
- tarih ve meta bilgisini daha profesyonel konumlandırmak
- admin preview ile player render arasındaki farkı azaltmak

### 2. Duyuru admin operasyonu
- liste metadata'sını sadeleştirmek
- editor tarafında gereksiz yoğunluğu azaltmak
- blok modelini koruyup oyuncuya ham blok mantığını hissettirmemek
- preview panelinde oyuncuya yakın render kullanmak

### 3. Toplu kelime yükleme
- bulk upload için kategori seçimi
- varsa alt kategori seçimi
- mevcut CSV formatını kırıp sistemi bozmayacak bir geçiş modeli
- partial success / skipped / error raporunu görünür yapmak

## Uygulama Kararları

### Duyuru render kararı
- structured announcement modeli korunur
- oyuncuya block count veya iç blok sayısı gösterilmez
- collapsed kart görünümü tam içerik özeti göstermez
- collapsed kart yalnız:
  - başlık
  - `YENİ` / `SABİT`
  - versiyon
  - medya ipucu
  - sağ üst ikonlu tarih
  taşır
- expanded durumda tekrar preview metni gösterilmez; tam içerik ayrı açılır
- `YENİ` etiketi kalıcı değildir
- mevcut eşik: oluşturulma tarihinden itibaren 7 gün

### Duyuru editor limit kararı
- heading metni: `120`
- body / quote metni: `700`
- list item metni: `220`
- sınır aşıldığında save aşamasında hata vermek yerine editörde `maxLength` ile giriş durdurulur

### Bulk taxonomy kararı
- kategori / alt kategori bulk upload sırasında otomatik oluşturulmaz
- sebep:
  - typo ile taksonomi kirlenmesi
  - yanlış alt kategori açılması
  - audit ve veri kalitesinin bozulması
- profesyonel standart:
  - kategori önce kategori yönetiminden açıkça oluşturulur
  - bulk upload yalnız mevcut kategori isimlerine bağlanır

### Bulk upload modları
1. `csv_categories`
- her satır kendi kategori / alt kategori bilgisini taşır
- format:
  - `kelime,zorluk,kategori,alt_kategori,yasak1,yasak2,...`
- alt kategori yoksa ilgili sütun boş bırakılır

2. `fixed_categories`
- CSV sadece kelime ve yasaklı kelimeleri taşır
- kategori / alt kategori UI'dan bir kez seçilir
- tüm satırlara aynı atama uygulanır

### Duplicate ve hata davranışı
- aynı kelime zaten varsa tüm import düşmez
- o satır `skipped` olarak işaretlenir
- diğer geçerli satırlar eklenmeye devam eder
- hatalı satırlar ayrı raporlanır

### Kelime operasyonları kararı
- bulk upload için tek resmi giriş noktası `Kelime Yönetimi` ekranıdır
- eski `/admin/bulk-upload` sayfası artık `Kelime Yönetimi` ekranına yönlenir
- kelime seçim modeli tüm veritabanını değil yalnız görünen sayfayı seçer
- toplu silme için:
  - ikinci onay modalı zorunludur
  - CTA seçili kayıt sayısını açıkça taşır
  - `10+` kayıt siliniyorsa reason zorunludur
  - audit log'a adet, reason ve etkilenen kayıt örnekleri düşer

## Bu Branch'te Fiilen Eklenenler

### Duyurular
- player modal collapsed kartı sadeleştirildi
- duplicate içerik hissi kaldırıldı
- tarih sağ üst meta alanına taşındı
- `YENİ` etiketi 7 gün sonra kendiliğinden düşecek şekilde korundu
- admin preview paneli oyuncu kartına hizalandı
- editor limitleri:
  - heading `120`
  - body / quote `700`
  - list item `220`

### Kelime Yönetimi
- bulk upload modalı iki modlu hale getirildi:
  - `csv_categories`
  - `fixed_categories`
- partial success / skipped / errors raporu görünür oldu
- seçili kelimeler için bulk delete eklendi
- bulk delete sadece görünen sayfada çalışır
- büyük bulk delete için reason ve audit kaydı zorunlu hale getirildi
- eski sidebar bulk upload girişi kaldırıldı
- doğrudan eski URL kullanan akışlar `Kelime Yönetimi` sayfasına yönlenir

## Guardrail

- structured announcement modeli korunacak
- raw HTML girişi açılmayacak
- render zinciri yalnız izinli blok şeması üzerinden kalacak
- bulk upload tarafında SQL/string injection benzeri risk yaratacak serbest parser davranışlarına izin verilmeyecek
- kategori auto-create bulk upload içine gömülmeyecek

## Bu Branch'te Bilinçli Olarak Yapılmayacaklar

- coin grants archive lifecycle
- admin user IP observability
- night market
- economy abuse
- cache / Redis refactor
