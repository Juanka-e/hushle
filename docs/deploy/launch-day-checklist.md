# Launch Day Checklist

Bu liste ilk public acilis ve buyuk release pencereleri icindir.

## 24 Saat Once

- [ ] `main` release adayi SHA sabitlendi.
- [ ] CI, build ve ilgili regresyon testleri basarili.
- [ ] Production env/secret farklari ikinci kisi tarafindan kontrol edildi.
- [ ] MySQL local backup ve SHA-256 checksum mevcut.
- [ ] Son backup gecici DB restore smoke testinden gecti.
- [ ] Offsite backup upload ve remote size dogrulamasi basarili.
- [ ] Disk, CPU, memory ve Docker image/volume kullanimi kontrol edildi.
- [ ] Cloudflare Full (strict), origin certificate ve Nginx zinciri kontrol edildi.
- [ ] `80/443` disindaki app, MySQL ve Redis portlari public degil.
- [ ] Admin Access/MFA ve production environment approval calisiyor.
- [ ] Rollback adayi SHA ve operator belli.

## Acilistan Once

- [ ] `npm run ops:preflight -- --env-file .env.production` blocker olmadan basarili.
- [ ] `docker compose config --quiet` basarili.
- [ ] Tek `app` replica calisiyor.
- [ ] MySQL ve Redis healthy.
- [ ] Health endpoint token'siz `404`, dogru token ile `200`.
- [ ] `REALTIME_TOPOLOGY=single-writer`.
- [ ] `REALTIME_REPLICA_COUNT=1`.
- [ ] Oda kapasitesi ve admission esikleri bilincli degerlerde.
- [ ] Economy base reward, cap ve damping ayarlari incelendi.
- [ ] Product/word analytics bayraklari bilincli olarak acik veya kapali.
- [ ] Maintenance mesaji ve acilis duyurusu hazir.
- [ ] Support ve admin audit yuzeyleri erisilebilir.
- [ ] Structured error loglari collector'a ulasiyor; exporter failure `0`.
- [ ] Exporter queue/dropped `0`; test alarmi on-call kanalina ulasiyor.

## Kontrollu Smoke

- [ ] `npm run test:web-launch-readiness` basarili.
- [ ] MySQL + Redis integration kapisi
  `docs/guides/web-launch-readiness-guide.md` uzerinden basarili.
- [ ] Kayit olma ve login.
- [ ] Guest join.
- [ ] Kayitli kullanici ile oda olusturma.
- [ ] Takim degistirme ve host kontrolu.
- [ ] Oyun baslatma, pause/resume ve reconnect.
- [ ] Dogru, tabu, pas ve timeout.
- [ ] Mac bitisi ve duplicate finalize idempotency.
- [ ] Coin sonucu ve audit/telemetry sinyali.
- [ ] Store listeleme, satin alma ve equip.
- [ ] Admin kelime, kullanici, audit ve health gorunumu.
- [ ] Mobil ve masaustu ana oyun alani.

Otomatik test sonucu manuel coklu oyuncu, reconnect ve gercek cihaz smoke
turunun yerine gecmez.

## Ilk 60 Dakika

Her 10-15 dakikada:

- [ ] Health status ve Redis latency.
- [ ] Aktif oda/oyuncu sayisi ve event-loop lag.
- [ ] `5xx`, WebSocket disconnect ve finalize hatalari.
- [ ] Economy guard trigger/fallback orani.
- [ ] Product/word analytics dropped/read failure sayaclari.
- [ ] MySQL connection ve slow/error loglari.
- [ ] Support talebi veya tekrar eden oyuncu sikayeti.

Otomatik ceza veya kelime gizleme karari ilk gun metriklerinden uretilmez.

## Go / Hold / Rollback

`GO`:

- ana oyun ve auth akisi saglikli
- health beklenen durumda
- veri butunlugu riski yok

`HOLD`:

- ana oyunu durdurmayan ama nedeni bilinmeyen degraded sinyal
- kapasite veya latency artisi
- sinirli cihaz/ekran regresyonu

`ROLLBACK/CONTAIN`:

- yaygin login, room, socket veya finalize hatasi
- yanlis coin/veri yazimi
- yetki veya veri sizintisi
- DB erisim/butunluk sorunu

Containment ve rollback adimlari:
[rollback-and-incident.md](./rollback-and-incident.md).
