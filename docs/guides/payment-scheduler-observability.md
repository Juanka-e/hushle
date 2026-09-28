# Payment Scheduler Observability

## Amaç

Webhook ve reconciliation worker'larının yalnız yapılandırılmış görünmesini değil,
gerçekten başarılı çalıştığını ölçer. Bu katman ödeme veya entitlement kararı vermez;
MySQL ödeme source of truth olmaya devam eder.

## Heartbeat

- Yalnız başarılı `execute` çalışması heartbeat yazar.
- Dry-run ve Redis lease'i alamadığı için atlanan çağrı heartbeat üretmez.
- Kayıt PII içermez: job adı, tamamlanma zamanı ve çalışma süresi tutulur.
- Redis anahtarı yedi gün TTL taşır; DB'ye periyodik heartbeat satırı yazılmaz.
- Redis kesintisi admin ekranında `Durum okunamadı` olur. Oyuncu, bakiye veya sipariş
  üzerinde otomatik işlem yapılmaz.

Freshness eşikleri:

```dotenv
PAYMENT_WEBHOOK_SCHEDULE_MAX_AGE_SECONDS=180
PAYMENT_RECONCILIATION_SCHEDULE_MAX_AGE_SECONDS=1800
```

Admin ödeme ekranı her worker'ı `Çalışıyor`, `Gecikmiş`, `Çalışma kanıtı yok`,
`Yapılandırılmadı` veya `Durum okunamadı` durumlarından biriyle gösterir.
Token korumalı `/api/health` aynı aggregate durumu `payments.schedulers` altında verir.
Ödemeler açıkken worker'lardan biri sağlıklı değilse health sonucu `degraded` olur;
böylece scheduler durmuş olsa bile dış uptime monitor alarm üretebilir.

## Merkezi alarmlar

Başarılı job çalışmaları merkezi exporter'a bounded `job.run.completed` olayı yollar.
Global dead-letter veya açık reconciliation vaka sayısı yapılandırılmış eşiğe ulaşırsa
PII içermeyen warning üretilir:

- `payment.webhook.dead_letter_threshold_exceeded`
- `payment.reconciliation.open_case_threshold_exceeded`

Redis cooldown aynı alarmı 15 dakika içinde ikinci kez göndermez. Sayaçlar ve vaka
kayıtları MySQL/admin ekranında korunur; cooldown yalnız bildirim tekrarını azaltır.

## Operasyon kabulü

1. Scheduler tanımları kurulur ve ilgili `*_SCHEDULE_CONFIGURED=true` yapılır.
2. Her iki job `execute` modunda kontrollü çalıştırılır.
3. Admin ödeme ekranında iki heartbeat `Çalışıyor` görülür.
4. Merkezi exporter'da iki `job.run.completed` olayı doğrulanır.
5. Test ortamında düşük eşikle warning ve 15 dakika tekrar bastırma kontrol edilir.
6. Scheduler durdurularak freshness penceresi sonunda `Gecikmiş` alarmı doğrulanır.

Bu kabul tamamlanmadan yalnız schedule flag'lerinin `true` olması operasyonel kanıt
sayılmaz.

Production systemd timer, fail-closed job wrapper ve dış monitor probe kurulumu için
[`payment-scheduler-deployment.md`](../deploy/payment-scheduler-deployment.md) izlenir.
