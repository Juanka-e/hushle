# Kalıcı Görseller Ve Veri Yedekleri

Güncelleme: 2026-10-06. Hushle MySQL kullanır. Redis kalıcı iş verilerinin veya
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

Mevcut S3-compatible adapter kullanılır: `BACKUP_REMOTE_ENABLED`, endpoint, bucket,
region, access key ve secret key. R2 veya AWS S3 aynı kontratla kullanılabilir.
Full snapshot `.tar.gz` ve SHA-256 sidecar olarak `/data/` prefix'ine gönderilir;
upload sonrası object size doğrulanır. **Size kontrolü tek başına içerik/restore
kanıtı değildir:** indirilmiş arşiv checksum'ı ve iç manifest doğrulanmalı, ayrı
MySQL restore drill yapılmalıdır. Bucket kimlik bilgileri olmadığı için gerçek
offsite acceptance henüz tamamlanmadı.

Bucket private olmalı; least-privilege servis anahtarı ve TLS kullanın. R2/S3
lifecycle, versioning/immutability ve şifreleme sağlayıcı tarafında ayrıca kurulur;
env değerini yazmak bu politikaları kendiliğinden oluşturmaz. Yerel kopyanın yanı
sıra başka disk/bucket kopyası olmadan disk kaybına dayanıklı olduğunu söylemeyin.

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
- S3 adapter mock testi geçti; gerçek uzak bucket testi yapılmadı.

### Release Gate'leri

- Dependency scan bulgularını runtime/dev ayrımıyla doğrulama ve uyumlu patch'ler.
- Build başarılı; storage import zincirinde bir Turbopack NFT tracing uyarısı
  kaldı. Runtime `data`/`backups` tracing ve Docker context'ten dışlanır; build'in
  uyarısız olduğunu söylemeyin. Daha dar runtime storage modülü ayrıca incelenecek.
- Client finalize'dan bağımsız durable maç sonucu + reward outbox/worker. Cüzdan
  kilidi eşzamanlı cap yarışını kapatır, ama tarayıcı kapanması/server restart sonrası
  ödül işinin kaybolması sorununu tek başına çözmez.
- Atomik release dizinleri ve kontrollü uygulama rollback; schema rollback otomatik olmaz.
- Gerçek bucket acceptance, cron/alarm kurulumu, offsite indirme/restore tatbikatı.
- Mağazada bounded server-side sayfalama/filtreleme ve audit archive lifecycle.
- Production merchant, SMTP, Turnstile, DNS/TLS ve origin firewall kabul testleri.

Bu maddeler tamamlanmadan tüm projeye "production işi bitti" etiketi verilmez.
