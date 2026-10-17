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

## 3. Rollback Siniri

Sunucu bir onceki release'in image'larini ve compose kaydini saklar.
`bash scripts/ops/deploy.sh rollback` (veya Deploy Production workflow'unda
`action: rollback`) yeniden build etmeden ve migration calistirmadan ona doner.
Ayrintilar: [release-process.md](./release-process.md) bolum 8. Kurallar:

1. Yalniz bir onceki release'e donulur. `deploy.sh status` `previous` gostermiyorsa
   ya da image'i `missing` ise rollback yoktur.
2. DB'de onceki release'in bilmedigi bir migration varsa rollback reddedilir.
   Sema geri donusu release-process.md 8.5'e gore yapilir.
3. Eski SHA'ya donmek icin rastgele dosya kopyalama yapma; yalniz rollback ya da
   release gate'ten gecen redeploy kullan.
4. Kalici `.env.production`, `nginx/ssl`, MySQL ve Redis volume'larini kaynak
   rollback ile degistirme.
5. `docker compose down -v`, volume silme, `git reset --hard` veya production
   DB'ye destructive `db push` kullanma.
6. Deploy saglik kontrolunden gecemezse script zaten calisan release'e doner;
   bu durumda ayrica rollback gerekmez, nedeni incelenir.

## 4. Uygulama Rollback Sirasi

1. Incident ve hedef rollback SHA kaydini ac.
2. Gerekliyse yeni oda admission'ini kapat.
3. Guncel DB backup ve checksum al.
4. `bash scripts/ops/deploy.sh status` ile `current` ve `previous`'u kaydet;
   `previous` hedef SHA olmalidir.
5. Actions'ta Deploy Production -> Run workflow -> `main` -> `action: rollback`
   calistir ve `production` onayini ver (ya da sunucuda
   `bash scripts/ops/deploy.sh rollback`).
6. Sema reddi gelirse dur; release-process.md 8.5'e gec.
7. Script saglik kontrolunu kendisi yapar. Ardindan health ve ana smoke
   zincirini calistir.
8. Admission'i ancak smoke basariliysa yeniden ac.

Onceki release yoksa (ilk deploy, art arda ikinci rollback, image silinmis) ve
eski SHA release gate'ten gecmiyorsa kontrollu forward-fix yapilir.
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
