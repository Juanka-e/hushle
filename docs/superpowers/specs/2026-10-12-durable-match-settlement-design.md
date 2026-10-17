# Kalıcı Maç Sonucu (Match Settlement) Tasarımı

Tarih: 12 Ekim 2026. Durum: kullanıcı onayladı (sohbet, 9–12 Ekim).

## Problem

Maç ödülü ve maç geçmişi bugün yalnız istemcinin `oyunBitti` sonrasında gönderdiği
`POST /api/game/match/finalize` isteğiyle yazılıyor. Oda durumu yalnız bellekte.

Sonuç kaybolan durumlar:

- Tarayıcı kapanır, ağ kopar, istek 429/5xx alır.
- Yönetici maç biter bitmez lobiye döner (`resetGame` maç durumunu siler).
- Sunucu maç bitişi ile istek arasında yeniden başlar.
- Maç biterken telefonu kapanan kayıtlı oyuncu.

## Hedef

Biten bir maçın sonucu ve coin'i istemciden bağımsız, sunucu tarafından ve tekrar
denenebilir şekilde yazılır. Aynı maç iki kez işlense de tek ödül çıkar.

## Kapsam dışı

- Misafire maç geçmişi satırı (karma yapı: veri saklanır, sahiplenme ayrı PR).
- "Maçı bitir" düğmesi ve "Onsuz devam et" (ayrı PR; bu PR `host_ended` politikasını hazırlar).
- Bitiş ekranında coin göstermek.
- Admin "lab" analitik bölümü.

## Kararlar

1. **Yaklaşım A:** Maç bitince değişmez bir sonuç kaydı (`match_settlements`) yazılır
   ve aynı süreç tarafından hemen işlenir. Bekleyen/yarım kalan kayıtlar açılışta ve
   dakikada bir taranır.
2. **Erken bitirilen maç (`host_ended`):** coin 0, galibiyet sayılmaz, maç geçmişe
   `end_reason = host_ended` ile yazılır.
3. **Misafirler (karma yapı):** Kayıt anlık görüntüsü misafirleri de içerir
   (oyuncu kimliği, görünen ad, takım, rol; IP yok). `match_results` yalnız kayıtlı
   oyuncular için yazılır. İleride "kayıt ol, bu maç hesabına geçsin" sahiplenmesi
   migration gerektirmez.
4. **Ödül kuralları değişmez:** uygunluk, tekrarlanan grup, güvenlik tavanı, cüzdan
   defteri, audit/telemetri aynen kullanılır.
5. **Hesap kuralları korunur:** silinmiş, askıda veya e-posta doğrulaması zorunlu ama
   doğrulanmamış hesap ödül almaz (eski uç noktadaki `reward` yetenek kontrolü).
6. **Uç nokta geriye uyumlu:** `POST /api/game/match/finalize` artık ödül yazmaz;
   oyuncunun sonucunu döner, gerekirse kaydı oluşturup işlemeyi dürtür.

## Veri modeli

`match_settlements` (yeni):

| Alan | Açıklama |
| --- | --- |
| `room_code`, `match_started_at` | Tekil anahtar (maç sonuçlarıyla aynı) |
| `match_ended_at`, `end_reason` | `completed` / `host_ended` |
| `snapshot_version`, `snapshot` | Sürümlü JSON: mod, hedef, skor, duraklatmasız süre, katılımcılar |
| `registered_participant_count`, `guest_participant_count` | Sorgu/izleme kolaylığı |
| `status` | `pending` → `processing` → `settled` / `dead_letter` |
| `attempt_count`, `available_at`, `last_attempt_at`, `last_error` | Üstel bekleme |
| `claim_token`, `claim_expires_at` | Eşzamanlı işleme ve çökme sonrası kurtarma |
| `settled_at` | 30 gün sonra temizlik |

`match_results` tablosuna `end_reason` (varsayılan `completed`) eklenir.

## Akış

1. `finishGame` maç gerçekten bittiğinde (altın skor devamı hariç) bellekten anlık
   görüntüyü alır ve `enqueueMatchSettlement` çağırır. Oyun akışını beklemez.
2. Kayıt `INSERT … ON DUPLICATE KEY` ile idempotent yazılır. Veritabanı o an
   erişilemezse anlık görüntü sınırlı (500) bellek kuyruğunda tutulup tekrar denenir.
3. İşleme: kayıt `processing` olarak sahiplenilir (claim token, 60 sn). Her benzersiz
   kayıtlı katılımcı ayrı transaction'da işlenir:
   hesap kontrolü → cüzdan satırı kilidi → mevcut maç sonucu kontrolü → uygunluk →
   (`host_ended` ise coin 0) → tekrarlanan grup → tavan → `match_results` +
   cüzdan defteri (`match_result:<id>:reward`).
4. Commit sonrası (hata settlement'ı bozmaz): audit/telemetri, dashboard cache.
5. Tüm katılımcılar bittiyse `settled`. Geçici hata varsa `pending` + bekleme
   (15 sn, 30 sn, 1 dk, 2 dk, 5 dk, 10 dk, 15 dk, 30 dk…); 10 denemeden sonra
   `dead_letter` + hata olayı. Atlanan katılımcılar (silinmiş/askıda/doğrulanmamış)
   tekrar denenmez.
6. Çalışan: açılışta ve 60 sn'de bir bellek kuyruğunu boşaltır, vadesi gelen ve
   süresi dolmuş sahiplenmeleri işler; saatte bir 30 günden eski `settled` kayıtları
   500'lük partilerle siler. Kapanışta kuyruğu son kez boşaltır.
7. `/api/health` bekleyen, `dead_letter` ve bellek kuyruğu sayılarını raporlar.

## Uç nokta (`POST /api/game/match/finalize`)

| Durum | Yanıt |
| --- | --- |
| Oturum yok | 401 |
| `reward` yeteneği yok | 403 `EMAIL_VERIFICATION_REQUIRED` |
| Hız sınırı | 429 |
| Geçersiz gövde | 422 |
| Oda canlı ve maç sürüyor | 409 `Mac henuz tamamlanmadi.` |
| Kayıt yok | 404 `Oda bulunamadi.` |
| Kullanıcı katılımcı değil | 403 + `game.match.finalize.denied` audit |
| Sonuç var | 200 `{ status: "settled", coinEarned, won, matchId, endReason }` |
| İşlendi ama ödül atlandı | 200 `{ status: "settled", coinEarned: 0, rewardSkipped: true }` |
| Henüz işlenmedi | 202 `{ status: "pending" }` |

## Kalan risk

Maç biterken veritabanı erişilemiyorsa ve tam o sırada süreç de çökerse bellek
kuyruğundaki sonuç kaybolur.

## Test matrisi

Birim (`test:match-settlement`), gerçek MySQL entegrasyonu
(`test:match-settlement-integration`), soket uçtan uca (`test:match-settlement-e2e`)
ve kaynak sözleşme testleri. Ayrıntılı vaka listesi plan dosyasındadır:
`docs/superpowers/plans/2026-10-12-durable-match-settlement.md`.
