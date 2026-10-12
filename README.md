# Hushle

[![CI](https://github.com/Juanka-e/hushle/actions/workflows/ci.yml/badge.svg)](https://github.com/Juanka-e/hushle/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.4-4479A1?logo=mysql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)

**Hushle**, arkadaş grupları için geliştirilen gerçek zamanlı, takım tabanlı ve
Tabu benzeri bir çevrim içi kelime anlatma oyunudur. Oyuncular oda oluşturur,
takımlara ayrılır, yasaklı kelimeleri kullanmadan hedef kelimeyi anlatır ve süre
bitmeden en yüksek skora ulaşmaya çalışır.

Bu repository yalnızca oyun ekranını değil; yönetim paneli, içerik yönetimi,
oyuncu ekonomisi, kozmetik mağazası, ödeme altyapısı, güvenlik katmanları ve
operasyon araçlarını da içeren Hushle platformunun tamamını barındırır.

> Durum: Aktif geliştirme. Web sürümü önceliklidir. Ödeme sağlayıcıları, e-posta
> gönderimi ve bazı production entegrasyonları açık feature flag ve operasyon
> onayı olmadan devreye girmez.

## Öne Çıkanlar

### Oyun deneyimi

- Socket.IO tabanlı gerçek zamanlı oda ve oyun akışı
- Mobil ve masaüstü uyumlu lobi, takım panelleri ve oyun ekranı
- Misafir veya kayıtlı hesapla oynama
- Yönetici kontrollü takım, anlatıcı sırası ve oyun ayarları
- Türkçe ve İngilizce arayüz desteği
- Oda bazında ayrı kelime dili ve dile özel kategori/kelime paketleri
- Bağlantı kesintilerinde rol ve takım durumuna duyarlı güvenli duraklatma
- Reconnect sonrasında skor, kart, süre ve oyuncu kimliğini koruma
- Duyuru, tema, kart yüzü, kart arkası, avatar ve çerçeve sistemleri

### Platform ve canlı operasyon

- Merkezi ödül uygunluk kontrolü, coin ledger ve ekonomi guardrail'leri
- Mağaza, envanter, kuşanma, promosyon ve kupon temelleri
- Shopier, iyzico, PayTR ve Stripe için sağlayıcıya göre ayrılmış ödeme mimarisi
- Kullanıcı, maç geçmişi, audit, moderasyon ve destek araçları
- Kategori, kelime paketi, duyuru ve marka varlığı yönetimi
- Kapasite sağlığı, rate limit, Turnstile ve production güvenlik politikaları
- Audit arşivleme, telemetry rollup, e-posta ve webhook işleri için ayrı jobs runtime

## Mimari

Hushle erken microservice karmaşıklığına girmeden sınırları belirlenmiş bir
**modüler monolith** olarak geliştirilir.

```text
apps/
  web/       Next.js web uygulaması, admin paneli ve Socket.IO oyun sunucusu
  api/       Mobil ve harici istemciler için sürümlü API temeli
  jobs/      Audit, e-posta, ödeme ve retention işleri

packages/
  domain-*   Oyun ve ekonomi kuralları
  platform-* Kimlik, veritabanı, cache, ödeme, mağaza ve gözlemlenebilirlik

prisma/      MySQL şeması ve migration'lar
infra/       Operasyon ve yedekleme yardımcıları
nginx/       Reverse proxy ve production edge yapılandırması
docs/        Mimari kararlar, güvenlik rehberleri ve operasyon runbook'ları
```

### Temel teknoloji seti

| Katman | Teknoloji |
| --- | --- |
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Realtime | Socket.IO |
| Veritabanı | MySQL 8.4, Prisma |
| Cache ve koordinasyon | Redis 7 |
| Kimlik | Auth.js / NextAuth, credentials ve OAuth temeli |
| Test | Node tabanlı kontrat testleri, Playwright |
| Runtime | npm workspaces, Docker Compose, Nginx |

MySQL kalıcı iş verisinin source of truth katmanıdır. Redis cache, rate limit,
counter, lease ve dağıtık koordinasyon için kullanılır; kalıcı iş verisinin
yerini almaz.

## Yerel Kurulum

### Gereksinimler

- Node.js 20 veya üzeri
- npm
- Docker Desktop veya Docker Engine + Compose
- Git

### Hızlı başlangıç

```bash
git clone https://github.com/Juanka-e/hushle.git
cd hushle
cp .env.example .env
npm install
npm run infra:up
npm run db:sync
npm run dev
```

Windows PowerShell'de ortam dosyasını şu komutla oluşturabilirsiniz:

```powershell
Copy-Item .env.example .env
```

Uygulama varsayılan olarak [http://localhost:3000](http://localhost:3000)
adresinde açılır.

### Yerel servisler

| Servis | Varsayılan adres |
| --- | --- |
| Hushle web | `http://localhost:3000` |
| MySQL | `127.0.0.1:3307` |
| Redis | `127.0.0.1:6381` |
| Mailpit SMTP | `127.0.0.1:1025` |
| Mailpit UI | `http://127.0.0.1:8025` |

MySQL ve Redis named volume kullanır. `docker compose down` verileri silmez;
veriler yalnız volume açıkça kaldırılırsa silinir.

## Sık Kullanılan Komutlar

| Komut | Amaç |
| --- | --- |
| `npm run dev` | Web ve realtime geliştirme sunucusunu başlatır |
| `npm run infra:up` | MySQL, Redis ve Mailpit'i başlatır |
| `npm run infra:down` | Yerel altyapıyı durdurur, veriyi korur |
| `npm run infra:status` | Container durumlarını gösterir |
| `npm run db:sync` | Yerel şemayı uygular ve Prisma Client üretir |
| `npm run typecheck:web` | Web TypeScript kontrolünü çalıştırır |
| `npm run typecheck:packages` | Paket ve runtime sınırlarını typecheck eder |
| `npm run lint` | ESLint kontrolünü çalıştırır |
| `npm run build` | Production build üretir |
| `npm run test:web-launch-readiness:core` | Web açılış kontratlarını çalıştırır |
| `npm run test:web-multiplayer` | Çok oyunculu Playwright akışını çalıştırır |
| `npm run ops:preflight` | Production ortam değişkenlerini ve politikaları doğrular |

Veritabanında mutasyon yapan integration/E2E testleri geliştirme veritabanında
çalışmayı reddeder. Bu testler adı `tabu_test` içeren ayrı ve silinebilir bir
test veritabanı gerektirir.

## Güvenlik İlkeleri

- Oyun sonucu, rol, takım, ödül ve ödeme kararları sunucuda doğrulanır.
- İstemci verisi hiçbir zaman yetki veya ekonomi için source of truth değildir.
- State değiştiren HTTP ve socket işlemleri origin, session, rate limit ve şema
  kontrollerinden geçer.
- Coin işlemleri idempotent ledger kayıtları ve ödül kaynaklarıyla ayrıştırılır.
- Hassas güvenlik sinyalleri oyuncuya açıklanmaz; audit ve telemetry kanallarında
  takip edilir.
- Production secret'ları repository'ye eklenmez. `.env.example` yalnız şablondur.

Güvenlik açığı tespit ederseniz herkese açık issue içinde istismar ayrıntısı veya
gerçek kullanıcı verisi paylaşmayın; repository sahibiyle özel kanaldan iletişime
geçin.

## Production Topolojisi

Önerilen temel akış:

```text
Cloudflare -> Nginx -> Hushle Web/Realtime -> MySQL + Redis
                                      \-> Jobs runtime
```

Web uygulaması Docker ağı içinde özel kalmalı; yalnız Nginx `80/443` portlarını
yayınlamalıdır. Mevcut realtime oda state'i için production topolojisi tek writer
olarak sınırlandırılmıştır. Redis adapter ve ownership lease temelleri mevcut olsa
da yatay Socket.IO ölçekleme, ilgili readiness kapıları tamamlanmadan açılmamalıdır.

Production kurulumu için:

1. `.env.production.example` dosyasını `.env.production` olarak kopyalayın.
2. Gerçek secret, domain ve sağlayıcı ayarlarını girin.
3. Cloudflare origin certificate dosyalarını `nginx/ssl/` altına bağlayın.
4. Preflight kontrolünü çalıştırın.
5. Stack'i başlatın.

```bash
npm run ops:preflight
docker compose --env-file .env.production up -d --build
```

## Dokümantasyon

- [Mimari genel bakış](docs/architecture.md)
- [Workspace ve runtime ayrımı](docs/architecture/adr-001-apps-workspace-and-runtime-split.md)
- [Realtime production topolojisi](docs/architecture/adr-003-single-realtime-writer-topology.md)
- [Deployment güvenliği](docs/guides/deployment-security-guide.md)
- [Deployment operasyon runbook'u](docs/guides/deployment-ops-runbook.md)
- [Kalıcı görseller, veri yedekleme ve izole restore](docs/deploy/persistent-assets-and-data-backups.md)
- [Web açılış hazırlığı](docs/guides/web-launch-readiness-guide.md)
- [Ekonomi ve abuse koruması](docs/guides/economy-abuse-hardening-guide.md)
- [i18n, duyuru ve kelime paketleri](docs/guides/i18n-announcements-and-word-packs.md)
- [Ödeme ve yasal hazırlık](docs/guides/payment-checkout-and-legal-readiness.md)

## Geliştirme Akışı

- `main`: production'a aday kararlı sürümler
- `develop`: tamamlanan feature branch'lerinin entegrasyon hattı
- `feature/*`: izole özellik ve düzeltme çalışmaları

Değişiklik göndermeden önce en azından ilgili kontrat testlerini, typecheck'i ve
`npm run build` komutunu çalıştırın. Realtime veya responsive değişikliklerde
Playwright çok oyunculu akışını da doğrulayın.

## Marka Notu

Hushle bağımsız bir üründür. “Tabu benzeri” ifadesi yalnız oyun türünü açıklamak
için kullanılır; üçüncü taraf marka veya oyunlarla resmi bir bağlantı anlamına
gelmez.
