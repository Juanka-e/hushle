# Web Multiplayer Açılış Kontrolü

> Durum: disposable DB kullanan otomatik CI kapısı
> Kapsam: dört guest oyuncunun 2+2 takım, lobby ve oyun senkronu

## Amaç

Tek sayfa smoke testleri Socket.IO oda durumunun oyuncular arasında doğru
yayınlandığını kanıtlamaz. Bu kapı izole browser context'leri açar ve gerçek UI
üzerinden aşağıdaki akışı çalıştırır:

1. host guest adıyla oda oluşturur
2. ikinci guest oda koduyla katılır
3. iki oyuncuyla başlatma kapalı kalır
4. iki ek guest katılır ve takımlar 2+2 oyuncuya ulaşır
5. host ve guest sayfaları sırayla reload edilir
6. iki oyuncunun player kimliği korunur ve duplicate lobby kaydı oluşmaz
7. host yetkisi geri gelir ve bekleyen otomatik devir kapanır
8. kategori ve zorluk fixture'ı lobby'ye gelir
9. host oyunu başlatır
10. iki oyuncu ilk hazırlık ekranını görür
11. host hazırlığı durdurur ve guest durumu senkron görür
12. mobil guest viewport'unda yatay taşma olmadığı doğrulanır
13. hazırlık tamamlanınca aktif oyundaki guest reload edilir ve lobby yerine
    rol/kart yetkileri korunmuş oyun ekranına döner
14. mobil host oda oluşturur ve ayrı desktop guest aynı oda koduyla katılır
15. mobil guest Takım A ve Takım B panellerini ayrı ayrı açar ve kapatır

## Fixture Yaşam Döngüsü

`scripts/test-web-multiplayer-launch.ts` yalnız
`WEB_LAUNCH_DB_E2E=true` ve `tabu_test` veritabanında çalışır.

- benzersiz bir görünür kategori ve dört kelime ekler
- Chromium ve WebKit projelerini tek worker ile çalıştırır
- rate limit'i kapatmaz; aynı IP'deki iki motorun meşru reconnect istekleri için
  yalnız test sürecinde `ROOM_JOIN_MAX_ATTEMPTS=100` varsayılanını kullanır
- başarılı veya başarısız sonuçtan bağımsız `finally` içinde kelime ve
  kategoriyi siler
- migration, database reset veya volume silme çalıştırmaz

Yerel Docker/MySQL kapalıysa komut açıkça skip olur. CI disposable MySQL
üzerinde akış zorunludur.

## Komutlar

```powershell
npm run test:web-multiplayer-contract
npm run test:web-multiplayer
```

İki komut da `npm run test:web-launch-readiness` zincirine bağlıdır.

## Bilinçli Sınırlar

- maç tamamlanmaz ve ödül finalize edilmez
- coin/XP sonucu üretilmez
- lobby ve aktif oyun reload reconnect kapsam içindedir; timeout ile tamamlanan otomatik
  host handoff ve dört kayıtlı oyuncu senaryosu kapsam dışındadır
- Chromium ve WebKit otomasyonu fiziksel cihaz kanıtı değildir
- gerçek touch, sanal klavye ve cihaz performansı manuel smoke turunda kalır
