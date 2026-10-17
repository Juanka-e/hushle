# Bağlantı Duraklatması Çözümü ("Onsuz devam et / Maçı bitir") Tasarımı

Tarih: 13 Ekim 2026. Durum: kullanıcı onayladı (9–12 Ekim sohbeti).

## Problem

Bağlantıya duyarlı duraklatma (#150), anlatıcı/gözetmen düştüğünde veya bir takımın
çevrimiçi oyuncusu 2'nin altına indiğinde maçı durduruyor. Oyuncu hiç dönmezse
yönetici devam ettiremiyor, oyuncuyu atamıyor; tek çıkış skoru silen sıfırlama.

## Kararlar

1. Duraklatma başladıktan **60 sn** sonra yönetici iki karar verebilir:
   - **Onsuz devam et:** eksik oyuncular maçtan çıkarılır (izleyici olur). Yalnız
     çıkarıldıktan sonra her iki takımda en az 2 çevrimiçi oyuncu kalıyorsa sunulur.
   - **Maçı bitir:** maç mevcut skorla `host_ended` olarak biter; coin yok, galibiyet
     sayılmaz, maç geçmişe yazılır (#153 politikası).
2. Yönetici de eksikse, maçtaki herhangi bir çevrimiçi aktif oyuncu karar verebilir.
3. Eksikler arasında **anlatıcı** varsa:
   - tur sırasında: tur süre dolmuş gibi biter, sıra karşı takıma geçer;
   - geçiş ekranında: aynı takım için yeni anlatıcıyla geçiş yeniden başlar (tur sayacı
     ikinci kez artmaz).
4. Eksikler arasında **gözetmen** varsa yeni gözetmen karşı takımın çevrimiçi
   oyuncularından seçilir (yoksa gözetmensiz devam).
5. Çıkarılan oyuncu sonradan dönerse izleyici olarak döner; sonraki maçta takıma alınır.
   Ödül kuralı değişmez: maç başındaki kadro esas alınır.
6. **Veri:** kişisel veri içermeyen günlük Redis sayaçları — duraklatma tetikleyicisi ve
   çözüm şekli (oyuncu döndü / onsuz devam / yönetici bitirdi / sıfırlandı / terk edildi)
   ile çözüm süresi. Admin panelinde yeni **Lab** bölümünde 7/30 günlük görünüm.
7. Ek düzeltme: geçiş ekranı bitiminde anlatıcı çevrimdışıysa yeniden seçimde tur
   sayacı iki kez artıyordu; düzeltildi.

## Sözleşme

### Sunucu → istemci: `connectionPause` (geriye uyumlu genişletme)

`oyunDurumuGuncelle.connectionPause`, `turGecisiBaslat.connectionPause`,
`turGecisDurumGuncelle.connectionPause`:

```ts
interface ConnectionPauseSummary {
    waitingForPlayers: boolean;               // mevcut alan
    missingPlayers: { playerId: string; ad: string; takim: "A" | "B" | null }[];
    resolutionAvailableInSeconds: number;     // 60'tan geri sayar; 0 = karar verilebilir
    canContinueWithoutMissing: boolean;       // sunucu hesaplar
}
```

Bekleme süresi dolduğunda sunucu durumu bir kez daha yayınlar.

### İstemci → sunucu: `connection_pause:resolve`

Gövde `{ action: "continue_without_missing" | "end_match" }`. Hata durumunda
`hata` olayı (Türkçe metin). Başarıda normal durum olayları (`oyunDurumuGuncelle`,
`turGecisiBaslat`, `lobiGuncelle`, `oyunBitti`).

### `oyunBitti`

`{ kazananTakim: "A" | "B" | "Berabere", skor, endReason?: "completed" | "host_ended" }`.

### Telemetri modülü (`apps/web/src/lib/analytics/connection-pause-analytics.ts`)

```ts
type ConnectionPauseTrigger = "narrator" | "inspector" | "team_below_minimum";
type ConnectionPauseOutcome =
    | "resumed_after_reconnect"
    | "continued_without_missing"
    | "ended_by_host"
    | "reset_by_host"
    | "abandoned";
recordConnectionPauseStarted({ occurredAt, trigger, missingCount }): Promise<void>
recordConnectionPauseResolved({ occurredAt, outcome, durationSeconds }): Promise<void>
getConnectionPauseAnalytics({ days: 7 | 30, now? }): Promise<ConnectionPauseAnalyticsSummary>
getConnectionPauseAnalyticsStatus(): { enabled, attempted, recorded, dropped, readRequests, readFailures }
```

Redis/config arızası oyunu asla etkilemez (best-effort). `CONNECTION_PAUSE_ANALYTICS_ENABLED`
varsayılan açık (`false` ile kapanır), saklama `CONNECTION_PAUSE_ANALYTICS_RETENTION_DAYS`
(varsayılan 45).

### Admin

- `GET /api/admin/lab/connection-pauses?days=7|30` (admin oturumu + hız sınırı).
- `/admin/lab` sayfası, kenar çubuğunda "Lab". İlk kart: "Bağlantı kopmaları".

## Testler

- Birim: karar fonksiyonları (bekleme, uygunluk, tetikleyici sınıflama).
- Kaynak sözleşmeleri: olay adı, yetki, süre kontrolü, telemetri çağrıları.
- Telemetri: Redis'li ve Redis'siz, arıza toleransı, gün sınırları.
- Soket uçtan uca: bekleme süresinden önce reddedilir; yönetici olmayan reddedilir;
  onsuz devam (anlatıcı / gözetmen / takım arkadaşı eksik); takım 2'nin altına
  düşecekse onsuz devam reddedilir; maçı bitir → `host_ended` sonuç; yönetici eksikken
  başka oyuncu karar verir; dönen oyuncu izleyici olur.
