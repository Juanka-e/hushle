# Central Observability Foundation

Bu katman web, API ve jobs runtime'larinda ayni guvenli event kontratini kullanir.
Amaci uygulama davranisini audit tablosuna yigmadan merkezi hata servisine veya
log collector'a tasinabilecek standart bir cikis uretmektir.

## Mevcut Kontrat

- her HTTP istegi icin format kontrollu `X-Request-Id`
- tek satir JSON structured log
- `service`, `environment`, `event`, `level`, zaman ve opsiyonel request ID
- bounded primitive context; nested object reddi
- email, cookie, credential, password, secret, session ve token alanlarini atma
- mesaj/stack icindeki email, bearer token, URL credential ve secret redaksiyonu
- gameplay'i bozmayan, takilabilir `ObservabilityExporter`
- Next.js `onRequestError` ile uncaught route/render/action hata yakalama
- exporter arizasini ayri sayan process-local status
- token korumali health ve admin capacity yuzeyinde yalniz aggregate durum

Audit ile observability ayni sey degildir. Audit kalici ve operasyonel olarak
anlamli actor/action kaydidir. Observability ise hata ayiklama ve alarm icin
best-effort teknik sinyaldir; coin karari veya ceza kaynagi olamaz.

## Log Toplama

Varsayilan sink container stdout/stderr'idir. Production'da Docker loglari
`json-file` driver ile container basina `10 MB x 5` dosyayla sinirlanir. Merkezi
collector yine gereklidir; raw log retention, erisim ve silme suresi production
operator kararidir.

`ObservabilityExporter`, bounded HTTP batch exporter ile merkezi collector'a
baglanabilir. Sentry veya OpenTelemetry icin ince bir collector adapter'i
kullanilabilir. Exporter hata verirse business request basarisiz olmaz;
`exporterFailures` artar. Capture istek yolunda beklenmez; shutdown ve job
sonundaki flush en fazla iki saniye bekler. Redis bu akis icin kalici cozum degildir: merkezi
provider veya collector process restartindan bagimsiz kayit ve alarm saglar.

## Alarm Baslangici

- `exporterFailures > 0`: HOLD ve provider/config incelemesi
- health `status=degraded`: Redis/realtime dependency incelemesi
- kisa pencerede artan `error` event orani: endpoint/event bazli alarm
- `runtime.startup.failed`: deploy rollback adayi
- backup/job failure event'i: operator bildirimi

Process-local toplamlar restart ile sifirlanir. Kalici trend ve oran hesaplari
collector/provider tarafinda yapilmalidir.

## Bilinen Sinirlar

- production collector endpoint/token operator tarafinda yapilandirilacak
- external uptime probe ve on-call kanali operasyonel olarak kurulacak
- beklenen hatalari yakalayan tum legacy `console.error` cagrilari ilk dilimde tasinmadi
- CPU/RAM/disk/DB connection host dashboard'u bu paketin kapsami degil

Operasyon ve alarm kontrati `observability-exporter-operations.md` icindedir.
