# Web Responsive Cihaz Matrisi

> Durum: PR #85 ile tamamlandı
> Kapsam: ilk web açılışının otomatik viewport ve touch emülasyon kapısı

## Otomatik Profiller

`playwright.responsive.config.ts` aşağıdaki Chromium profillerini çalıştırır:

| Profil | Boyut | Amaç |
| --- | --- | --- |
| small-phone | iPhone SE descriptor | dar telefon ve touch yerleşimi |
| modern-android | Pixel 7 descriptor | güncel uzun telefon |
| phone-landscape | 844x390 | kısa dikey alan ve yatay kullanım |
| tablet | iPad Mini descriptor | tablet breakpoint geçişleri |
| laptop | 1366x768 | yaygın laptop viewport'u |

iPhone/iPad descriptor'ları viewport, user agent, touch ve device scale
bilgisi için kullanılır. Test motoru CI'da tek ve deterministik Chromium'dur;
bu test Safari/WebKit uyumluluk kanıtı değildir.

WebKit motoru için ayrı otomatik kapı:
`docs/guides/web-webkit-readiness.md`.

## Çalıştırma

Production build sonrasında:

```bash
npm run test:web-responsive
```

Komut ayrıca `npm run test:web-launch-readiness` zincirine bağlıdır ve PR CI
kapısında çalışır.

## Otomatik Kabul Kriterleri

Her profilde:

- document seviyesinde yatay taşma olmamalı
- login, kayıt, duyuru ve tema aksiyonları viewport içinde kalmalı
- nickname, login ve kayıt input'ları kullanılabilir olmalı
- birincil aksiyonların hedef alanı en az 24x24 px olmalı
- guest room prompt viewport içinde kalmalı
- duyuru modalı kapatma ve sekme aksiyonları erişilebilir kalmalı

Disposable MySQL E2E ayrıca 390x844 viewport'ta:

- kayıt
- login
- dashboard
- `Oyna` sekmesi
- kayıtlı oda oluşturma
- lobby

akışında document seviyesinde yatay taşma olmadığını doğrular.

## Bilinçli Sınırlar

Emülasyon aşağıdakileri kanıtlamaz:

- gerçek iOS Safari/WebKit render farkları
- Android Chrome adres çubuğu ve dinamik viewport davranışı
- sanal klavye açıldığında input/modal yerleşimi
- notch, safe-area ve cihaz üreticisi özel davranışları
- düşük performanslı cihazda animasyon akıcılığı
- gerçek touch gecikmesi, scroll ve gesture hissi

Bu maddeler fiziksel cihaz smoke turunda manuel olarak kapanır.
Kurulum ve kanıt standardı:
`docs/guides/web-real-device-smoke.md`.

## Fiziksel Cihaz Kanıtı

En az:

1. küçük ekranlı bir iPhone veya iOS Safari
2. güncel Android Chrome
3. yatay telefon
4. 1366x768 laptop

üzerinde `docs/guides/gameplay-ui-polish-smoke-checklist.md` uygulanmalıdır.
Sonuçta cihaz/OS/browser sürümü, tarih, test edilen release SHA ve bulunan
blocker kaydedilmelidir.

## Go/Hold Kuralı

- Otomatik matris kırmızıysa `GO` verilemez.
- Fiziksel cihazda kritik aksiyon kapanıyor veya yatay taşma oyunu engelliyorsa
  sonuç `HOLD` olur.
- Yalnız kozmetik ve oyunu engellemeyen küçük farklar ayrı blocker kaydıyla
  değerlendirilebilir.
