# Deployment Overview

Hafif model:

1. localde app `npm run dev`
2. local infra icin `docker-compose.dev.yml`
3. production'da `docker-compose.yml`
4. deploy tetigi GitHub Actions
5. hedef sunucu Ubuntu 24.04
6. reverse proxy Nginx
7. edge katmani Cloudflare

Temel kural:

- local gelistirme ile production orkestrasyonu ayri kalir
- localde her degisiklikte tam Docker build beklenmez
- Redis yoksa uygulama memory fallback ile calismaya devam eder
- production compose tarafinda Redis healthcheck gecmeden app kalkmis sayilmaz
- production'da sadece Nginx `80/443` acik eder
- app, MySQL ve Redis private Docker networkte kalir
- realtime room state process-local oldugu icin production tek `app` replica
  kullanir; Nginx upstream'i yalniz `app:3000` hedefler
- `REALTIME_TOPOLOGY=single-writer` ve `REALTIME_REPLICA_COUNT=1` runtime
  tarafinda da dogrulanir
- Redis adapter ve ownership lease temelleri tek basina yatay realtime
  olceklendirme izni vermez
- bugunku deploy arsivi mevcut klasorun ustune acilir; atomik release ve
  otomatik rollback henuz yoktur
- production schema degisikligi ayri tek-seferlik migration container'inda,
  app rollout'undan once uygulanir; ilk mevcut-DB baseline kaydi manuel ve
  backup/drift kontrolludur

Ilgili dosyalar:

- `docker-compose.dev.yml`
- `docker-compose.yml`
- `scripts/ops/deploy.sh`
- `docs/deploy/release-process.md`
- `docs/deploy/database-migrations.md`
- `docs/deploy/rollback-and-incident.md`
- `docs/deploy/launch-day-checklist.md`
- `docs/architecture/adr-003-single-realtime-writer-topology.md`
- `docs/guides/deployment-security-guide.md`
- `docs/guides/deployment-ops-runbook.md`
