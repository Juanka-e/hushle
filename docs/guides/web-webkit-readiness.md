# WebKit Web Açılış Kontrolü

> Durum: otomatik CI kapısı
> Kapsam: WebKit motorunda public responsive yüzeyler ve kayıtlı kullanıcı akışı

## Amaç

Chromium cihaz emülasyonu tek browser motoruna bağlıdır. Bu kapı aynı ürün
yüzeylerini WebKit motorunda çalıştırarak motor kaynaklı layout, erişilebilirlik
ve temel navigation hatalarını PR aşamasında yakalar.

Bu test fiziksel iOS Safari kanıtı değildir. Gerçek cihazdaki Safari sürümü,
safe-area, adres çubuğu, sanal klavye, touch ve performans davranışı ayrıca
`docs/guides/web-real-device-smoke.md` ile doğrulanır.

## Projeler

`playwright.webkit.config.ts` üç proje çalıştırır:

| Proje | Test | Amaç |
| --- | --- | --- |
| `webkit-iphone-public` | `web-responsive.spec.ts` | iPhone viewport ve touch public yüzeyleri |
| `webkit-desktop-public` | `web-responsive.spec.ts` | desktop Safari benzeri public yüzeyler |
| `webkit-iphone-auth` | `web-launch-auth.spec.ts` | registered kullanıcı kayıt, login, dashboard ve lobby akışı |

Auth projesi yalnız `WEB_LAUNCH_DB_E2E=true` ile çalışır. CI disposable MySQL
üzerinde bu değeri zorunlu açar; yerel Docker kapalıyken test açıkça skip olur.

## Çalıştırma

İlk kurulum:

```powershell
npx playwright install webkit
```

Production build sonrasında:

```powershell
npm run test:web-webkit-contract
npm run test:web-webkit
```

Her iki komut `npm run test:web-launch-readiness` zincirine bağlıdır.

## Kabul Kriteri

- iki public projedeki sekiz responsive kontrol geçmeli
- CI disposable DB üzerinde tek WebKit registered akışı geçmeli
- test motoru eksikse veya WebKit başlatılamıyorsa kapı kırmızı olmalı
- fiziksel cihaz maddeleri WebKit emülasyonu sonucuyla kapatılmamalı
