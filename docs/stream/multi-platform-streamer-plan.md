# Çoklu Platform Yayıncı Sistemi Planı

Tarih: 8 Eylül 2026

Durum: Planlama raporu. Branch adları öneridir; oluşturulmuş veya tamamlanmış
branch anlamına gelmez. Bu raporun kaydedilmesi implementasyon onayı değildir.

## 1. Amaç ve Kapsam

Yayıncı modu Twitch'e özel bir Tabu uygulaması değil, farklı platformlardan
gelen etkileşimleri ortak oyun motoruna aktaran ayrı bir mod olmalıdır.
Normal maç kuralları, cüzdan ve coin korumalarıyla iç içe geçirilmemelidir.

İlk hedef: sınırlı yayıncı betası, tek platformlu oturum, Chat Challenge,
coin ödülü olmadan tam yayın ekranı ve OBS overlay desteği.
Ses veya video taşınmaz; dahili sesli sohbet ayrı ve ertelenmiş konudur.

Mevcut [teknik taslak](./online-tabu-streamer-mode.md) tasarım girdisidir.
İnteraktif genişleme sınırları şimdi tasarlanır; tüm özellikler şimdi yapılmaz.

## 2. Platform Kapsamı

| Platform | Entegrasyon yolu | Önerilen aşama |
| --- | --- | --- |
| Twitch | OAuth ve EventSub chat olayları | İlk sürüm |
| Kick | OAuth ve imzalı chat webhook'ları | İlk sürüm |
| YouTube | Canlı yayın sohbet API'si | İkinci aşama |
| TikTok | Resmi erişim ve izinler doğrulanacak | Yalnız mimari hazırlık |

