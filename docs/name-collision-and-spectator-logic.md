# İsim Çakışmaları, Kimlik Güvenliği ve Gözlemci (Spectator) Akışı

Bu belge, Tabu Online projesinde oyuncuların isim alma mantığı ile oyunun ortasında odaya dahil olan (Geç Katılan/Spectator) kişilerin nasıl yönetildiğini açıklamaktadır. Proje, özellikle sesli sohbet (Discord vb.) eşliğinde arkadaş gruplarının eğlenmesi üzerine kurgulandığı için bu dinamikler esnek tutulmuştur.

---

## 1. Aynı İsimde Giren Oyuncular (Nickname Collisions)

Başlangıçta oyuna giren bir oyuncu ("Ahmet"), içeride halihazırda bulunan başka bir "Ahmet" ile aynı ismi aldığında, sistemin kafası karışmasın ve chat/loglar temiz kalsın diye yanına otomatik bir numara ekliyorduk ("Ahmet 1"). Ancak oyun genellikle sesli ve tanıdık gruplarla oynanacağından, bu katı kural esnetilmiştir.

### Karar ve Mimari:
- **Tam Özgürlük:** Artık 10 kişi bile aynı anda "Ahmet" adıyla (veya sadece "." koyarak) odaya girebilir. Sistem "Bu isim alınmış" demez veya yanına "1" koymaz.
- **Kusursuz Kimlik Ayrımı (PlayerID):** Ekranda 10 tane Ahmet yazsa bile, arka planda (game-socket.ts) sunucu hiçbirisini birbirine karıştırmaz.
    - Bunun sebebi; herkesin oyuna dahil olduğu o ilk "Misafir / Login" sayfasında kendisine özel ve değişmez bir **JWT Token (UUID)** atanmasıdır.
    - Sunucu `Ahmet` isimlerine göre değil, `uuid-xxxx-yyyy` şeklindeki gizli ID'lere göre puan ekler, takımlara böler ve taç ataması yapar. Kimin anlattığını oyun içi sıradan ve UUID'sinden bilir.

---

## 2. Oyun Ortasında Girenlerin Durumu (Mid-Game Spectator Flow)

Oyun halihazırda başlamışken (turlar dönüyorken) WhatsApp'tan linke tıklayıp gelen bir arkadaşınız olduğunda, oyun onu bozmadan bir seyirciye dönüştürür.

### Nasıl Çalışıyor?
1. **Oyun İçi Senkronizasyon (yeniTurBilgisi):** 
    - Geç katılan kişi (`currentPlayerRef.rol = "İzleyici"`) odaya ve Socket'e bağlandığı o milisaniyede, sunucu oyunun neresinde olduklarını kontrol eder.
    - Sunucu anında o kişiye özel bir `yeniTurBilgisi` paketi fırlatır.
2. **Kriptografik Körlük (Hile Koruması):**
    - Sistem sadece "Anlatıcı" ve "Gözetmen" rolünde olan kişilere kelimeyi (kart bilgisini) gönderir.
    - Yeni gelen kişi `İzleyici` (veya `Tahminci`) statüsünde olduğu için, sunucu ona gönderdiği paketin içine kart verisini bilerek koymaz (`kart: null`).
    - Tur ortasında anlatıcı kart değiştirdiğinde (`kartGuncelle`) de aynı kural geçerlidir: kartı yalnız anlatıcı, gözetmen ve karşı takımın oyuncuları alır; `İzleyici` rolündeki hiç kimse almaz (`lib/socket/card-visibility.ts` içindeki `shouldPlayerSeeCard`, `scripts/test-card-visibility.ts` ile sözleşmeye bağlıdır).
3. **Akıcı Arayüz:**
    - Giren kişi kelimeyi hiçbir şekilde göremez. Ekranda sadece "**[Şu An Anlatan Kişi] kelimeyi anlatıyor. Doğru cevabı bulmaya çalış!**" ekranını (Guessing Screen) görür.
    - Bu sayede oyunu bozmadan dışarıdan izler, chatten tahminde bulunabilir ve bir sonraki "Yeni Tur" başlangıcında sistem onu otomatik olarak takımlara dağıtır.

---

Bu esnek mimari sayesinde, hem kullanıcı hüsranı (friction) sıfıra indirilmiş hem de arka ucu %100 güvenli (Kimse başkasının yerine geçemez, kimse gizlice kartlara bakamaz) bir altyapı oluşturulmuştur.
