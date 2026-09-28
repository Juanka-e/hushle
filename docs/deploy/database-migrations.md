# Database Migrations

Bu dokuman MySQL sema degisikliklerinin veri sifirlamadan nasil yonetilecegini
tanımlar. `prisma/schema.prisma` hedef modeli, `prisma/migrations` ise bu hedefe
hangi sirayla ulasilacaginin kalici gecmisidir.

## Temel Kurallar

1. Production ve paylasilan ortamlarda `prisma db push` kullanilmaz.
2. Yeni sema degisikligi `npm run db:migrate:dev -- --name <acik-ad>` ile ayri
   migration olarak uretilir.
3. Uretilen SQL kod incelemesinde veri kaybi, lock suresi ve eski uygulama
   surumuyle ileri/geri uyumluluk acisindan incelenir.
4. Production migration oncesi guncel backup ve basarili restore smoke kaniti
   gerekir.
5. `migrate deploy` yalniz version control'deki migration'lari uygular; schema
   tahmini yapmaz ve veritabanini sifirlamaz.
6. Baseline islemi normal deploy adimi degildir ve otomatik calismaz.
7. Backup, restore ve production migration ortak schema-ops lock'u altinda
   calisir; birbirleriyle ayni anda baslamaz.

## Mevcut Veritabanini Baseline Etme

`20260731000000_baseline`, bos bir MySQL veritabanini bugunku semaya getirir.
Halihazirda ayni tablolari ve verileri tasiyan bir veritabaninda bu SQL tekrar
calistirilmaz. Bunun yerine migration metadata'si bir kez kaydedilir.

Once backup ve drift kontrolu:

```bash
npm run db:migrate:status
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

`No difference detected` disinda sonuc varsa baseline yapilmaz. Fark veri
sifirlamadan incelenip uzlastirilir.

Backup ve restore smoke dogrulandiktan sonra:

```bash
PRISMA_BASELINE_CONFIRM=I_HAVE_A_VERIFIED_BACKUP \
  npm run db:migrate:baseline:existing
```

Docker production ortami icin ayni kontrollu komut:

```bash
docker compose --env-file .env.production -f docker-compose.yml \
  --profile migration build migrate
docker compose --env-file .env.production -f docker-compose.yml \
  --profile migration run --rm \
  -e PRISMA_BASELINE_CONFIRM=I_HAVE_A_VERIFIED_BACKUP \
  migrate npm run db:migrate:baseline:existing
```

Bu komut once mevcut DB ile Prisma modelini karsilastirir. Drift varsa durur;
baseline SQL'i calistirmaz ve kullanici tablolarini silmez.

## Normal Release

`scripts/ops/deploy.sh` su sirayi uygular:

1. migration image'ini build eder
2. tek-seferlik `migrate` servisiyle `prisma migrate deploy` calistirir
3. migration basarisizsa app rollout'una gecmeden durur
4. migration basariliysa servisleri yeniden kurar

Migration app container'inin startup komutuna bagli degildir. Bir app restart'i
sema islemini tekrar tetiklemez. Prisma migration tablosu daha once uygulanmis
adimlarin ikinci kez calismasini engeller.

## Lokal Gelistirme

Yeni migration gereken kalici bir model degisikligi:

```bash
npm run db:migrate:dev -- --name add_example_field
```

`npm run db:push:local` yalniz gecici local prototiplerde kullanilir. Merge
edilecek schema degisikligi mutlaka migration dosyasi tasir.

Temiz veritabaninda dogrulama:

```bash
npm run db:migrate:deploy
npm run db:migrate:status
```

CI her calismada bos MySQL veritabanina migration gecmisini uygular. Bu, baseline
ve sonraki migration'larin sifirdan kurulabildigini denetler.

## Hata Durumu

1. `migrate deploy` hata verirse uygulama rollout'u durur.
2. Migration dosyasi uygulanmaya basladiktan sonra degistirilmez.
3. Otomatik `db push`, `--accept-data-loss` veya volume silme kullanilmaz.
4. Prisma status ve DB loglari saklanir; gerekirse kontrollu forward-fix
   migration hazirlanir.
5. Uygulama rollback'i migration rollback'i anlamina gelmez. Bu nedenle schema
   degisiklikleri mumkun oldugunca once genislet, sonra kodu gecir, en son eski
   alani kaldir sirasi ile yapilir.
6. Eski backup aktif DB ustune import edilmez. Izole DB'ye restore edilir,
   mevcut migration'larla ileri alinir ve ancak smoke sonrasi cutover edilir.
