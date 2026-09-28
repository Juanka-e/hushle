# Observability Exporter Operations

Bu rehber Hushle structured event'lerini merkezi collector'a tasiyan HTTP
exporter'in production kontratini ve alarm baslangic degerlerini tanimlar.

## Collector Kontrati

Exporter `OBSERVABILITY_EXPORT_URL` adresine `POST` yapar:

```json
{
  "schemaVersion": 1,
  "sentAt": "2026-07-31T12:00:00.000Z",
  "events": []
}
```

- `Content-Type: application/json`
- `Authorization: Bearer <OBSERVABILITY_EXPORT_TOKEN>`
- basari: herhangi bir `2xx`
- hata/timeout: batch bounded queue'ya geri alinir
- production URL: HTTPS, credential/query/hash iceremez
- redirect takip edilmez; bearer token baska origin'e tasinmaz
- her event sabit `eventId` tasir; collector retry duplicate'lerini bu ID ile
  idempotent olarak yok saymalidir

Token collector tarafinda yalniz event ingest yetkisine sahip olmali; dashboard
okuma, silme veya admin yetkisi verilmemelidir. Token loglanmaz ve uygulama
health/admin cevabinda gosterilmez.

## Performans Sinirlari

Varsayilanlar:

- batch: `20` event
- process-local queue: `500` event
- periyodik flush: `5000 ms`
- HTTP timeout: `3000 ms`

Collector yavas veya kapaliysa gameplay beklemez. Queue dolunca yeni telemetry
event'i dusurulur; business islemi, reward, auth veya oda aksiyonu etkilenmez.
Queue process-local ve best-effort'tur; audit veya coin ledger yerine gecmez.

## Admin ve Health

Admin kapasite karti ve token korumali `/api/health` su aggregate alanlari verir:

- `exporterMode`
- `exporterFailures`
- `exporterQueued`
- `exporterDelivered`
- `exporterDropped`
- `lastExportAt`

Token, endpoint, event body, email veya request header bu yuzeylere cikmaz.

## Alarm Baslangici

- `exporterFailures > 0` ve 5 dakika devam: warning
- `exporterQueued >= queueLimit * 0.5` ve 5 dakika devam: warning
- `exporterDropped > 0`: critical, veri kaybi basladi
- `lastExportAt` 10 dakika eski ve runtime event uretiyor: critical
- `/api/health` erisilemiyor: critical uptime alarmi
- `runtime.startup.failed` veya job/backup failure: anlik operator bildirimi

Ilk acilista esikler veri geldikce ayarlanir. Tek bir gecici network hatasi icin
oyuncuya mesaj gosterilmez ve otomatik yaptirim uygulanmaz.

## Incident Akisi

1. Collector health, DNS/TLS ve ingest token yetkisini kontrol et.
2. Admin kartinda queue/dropped/failure trendini kontrol et.
3. Uygulama saglikliysa gameplay'i kapatma; collector'u duzelt.
4. Queue dusmuyorsa kontrollu app restartindan once stdout loglarini koru.
5. Token sizintisi supheliyse collector token'ini rotate et ve container'lari
   yeni env ile yeniden baslat.
6. Incident sonunda exporter failure ve dropped sayaclarini release kaydina ekle.

## Vendor Baglama

Bu endpoint dogrudan bir ingest gateway, Vector/Fluent Bit HTTP source veya
kuruma ait ince bir adapter olabilir. Sentry ya da OTLP secilirse adapter bu
schema'yi ilgili provider formatina cevirir; web/API/jobs kodu degismez.

External uptime monitor `/api/health` isteginde `x-health-token` header'i
gondermeli ve JSON `status` alani `ok` disina ciktiginda alarm uretmelidir.
