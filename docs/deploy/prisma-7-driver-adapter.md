# Prisma 7 ve MariaDB sürücü adaptörü

Prisma 7 ile Rust sorgu motoru kalktı. Uygulama MySQL'e `@prisma/adapter-mariadb`
üzerinden `mariadb` Node sürücüsüyle bağlanıyor. Bu not, Prisma 6'dan farklı çalışan
noktaları ve uygulamanın bunlara nasıl uyduğunu kaydeder.

## İstemci nerede?

- Şemadaki generator `prisma-client`. İstemci
  `packages/platform-db/src/generated/prisma` altına üretilir. Bu klasör git'e girmez;
  `npm run db:generate` ya da `npm run build` (prebuild) onu yeniden üretir.
- Kod istemciyi yalnız `@hushle/platform-db` üzerinden kullanır. `@prisma/client`'tan
  doğrudan import yoktur.
- `moduleFormat = "cjs"`: üretilen kod `import.meta` kullanmaz. Bu sayede Playwright'ın
  CommonJS dönüşümü de onu yükleyebilir; tsx ve Next.js aynı dosyaları ES modülü olarak
  yükler.

## Bağlantı adresi

- `prisma/schema.prisma` artık `url` içermez.
- Migrate komutları `DATABASE_URL`'i `prisma.config.ts` üzerinden okur. Prisma 7 `.env`
  dosyasını kendisi yüklemez. `prisma.config.ts`, `.env`'deki değerleri yalnız ortamda
  tanımlı olmayan anahtarlar için doldurur. CI, testler ve Docker'da verilen
  `DATABASE_URL` her zaman önceliklidir.
- Uygulama `DATABASE_URL`'i ilk bağlantı anında okur (`packages/platform-db/src/index.ts`).
  Değişken olmadan da paket import edilebilir; imaj derlemesi ve birim testleri bu
  sayede çalışır. O durumda yalnız sorgular `DATABASE_URL is not set.` hatası verir.

## Havuz ayarları (`packages/platform-db/src/connection.ts`)

| Ayar | Kaynak | Varsayılan |
| --- | --- | --- |
| En fazla bağlantı | URL'de `connection_limit`, yoksa `DATABASE_CONNECTION_LIMIT` (1-100) | 20 |
| Bağlanma zaman aşımı | URL'de `connect_timeout` (saniye) | 5 sn |
| Havuzdan bağlantı bekleme | URL'de `pool_timeout` (saniye) | 10 sn |
| Soket zaman aşımı | URL'de `socket_timeout` (saniye) | yok |
| Boşta bağlantının kapanması | sabit | 5 dk |

- Havuz, Prisma 6'daki gibi bağlantıyı sorgu geldikçe açar. `mariadb` sürücüsünün kendi
  varsayılanı açılışta bütün bağlantıları kurup açık tutmaktır; bu kapatıldı.
- Bu tablonun dışındaki URL parametreleri (örneğin `sslaccept`, `sslcert`, `socket`)
  sessizce yok sayılmaz, bağlantı hatayla durur. TLS gerekirse önce
  `resolveDatabasePoolConfig` genişletilmelidir.
- MySQL 8'in `caching_sha2_password` girişi TLS olmadan, sunucu yeniden başladıktan
  sonraki ilk girişte sunucunun RSA anahtarını ister. Bu yüzden
  `allowPublicKeyRetrieval` açıktır; Prisma 6'nın motoru da anahtarı aynı şekilde
  alıyordu. Veritabanı bağlantısı yalnız güvenilir ağda (Docker ağı) kalmalıdır.

## Hata biçimi

Sürücü adaptörüyle bazı hata ayrıntılarının yeri değişti:

| Durum | Prisma 6 | Prisma 7 |
| --- | --- | --- |
| Benzersizlik ihlali (P2002) | `meta.target` | `meta.driverAdapterError.cause.constraint.index` |
| Ham sorgu hatası (P2010) | `meta.code` (ör. `"1213"`) | `meta.driverAdapterError.cause.originalCode` |

Hata kodlarının kendisi (P2002, P2010, P2034, P2028) değişmedi. Ayrıntıya bakan kod iki
biçimi de okuyan yardımcıları kullanır:

- `getUniqueConstraintTarget(error)`: P2002'nin adlandırdığı indeks. Wallet
  idempotency yeniden denemesi buna dayanır.
- `isRetryableWriteConflict(error)`: P2034 ya da MySQL 1213'lü P2010 (deadlock).
  Ödeme checkout kontrolündeki yeniden deneme buna dayanır.

## Kısa ömürlü betikler

Havuzun soketleri Node'un olay döngüsünü açık tutar. Prisma 6'da bağlantılar motorun
içindeydi; `$disconnect` çağırmayan bir betik yine de kapanıyordu. Artık betikler ve
testler işleri bitince `prisma.$disconnect()` çağırmalıdır.

## CLI değişiklikleri

- `prisma migrate diff`: `--from-schema-datasource` yerine `--from-config-datasource`,
  `--to-schema-datamodel` yerine `--to-schema` kullanılır
  (`scripts/baseline-existing-database.ts`).
- `--skip-generate` kalktı. `db push` ve `migrate dev` artık istemciyi üretmez;
  gerekirse `npm run db:generate` çalıştırılır.
- Kurallar aynı: geliştirme veritabanında da `prisma migrate deploy` kullanılır.

## Testler

- `npm run test:platform-db-adapter`: adres eşleme kuralları ve hata yardımcıları. Prisma
  6 ve 7 biçimleriyle sınanır. Web-launch çekirdek setinin parçasıdır.
- `npm run test:platform-db-adapter-integration` (`PLATFORM_DB_ADAPTER_INTEGRATION_TEST=true`,
  `tabu_test`): gerçek MySQL üzerinde şunları doğrular. CI'ın Build işinde çalışır.
  - benzersizlik ihlalleri ve deadlock'lar;
  - READ COMMITTED, REPEATABLE READ ve SERIALIZABLE yalıtım davranışları;
  - tarihlerin UTC ve milisaniyesiyle saklanması;
  - ham sorgu sonuç tipleri.
