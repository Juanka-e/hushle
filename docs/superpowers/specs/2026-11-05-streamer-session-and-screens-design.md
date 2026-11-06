# Yayın Oturumu, Yayıncı Paneli ve Yayın Ekranı (2. Aşama) Tasarımı

Tarih: 5 Kasım 2026. Durum: taslak; sahibin plan incelemesiyle onaylanacak.

Dayandığı belgeler: [1. aşama tasarımı](./2026-11-05-streamer-platform-connections-design.md)
(kanal bağlama, PR #180), [çoklu platform planı](../../stream/multi-platform-streamer-plan.md),
[eski teknik taslak](../../stream/online-tabu-streamer-mode.md) (§2 özel/public ekran,
§12–13 tahmin kontrolü, §17–18 olay seçimi, §34 sunucu-otoriter yapı), onaylanan
yayın ekranı taslağı (`scripts/design-prototypes/hushle-streamer-studio`, V4,
`hm` çalışma ağacında; bu aşamada repoya taşınır).

## Problem

Yayıncı kanalını bağlayabiliyor ama yayın yapamıyor: oyun oturumu, yayıncının gizli
kartı gördüğü panel ve OBS'ye verilecek yayın ekranı yok. Taslak bir tarayıcı
içinde `BroadcastChannel` ile çalışıyor; gerçek sunucu, kimlik ve kelime havuzu yok.

## Hedef

Yayıncı `/streamer`'dan bir oturum açar, kelime dilini ve kategorileri seçer, OBS'ye
yayın ekranı adresini verir, turu başlatır. Sunucu kelimeyi çeker, süreyi tutar,
tahminleri değerlendirir (bu aşamada sahte sohbet; gerçek sohbet 3. aşama), skoru
hesaplar. Yayın ekranı yalnız güvenli projeksiyonu alır: kelime ve yasaklı kelimeler
tur bitmeden hiçbir yanıtta, HTML'de ya da socket mesajında bulunmaz.

## Kapsam dışı (sonraki aşamalar)

- Gerçek Twitch EventSub / Kick webhook sohbet okuma, izleyici kimliği birleştirme,
  spam/cooldown (3. aşama). Bu aşamada tahmin kaynağı yalnız test amaçlı sahte sohbet.
- Yayıncıya ödül, izleyici coin'i, haftalık/global sıralama, seri (streak) rozetleri.
- Yayın sırasında saatlik Twitch `/validate` (3. aşamada sohbet bağlantısıyla gelir).
- Çoklu platform aynı oturumda; takım/survival modları; YouTube.
- Kart tasarımlarının son hali (sahip sonra netleştirecek; ekran kart arkasını
  mevcut koleksiyonlardan seçer).

## Kararlar

1. **Alan mantığı saf paket.** `packages/domain-streamer`: taslaktaki `session.mjs`
   TypeScript'e taşınır. Durumlar `ready → running ⇄ paused → finished → (running | ended)`;
   `acceptGuess` sonuçları `closed | stale | duplicate | invalid | wrong | correct`;
   ilk doğru tahmin turu bitirir; `ranking` puana göre, beraberlik işaretli;
   `publicSnapshot` (v4 şeması, kart yalnız `finished`'ta) ve `hostSnapshot` (kart dahil).
   Tahmin normalizasyonu: NFC, Türkçe küçük harf, noktalama ve boşluk temizliği;
   tolerans `strict | normal` (normal: ı/i, ş/s, ğ/g, ç/c, ö/o, ü/u eşdeğer).
   `flexible` (yazım hatası toleransı) bu aşamada yok.
2. **Sunucu tek yazıcı, bellek içi oturum.** Oturumlar web sürecinde bellekte tutulur
   (ADR-003: tek replika). Her oturum için 1 sn'lik tik; süre `deadline` zaman
   damgasıyla hesaplanır, mola sayılmaz. Süreç yeniden başlarsa aktif oturum
   veritabanında `interrupted` olur; panel "oturum kesildi, yeni oturum aç" der.
   Redis bu aşamada zorunlu değil (hız sınırı ve oda kilidi zaten Redis'siz çalışıyor).
3. **İki socket odası, iki projeksiyon.** Mevcut Socket.IO sunucusu (varsayılan
   namespace, `/api/socketio`) kullanılır. Yayıncı `streamer:host:join {sessionId}` ile
   `streamer:host:<id>` odasına girer (oturum sahibi olmalı: cookie JWT, `sessionVersion`
   ve askıya alma denetimi mevcut `getSocketAuthState` ile). Yayın ekranı
   `streamer:public:join {viewKey}` ile `streamer:public:<id>` odasına girer; giriş
   gerekmez (OBS çerez taşımaz). Yayına yalnız `publicSnapshot` gider; host odasına
   `hostSnapshot`. Projeksiyon testi: tur sürerken public snapshot JSON'unda hedef ve
   yasaklı kelimeler aranır, bulunmamalı.
4. **Görüntüleme anahtarı.** `viewKey` 32 bayt rastgele, veritabanında yalnız sha256
   özeti (`view_key_hash`), panelden tek tıkla yenilenir (eski anahtarla bağlı ekranlar
   düşer). URL: `/stream/<viewKey>`; aynı anahtar `?layout=half` ve
   `?overlay=top|bottom` kaynaklarında da kullanılır. Anahtar oturuma bağlı; oturum
   bitince geçersiz. Katılım IP başına hız sınırlı.
5. **Kelime kaynağı mevcut havuz.** `getNextWord(poolKey, categoryIds, difficulties, locale)`
   `poolKey = "streamer:<sessionId>"` ile çağrılır; oturum sonunda havuz temizlenir.
   Dil (`tr`/`en`) ve kategori seçimi normal odalardaki şemayla aynı (görünür
   kategoriler, zorluk 1–3).
6. **Oturum kaydı.** `stream_sessions` (id, user_id, connection_id, platform,
   status `active|ended|interrupted`, settings JSON, view_key_hash, started_at,
   ended_at, round_count, summary JSON: ilk 10 sıra + katılımcı sayısı) ve
   `stream_round_results` (session_id, round, word_id, outcome `solved|timeout|passed`,
   winner_platform_user_id, winner_name, solve_ms, started_at, ended_at). Ham sohbet,
   yanlış tahminler ve tek tek puan olayları yazılmaz. Aynı kullanıcı için aynı anda
   tek aktif oturum (kısmi tekil indeks yerine uygulama kilidi + `active` sorgusu).
7. **Ayarlar yayıncıya ait.** Tema (5), kamera yuvası (7) ve boyu (3), zamanlayıcı
   şablonu (temanın ya da 6'dan biri), kart arkası, kart adı gösterimi, tur süresi
   (30–120), dil, kategoriler, tolerans. Son oturumun ayarları sonraki oturumda ön
   doldurulur (`settings` JSON'undan). Tema/kamera değişikliği oturum sürerken de
   yayına anında yansır.
8. **Yayın ekranı taslaktan taşınır.** `public.css` düzen tablosu (yuva değişkenleri,
   kamera deliği maskesi, beş tema, altı zamanlayıcı) olduğu gibi bir CSS dosyasına,
   işaretleme React bileşenine, `public.js`'teki render mantığı (fitLine/fitWord,
   damga sırası, finale, taç yaprakları) TypeScript'e taşınır. Taşıma sırasında
   davranış değişmez; demo durumları (`?demo=`) sahte platform bayrağıyla korunur ki
   galeri ve ekran görüntüsü testleri çalışmaya devam etsin. Fontlar Google Fonts
   yerine `next/font` ile paketlenir (üretim kuralı).
9. **Yayıncı paneli.** `/streamer` tek sayfa: (a) oturum kur (bağlı kanal, dil,
   kategoriler, süre, tolerans, tema/kamera/kart), (b) OBS kutusu (tam ekran / yarım /
   şerit adresleri, kamera ölçüleri 1080p+720p, "anahtarı yenile"), (c) oyun: gizli
   kart (hedef + yasaklı), süre, Başlat / Duraklat / Devam / Pas / Sonraki / Bitir,
   canlı skor, son bilen, olay günlüğü, (d) oturum sonu özeti. Kolay anlaşılır,
   büyük düğmeler; taslaktaki panelden sadeleştirilir.
10. **Sahte sohbet (yalnız test).** `STREAMER_FAKE_PLATFORM=1` iken
    `POST /api/streamer/sessions/current/test-guess {name, text}` alan mantığına
    tahmin verir; e2e ve galeri bunu kullanır. Gerçek sohbet 3. aşamada aynı
    `ChatGuess` arayüzünden gelir: `{platform, platformUserId, name, text, messageId, sentAt}`.
11. **Yayın vitrini: admin anahtarı (sahip onayladı).** Sistem ayarlarına
    `streamerShowcaseAllCosmetics` (varsayılan kapalı) eklenir. Açıkken yayın ekranı
    için bütün kart arkaları seçilebilir; kapalıyken yalnız yayıncının envanterindeki
    kartlar. Oyunun kendisi her durumda yalnız sahip olunanları kullanır. Seçim
    sunucuda da doğrulanır (ayar kapalıyken sahip olunmayan koleksiyon reddedilir).
12. **Tolerans.** `strict | normal`; `flexible` sonraya.

## Sunucu olayları (zod ile doğrulanır)

İstemci → sunucu: `streamer:host:join {sessionId}`, `streamer:host:start`,
`streamer:host:pause`, `streamer:host:resume`, `streamer:host:pass`,
`streamer:host:next`, `streamer:host:end`, `streamer:host:settings {theme, camera, cameraSize, clock, cardBack, showCardName}`,
`streamer:public:join {viewKey}`.
Sunucu → istemci: `streamer:host:state` (hostSnapshot), `streamer:public:state`
(publicSnapshot, `revision` artan), `streamer:ended`, `hata` (mevcut hata kanalı).
Host olayları yalnız oturum sahibinden, 10 sn'de 10 ile sınırlı; tahmin yolu HTTP
(sahte) ve ileride adaptör.

## Güvenlik kontrol listesi

- Tur sürerken `publicSnapshot`, sayfa HTML'i ve `streamer:public:state` kelime
  taşımaz (projeksiyon ve socket testleri; e2e'de tur sürerken sayfa kaynağında kelime aranır).
- Host olayları için oturum sahipliği her olayda denetlenir; başkasının `sessionId`'si
  ile `join` reddedilir; host odasına giriş `sessionVersion` ve askıya alma denetiminden geçer.
- `viewKey` yalnız özet olarak saklanır, yenilenince eski bağlantılar `streamer:ended`
  benzeri `view-key-rotated` ile düşürülür; anahtar log'a ve audit'e yazılmaz.
- Sahte tahmin ucu yalnız sahte platform bayrağıyla var olur; üretimde 404.
- Hız sınırları: oturum oluşturma kullanıcı başına 10/15 dk, public join IP başına
  30/dk, host olayları 10/10 sn.
- Kelime havuzu anahtarı oturuma özel; oturum bitince `clearWordPool`.
- Normal odalardaki izleyici kart sızıntısı (`handleWordAction` `kartGuncelle` dağıtımı,
  takım `null` olan İzleyici'ye kart gidiyor) bu aşamanın kapsamı dışında ama ayrı,
  öncelikli bir düzeltme olarak sahibe bildirildi.

## Yapılmayacaklar

- Her sohbet mesajını yayın ekranına ya da veritabanına göndermek.
- Kelimeyi gönderip CSS ile gizlemek.
- İzleyici girişi/OAuth; yayıncıya coin; mikroservis.
- Google Fonts'tan canlı yükleme (üretimde self-host).
