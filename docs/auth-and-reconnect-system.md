# Tabu Online - Auth, Misafir ve Yeniden Bağlanma (Reconnect) Mimarisi

Bu belge, oyunun "Kimlik Yönetimi (NextAuth)", "Misafir (Guest) Sistemi" ve "Kopma/Yeniden Bağlanma (Grace Period)" süreçlerini profesyonel endüstri standartlarına (AAA oyun altyapıları gibi) nasıl uyarladığımızı açıklamaktadır.

---

## 1. Misafir (Guest) Sistemi ve 30 Günlük Kalıcılık

Oyuncular için en kritik özelliklerden biri olan "Kayıt Olmadan Hızlıca Oyuna Girme" prensibi, performansı ve güvenliği sarsmayacak şekilde kurgulanmıştır.

- **Veritabanı Şişmesini Önleme:** Misafir oyuncular sisteme girdiklerinde veritabanına ("Guest123" gibi) kaydedilmezler. Bu sayede veritabanı kirliliği oluşmaz.
- **Kriptografik Token Mimarisi:** Bir oyuncu misafir olarak "Oyuna Katıl" dediğinde `crypto.randomUUID()` ile eşsiz bir ID yaratılarak bu ID'ye bağlı gizli bir **NextAuth JWT (JSON Web Token)** çerezi oluşturulur.
- **Güvenlik:** Kötü niyetli kullanıcıların Socket.IO üzerinden sahte `playerId` gönderip başka birinin yetkilerini (veya Admin taçını) çalması HTTPOnly çerezler ile imkansızlaştırılmıştır. Güvenlik %100 oranında sağlanmıştır.
- **30 Günlük Session Ömrü:** Misafir oturumlarının geçerlilik süresi (maxAge) `apps/web/src/lib/auth.ts` içinde **30 Gün** olarak belirlenmiştir. Bu sayede misafir kullanıcı sekmeyi / bilgisayarı kapatsa bile, çerezlerini manuel silmediği sürece 1 ay boyunca sistemde aynı profille duracak ve başarı veya takımlarını kaybetmeyecektir.

---

## 2. Pürüzsüz Katılım (Frictionless Join) ve Davet Linkleri

Bir kullanıcının, doğrudan oda URL'sini (`/room/AB123`) kopyalayıp WhatsApp veya Discord'dan arkadaşına atması senaryosu, pürüzsüz bir misafir akışına (*Frictionless Game Loop*) bağlanmıştır.

### Akış:
1. **Middleware Koruması:** Aktif bir oturumu (Token'i) olmayan kullanıcı tıklayıp oyuna girmek istediğinde, `middleware.ts` onu "Yetkisiz Erişim / Soket Hatası" yerine anında `/login?callbackUrl=/room/AB123` sayfasına fırlatır.
2. **Sekmeli (Tab) Giriş Ekranı:** Giriş sayfasında sadece "Kullanıcı" bölümü değil, varsayılan olarak **"Misafir"** alanı açılır.
3. **Akıllı Yönlendirme:** Kullanıcı odada gözükecek adını yazıp butona basar basmaz saniyesinde token'ini alır ve geldiği oda bağlantısına (`callbackUrl`) geri fırlatılarak odaya sokulur.

---

## 3. Akıllı Kullanıcı Adı Algılama (Smart Username Recognition)

URL davetleriyle gelen oyuncuların önüne, odaya düştüklerinde tekrar tekrar "Kullanıcı adı girin" penceresi çıkartılma hatası bu mimariyle çözülmüştür.

- **Tarayıcı Depolaması Sorunu:** Oyun odaları kullanıcı ismini önceden sadace tarayıcının yerel deposundan (`localStorage('tabu_username')`) arıyordu. Login sayfasından gelen çerezli misafirlerin local storage'i boş olduğundan oyuncuya ismi iki kez soruluyordu.
- **Akıllı Çözüm:** `apps/web/src/app/room/[code]/page.tsx` içinde yazılan "Smart Recognition" sayesinde sayfa açıldığında öncelik şifreli oturuma (NextAuth `session.user.name`) verilir. Sistem kullanıcının paketindeki ismi görürse, **bir pop-up sormadan**, ismi usulca arka planda `localStorage`'a yazıp oyuncuyu anında lobilere ışınlar.

---

## 4. State Preservation (Durum Koruma) ve Reconnect Mimarisi

Sistem, "Kısa süreli anlık koptum" ve "Oyunu tamamen kapattım gittim" durumlarını çok iyi ayırt edecek şekilde kodlanmıştır.

### 15 Saniyelik Oyuncu Bekleme Süresi (`PLAYER_TIMEOUT_MS`)
Eğer bir oyuncu oyundayken **F5 (Yenile) yaparsa**, sekmeyi alta alırsa veya interneti saniyelik koparsa;
- **Sistemden Silinmez:** `game-socket.ts` oyuncunun bağlantısının koptuğunu anlar ama diziden oyuncuyu atmaz, puanını veya takımını bozmaz. Sadece diğer oyunculara o ismin yanına "Çevrimdışı (Offline)" ikonu basar.
- **Anında Reconnect:** Oyuncu saniyeler içinde sekmeyi geri yüklediğinde, JWT sayesinde anında kaldığı takıma / süre akışına geri oturur.
- **15 Saniye Çöp Kutusu:** Ancak oyuncu sekmeyi kapatıp yemeğe giderse, odada "Hayalet (Phantom)" olarak sonsuza dek kalmaması (ve sunucu belleğini şişirmemesi) için 15 saniyelik "Grace Period" (Mühlet Süresi) işler. 15 saniye içinde geri dönmeyenler odadan kalıcı olarak çöpe atılır.
- Bu ayar `.env` dosyasındaki `PLAYER_TIMEOUT_MS=15000` kısmından istenildiği gibi saniye bazında kısaltılıp uzatılabilir.

### 3 Dakikalık Kurucu (Yönetici) Bekleme Süresi (`ADMIN_TIMEOUT_MS`)
Oda kurucusunun (Taç / 👑 sahibi) düşmesi oyunu kitlemesin diye ona özel 3 dakika (`ADMIN_TIMEOUT_MS=180000`) bekleme süresi verilmiştir.
- Yönetici koparsa odayı bozmamak için 3 dakika beklenir.
- 3 dakika içinde dönerse (ördek gibi farklı bir soket ID'si ile gelse bile) gerçek JWT'sinden tanınarak "Taç" anında ona geri iade edilir.
- Yönetici 3 dakikada dönmezse, sistem odadaki ilk müsait oyuncuya yöneticilik (Host) yetkilerini devreder.
