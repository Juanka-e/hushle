# Production Checklist

Ubuntu 24.04 üzerinde hedef sade model:

1. Cloudflare edge
2. Nginx reverse proxy
3. Tek Next.js + Socket.IO app container
4. MySQL container
5. Redis container
6. GitHub Actions deploy

## İlk Kurulum

1. `docs/deploy/overview.md` dosyasını oku.
2. Sunucuda Docker ve Compose kur.
3. `/srv/hushle/app` klasörünü hazırla.
4. `.env.production` dosyasını sunucuda oluştur.
5. Cloudflare Origin Certificate `.pem` ve key dosyalarını kalıcı konuma koy.
6. `npm run ops:preflight -- --env-file .env.production` ile secret ve politika
   kontratını doğrula.
7. `docker compose --env-file .env.production -f docker-compose.yml config`
   komutuyla compose yapılandırmasını doğrula.
8. İlk ayağa kaldırmayı manuel yap.

## GitHub Actions Secrets

1. `PROD_HOST`
2. `PROD_PORT`
3. `PROD_USER`
4. `PROD_DEPLOY_PATH`
5. `PROD_SSH_PRIVATE_KEY`

## Zorunlu Env Değerleri

1. `DATABASE_URL`
2. `AUTH_SECRET`
3. `NEXTAUTH_URL`
4. `NEXT_PUBLIC_SITE_URL`
5. `MYSQL_ROOT_PASSWORD`
6. `MYSQL_PASSWORD`
7. `HEALTHCHECK_TOKEN`
8. `REDIS_URL`
9. `INSTANCE_ID=hushle-app-1`
10. `REALTIME_TOPOLOGY=single-writer`
11. `REALTIME_REPLICA_COUNT=1`
12. `MATCH_FINALIZE_TELEMETRY_ROLLUP_ENABLED=true`
13. `TELEMETRY_ROLLUP_RETENTION_DAYS=45`
14. Urun analytics acilacaksa `PRODUCT_ANALYTICS_ENABLED=true`
15. `PRODUCT_ANALYTICS_RETENTION_DAYS=45`
16. Kelime liveops olcumu acilacaksa `WORD_ANALYTICS_ENABLED=true`
17. `WORD_ANALYTICS_RETENTION_DAYS=45`
18. Zorunlu e-posta doğrulama açılacaksa `EMAIL_PROVIDER=smtp`
19. `EMAIL_FROM`, `EMAIL_TOKEN_SECRET`, `SMTP_HOST`, `SMTP_PORT`
20. SMTP auth gerekiyorsa yalnız jobs container için `SMTP_USER`, `SMTP_PASS`
21. `JOBS_ENABLED=true` ve email delivery/retention scheduler
22. `PRODUCTION_CAPTCHA_POLICY=turnstile` veya yazili risk kabul karari
23. `PRODUCTION_EMAIL_POLICY=smtp` veya yazili risk kabul karari
24. `PRODUCTION_EMAIL_FEEDBACK_POLICY=ses_sns` ise exact
    `SES_SNS_TOPIC_ARNS`, `SES_ALLOWED_SOURCE_ARNS` ve aktif webhook; başka
    provider ise yazılı risk kabulü
25. `ADMIN_ACCESS_MODE`, fail-closed gateway header/identity allowlist'i
26. `BACKUP_REMOTE_ENABLED=true` ve S3-compatible hedef bilgileri
27. `STATE_CHANGE_ORIGIN_POLICY=strict` ve exact `TRUSTED_WEB_ORIGINS`
28. `PRODUCTION_OAUTH_POLICY=google` ise `GOOGLE_OAUTH_ENABLED=true`,
    `AUTH_GOOGLE_ID` ve `AUTH_GOOGLE_SECRET`

## Deploy Öncesi

1. Production preflight blocker olmadan geçiyor mu kontrol et.
2. `main` branch temiz ve build alıyor mu kontrol et.
3. `npm run build`
4. `npm run test:realtime-topology`
5. `npm run test:telemetry-rollup`
6. Kritik smoke testleri çalıştır:
   - `npm run test:web-launch-readiness`
   - `npm run test:distributed-coordination`
   - `npm run test:room-capacity-controls`
   - `npm run test:economy-guardrails`
   - `npm run test:word-category-selection-ui`
   - `npm run test:card-flip-settings`
