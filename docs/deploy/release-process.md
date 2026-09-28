# Production Release Process

Bu dokuman bugunku production release akisinin gercek kontratidir. Hedef,
deploy'u hizlandirmak degil; hangi kanitla baslatildigini, ne zaman
durdurulacagini ve kim tarafindan onaylandigini acik tutmaktir.

## 1. Bugunku Gercek

Production deploy:

1. `develop -> main` pull request'i ile baslar.
2. `main` push'u `.github/workflows/deploy-production.yml` workflow'unu tetikler.
3. Workflow kaynak agacini arsivler ve `PROD_DEPLOY_PATH` altina yukler.
4. Arsiv SHA-256 checksum ile transfer sonrasi dogrulanir.
5. `.release-sha` dosyasi deploy edilen Git SHA'yi kaydeder.
6. Arsiv mevcut deploy klasorunun ustune acilir.
7. `scripts/ops/deploy.sh`, migration'i ayri tek-seferlik container'da uygular.
8. Migration basariliysa image'lari ve Compose stack'ini yeniden kurar.

Bugunku akis:

- atomik release directory gecisi yapmaz
- kaldirilan dosyalari hedef klasorden otomatik temizlemez
- onceki release'i otomatik saklamaz
- uygulama health sonucuna gore otomatik rollback yapmaz
- migration basarisizliginda uygulama rollout'una devam etmez

Bu sinirlar giderilene kadar deploy, dusuk trafik penceresinde ve operator
gozetiminde yapilir.

Workflow `production-deploy` concurrency grubu ile calisir. Devam eden deploy
iptal edilmez; sonraki deploy kuyrukta bekler.

## 2. Release Gate

Asagidakilerden biri eksikse `main` merge edilmez:

1. `develop` CI basarili.
2. Release PR'i icin `Lint & TypeScript` ve `Build` basarili.
3. Degisen alana ait regresyon testleri kayitli.
4. Production env veya secret degisikligi listelenmis.
5. DB schema degisikligi olup olmadigi acikca belirtilmis.
6. Guncel local backup ve son restore smoke sonucu biliniyor.
7. Rollback adayi SHA ve operator belirlenmis.
8. Aktif oda kaybi riski icin uygun deploy penceresi secilmis.

Release kaydi en az su alanlari tasir:

```text
Release SHA:
Onceki production SHA:
Operator:
Planlanan pencere:
DB schema degisikligi: evet/hayir
Env/secret degisikligi:
Backup dosyasi ve checksum:
Son restore smoke:
Beklenen kullanici etkisi:
Rollback adayi:
Go/no-go karari:
```

## 3. Veritabani Kapi Kurali

Repoda `prisma/migrations` gecmisi vardir. CI temiz test veritabanina
`prisma migrate deploy` uygular. Production deploy scripti migration'i app
startup'ina baglamadan ayri tek-seferlik Compose servisiyle calistirir.

Kurallar:

1. Schema degismediyse normal release akisi devam edebilir.
2. Schema degistiyse migration SQL'i review edilmeden release onaylanmaz.
3. Degisiklik icin ileri ve geri uyumluluk analizi yapilir.
4. Production backup ve restore smoke kaniti olmadan schema islemi yapilmaz.
5. Destructive SQL veya otomatik `prisma db push --accept-data-loss`
   kullanilmaz.
6. Mevcut production DB'nin ilk baseline kaydi otomatik yapilmaz; sifir drift,
   backup ve restore smoke kanitiyla bir kez operator tarafindan kaydedilir.
7. Normal release'te `prisma migrate deploy` basarisizsa app rollout'u durur.

Komutlar ve ilk baseline proseduru
[database-migrations.md](./database-migrations.md) icinde tanimlidir.

Bu projede DB source of truth'tur. Uygulama deploy'u basarili olsa bile schema
uyumsuzsa release basarili sayilmaz.

## 4. Deploy Oncesi

Repo tarafinda:

```bash
npm ci
npm run lint
npx tsc --noEmit
npm run typecheck:packages
npm run test:package-boundaries
npm run test:realtime-topology
npm run build
```

Sunucu tarafinda:

```bash
cd "$PROD_DEPLOY_PATH"
npm run ops:preflight -- --env-file .env.production
docker compose --env-file .env.production -f docker-compose.yml config --quiet
docker compose --env-file .env.production -f docker-compose.yml ps
df -h
docker system df
```

Kontrol:

1. Production config preflight blocker olmadan gecti.
2. `app` replica sayisi `1`.
3. MySQL ve Redis healthy.
4. Yeterli disk alani var.
5. `.env.production` ve `nginx/ssl` kalici, repo arsivinden bagimsiz.
6. Backup ve checksum mevcut.
7. Beklenmeyen admission/maintenance ayari yok.
8. Product ve word analytics varsayilan olarak kapali; acilacaksa env degeri
   bilincli verilmis.

## 5. Deploy

GitHub `production` environment manual approval ile korunmalidir. Onaydan
sonra `main` deploy workflow'u izlenir.

Deploy sirasinda:

1. Workflow logunda arsiv upload ve SSH adimi izlenir.
2. Sunucuda `docker compose ps` ile servis gecisi izlenir.
3. `.release-sha` degeri release kaydindaki SHA ile karsilastirilir.
4. Uygulama restart'i aktif process-local odalari sonlandirabilir. Bu nedenle
   deploy penceresi oyunculara onceden duyurulur.
5. Deploy bitmeden ikinci bir production deploy baslatilmaz.

## 6. Deploy Sonrasi Kanit

Health endpoint token ile kontrol edilir:

```bash
curl --fail --silent --show-error \
  -H "x-health-token: $HEALTHCHECK_TOKEN" \
  https://PUBLIC_ORIGIN/api/health
```

Beklenen minimum:

1. HTTP `200`.
2. `status` degeri `ok`; `degraded` ise neden aciklanmadan release kapanmaz.
3. Redis `configured=true` ve `available=true`.
4. `realtime.topology.mode=single-writer`.
5. `realtime.topology.declaredReplicaCount=1`.
6. Admin login basarili.
7. Oda olusturma, guest join, WebSocket baglantisi ve lobiye donus basarili.
8. Bir kisa mac tamamlanir; match finalize ve coin sonucu kontrol edilir.
9. Yeni server error veya surekli artan telemetry drop/fallback yok.
10. `npm run db:migrate:status` tum migration'lari uygulanmis gosterir.

Release kaydina su kanitlar eklenir:

- workflow URL
- deploy edilen SHA
- health kontrol zamani ve sonucu
- smoke sonucu
- gozlenen hata/fallback sayaclari
- nihai `go` veya rollback karari

## 7. No-Go ve Rollback

Asagidakilerden biri varsa release kapatilmaz:

- login/session kirik
- oda kurma veya join kirik
- WebSocket baglantisi kurulamiyor
- MySQL erisilemiyor
- Redis zorunlu production koordinasyonu kullanilamaz durumda
- health `degraded` nedeni bilinmiyor
- ekonomi veya finalize duplicate/500 hatasi uretiyor

Containment ve rollback icin
[rollback-and-incident.md](./rollback-and-incident.md) izlenir.
