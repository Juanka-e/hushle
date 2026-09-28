# MySQL Backups

Uygulanan yapi:

1. `scripts/ops/mysql-backup.sh`
2. `scripts/ops/mysql-restore.sh`
3. `scripts/ops/mysql-backup.cron.example`
4. `scripts/ops/object-storage.sh`
5. `scripts/ops/mysql-restore-smoke.sh`
6. `docker-compose.ops.yml`

Backup mantigi:

- `mysqldump --single-transaction --quick --routines --triggers`
- gzip sikistirma
- her dump icin tasinabilir SHA-256 checksum
- varsayilan 7 gun local retention
- opsiyonel S3-compatible offsite upload ve remote size dogrulamasi

Elle backup:

```bash
./scripts/ops/mysql-backup.sh
```

Restore dogrudan aktif veritabaninin ustune yapilmaz. Once izole bir hedef DB
olusturulur:

```bash
docker compose --env-file .env.production -f docker-compose.yml exec -T mysql \
  sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e \
  "CREATE DATABASE hushle_restore_incident_YYYYMMDD CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"'

RESTORE_DATABASE=hushle_restore_incident_YYYYMMDD \
RESTORE_USE_ROOT=true \
  ./scripts/ops/mysql-restore.sh \
  backups/mysql/hushle-mysql-YYYYMMDDTHHMMSSZ.sql.gz
```

Remote restore:

```bash
RESTORE_DATABASE=hushle_restore_incident_YYYYMMDD \
RESTORE_USE_ROOT=true \
  ./scripts/ops/mysql-restore.sh \
  s3://bucket-name/production/mysql/hushle-mysql-YYYYMMDDTHHMMSSZ.sql.gz
```

Restore varsayilan olarak ayni dizindeki `.sha256` dosyasini zorunlu tutar.
Eski bir backup'i kontrollu olarak restore etmek gerekirse yalniz o komut icin
`BACKUP_REQUIRE_CHECKSUM=false` verilebilir.

Haftalik, gecici veritabanina restore smoke testi:

```bash
./scripts/ops/mysql-restore-smoke.sh \
  backups/mysql/hushle-mysql-YYYYMMDDTHHMMSSZ.sql.gz
```

Smoke scripti benzersiz bir test veritabani olusturur, restore edilen tablo
sayisini kontrol eder ve basarili/basarisiz her cikista test veritabanini siler.
Production veritabaninin adini hedef olarak kullanmaz.

## Race Ve Cutover Guvenligi

`mysql-backup.sh`, `mysql-restore.sh` ve `deploy.sh` ayni
`backups/.locks/mysql-schema-ops.lock` kilidini kullanir. Sonuc:

- migration ve backup ayni anda calismaz
- restore ve deploy ayni anda calismaz
- ikinci operasyon varsayilan 15 dakika bekler, sonra fail eder
- lock process kapaninca kernel tarafindan serbest birakilir; stale PID lock'u
  kalmaz

`mysqldump --single-transaction` InnoDB satirlari icin tutarli snapshot alir.
Ortak lock ayrica dump sirasinda schema migration baslamasini engeller. Uzun
sureli DDL veya elle calistirilan SQL bu kontratin disindadir ve production'da
yasaktir.

Schema-ops lock uygulama transaction'larini durdurmaz. Normal migration'lar bu
nedenle expand/contract ve eski app surumuyle uyumlu tasarlanir. Destructive veya
uzun lock alan migration icin ayrica maintenance, job durdurma ve dusuk trafik
penceresi gerekir.

Restore/cutover sirasi:

1. Yeni oda girisini ve DB yazan job'lari maintenance proseduruyle durdur.
2. Mevcut aktif DB'nin yeni backup ve checksum'unu al.
3. Backup'i `hushle_restore_*` adli izole DB'ye yukle.
4. Restore DB icin ayri `DATABASE_URL` ile `prisma migrate deploy` calistir.
   Backup baseline oncesinden geliyorsa once sifir drift kosuluyla mevcut-DB
   baseline prosedurunu uygula; tablo varken baseline SQL'i tekrar calistirma.
5. `prisma migrate status`, drift, tablo/satir sanity ve uygulama smoke yap.
6. Restore DB backup tarihinden sonra olusan wallet/email/admin yazilarinin kayip
   etkisini incident kaydinda hesapla.
7. Production `DATABASE_URL` degerini izole DB'ye kontrollu cevir ve stack'i
   restart et.
8. Health, login, room, finalize ve admin smoke gecmeden admission'i acma.
9. Eski DB'yi hemen silme; rollback penceresi boyunca read-only tut.