Twitch `channel.chat.message` olaylarını destekler. OAuth izinleri ve taşıma
modeli gerçek uygulama türüne göre seçilmelidir. İlk sürümde chat'e mesaj
yazmak zorunlu değildir; gereksiz izin istenmez.
[Twitch yetkilendirme belgeleri](https://dev.twitch.tv/docs/chat/authenticating/).

Kick `chat.message.sent` olayını sunar. İmza, mesaj kimliği ve zaman damgası
doğrulanmalıdır. [Kick olayları](https://github.com/KickEngineering/KickDevDocs/blob/main/events/event-types.md),
[webhook güvenliği](https://github.com/kickengineering/kickdevdocs/blob/main/events/webhook-security.md).

YouTube `liveChatMessages.streamList` ile akan sohbet mesajları alınmasına
olanak verir. Kota, yetkilendirme ve yayın yaşam döngüsü adaptörde yönetilir.
[YouTube canlı sohbet API'si](https://developers.google.com/youtube/v3/live/docs/liveChatMessages).

Araştırmada TikTok'un açık geliştirici ürünleri içinde genel kullanıma açık
LIVE chat erişimi doğrulanamadı. Bu, özel ortaklık erişiminin bulunmadığı
iddiası değildir. Resmi erişim netleşmeden destek sözü verilmemeli;
gayriresmî bağlantı kütüphaneleri production temeli yapılmamalıdır.
[TikTok geliştirici ürünleri](https://developers.tiktok.com/).

Platform olanakları, onay süreçleri ve limitler ilgili adaptör branch'i
başlarken yeniden doğrulanmalıdır.

## 3. Yayıncı ve İzleyici Deneyimi

1. Yayıncı site hesabına giriş yapar.
2. Twitch veya Kick kanalını bağlar.
3. Kelime dilini ve kategorileri seçer.
4. Yayın ekranını açar veya OBS bağlantısını kopyalar.
5. Chat bağlantısı doğrulanınca oyunu başlatır.

İzleyicinin siteye kayıt olması gerekmez; yayın chat'ine tahmin yazar.
Birden fazla platform hesabı bağlanabilir fakat ilk sürümde her oturumda
tek platform aktiftir. Çoklu platform yarışı sonraya bırakılır.

| Ekran | İçerik |
| --- | --- |
| Özel yönetim ekranı | Hedef ve yasaklı kelimeler, pas, durdur/devam, bağlantı durumu |
| Tam yayın ekranı | Süre, puan, kazanan ve güvenli oyun durumu |
| Şeffaf OBS overlay | Güvenli yayın verilerinin kompakt görünümü |

Hedef kelime public ekrana gönderilip CSS ile saklanmaz. Public HTTP/socket
yanıtı, başlangıç HTML'i ve reconnect verisi de bu bilgiyi taşımamalıdır.
Overlay bağlantısı yalnız izleme yetkili, iptal edilebilir anahtar kullanır;
yönetim yetkisi veya platform token'ı taşımaz.

Arayüz TR/EN olabilir. Kelime paketi dili ayrı oturum ayarıdır; yayıncı veya
izleyicinin arayüz tercihi oyun içeriğinin dilini değiştirmez.

## 4. Mimari Sınırlar

```text
Platform API / olayları
        |
Platform adaptörü
        |
Doğrulama ve olay normalizasyonu
        |
Sınırlı kuyruk ve oturum yönlendirme
        |
Yayıncı oyun motoru
        |
Puan / sonuç / güvenli ekran verisi
```

- `domain-streamer`: durum makinesi, tahmin kuralları, puan ve sonuçlar.
- `platform-streaming`: OAuth, abonelik, webhook, bağlantı yenileme ve adaptörler.
- Web: yayıncı paneli, tam ekran ve overlay.
- API: yetkili işlemler ve webhook girişleri.
- Worker: uzun ömürlü chat bağlantıları ve olay işleme.

Bunlar önerilen mantıksal modüllerdir; mevcut repo yolları veya ayrı
mikroservislerin hazır olduğu anlamına gelmez. Yoğun chat işleme, normal
maçların zamanlayıcılarıyla aynı işlem döngüsüne bağlanmamalıdır.

Her adaptör desteklediği yetenekleri açıklar:

```text
chat.read
chat.write
polls
subscriptions
channel-points
gifts
moderation-events
```

Her platform her özelliği desteklemez. Desteklenmeyen işlemler UI'da
sunulmamalı; oyun motoru platforma özgü koşullarla doldurulmamalıdır.
Normalleştirilmiş olay kontratları sürümlenebilir olmalı; platform payload
değişiklikleri adaptör sınırında karşılanmalıdır.

## 5. Tahmin ve Adalet Kuralları

İlk mod Chat Challenge: yayıncı anlatır, chat bilir.

- İzleyici kimliği `platform + platformUserId` olur; isim görsel snapshot'tır.
- Aynı isimli iki platform hesabı otomatik olarak birleştirilmez.
- Hesap eşleştirme ancak iki hesabın sahipliği doğrulanırsa yapılır.
- Dil bazlı büyük/küçük harf ve boşluk normalizasyonu uygulanır.
- Alternatif doğru cevaplar kelime paketinde açıkça tanımlanır.
- İlk sürümde agresif yaklaşık eşleşme kullanılmaz.

Kazanan, sunucunun kabul ettiği ilk geçerli tahmindir. Farklı yayın ve olay
teslimat gecikmeleri nedeniyle dünyada ilk yazanı bulma garantisi verilmez.

Tur kapanışı atomik olmalı; aynı turda yalnız bir kazanan kaydı oluşmalıdır.
Tekrarlanan webhook ikinci puan üretmez. Geciken eski mesajlar yeni turu
kazandırmamalıdır. Yeniden bağlantıda gelen geçmiş mesajlar doğrudan yeni
tahmin kabul edilmez. Mesaj zamanı, tur sınırı ve kesinti sonrası kabul
politikası test edilebilir biçimde tanımlanmalıdır.

Çoklu platform aşamasında platform bazlı sıralama ve ortak eğlence skoru
önerilir. Milisaniyelik ortak yarışın platformlar arasında eşit olduğu
iddia edilmemelidir.

## 6. Redis, Kalıcılık ve Ölçek

Her chat mesajı SQL'e veya audit'e yazılmaz.

| Veri | Önerilen yer |
| --- | --- |
| Bağlı hesaplar ve şifrelenmiş token'lar | Kalıcı veritabanı |
| Oturum, tur sonucu ve puan kayıtları | Kalıcı veritabanı |
| Kısa süreli duplicate kontrolü | Redis |
| İşleme kuyruğu ve geçici olaylar | Sınırlı Redis Streams veya eşdeğeri |
| Canlı sıralama | Redis; kalıcı sonuçlardan yeniden kurulabilir |
| Yetki ve manuel skor değişiklikleri | Audit |
| Normal yanlış tahminler | Kalıcı kayıt yok |

- Webhook başarı yanıtı olay güvenilir işleme kuyruğuna alındıktan sonra verilir.
- Kuyruk sınırları, geri basınç ve Redis kalıcılık ayarları açıkça tanımlanır;
  yalnız Redis kullanmak sıfır veri kaybı garantisi değildir.
- Kuyruk dolması veya bağlantı kesintisi açıkça gösterilir; sessiz sonuç kaybı olmaz.
- Redis kaybında yeniden ödüllendirmeyi veritabanı tekillikleri de engeller.
- Ham mesajların kısa saklama süresi ve otomatik temizliği olur.
- Public ekrana bütün chat değil, değişen skor ve sonuçlar gönderilir.
- Aynı oturumu iki worker'ın eşzamanlı yönetmesi sahiplik mekanizmasıyla önlenir.
- Kanal başına olay hızı, kuyruk gecikmesi ve aktif oturum sayısı ölçülür.

## 7. Güvenlik ve Ekonomi

- Kanal bağlama mevcut site hesabına ayrı işlemdir; e-postayla sessiz birleştirme yok.
- OAuth `state`, gerektiğinde PKCE ve minimum scope uygulanır.
- Platform token'ları sunucuda şifreli saklanır; loglara ve overlay'e verilmez.
- Webhook imzası, replay, payload boyutu ve şema doğrulanır.
- Host komutları oturum sahipliği ve mevcut oyun durumuna göre doğrulanır.
- Chat ve kullanıcı isimleri HTML olarak çalıştırılmaz.
- Platform yetkisi iptal edilirse akış güvenli biçimde duraklatılır.
- Limitler uygun yerde kanal, platform kullanıcısı ve oturum kimliği üzerinden uygulanır.

Streamer puanı coin değildir. İlk sürümde izleyici skoru cüzdan, mağaza ve
cashout sisteminden ayrıdır. Ödül sonradan eklenirse merkezi reward katmanına
ayrı kaynak olarak bağlanır. Abonelik veya hediye başlangıçta tahmin puanını
artırmamalıdır.

## 8. İnteraktif Genişleme

| İlk sürüm | Sonraki seçenekler |
| --- | --- |
| Chat tahminleri | Kategori oylaması |
| Oturum sıralaması | Yayıncıya karşı chat |
| Pas ve süre | Chat takımları |
| Durdur/devam | Ortak hedef ve seri görevleri |
| Bağlantı durumu | Survival |
| Tam ekran ve overlay | Çoklu platform katılımı |

Etkileşimler izin verilen aksiyonlar olarak modellenir: oy verme, görsel
efekt veya sonraki kategoriyi seçme gibi. Admin panelinden rastgele script
çalıştırılan genel otomasyon motoru yapılmaz. Hediye, abonelik ve kanal puanı
entegrasyonları ayrı kapsam, moderasyon ve ekonomi değerlendirmesi gerektirir.

## 9. Önerilen Branch Sırası

1. `feature/streamer-domain-foundation`: durum makinesi, kimlikler, tahmin,
   duplicate ve yarış testleri; sahte platform adaptörü.
2. `feature/streamer-private-public-surfaces`: panel, overlay, TR/EN,
   responsive tasarım ve public veri sızıntısı Playwright testleri.
3. `feature/streamer-twitch-adapter`: gerçek OAuth, chat, reconnect ve
   yetki iptali kabul testleri.
4. `feature/streamer-kick-adapter`: imza, replay, tekrar teslim ve kesinti testleri.
5. `test/streamer-beta-readiness`: gerçek yayın, yoğun mesaj yükü,
   worker/Redis restart, çift doğru cevap, token süresi ve overlay anahtarı yenileme.
6. Sonraki bağımsız işler: YouTube, oylama, takım modu; resmi erişim
   netleşirse TikTok.

Her branch başlamadan kapsam onaylanır. Gerçek platform kabulü yapılmadan
yalnız mock veya Playwright başarısıyla production hazır denmez.
