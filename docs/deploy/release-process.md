# Production Release Process

Bu dokuman bugunku production release akisinin gercek kontratidir. Hedef,
deploy'u hizlandirmak degil; hangi kanitla baslatildigini, ne zaman
durdurulacagini ve kim tarafindan onaylandigini acik tutmaktir.

## 1. Bugunku Gercek

Production deploy:

1. `develop -> main` pull request'i ile baslar.
2. `main` push'u CI'yi tetikler. Deploy workflow'u yalniz ayni repodaki basarili `CI` push calismasinin tamamlanmasindan sonra baslar; PR veya basarisiz CI deploy edilemez.
3. Workflow kaynak agacini arsivler ve `PROD_DEPLOY_PATH` altina yukler.
4. Arsiv SHA-256 checksum ile transfer sonrasi dogrulanir.
5. `.release-sha` dosyasi deploy edilen Git SHA'yi kaydeder.
6. Arsiv mevcut deploy klasorunun ustune acilir.
7. Mevcut kurulumda MySQL ve kalici gorseller migration oncesinde yedeklenir. Yedek veya eski asset mount kontrolu basarisizsa deploy durur.
8. `scripts/ops/deploy.sh`, migration'i ayri tek-seferlik container'da uygular. Migration basariliysa uygulamayi o SHA'nin image'ina gecirir, `--wait` ve `/api/health` sonucunu bekler. Saglik basarisizsa calisan release'e geri doner (bkz. bolum 8).

Bugunku akis:

