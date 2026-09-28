# Deployment Ops Runbook

Bu rehber Hushle icin hafif operasyon modelini tarif eder:

1. local development kolay kalir
2. production Docker Compose ile calisir
3. GitHub Actions Ubuntu 24.04 sunucuya otomatik deploy yapar
4. MySQL backup cron ile alinir ve opsiyonel olarak offsite object storage'a yazilir

## 1. Hedef Mimari

Production:

1. Cloudflare
2. Nginx container
3. Next.js app container
4. MySQL container
5. Redis container

Local development:

1. uygulama lokal `npm run dev`
2. sadece MySQL + Redis Docker ile ayaga kalkar

Bu ayrim onemli. Her degisiklikte localde tam Docker build beklemek istemiyoruz.

## 2. Local Development

Infra servislerini ac:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Local `.env.local` ornegi:

```env
DATABASE_URL=mysql://hushle:hushle@127.0.0.1:3307/hushle_dev
REDIS_URL=redis://127.0.0.1:6381
REDIS_KEY_PREFIX=hushle:development
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
AUTH_SECRET=local_dev_secret_change_me
```

Sonra:

```bash
npm install
npm run db:sync
npm run dev
```

## 3. Ubuntu 24.04 Sunucu Hazirligi

Sunucuda temel paketler:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 curl git
sudo systemctl enable --now docker
```

Deploy klasoru:

```bash
sudo mkdir -p /srv/hushle/app
sudo chown -R $USER:$USER /srv/hushle
cd /srv/hushle/app
```

Bu dosyalari sunucuda kalici tut:

1. `.env.production`
2. `nginx/ssl/origin-cert.pem`
3. `nginx/ssl/origin-key.pem`

## 4. Manual Ilk Deploy

Repo dosyalari sunucuya ciktiginda:

```bash
chmod +x scripts/ops/deploy.sh
./scripts/ops/deploy.sh
```

Bu script:

1. `mysql`, `redis`, `nginx` image'larini `pull` eder
2. app image'ini build eder
3. `docker compose up -d --build --remove-orphans` calistirir

Script production schema sync, post-deploy health veya otomatik rollback
calistirmaz. Release gate ve kanit akisi icin
`docs/deploy/release-process.md` zorunlu eslik eden dokumandir.

## 5. GitHub Actions Auto Deploy

Workflow dosyasi:

- `.github/workflows/deploy-production.yml`

Workflow release SHA ve arsiv checksum'i uretir, transfer sonrasi checksum'i
dogrular. Production concurrency grubu ayni anda tek deploy calistirir; yeni
calisma devam eden deploy'u iptal etmez.

Tetik:

1. `main` branch push
2. `workflow_dispatch`

Gerekli GitHub Actions secrets:

1. `PROD_HOST`
2. `PROD_PORT`
3. `PROD_USER`
4. `PROD_DEPLOY_PATH`
5. `PROD_SSH_PRIVATE_KEY`

Oneri:

1. repo `main` -> production deploy
2. `develop` -> sadece CI
3. production workflow icin GitHub Environment `production` kullan
4. gerekiyorsa manual approval ekle

Bugunku workflow in-place extract yapar; atomik release directory veya otomatik
onceki surume donus saglamaz. Rollback gercegi
`docs/deploy/rollback-and-incident.md` icinde tanimlidir.

GitHub Environments ve deployment protection kurallari resmi olarak desteklenir. Branch bazli workflow tetigi de resmi `push.branches` filtresiyle calisir.

## 6. MySQL Backup Stratejisi

Script:

- `scripts/ops/mysql-backup.sh`

Bu script:

1. `mysqldump --single-transaction --quick --routines --triggers`
2. gzip ile sikistirma
3. SHA-256 checksum
4. varsayilan `7` gun local retention
5. etkinse R2 / S3 / B2 upload ve remote size dogrulamasi

Calistirma:

```bash
chmod +x scripts/ops/mysql-backup.sh
./scripts/ops/mysql-backup.sh
```

Cron ornegi:

- `scripts/ops/mysql-backup.cron.example`

Restore:

```bash
chmod +x scripts/ops/mysql-restore.sh
./scripts/ops/mysql-restore.sh backups/mysql/hushle-mysql-YYYYMMDDTHHMMSSZ.sql.gz
```

Offsite ayarlari:

1. `.env.production` icinde `BACKUP_REMOTE_ENABLED=true`
2. provider'a gore `BACKUP_S3_ENDPOINT`, region, bucket ve prefix
3. yalniz backup prefix'ine erisen access key
4. provider lifecycle policy ile remote retention

Remote restore ve haftalik smoke:

```bash
./scripts/ops/mysql-restore.sh s3://bucket/prefix/mysql/backup.sql.gz
./scripts/ops/mysql-restore-smoke.sh backups/mysql/backup.sql.gz
```

Secret'lar yalniz `docker-compose.ops.yml` icindeki `backup-cli` servisine
gider. `app` ve `jobs` servislerine object-storage credential verilmez.

## 7. Cloudflare Admin Koruma Karari

En dogru model:

1. `admin.hushle.com` gibi ayri bir subdomain
2. Cloudflare Access ile kimlik dogrulama
3. tek IdP + MFA
4. gerekirse `/admin` icin ek WAF/rate-limit kurali

Neden ayri subdomain:

1. kural kapsamlarini temiz ayirirsin
2. admin icin daha sert cache/security ayarlari uygularsin
3. log ve Access policy yonetimi sade olur
4. ileride admin'i ayri origin veya ayri servis yaparsan migration daha kolay olur

Subdomain zorunlu degil, ama tavsiye edilir.

Eger tek domainde kalacaksan:

1. `/admin*`
2. `/api/admin*`

icin ayri Cloudflare kural setleri tanimla.

## 8. Ucretsiz Cloudflare Tarafinda Ne Kullanilmali?

Admin panel icin ilk tercih:

1. Cloudflare Access
2. Browser Integrity Check
3. login endpoint icin Turnstile
4. gerektiğinde kisa sureli Under Attack mode

Not:

1. Under Attack mode surekli acik bir ayar olmamali
2. admin panelde en degerli koruma uygulama onunde kimlik katmani oldugu icin Access en guclu secenektir
3. sadece WAF ile admin gizlemek yeterli degil

## 9. Yuku Dusuk Tutma Prensibi

Bu yapi bize sunu saglar:

1. localde tek komutla infra
2. uygulama lokal hizda gelistirilir
3. production tek script ile deploy olur
4. backup scripti cron ile calisir
5. GitHub Actions sadece paketleyip SSH ile tetikler, karma bir CD platformuna gerek kalmaz