7. Nginx upstream'inin yalnız `app:3000` içerdiğini doğrula.
8. Compose tarafında tek `app` container çalıştığını doğrula.
9. MySQL backup cron aktif mi kontrol et.
10. `email-delivery` dry-run provider ready ve bekleyen mesaj sayısını doğruluyor mu kontrol et.
11. Mail provider production smoke hesabına doğrulama e-postası ulaştırıyor mu kontrol et.
12. Parola reset ve e-posta değişim bağlantıları tek kullanımdan sonra reddediliyor mu kontrol et.
13. Güvenlik işlemi sonrası web, mobile ve Redis adapter üzerinden aktif oyun socket'leri kapanıyor mu kontrol et.
14. `npm run test:account-recovery-e2e` ve local MySQL üzerinde
    `ACCOUNT_RECOVERY_INTEGRATION=true npm run test:account-recovery-integration`
    geçti mi kontrol et.
15. SES kullanılıyorsa gerçek SNS subscription confirmed, permanent bounce ve
    complaint simulator eventleri idempotent biçimde suppression oluşturuyor mu kontrol et.

## Deploy Sonrası

1. Health endpointini kontrol et.
2. `realtime.topology.mode=single-writer` olduğunu doğrula.
3. `realtime.topology.declaredReplicaCount=1` olduğunu doğrula.
4. `realtime.topology.multiInstanceReady=false` bekle; bu bir hata değildir.
5. Admin login akışını kontrol et.
6. Oda oluşturma ve odaya dönme akışını kontrol et.
7. Redis bağlantısı ve rate-limit fallback loglarını izle.
8. Nginx TLS zinciri ve Cloudflare origin handshake kontrolü yap.
9. Admin kapasite kartında instance, oda, oyuncu ve event-loop verisini kontrol et.
10. Admission `closed` iken mevcut oyuncunun reconnect olabildiğini kontrol et.
11. `telemetry.matchFinalize` altında recorded ve audit fallback sayaçlarını izle.
12. Audit fallback sürekli artıyorsa Redis erişimini kontrol et.
13. Integration Hub `Email Outbound` durumunun ready olduğunu kontrol et.
14. Email delivery job sonucunda retry/dead-letter artışını izle.
15. `npm run db:migrate:status` ile bekleyen veya hatalı migration olmadığını
    doğrula.
16. Ödeme açıksa `hushle-payment-webhook.timer` ve
    `hushle-payment-reconciliation.timer` aktif ve son çalışmaları başarılı olmalı.
17. Uygulama sunucusu dışındaki monitor
    `scripts/ops/check-payment-health.sh` ile iki scheduler'ı `healthy` görmeli.
18. Ödeme açıksa legal ve provider acceptance evidence dosyalarının SHA-256 değerleri
    production env ile eşleşmeli; preflight stale veya değiştirilmiş kanıtı reddetmeli.
19. `PAYMENT_ROLLOUT_SEED` secret manager'da sabit tutulmalı; checkout varsayılan
    paused/0% durumundan admin ödeme operasyonları ekranında kontrollü açılmalı.
20. Acil durdurma testinde yeni checkout 503 alırken callback, webhook ve reconciliation
    worker'larının mevcut siparişleri işlemeye devam ettiği doğrulanmalı.

Web launch test katmanlari ve disposable DB siniri:
`docs/guides/web-launch-readiness-guide.md`.

## Realtime Ölçekleme Engeli

Aktif oda state'i process-local kaldığı sürece `app` replica sayısını artırma.
Redis adapter veya ownership lease özelliğini açmak bu kuralı değiştirmez.
Geçiş koşulları:

1. `docs/architecture/adr-003-single-realtime-writer-topology.md` içindeki
   multi-instance migration gate tamamlanmalı.
2. Polling kullanılacaksa gerçek load-balancer affinity doğrulanmalı.
3. Owner-aware command forwarding ve owner failure davranışı uygulanmalı.
4. Reconnect, failover, rolling deploy ve yük testleri geçmeli.

## Rollback

1. Mevcut workflow'un onceki release'i otomatik saklamadigini kabul et.
2. Release oncesinde rollback adayi SHA ve dogrulanmis source arsivini belirle.
3. Rollback oncesi guncel DB backup ve checksum al.
4. Persistent `.env.production`, SSL dosyalari ve volume'lara dokunma.
5. Uygulama rollback'inin DB rollback'i olmadigini kontrol et.
6. Ayrintili sirayi `rollback-and-incident.md` dosyasindan uygula.

## Backup Disiplini

1. Günlük local MySQL dump
2. Haftalık restore testi
3. Sonraki adımda offsite kopya

## Notlar

1. Redis source of truth değildir; cache, rate limit ve koordinasyon katmanıdır.
2. Local geliştirme Redis olmadan devam edebilir.
3. `/admin` aynı origin üstünde kalırsa CORS ve auth riski daha düşüktür.
4. Hem `/admin` hem subdomain uzun süre desteklenecekse
   `subdomain-and-cors.md` zorunlu tasarım girdisidir.
