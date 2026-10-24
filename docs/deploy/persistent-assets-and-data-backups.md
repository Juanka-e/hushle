# Kalıcı Görseller Ve Veri Yedekleri

Güncelleme: 2026-10-15. Hushle MySQL kullanır. Redis kalıcı iş verilerinin veya
MySQL/görsel yedeğinin yerine geçmez.

## Tamamlanan İşler

- Kozmetik ve branding upload'ları `data/assets` içine kaydedilir; Docker'da
  `/data/assets` host bind mount'tur. URL'ler değişmez: `/cosmetics/...`, `/branding/...`.
- Yerel custom server ve Docker aynı depolama sözleşmesini kullanır.
- Eski `apps/web/public/cosmetics` ve `branding` raster görselleri başlangıçta
  kopyalanır. Kaynaklar silinmez, mevcut kalıcı dosyalar ezilmez. Bundled SVG'ler
  image kaynakları olarak kalır; admin upload SVG kabul etmez.
- Yükleme tamamlanmadan dosya yayına çıkmaz. Aynı URL'ye paralel yazma eski
  dosyayı ezemez. Yol traversal'ı ve dış dizine çıkan symlink reddedilir.
- Logo değiştirmek eski dosyayı otomatik silmez. Geçmiş yedeklerin referansları korunur.
- MySQL dump + görseller + dosya boyutları + SHA-256 manifest tek snapshot altında
  tutulur. Tamamlanmamış snapshot `.partial` kalır; doğrulanmış yedek gibi kullanılmaz.
- Yedekleme kilidi paralel işlemi reddeder. Dosya checksum'ları ve gzip tekrar
  doğrulanır. Restore mevcut dizine, boş olsa bile, yazamaz.
- Snapshot offsite'a `.tar.gz` + `.sha256` olarak gider. `data-restore.sh` uzak
  snapshot'ları listeler ve DB'yi izole hedefe, görselleri yeni dizine geri yükler.
  Akış MinIO'ya karşı uçtan uca test edilir (aşağıda).
- CI storage/backup regresyonlarını çalıştırır. Production deploy yalnız başarılı
  `main` CI sonucuyla ilerler; mevcut kurulumda migration öncesinde yedek alır.
- App healthcheck MySQL, Redis ve runtime durumunu kontrol eder. Deploy sağlık
  beklemesi başarısız olursa hata verir; otomatik schema rollback yapmaz.

## Depolama Sınırları

| Veri | Yerel | Erken production | Yedek |
| --- | --- | --- | --- |
| Hesap, cüzdan, satın alım, mağaza kayıtları | MySQL dev named volume | MySQL production named volume | `mysql.sql.gz` |
| Upload görselleri | repo `data/assets` | host bind mount `/data/assets` | snapshot `assets/` |
| Redis counter/cache | Redis dev named volume | Redis AOF named volume | kalıcı iş kaydının kaynağı değildir |
| Statik kod/SVG | Git | Docker image | Git/release |

`docker build`, `up -d --build` ve container restart bu verileri sıfırlamaz.
Ancak `docker compose down -v`, `docker volume prune`, `db reset`, host dizinini
silme veya disk kaybı kalıcılıkla çözülmez. Bunları rutin deploy'da kullanmayın.
Compose project adını/dizinini veya volume adlarını değiştirmeden önce mevcut
volume kimliklerini kaydedin; farklı ad yeni boş DB açabilir, eski DB silinmese de
veriler kaybolmuş gibi görünür. Yeni bir adla sessizce yeniden kurulum yapmayın.

Erken production için `.env.production` içinde sabit ve tercihen repo dışı yol:

```dotenv
ASSET_STORAGE_HOST_PATH=/srv/hushle-data/assets
ASSET_STORAGE_PATH=/data/assets
```

Bu dizini ilk kurulumda oluşturun, yalnız uygulama/operatör erişimine izin verin,
disk doluluk alarmı kurun. Bind mount'un kendisi yedek değildir. DB password/volume
değişikliği mevcut MySQL kurulumunun parolasını otomatik güncellemez.

## Yerel Windows / Linux Kullanımı

Docker dev MySQL açıkken repo kökünde:

```powershell
npm run backup:data
npm run backup:verify -- --backup "D:\...\backups\data\hushle-data-..."
npm run backup:restore-assets -- --backup "D:\...\backups\data\hushle-data-..." --target "D:\...\restore-check-NEW"
```

