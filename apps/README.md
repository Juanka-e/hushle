# Apps Workspace

Bu klasor repo'yu uzun vadede `apps/` + `packages/` yapisina tasimak icin acildi.

Amac:

- tek Next.js uygulamasini zamanla daha net sinirlara ayirmak
- yeni web yuzeyleri veya oyun modlari eklerken mevcut uygulamayi sisirmemek
- mobil uygulama icin daha temiz API/BFF ayrimi hazirlamak
- realtime, jobs ve API katmanlarini gerektiginde ayri deploy edilebilir hale getirmek

## Hedef Yapi

```text
apps/
  web/        -> mevcut Next.js oyuncu + admin uygulamasi
  api/        -> gelecekte mobil/public API veya backend gateway
  jobs/       -> scheduled jobs, retention, archive, background workflows
```

## Simdiki Durum

- `apps/web` gercek Next.js + Socket.IO runtime'idir
- `apps/jobs` gercek one-shot retention/background runtime'idir
- `apps/api` surumlu mobile/public API runtime temelidir; kullanici endpoint'leri bearer auth gate'ini bekler
- root `package.json` workspace orchestration ve ortak komutlari yonetir
- paylasilan platform/domain kodlari `packages/*` sinirinda buyur

Bugun icin planlanan apps migration tamamlanmistir. `apps/api` varsayilan deploy
degildir; yalniz explicit host komutu veya Compose profili ile calisir.

## Migration Kurali

1. once klasor ve dokuman sinirlari olusur
2. sonra paylasilan domain/platform kodlari `packages/` altina cikar
3. en son runtime ayirma yapilir

Bu siralama gereksiz kisa vadeli kirilmalarin onune gecer.