Aktif DB adiyla `RESTORE_DATABASE` verilirse script fail-closed davranir.
Standart `hushle_restore_*` disinda izole hedef kullanmak icin ek olarak
`RESTORE_TARGET_CONFIRM=I_ACCEPT_AN_ISOLATED_RESTORE_TARGET` gerekir.

Backup uygulama kodunu, Socket.IO protokolunu veya renderer dosyalarini tasimaz;
yalniz DB snapshot'idir. Kod surumu Git SHA ile deploy edilir. Eski backup'in
schema version'i cutover oncesi migration ile ileri alinir. Daha yeni schema'dan
daha eski koda rollback ise otomatik guvenli kabul edilmez.

Redis cache/lease/counter verisi ve process-local aktif odalar MySQL backup'ina
dahil degildir. Restore, devam eden odalari veya backup sonrasindaki event'leri
geri getirmez.

## Offsite Object Storage

Amazon tarafindaki urunun adi `Amazon S3`'tur. Cloudflare R2, Backblaze B2 ve
benzeri servisler S3-compatible API sunar. Ops scriptleri tek saglayiciya
baglanmaz.

Uygulanan sinir:

1. `mysql-backup.sh` local `.sql.gz` dosyasini olusturmaya devam eder.
2. Dump icin SHA-256 checksum uretilir.
3. Dump ve checksum private S3-compatible bucket'a yuklenir.
4. Her upload remote object size ile dogrulanir.
5. Remote restore checksum dosyasini da indirir.
6. Checksum dogrulanmadan MySQL restore baslamaz.
7. Haftalik smoke ayri bir gecici veritabaninda calisir.

Saglayicidan bagimsiz ops env kontrati:

- `BACKUP_REMOTE_ENABLED`
- `BACKUP_S3_ENDPOINT`
- `BACKUP_S3_REGION`
- `BACKUP_S3_BUCKET`
- `BACKUP_S3_PREFIX`
- `BACKUP_S3_ACCESS_KEY_ID`
- `BACKUP_S3_SECRET_ACCESS_KEY`
- `BACKUP_S3_CLI_MODE`
- `BACKUP_AWS_CLI_IMAGE`
- `BACKUP_REMOTE_RETENTION_DAYS`

R2 ornegi:

```env
BACKUP_REMOTE_ENABLED=true
BACKUP_S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
BACKUP_S3_REGION=auto
BACKUP_S3_BUCKET=hushle-backups
BACKUP_S3_PREFIX=production
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
BACKUP_S3_CLI_MODE=docker
BACKUP_AWS_CLI_IMAGE=public.ecr.aws/aws-cli/aws-cli:2.36.10
BACKUP_REMOTE_RETENTION_DAYS=30
```

Amazon S3 kullanirken `BACKUP_S3_ENDPOINT` bos, region ise bucket region'i
olmalidir. R2 kullanirken account endpoint'i ve `auto` region kullanilir.

Bu secret'lar Next.js `app` veya `jobs` container'ina verilmez. Yalniz
`docker-compose.ops.yml` icindeki `backup-cli` servisine aktarilir. Hostta
AWS-compatible CLI kuruluysa `BACKUP_S3_CLI_MODE=host` da kullanilabilir.
Ops container host kullanicisinin UID/GID degerleriyle calisir; indirdigi
backup dosyalarini root-owned birakmaz. Resmi AWS ECR Public image'i immutable
bir tam surume pinlidir; surum guncellemesi testlerden sonra bilincli yapilir.

Guvenlik ve retention:

- bucket public access tamamen kapali
- credentials yalniz belirlenen backup prefix'i icin minimum yetkili
- transit sifreleme TLS; provider-side at-rest encryption zorunlu
- local kopya varsayilan 7 gun
- remote gunluk kopya ilk asamada 30 gun
- remote silme scriptle degil provider lifecycle policy ile yonetilir
- `BACKUP_REMOTE_RETENTION_DAYS` lifecycle icin operasyonel kontrattir
- backup yazma kimligine remote delete yetkisi verilmez
- kritik production icin versioning ve mumkunse Object Lock degerlendirilir

Offsite icin uygun adaylar:

1. Cloudflare R2
2. Amazon S3
3. Backblaze B2

Erken asamada R2 genellikle basit ve dusuk egress maliyetli secenektir. AWS
altyapisi zaten kullaniliyorsa S3 daha dogal secimdir. Ayni scriptler iki
hedefte de S3-compatible kontrati kullanir.