Son komut görselleri `restore-check-NEW/assets` altına çıkarır; canlı `data/assets`
üzerine yazmaz. Önce bütün snapshot doğrulanır. Kaynak yedek silinmez.
Farklı env/Compose dosyası için `create --env path --compose path` kullanın.
`--assets` ve `--output` ile depolama yolları ayrı ayrı seçilebilir.
Yerel native CLI çalışırken migration başlatmayın; production Bash wrapper'ı
mevcut schema-ops lock'ını kullanır.

Gerçek DB restore drill, canlı MySQL'den tamamen ayrı, ağsız, geçici MySQL container'ı:

```powershell
node scripts/test-data-backup-integration.mjs "D:\...\backups\data\hushle-data-..."
```

Test `mysql:8.4` image'ının önceden mevcut olmasını ister; yeni image indirmez.
Test sonunda yalnız kendi oluşturduğu container kaldırılır. Canlı DB ve volume'ları
değiştirmez. Güncel yerel drill: 55 tablo, 9 kullanıcı, 30 kelime geri yüklendi.

## Production Yedekleme

Host'ta Bash, Docker Compose, `flock`, `tar`, `sha256sum`; Node host'a kurulmak
zorunda değildir, yardımcı Node container'ı ağsız çalışır.

```bash
ENV_FILE=/opt/hushle/.env.production bash scripts/ops/data-backup.sh
```

Önce transaction-consistent MySQL dump, ardından immutable görseller kopyalanır.
Yeni yüklemeler eklenebilir; eski görseller otomatik silinmediğinden dump içinde
var olan dosya referansları korunur. DDL migration backup sırasında çalıştırılmaz.
Operatörün dışarıdan dosya silmesi/dosyayı yerinde değiştirmesi bu sözleşmeye aykırıdır.

`scripts/ops/data-backup.cron.example` günlük örnektir; yalnız başarılı ilk backup ve
restore drill sonrasında kurun. Hata logları, son başarılı yedek yaşı, disk doluluğu
ve offsite upload başarısızlığı için alarm gereklidir. Cron dosyası kendiliğinden
kurulmaz. Yerel yedekler otomatik silinmez (`RETENTION_DAYS=0`). İstenirse DB-only
script için açık retention tanımlanabilir; tam veri snapshot'ları ayrı lifecycle ister.
Yedeklerde kişisel veri ve hesap hash'leri bulunur; Git'e eklenmez, erişim sınırlandırılır.

## İlk Geçişte Eski Container Görselleri

Eski container'ın kendi writable layer'ına yüklenmiş dosyalar yeni image içinde
bulunmaz. Deploy eski app'te `/data/assets` mount'u yoksa güvenli şekilde durur.
Eski container'ı kaldırmadan bakım penceresinde:

1. Upload trafiğini durdurun, eski app container kimliğini kaydedin.
2. `docker cp <OLD_APP>:/app/apps/web/public/. /safe/legacy-public/` ile kaynakları
   çıkarın. Başarısız kopyayı görmezden gelmeyin; henüz eski container'ı silmeyin.
3. `node scripts/ops/data-backup.mjs import-legacy --source /safe/legacy-public --assets /srv/hushle-data/assets`
   komutuyla yalnız raster görselleri silmeden/ezmeden kopyalayın. Node gerekirse
   network-none yardımcı container içinde çalıştırılabilir.
4. DB+görsel yedeğini alın, verify ve izole restore yapın; mağazadaki URL'leri kontrol edin.
5. Eski **app container'ını**, DB/Redis container veya volume'larına dokunmadan
   kaldırın; ardından yeni mount'lu app'i deploy edin. Yeni app sağlıklı ve URL'ler
   erişilebilir olmadan eski export/yedekleri temizlemeyin.

Yerel `public` dosyaları için bu elle container export'una gerek yoktur; native
backup ve custom server eski raster dosyaları otomatik, silmeden kopyalar.

## R2 / S3 Offsite

S3-compatible adapter `scripts/ops/object-storage.sh`'tır. Varsayılan
`BACKUP_S3_CLI_MODE=docker`, `docker-compose.ops.yml` içindeki pinli AWS CLI
container'ını kullanır. Ayarlar: `BACKUP_REMOTE_ENABLED`, `BACKUP_S3_ENDPOINT`,
`BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_PREFIX`, access key ve secret key
(örnek: `docs/deploy/mysql-backups.md`). Aşağıdaki akış MinIO'ya karşı uçtan uca
doğrulandı ve CI'da her PR'da tekrar çalışır. Gerçek R2 bucket ile kabul testi
henüz yapılmadı; aynı komutlarla yapılmalıdır.

