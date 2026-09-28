# Gorev Kaydi

> Son guncelleme: 27 July 2026
> Durum: aktif execution log

## Cekirdek Kurallar
- Her branch tek konu tasir.
- Implementasyon sonunda `review`, `test`, `refactor`, `docs`, `push` kapanisi zorunludur.
- PR olmadan once branch kapsam disina cikilmaz.

## Yakin Zamanda Tamamlanan Branch'ler
- `feature/admin-user-observability`
- `feature/economy-abuse-hardening`
- `feature/gameplay-ui-polish`
- `feature/packages-extraction-foundation`

## Aktif Branch

### `chore/dependency-security-refresh`

Hedef:
- kritik ve yuksek production dependency advisory'lerini major migration yapmadan azaltmak
- kullanilmayan runtime paketlerini kaldirarak saldiri yuzeyini kucultmek
- residual riskleri audit sayisini gizlemeden kaydetmek

Tamamlananlar:
- Auth.js `beta.32` ve Next.js `16.2.12`
- PostCSS, Playwright, ESLint Next ve Socket.IO transitif patch'leri
- kullanilmayan Multer ve DOMPurify/jsdom zincirinin kaldirilmasi
- production kritik advisory sayisinin sifirlanmasi
- production audit toplaminda `17 -> 4`
- tam lint, typecheck, security smoke, Playwright ve build turu

Siradaki kontrollu adimlar:
- upstream Next Sharp/PostCSS destegini izlemek
- branch review ve PR kapanisi

## Onceki Branch Kaydi
### `feature/gameplay-ui-polish`
Hedef:
- room, lobby ve dashboard arasinda oyuncu kimligi UX'ini sadelestirmek
- `displayName` akisina tutarlilik kazandirmak
- audit kimlik snapshot'ini gelecekteki moderasyon akislarina hazirlamak
- gameplay yuzeylerindeki gereksiz gurultuyu azaltmak
- sonraki modularizasyon isleri icin `apps/` ve local infra planini repo icinde netlestirmek

Bu branch'te tamamlanan ana isler:
- settings kaynakli `displayName` yonetimi
- lobby quick edit ile kayitli / guest isim akisi
- kayitli kullanicida bos isim icin `username` fallback
- audit identity snapshot alanlari
- audit tarafinda guest / kayitli ayrimi
- room ust bar ve mobil yardimci menu temizligi
- pause sirasinda ust modallara erisim
- hazirlik ekrani UX iyilestirmesi
- ilk geciste `Oyun basliyor`, sonraki gecislerde `Anlatici degisiyor` copy'si
- countdown'in `0`'da bitmesi
- stale room storage yuzunden olusan yanlis oda blokajinin kaldirilmasi
- kayitli kullanici icin server-side aktif oda korumasinin eklenmesi
- create/join aninda O(1) lookup icin process-local registered room index optimizasyonu
- bildirim sheet close aksiyonunun yeniden ust saga alinmasi
- hizli kusan bolumunun tekrar tek satira alinmasi
- envanterde kusanilan kozmetigi dogrudan cikarabilme
- room / lobby logosunun ust merkezde yeniden dengelenmesi
- `apps/` workspace, modularizasyon ve Docker persistence planinin dokumante edilmesi
- root npm workspace kontratinin `apps/*` ve `packages/*` icin acilmasi
- Redis retry, health, graceful shutdown ve key prefix altyapisinin tamamlanmasi
- MySQL 8.4 + Redis icin kalici ve local-only Docker infra akisinin dogrulanmasi

Bu branch'te acik kalan takip maddeleri:
- admin kategoriler surukle-birak davranisini gercek kullanimda son kez dogrulama
- aktif oda korumasini reconnect ve farkli browser senaryolarinda son kez kontrol etme
- bildirim sheet, toast, header ve hizli kusan yerlesimini cihazlarda son kez kontrol etme
- `docs/guides/gameplay-ui-polish-smoke-checklist.md` ile gercek cihaz final smoke turu
- kart tasarim sistemi teknik olarak ertelenebilir; premium art direction arastirmasi tamamlanana kadar bu konu not/backlog seviyesinde tutulacak

Kapsam disi birakilanlar:
- admin detayli mac gecmisi yuzeyi
- room sifre akisi
- oda kapasitesi / oyuncu sirasi yonetimi
- XP, gorev ve event runtime
- fiziksel `apps/web` / `apps/api` tasimasi

## Sonraki Branch Adaylari
1. `feature/admin-match-history-review`
2. `feature/admin-categories-dnd-polish`
3. `feature/room-rules-and-capacity-controls`
4. `feature/cache-and-rate-limit-foundation`
5. `feature/jobs-runtime-foundation`
6. `feature/post-launch-economy-observability-review`
7. `feature/admin-player-messaging`

## Referanslar
- `docs/guides/economy-abuse-hardening-guide.md`
- `docs/guides/player-display-name-and-audit-strategy-guide.md`
- `docs/cache-and-storage-strategy.md`
- `docs/architecture/apps-migration-plan.md`
- `docs/implement docs/remaining.md`
