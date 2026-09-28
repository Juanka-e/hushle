# Ubuntu 24.04 And GitHub Actions

Sunucuda minimum:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 curl git
sudo systemctl enable --now docker
```

Deploy klasoru:

```bash
sudo mkdir -p /srv/hushle/app
sudo chown -R $USER:$USER /srv/hushle
```

GitHub Actions workflow:

- `.github/workflows/deploy-production.yml`

Bu workflow:

1. release arsivi olusturur
2. deploy edilen Git SHA'yi `.release-sha` icine yazar
3. arsiv icin SHA-256 checksum uretir
4. SSH ile arsiv ve checksum'i sunucuya yollar
5. checksum'i dogrular
6. sunucuda `scripts/ops/deploy.sh` calistirir
7. production concurrency grubu ile ayni anda tek deploy calistirir

Bugunku sinir:

- arsiv mevcut deploy klasorunun ustune acilir
- onceki release otomatik saklanmaz
- post-deploy health ve otomatik rollback yoktur
- DB schema otomatik degistirilmez

Bu nedenle production environment manual approval zorunlu operasyon kapi
olarak ele alinmalidir. Ayrintili akis:
`docs/deploy/release-process.md`.

Gerekli GitHub secrets:

1. `PROD_HOST`
2. `PROD_PORT`
3. `PROD_USER`
4. `PROD_DEPLOY_PATH`
5. `PROD_SSH_PRIVATE_KEY`

Onerilen branch akisi:

1. `feature/*` -> gelistirme
2. `develop` -> CI dogrulama
3. `main` -> production deploy

Not:

- Production Environment kullanip manual approval eklemek mantikli.
- Sunucuda `.env.production` ve `nginx/ssl/*.pem` dosyalari repodan bagimsiz kalici durmali.
- `REDIS_URL` degerini production'da acik yazmak daha temizdir. Docker icinde standart deger `redis://redis:6379` olur.
- `docker-compose.yml` icinde Redis healthcheck vardir; app container Redis hazir olmadan baslamaz.
- Cloudflare Origin Certificate kullaniyorsan `nginx/ssl` altinda `.pem` ve key dosyalari sunucuda kalici tutulmali, workflow bunlari overwrite etmemeli.
