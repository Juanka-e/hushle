# Redis Rollout

Redis burada sadece rate limit icin degil, coklu instance davranisini kontrollu sekilde buyutmek icin kullanilacak.

Temel ilke:

- local gelistirme Redis olmadan calismaya devam eder
- Redis production koordinasyonu icin devreye girer
- room state tek seferde degil, parca parca tasinir
- kritik oyun akisi tasinmadan once test ve guvenlik kontrolleri eklenir

Asama 1:

- dagitik request rate limit
- socket room join throttle
- Redis yoksa memory fallback

Asama 2:

- room presence ve aktif oda kaydi
- reconnect token / oyuncu geri donus koordinasyonu
- birden fazla instance arasinda duplicate join savunmasi

Asama 2 mevcut durum:

- authenticated kullanici icin server-side `userId -> roomCode` membership index eklendi
- authenticated dashboard girisinde aktif oda kontrolu `/api/user/active-room` uzerinden server-side okunuyor
- dashboard aktif oda baglamini room code + pending handoff bilgisiyle okuyup kullaniciya dogrudan "odana don" aksiyonu sunuyor
- Redis varsa TTL yenilenen dagitik kayit kullaniliyor
- Redis yoksa local memory fallback ile gelistirme akisi korunuyor
- Redis baglantisi gecici kesilirse cooldown sonrasinda process restart gerekmeden yeniden deneniyor
- ortam bazli key prefix ile development ve production anahtarlari ayriliyor
- `/api/health` Redis erisilebilirligini ve gecikmesini raporluyor
- join tamamlanamazsa membership claim temizleniyor
- socket disconnect sonrasinda kayit kontrollu sekilde serbest birakiliyor
- pending admin handoff metadata'si TTL ile takip ediliyor ve reconnect / manuel devir / timeout sonrasinda temizleniyor
- realtime instance kapasitesi 10 saniyelik heartbeat ve 30 saniyelik TTL ile yayinlaniyor
- cluster kapasite okumasi Redis `MGET`, stale registry temizligi ve local fallback kullaniyor
- admin kapasite karti oda, oyuncu, mac, spectator, socket, memory ve event-loop ozetini gosteriyor
- admission kontrolu reconnect'i koruyor; kritik yogunlukta yeni oda acmayi once kapatiyor

Asama 3:

- room event fan-out icin Redis adapter degerlendirmesi
- host/anlatici devri gibi zamanlama hassas state'lerin koordinasyonu
- match finalize ve reward akislarinda instance bagimsiz dogrulama

Asama 4:

- cache invalidation
- job / queue ihtiyaci cikarsa ayri kanal tasarimi
- operasyonel metric ve alarm esikleri

Guvenlik notlari:

- `TRUST_PROXY` acik degilse `x-forwarded-for` ve `x-real-ip` basliklarina guvenilmez
- socket ve HTTP IP cozumleme mantigi ayni helper uzerinden kalmali
- admin ve economy akislari Redis hata verse bile fail-open degil, kontrollu fallback veya sert hata karariyla ele alinmali

Hangi state hemen tasinmamali:

- tum `rooms` objesini dogrudan Redis'e koymak
- aktif oyun dongusunu tek adimda distributed hale getirmek
- test edilmeden reconnect mantigini instance'lar arasina yaymak

Redis'e tasinmasi uygun state:

- request rate limit sayaclari
- `userId -> roomCode` aktif oda membership kaydi
- pending admin handoff metadata'si
- kisa TTL room action lock'lari (`start-game`, `reset-game`, `game-control`, `transfer-host`, `shuffle-teams`)
- ileride gerekiyorsa invalidation anahtarlari ve kisa omurlu coordination lock'lari

Redis'e tasinmamasi gereken state:

- tam `RoomData` nesnesi
- socket'e bagli gecici UI state
- aktif turun anlik kart, sayac ve takim ici mikro gecis state'leri
- sadece tek process icinde anlamli olan `socket.id -> roomCode` index'i

Sartli tasinabilecek state:

- match finalize oncesi reward coordination verisi
- room-level presence ozeti
- event replay veya reconnect snapshot verisi

Sart:

- once veri semasi kucuk ve TTL tabanli olmali
- tek writer / coklu reader davranisi net tanimlanmali
- stale veri temizligi garanti edilmeli
- smoke test ve fallback davranisi hazir olmadan production koordinasyon state'i buyutulmemeli

Bir sonraki teknik hedef:

- reconnect ve host handoff akislarini instance bagimsiz ele almak
- authenticated room presence bilgisini istemci localStorage ipucundan daha az bagimli hale getirmek
- bunun uzerine coklu instance smoke testleri eklemek
- Socket.IO Redis adapter oncesinde heartbeat admission'i load test etmek
- ancak olculen overshoot gerekiyorsa atomik global seat reservation eklemek