### Bucket hazırlığı (bir kez, yönetici anahtarıyla)

1. Bucket private olsun; public erişim kapalı, TLS endpoint.
2. Lifecycle kuralı kurun. Prefix altındaki nesneler `BACKUP_REMOTE_RETENTION_DAYS`
   gün sonra silinir; yarım kalan multipart upload'lar 1 gün sonra temizlenir.
   Remote silme script'le yapılmaz.

   ```json
   {"Rules":[{"ID":"hushle-backup-retention","Status":"Enabled","Filter":{"Prefix":"production/"},"Expiration":{"Days":30},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}
   ```

   ```bash
   aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3api put-bucket-lifecycle-configuration \
     --bucket hushle-backups --lifecycle-configuration file://lifecycle.json
   aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3api get-bucket-lifecycle-configuration \
     --bucket hushle-backups
   ```

   Kuralı geri okuyup iki alanı da görün. MinIO bu JSON'u kabul eder ama
   `AbortIncompleteMultipartUpload` alanını saklamaz; testte yalnız `Expiration`
   doğrulanabildi.
3. Backup anahtarı prefix altında yalnız yazar, okur ve listeler; silemez. S3 IAM
   politikası (testte MinIO'da aynısı kullanıldı, silme denemesi `AccessDenied` aldı):

   ```json
   {"Version":"2012-10-17","Statement":[
    {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":["arn:aws:s3:::hushle-backups"],"Condition":{"StringLike":{"s3:prefix":["production/*"]}}},
    {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:AbortMultipartUpload","s3:ListMultipartUploadParts"],"Resource":["arn:aws:s3:::hushle-backups/production/*"]}]}
   ```

   R2'de API token'ı tek bucket'a sınırlayın. R2'nin "Object Read & Write" izni
   silmeyi de kapsar; silmeye karşı R2 bucket lock (retention) kuralını değerlendirin.
4. Versioning/Object Lock ve şifreleme sağlayıcı tarafında ayrıca kurulur. Env
   değerini yazmak bu politikaları kendiliğinden oluşturmaz.

### Yedek alma

```bash
ENV_FILE=/opt/hushle/.env.production bash scripts/ops/data-backup.sh
```

Sıra şöyledir:

1. MySQL dump `backups/staging` altına yazılır ve checksum'ı kontrol edilir.
2. Dump ve görseller manifest'li snapshot olur.
3. Snapshot `.tar.gz` yapılır ve `<prefix>/data/` altına yüklenir. Upload'dan sonra
   uzak nesnenin boyutu kontrol edilir.
4. `.tar.gz.sha256` **en son** yüklenir. Sidecar'ı olmayan arşiv eksik sayılır.

Yerel snapshot dizini kalır. Staging dump ve geçici `.tar.gz` her durumda silinir.
Snapshot dizini script'i çalıştıran hesaba devredilir; root olmayan, docker
grubundaki bir hesapla da çalışır. DB, snapshot ile tek kez dışarı gider
(`<prefix>/mysql/` altına ayrıca yüklenmez).

Uzak hata olursa (yanlış anahtar, olmayan bucket, kesilen upload) script sıfırdan
farklı kodla biter. Doğrulanmış yerel snapshot yine kalır, secret log'a yazılmaz.
Yeniden çalıştırmak yeni bir snapshot alır ve yükler. Alarmı bu çıkış koduna bağlayın.

### Listeleme

```bash
ENV_FILE=/opt/hushle/.env.production bash scripts/ops/data-restore.sh list
```

Her satır: `durum  ad  bayt  tarih`. Durumlar:

- `complete`: arşiv ve `.sha256` var. Yalnız bunlar geri yüklenir.
- `incomplete`: arşiv var, `.sha256` yok; upload yarıda kalmış.
- `orphan-checksum`: yalnız `.sha256` var.

Ham liste: `bash scripts/ops/object-storage.sh list production/data/`.

### Elle indirme ve doğrulama

```bash
bash scripts/ops/object-storage.sh download production/data/NAME.tar.gz backups/manual/NAME.tar.gz
bash scripts/ops/object-storage.sh download production/data/NAME.tar.gz.sha256 backups/manual/NAME.tar.gz.sha256
(cd backups/manual && sha256sum -c NAME.tar.gz.sha256)
```

Docker modunda indirilen dosyalar `backups/` altında kalmalıdır.

### Geri yükleme (izole hedefe)

1. Boş bir DB açın (`docs/deploy/mysql-backups.md` içindeki `CREATE DATABASE` komutu).
2. Geri yükleyin:

   ```bash
   RESTORE_DATABASE=hushle_restore_incident_YYYYMMDD RESTORE_USE_ROOT=true \
   RESTORE_ASSETS_TARGET=/srv/hushle-data/restore-YYYYMMDD \
   ENV_FILE=/opt/hushle/.env.production \
     bash scripts/ops/data-restore.sh restore hushle-data-...
   ```

   Kaynak dört biçimde verilebilir: uzak snapshot adı, `s3://<bucket>/<anahtar>.tar.gz`,
   indirilmiş `.tar.gz` (yanında `.sha256` ile) veya yerel `backups/data/hushle-data-...`
   dizini (örneğin deploy öncesi alınan yedek).
3. Script sırası:
   1. Hedef kontrolleri; hiçbir şey indirilmeden önce.
   2. Uzak kaynakta önce `.sha256`, sonra arşiv indirilir.
   3. SHA-256 kontrolü.
   4. Tar içeriği kontrolü: yalnız snapshot dizini, normal dosya ve dizin.
   5. Manifest doğrulaması.
   6. DB, `mysql-restore.sh` ile geri yüklenir (schema-ops kilidiyle).
   7. Görseller `RESTORE_ASSETS_TARGET/assets` altına yazılır.

   Geçici kopya `backups/restore/` altında açılır ve her durumda silinir.
4. Restore şu durumlarda reddedilir; hedefe hiçbir şey yazılmaz:
   - aktif DB adı veya MySQL sistem şeması;
   - `hushle_restore_*` dışı DB adı, `RESTORE_TARGET_CONFIRM` olmadan;
   - dolu hedef DB, `RESTORE_OVERWRITE_CONFIRM=<hedef-db>` olmadan;
   - var olan görsel hedefi (boş olsa bile);
   - eksik, bozuk ya da başka arşivi tarif eden `.sha256`;
   - checksum'ı tutmayan arşiv;
   - snapshot dışına çıkan ya da link içeren tar;
   - manifest uyuşmazlığı.
5. Cutover için `docs/deploy/mysql-backups.md` içindeki "Restore/cutover sirasi"
   izlenir. Görsellerde `ASSET_STORAGE_HOST_PATH` yeni `.../assets` dizinine çevrilir.

Yerel kopyanın yanı sıra başka disk/bucket kopyası olmadan disk kaybına dayanıklı
olduğunu söylemeyin.

### Uçtan uca test (MinIO)

`scripts/test-remote-backup-e2e.sh` production script'lerini değiştirmeden
çalıştırır:

- Geçici bir Compose projesinde MinIO ve bir `mysql` istemci servisi açar. İstemci,
  dışarıdaki MySQL sunucusuna bağlanır.
- `backup-cli` aynı proje ağından `http://minio:9000`'e ulaşır.
- Sunucuda yalnız `tabu_backup_src`, `tabu_backup_restore`, `tabu_backup_e2e`
  kullanıcısı ve smoke'un geçici DB'si açılır. Hepsi sonunda silinir; container,
  ağ ve volume'lar da kaldırılır.

Kapsamı (38 kontrol):

- Gerçek migration'larla 55 tablo, Türkçe karakterli ve ikili veri.
- 24 MB'lık görselle multipart upload.
- Silme yetkisi olmayan anahtarla yedek, liste, indirme ve `sha256sum -c`.
- İki DB'de satır sayısı, `CHECKSUM TABLE` ve DDL karşılaştırması; görsellerde
  dosya hash'leri.
- Bozuk indirme, bozuk uzak nesne ve içi değiştirilmiş arşivin reddi.
- Aktif DB, onaysız ad, dolu DB ve var olan görsel hedefinin reddi.
- Yanlış secret, olmayan bucket, sidecar'ı yüklenemeyen arşiv ve yarıda kesilen
  multipart upload.
- Eşzamanlı yedek kilidi.
- Hata sonrası yeni yedek ve onaylı üzerine yazma.
- Yerel snapshot'tan restore.
- DB-only yedekte `RETENTION_DAYS`, uzak `mysql-restore.sh` ve restore smoke.

CI'da `Remote Backup E2E (MinIO)` job'u bunu bir MySQL 8.4 container'ıyla
çalıştırır. Paylaşılan runner'larda Docker Hub ve `public.ecr.aws`'ten anonim
imaj çekimi IP başına sınıra takıldığı için senaryonun bütün imajları (MySQL
dahil) Actions önbelleğinden yüklenir. Liste `--print-images` ile alınır;
eksik imaj bir kez çekilip `scripts/ci/docker-image-cache.sh` ile önbelleğe
yazılır. Linux'ta:

```bash
E2E_MYSQL_HOST=host.docker.internal E2E_MYSQL_PORT=3306 E2E_MYSQL_ADMIN_PASSWORD=... \
  npm run test:remote-backup-e2e
```

Windows'ta Git Bash'te `flock` yoktur. Testi bir Linux runner container'ında,
iç bind mount'lar Docker daemon'ında aynı yolu görecek şekilde çalıştırın
(Docker Desktop, yerel dev MySQL `127.0.0.1:3307`):

```bash
docker volume create hushle-backup-e2e-work
W=/var/lib/docker/volumes/hushle-backup-e2e-work/_data
MSYS_NO_PATHCONV=1 docker run --rm -v //var/run/docker.sock:/var/run/docker.sock \
  -v hushle-backup-e2e-work:$W -v "$(pwd -W):/repo:ro" -e E2E_WORK_PARENT=$W \
  -e E2E_MYSQL_HOST=host.docker.internal -e E2E_MYSQL_PORT=3307 -e E2E_MYSQL_ADMIN_PASSWORD \
  docker:29-cli sh -c 'apk add --no-cache bash coreutils util-linux findutils tar gzip curl >/dev/null &&
    mkdir /src && cd /repo && cp -R --parents scripts/ops scripts/test-remote-backup-e2e.sh docker-compose.ops.yml prisma/migrations /src/ &&
    find /src -name "*.sh" -exec sed -i "s/\r$//" {} + && bash /src/scripts/test-remote-backup-e2e.sh --run'
docker volume rm hushle-backup-e2e-work
```

Upstream `minio/minio` image'ı artık yayınlanmadığı için test, aynı sunucunun
bakımı süren topluluk build'ini digest ile pinler (`E2E_MINIO_IMAGE` ile değiştirilebilir).

## Açık Kalan İşler

### Yerel Doğrulama Kanıtları

- Lint, web TypeScript ve bütün workspace/package typecheck geçti.
- Web launch core: 31/31. Storage/backup, IP trust, checkout i18n,
  cosmetic render, branding upload ve release ops kontrolleri geçti.
- Görünür Chromium: 10/10 UI smoke, 2/2 çok oyunculu/reconnect/mobil katılım.
- Docker production image build geçti; aşağıda belirtilen bir NFT uyarısı kaldı.
- İki ayrı, kaldırılıp yeniden oluşturulan test container'ı aynı host mount'taki
  sentetik kozmetik dosyasını okudu; yedekler image içinde bulunmadı.
- Ayrı Linux production test container'ında DB/Redis health, görsel HTTP servisi,
  `/` 200, `/test` 404 ve `app-healthcheck.mjs` doğrulandı. Test container'ları
  kaldırıldı; host backup/test artifact'leri korundu.
- Gerçek MySQL dump ayrı, ağsız test DB'sine geri yüklendi. Canlı DB resetlenmedi.
- S3 adapter MinIO'ya karşı uçtan uca doğrulandı (yukarıdaki test, CI job'u).
  Gerçek R2 bucket testi yapılmadı.

### Release Gate'leri

- Dependency scan bulgularını runtime/dev ayrımıyla doğrulama ve uyumlu patch'ler.
- Build başarılı; storage import zincirinde bir Turbopack NFT tracing uyarısı
  kaldı. Runtime `data`/`backups` tracing ve Docker context'ten dışlanır; build'in
  uyarısız olduğunu söylemeyin. Daha dar runtime storage modülü ayrıca incelenecek.
- ~~Client finalize'dan bağımsız durable maç sonucu + reward outbox/worker.~~
  Tamamlandı (2026-10-12): `match_settlements` outbox'ı ve süreç içi worker.
  Kalan risk: maç biterken DB erişilemezken süreç de çökerse bellek tamponu kaybolur.
- Atomik release dizinleri ve kontrollü uygulama rollback; schema rollback otomatik olmaz.
- Gerçek R2 bucket kabul testi (bucket hazırlığı, yedek, liste, izole restore),
  cron/alarm kurulumu.
- Mağazada bounded server-side sayfalama/filtreleme ve audit archive lifecycle.
- Production merchant, SMTP, Turnstile, DNS/TLS ve origin firewall kabul testleri.

Bu maddeler tamamlanmadan tüm projeye "production işi bitti" etiketi verilmez.
