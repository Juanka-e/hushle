# Web Gerçek Cihaz Smoke

> Branch: `feature/web-real-device-responsive-smoke`
> Amaç: emülasyonun kapsamadığı gerçek iOS, Android ve laptop davranışlarını
> kayıt altına almak

## Sınır

Bu akış bir otomatik CI testi değildir. Playwright cihaz emülasyonu başarılı
olsa bile gerçek iOS Safari, Android Chrome, sanal klavye, safe-area, adres
çubuğu ve dokunma davranışı için fiziksel cihaz kanıtı gerekir.

Bir cihaz üzerinde sayfayı açabilmek tek başına fiziksel cihaz kanıtı değildir.
Kontrol listesi tamamlanmalı ve sonuç şablona kaydedilmelidir.

## Ön Koşullar

- bilgisayar ve telefon aynı özel ağda olmalı
- kullanılacak LAN IPv4 adresi bilinmeli
- production build hazır olmalı
- mevcut yerel MySQL ve gerekiyorsa Redis ayakta olmalı
- test sırasında güvenlik duvarında yalnız seçilen özel ağ erişimine izin
  verilmeli

Bu komut veritabanını sıfırlamaz, migration çalıştırmaz ve Redis'i kapatmaz.
`docker compose down -v` kullanılmaz.

Kalıcı development veritabanında kategori/kelime yoksa fiziksel gameplay
smoke'u için geçici fixture hazırlanabilir. Komut yalnız adı `_dev` veya
`_test` ile biten MySQL veritabanında ve açık izin bayrağıyla çalışır:

```powershell
$env:REAL_DEVICE_FIXTURE_ALLOWED="true"
npm run smoke:web-real-device-fixture -- prepare
npm run smoke:web-real-device-fixture -- status
```

Smoke oturumu bitince yalnız rezerv fixture prefix'ini temizler:

```powershell
npm run smoke:web-real-device-fixture -- cleanup
```

Bu akış database reset, migration veya genel seed çalıştırmaz.

## Sunucuyu Açma

Önce build:

```powershell
npm run build
npm run test:web-webkit
npm run test:web-real-device-server
```

WebKit komutu motor seviyesindeki public kontrolleri çalıştırır ancak fiziksel
cihaz kanıtı değildir. Son komut production sunucusunun özel LAN IPv4 üzerinde HTTP 200 verdiğini
otomatik doğrular ve CI launch-readiness zincirinde de çalışır. Fiziksel cihaz,
touch veya gerçek browser kanıtı üretmez.

Windows üzerinde LAN IPv4 adresini görmek için:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { -not $_.IPAddress.StartsWith("127.") }
```

Örnek olarak bilgisayar adresi `192.168.1.20` ise:

```powershell
$env:REAL_DEVICE_BASE_URL="http://192.168.1.20:3202"
npm run smoke:web-real-device-server
```

Telefon tarayıcısında aynı origin açılır:

```text
http://192.168.1.20:3202
```

`REAL_DEVICE_BASE_URL` cihazın erişebildiği RFC1918 özel LAN IPv4 origin'i
olmalıdır. `localhost`, `127.0.0.1`, public IP/hostname, HTTPS, portsuz URL,
1024 altı port, path, query veya kullanıcı bilgisi kabul edilmez. Sunucu tüm
ağ arayüzlerini dinlediği için test sonunda kapatılmalı ve herkese açık bir
ağda çalıştırılmamalıdır.

## Minimum Cihaz Matrisi

1. küçük ekranlı iPhone üzerinde iOS Safari
2. güncel Android telefon üzerinde Android Chrome
3. telefonun yatay yönü
4. 1366x768 veya yakın boyutta laptop tarayıcısı

Her satır için
`docs/evidence/web-real-device-smoke-template.md` ayrı kopya olarak
doldurulmalıdır. Dosya adı tarih, cihaz ve kısa release SHA içermelidir.

## Kontrol Akışı

- ana sayfa aksiyonları taşmadan görünür ve tıklanabilir
- login ve kayıt input'ları sanal klavye açıkken erişilebilir
- duyuru, tema, kurallar ve kullanıcı menüleri açılıp kapanabilir
- dashboard geçişlerinde yatay taşma veya engelleyici sıçrama yok
- oda oluşturma ve guest katılım akışları çalışır
- lobby header, logo, oda kontrolleri ve oyuncu listesi taşmaz
- hazırlık ve oyun ekranında sayaç, kart ve sağ üst aksiyonlar erişilebilir
- dikey ve yatay yön değişiminden sonra layout toparlanır
- Socket.IO WebSocket bağlantısı ve oyun güncellemeleri devam eder
- toast, modal veya sheet kapatma aksiyonunun üstünü kapatmaz

Detaylı ürün akışı:
`docs/guides/gameplay-ui-polish-smoke-checklist.md`.

## Sonuç

- Kritik aksiyon erişilemiyorsa, oyun alanı kullanılamıyorsa veya bağlantı
  kopuyorsa sonuç `HOLD` olur.
- Yalnız kozmetik ve oyunu engellemeyen farklar ayrı issue ile kaydedilebilir.
- Her zorunlu cihazda sonuç `GO` olmadan gerçek cihaz kapısı tamamlanmış sayılmaz.
- Bu branch yalnız harness ve kanıt standardını hazırlar; doldurulmamış şablon
  testin geçtiği anlamına gelmez.
