# Rollback And Incident Runbook

Bu runbook production deploy sonrasinda hata goruldugunde izlenecek sirayi
tanımlar. Amac, panik halinde veritabani veya kalici volume'lar uzerinde
destructive komut calistirilmasini engellemektir.

## 1. Ilk Karar

Ilk bes dakika icinde:

1. Yeni oda girisini admin maintenance/admission kontrolleriyle sinirla.
2. Mevcut oyuncu etkisini ve aktif oda sayisini kaydet.
3. Hatanin deploy SHA'si ile basladigini dogrula.
4. `/api/health`, app/nginx loglari ve MySQL/Redis health durumunu kaydet.
5. DB yazimini etkileyen hata varsa yeni ekonomi/admin mutasyonlarini durdur.
6. Operator, karar saati ve ilk bulguyu incident kaydina yaz.

Maintenance ayari mevcut oyunculari sessizce oyundan atmak icin kullanilmaz.
Process restart'i process-local aktif odalari kaybettirebilir.

## 2. Siniflandirma

### Kritik

- login tamamen kapali
- oda olusturma/join tamamen kapali
- yaygin `500`
- DB veri butunlugu veya yanlis coin yazimi riski
- yetkisiz admin/oyuncu verisi erisimi

Karar: yeni girisi kapat, yazma yuzeylerini sinirla ve rollback/forward-fix
kararini hemen ver.

### Yuksek

- WebSocket reconnect veya finalize hatalari
- Redis koordinasyonunun surekli degraded olmasi
- belirli cihazlarda ana oyun akisi kirik

Karar: trafik ve hata yayginligina gore rollback; yeni oda admission'i
gerekiyorsa kapat.

### Orta

- admin raporu, analytics veya kozmetik preview gibi ana oyunu durdurmayan hata

Karar: ana akisa dokunmadan forward-fix tercih edilebilir.

## 3. Bugunku Rollback Siniri

Mevcut workflow eski release'i otomatik saklamaz ve tek komutla atomik rollback
sunmaz. Kaynak arsivi mevcut deploy klasorunun ustune acilir. Bu nedenle:

1. "bir onceki release arsivi zaten vardir" varsayimi yapma.
2. Deploy oncesi rollback adayi SHA'yi release kaydina yaz.
3. Eski SHA icin yeniden uretilmis ve incelenmis release arsivi olmadan rastgele
   dosya kopyalama yapma.
4. Kalici `.env.production`, `nginx/ssl`, MySQL ve Redis volume'larini kaynak
   rollback ile degistirme.
5. `docker compose down -v`, volume silme, `git reset --hard` veya production
   DB'ye destructive `db push` kullanma.

Otomatik release directory ve tested rollback scripti eklenene kadar rollback
manuel, operator kontrollu bir islemdir.

## 4. Uygulama Rollback Sirasi

Onceden hazirlanmis, dogrulanmis onceki release arsivi varsa:

1. Incident ve hedef rollback SHA kaydini ac.
2. Gerekliyse yeni oda admission'ini kapat.
3. Guncel DB backup ve checksum al.
4. Onceki source arsivinin SHA/provenance bilgisini dogrula.
5. Persistent secret ve volume'lara dokunmadan source'u geri yukle.
6. `docker compose config --quiet` ile config'i dogrula.
7. `scripts/ops/deploy.sh` ile stack'i yeniden kur.
8. Health ve ana smoke zincirini calistir.
9. Admission'i ancak smoke basariliysa yeniden ac.

Onceki arsiv yoksa kontrollu forward-fix, bilinmeyen bir source snapshot'ina
donmekten daha guvenlidir.

## 5. DB Degisikligi Varsa

Uygulama rollback'i DB rollback'i anlamina gelmez.

1. Onceki app surumunun mevcut schema ile ileri/geri uyumlulugunu kontrol et.
2. Veri kaybi riski varsa uygulamayi geri almak yerine yazma yuzeylerini kapat.
3. Restore, ancak ayri incident karari ve dogrulanmis backup ile yapilir.
4. Production veritabanina restore smoke scripti hedeflenmez; o script gecici
   test veritabani icindir.
5. MySQL volume'u silinmez veya sifirdan olusturulmaz.
6. Aktif production DB'ye in-place restore yapilmaz. Backup izole restore DB'ye
   acilir, guncel migration'larla ileri alinir ve smoke sonrasinda kontrollu
   `DATABASE_URL` cutover yapilir.
7. Restore noktasi sonrasindaki wallet, email outbox ve admin mutasyonlari kayip
   veri araligi olarak ayrica hesaplanir; restore bunlari otomatik birlestirmez.

## 6. Kanit Toplama

Secret veya PII kopyalamadan:

```bash
docker compose --env-file .env.production -f docker-compose.yml ps
docker compose --env-file .env.production -f docker-compose.yml logs \
  --since 20m --tail 500 app nginx mysql redis
```

Kaydet:

- olay baslangic ve bitis zamani
- deploy ve rollback SHA
- etkilenen ana akis
- health status ve dependency durumlari
- aktif oda/oyuncu sayisi
- hata ornegi ve tekrar adimlari
- containment adimi
- veri duzeltmesi gerekip gerekmedigi

Loglari paylasmadan once token, email, IP ve kullaniciya ait serbest metinleri
temizle.

## 7. Incident Kapanisi

Incident su kosullarda kapanir:

1. Health beklenen durumda.
2. Login, oda, socket ve match finalize smoke basarili.
3. Yeni beklenmeyen DB/Redis hata artisi yok.
4. Ekonomi yan etkisi varsa etkilenen wallet kayitlari incelendi.
5. Admission/maintenance normal ayara dondu.
6. Kok neden, kalici aksiyon ve sahibi kaydedildi.