- release kimligi commit SHA'sidir; `hushle-app`, `hushle-jobs` ve `hushle-migrate` image'lari SHA ile etiketlenir ve bir kez build edilir
- onceki release'in image'lari sunucuda saklanir; `deploy.sh rollback` yeniden build etmeden ona doner
- health basarisiz olursa calisan release'e otomatik donulur
- migration'lar yalniz ileri gider; DB'de bilmedigi migration olan bir release'e (rollback dahil) gecis reddedilir
- migration basarisizliginda uygulama rollout'una devam etmez
- atomik release directory gecisi yapmaz: kaynak agaci deploy klasorunun ustune acilir; rollback image'lari ve release'in compose tanimini geri alir, agactaki diger dosyalar (nginx config, ops script'leri) son acilan release'te kalir
- kaldirilan dosyalari hedef klasorden otomatik temizlemez

Deploy yine dusuk trafik penceresinde ve operator gozetiminde yapilir.

Workflow `production-deploy` concurrency grubu ile calisir. Devam eden deploy
iptal edilmez; sonraki deploy kuyrukta bekler.

Workflow kaynak agacini CI'nin dogruladigi `head_sha` ile alir; deploy anindaki
degismis `main` ucunu kullanmaz. Kuyrukta eski kalan CI SHA'si yeni `main` ucuyla
eslesmiyorsa deploy reddedilir. Arsivden `.env*`, `data` ve `backups` dislanir.
Kalici dosyalar ve izole restore proseduru icin
[veri guvenligi runbook'u](persistent-assets-and-data-backups.md) esas alinir.

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
3. `.release-sha` degeri release kaydindaki SHA ile karsilastirilir;
   `bash scripts/ops/deploy.sh status` ayni SHA'yi `current` olarak gostermelidir.
4. Uygulama restart'i aktif process-local odalari sonlandirabilir. Bu nedenle
   deploy penceresi oyunculara onceden duyurulur.
5. Deploy bitmeden ikinci bir production deploy baslatilmaz. Sunucudaki
   `.deploy/deploy.lock` ikinci deploy veya rollback'i hemen reddeder.

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
[rollback-and-incident.md](./rollback-and-incident.md) izlenir. Uygulama
rollback'inin kendisi bolum 8'deki `deploy.sh rollback` ile yapilir.

## 8. Release Kimligi, Redeploy ve Rollback

### 8.1 Sunucudaki durum

Her release tam commit SHA'si ile tanimlanir. Sunucuda:

| Yer | Icerik |
| --- | --- |
| `hushle-app:<sha>`, `hushle-jobs:<sha>`, `hushle-migrate:<sha>` | O release'in image'lari. Bir kez build edilir, sonra degistirilmez. |
| `hushle-*:current` | Canli release'i gosterir. Cron job'lari ve elle calisan Compose komutlari bunu kullanir. |
| `.deploy/current`, `.deploy/previous` | Canli ve bir onceki release'in SHA'si. |
| `.deploy/releases/<sha>/` | Degismez kayit: o release'in `docker-compose.yml` kopyasi ve tasidigi migration listesi (`migrations.txt`). |
| `.deploy/history.log` | Her deploy, rollback, otomatik donus ve red kaydi. |
| `.deploy/deploy.lock` | Ayni anda tek deploy veya rollback. |

Durumu gormek icin:

```bash
cd "$PROD_DEPLOY_PATH"
bash scripts/ops/deploy.sh status
```

Yalniz `current` ve `previous` release'in image'lari saklanir; daha eskileri
basarili deploy'dan sonra silinir. `.deploy` deploy klasorunun icindedir;
release arsivi ve Docker build context'i onu icermez. Bu klasoru silmeyin.

### 8.2 Otomatik deploy (`main` push'u)

`deploy.sh` (argumansiz) su sirayla calisir:

1. Production preflight ve zorunlu env kontrolu.
2. Deploy kilidi alinir; `.release-sha` okunur, release kaydi yazilir.
   Ayni SHA icin farkli bir agac gelirse deploy reddedilir.
3. `hushle-app:<sha>` yoksa build edilir; varsa yeniden build edilmez.
   `migrate` ve `jobs` image'lari Compose cache'i ile ayni SHA'ya etiketlenir.
4. Mevcut kurulumda migration oncesi yedek alinir
   ([veri guvenligi runbook'u](persistent-assets-and-data-backups.md)).
5. Schema-ops kilidi altinda sema kontrolu yapilir: DB'de uygulanmis her
   migration bu release'te olmalidir. Degilse deploy migration'dan once durur
   (bkz. 8.5).
6. `prisma migrate deploy` calisir. Bu sirada eski release hizmet vermeye devam eder.
7. Gecis: `:current` yeni SHA'ya alinir, stack `up -d --no-build --wait` ile
   yeniden kurulur, nginx yeniden yuklenir (uygulama adresini yalniz yuklemede
   cozer), sonra saglik beklenir.
8. Saglikli sayilmak icin: `app` container'i bu release'in image'ini calistirir ve
   `https://127.0.0.1/api/health` (nginx uzerinden, `x-health-token` ile) `200` ve
   `status: ok` doner. Bekleme suresi varsayilan 120 saniyedir.
9. Basarili: `previous` eski `current` olur, `current` yeni SHA olur.
10. Basarisiz: calisan release'e (`current`) otomatik donulur ve deploy hata ile
    biter. Yeni release'in migration'lari uygulanmis kalir; eski release adim 6'da
    zaten bu sema ile calisiyordu. Donus de basarisizsa incident runbook'u izlenir.

Bu mekanizmayla yapilan ilk deploy'da `current` yoktur; saglik basarisiz olursa
donulecek release yoktur ve deploy yalniz hata verir.

### 8.3 Elle redeploy (GitHub Actions)

Kullanim: `.env.production` degisikligini uygulamak, altyapi duzeltildikten
sonra ayni release'i tekrar kurmak, rollback sonrasi tekrar ileri gecmek.

1. Actions -> **Deploy Production** -> **Run workflow**.
2. Branch: `main` (baska branch'ten calistirilan is hicbir sey yapmaz).
3. `action`: `redeploy`, `sha`: tam 40 karakterlik commit SHA'si.
4. `production` environment onayi verilir.

Komut satirindan:

```bash
gh workflow run deploy-production.yml --ref main -f action=redeploy -f sha=<40-karakter-sha>
```

Workflow once `main`'i checkout eder ve `scripts/ops/release-gate.sh` ile SHA'yi
GitHub API'den dogrular:

- SHA `main` gecmisinde olmalidir (compare durumu `behind` veya `identical`);
- ayni SHA icin `main` uzerinde basarili bir `CI` push calismasi olmalidir
  (ayni repo, `conclusion: success`).

Biri eksikse workflow arsiv uretmeden durur. Gecerse kaynak o SHA'dan arsivlenir
ve normal deploy akisi (8.2) calisir. Canli SHA tekrar deploy edilirse app image'i
yeniden build edilmez ve `previous` degismez. Daha eski bir SHA secilirse 8.5'teki
sema kontrolu uygulanir.

### 8.4 Rollback

Actions'ta `action: rollback` secilir (`sha` yok sayilir) ya da sunucuda:

```bash
cd "$PROD_DEPLOY_PATH"
bash scripts/ops/deploy.sh status
bash scripts/ops/deploy.sh rollback
```

Akis:

1. Deploy kilidi alinir. `previous` yoksa ya da image'i silinmisse rollback
   reddedilir.
2. Schema-ops kilidi altinda sema kontrolu yapilir: DB'de uygulanmis her
   migration `previous` release'te olmalidir. Degilse rollback reddedilir (8.5).
3. Build ve migration yapilmaz. `:current` onceki SHA'ya alinir, stack onceki
   release'in kaydedilmis compose dosyasiyla kurulur, nginx yeniden yuklenir,
   saglik beklenir (8.2 madde 8).
4. Basarili: `current` onceki SHA olur, `previous` bosalir. Ikinci bir rollback
   reddedilir.
5. Basarisiz: rollback'ten onceki release'e otomatik donulur ve komut hata ile biter.

Tekrar ileri gecmek icin geri alinan SHA 8.3 ile redeploy edilir. Image'i
silinmediyse yeniden build edilmez.

Sinirlar: `.env.production` surumlenmez; rollback onu degistirmez. Deploy
klasorundeki dosyalar (nginx config, ops script'leri) son acilan release'te kalir.

### 8.5 Sema geri donusu

Migration'lar yalniz ileri gider; down migration yoktur. Deploy veya rollback
su mesajla reddedilirse:

```text
Refusing to roll back: the database has migrations that release <sha> does not know: <liste>
```

hedef release bu migration'lari tanimiyordur. Secenekler, tercih sirasiyla:

1. **Forward-fix:** sorunu duzelten yeni bir release'i normal yoldan cikarin.
2. **Incelenmis additive migration:** listedeki migration SQL'i yalniz ekleme
   yapiyorsa (yeni tablo/kolon/index; silme, yeniden adlandirma veya tip daraltma
   yok) ve hedef release bu sema ile calisabiliyorsa, sunucuda tam listeyle
   calistirin:

   ```bash
   ALLOW_NEWER_SCHEMA_MIGRATIONS=<liste> bash scripts/ops/deploy.sh rollback
   ```

   Liste mesajdaki ile birebir ayni olmalidir; aksi halde yine reddedilir. Karar
   `.deploy/history.log` ve incident kaydina yazilir. Bu secenek Actions'ta yoktur.
3. **Migration oncesi yedekten donus:** veri kaybi kabul edilecekse
   1. Deploy'un migration oncesi aldigi yedegi (`backups/data/hushle-data-...`)
      veya en yeni MySQL yedegini `hushle_restore_*` adli izole bir DB'ye geri
      yukleyin
      ([mysql-backups.md](./mysql-backups.md),
      [persistent-assets-and-data-backups.md](./persistent-assets-and-data-backups.md)).
   2. [mysql-backups.md](./mysql-backups.md) icindeki "Restore/cutover sirasi" ile
      `DATABASE_URL`'i izole DB'ye cevirin.
   3. Restore edilen DB'nin migration listesi `previous` ile ayni oldugu icin
      `bash scripts/ops/deploy.sh rollback` artik kabul edilir.
   4. Yedek ile cutover arasinda yazilan cuzdan, e-posta ve admin kayitlari kayip
      veri araligi olarak incident kaydinda hesaplanir.

Production DB uzerinde elle `DROP`/`ALTER` ile migration geri alinmaz ve
`_prisma_migrations` tablosu elle duzenlenmez.

### 8.6 Hata mesajlari

| Mesaj | Anlami | Yapilacak |
| --- | --- | --- |
| `Another deploy or rollback is running` | Kilit baska bir islemde | Bitmesini bekleyin; `history.log`'a bakin. |
| `No previous release to roll back to` | `previous` yok (ilk deploy ya da az once rollback yapildi) | Gerekirse eski SHA'yi 8.3 ile redeploy edin. |
| `Image hushle-app:<sha> is gone` | Onceki release image'i silinmis | O SHA'yi 8.3 ile redeploy edin. |
| `Refusing to deploy/roll back: the database has migrations ...` | Sema uyumsuz | 8.5. |
| `Deploy of <sha> failed its health check; <sha> is live again` | Yeni release sagliksiz, eskiye donuldu | Loglari inceleyin, forward-fix. |
| `... and returning to <sha> failed too` | Iki release de sagliksiz | [rollback-and-incident.md](./rollback-and-incident.md). |
| `The extracted tree differs from the recorded release` | Ayni SHA icin farkli dosyalar | Sunucuda elle degisiklik yapilmis; arsivi yeniden yukleyin. |
| `Release gate: ...` | SHA `main`'de degil ya da CI basarili degil | Dogru SHA'yi secin; CI'yi bekleyin. |

Ayarlar (gerekmedikce degistirmeyin): `DEPLOY_HEALTH_URL` (varsayilan
`https://127.0.0.1/api/health`), `DEPLOY_HEALTH_TIMEOUT` (120), `DEPLOY_WAIT_TIMEOUT`
(180), `DEPLOY_STATE_DIR` (`.deploy`).
