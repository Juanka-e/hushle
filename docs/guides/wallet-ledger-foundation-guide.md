# Wallet Ledger Foundation

> Durum: implemented  
> Branch: `feature/wallet-ledger-foundation`  
> Son güncelleme: 29 July 2026

## Amaç

Coin bakiyesini hızlı okumaya devam ederken her değişimi değiştirilemez ve
uzlaştırılabilir bir hareket zinciriyle kaydetmek.

`Wallet.coinBalance` güncel bakiye için source of truth olmaya devam eder.
`WalletLedgerEntry` ise bu bakiyenin hangi hareketlerle oluştuğunu açıklar.
İkisi aynı MySQL transaction'ında yazılır.

## Değişmezler

1. Üretim kodunda coin bakiyesini yalnız wallet ledger servisi değiştirir.
2. Cüzdan satırı `SELECT ... FOR UPDATE` ile kilitlenmeden bakiye yazılmaz.
3. Ledger kaydı ve bakiye değişimi aynı transaction içinde tamamlanır.
4. Negatif bakiye oluşamaz.
5. Her hareketin global unique idempotency anahtarı vardır.
6. Retry aynı hareketi ikinci kez yazmaz.
7. Redis/Valkey bakiye veya ledger için finansal source of truth değildir.
8. İstemciye idempotency anahtarı veya ham ledger metadata gönderilmez.

## Kaynaklar

| Kaynak | Yön | Referans |
| --- | ---: | --- |
| `account_opening` | artı veya sıfır | kullanıcı kaydı |
| `legacy_balance_snapshot` | mevcut bakiye | eski cüzdanın lazy başlangıcı |
| `match_reward` | artı | `MatchResult` |
| `store_item_purchase` | eksi | `Purchase` |
| `store_bundle_purchase` | eksi | `Purchase` |
| `coin_grant` | artı | `CoinGrantClaim` |
| `admin_adjustment` | artı/eksi | `WalletAdjustment` |
| `payment_topup` | artı | `PaymentOrder` / `PaymentFulfillment` |

Sıfır fiyatlı alışveriş ve sıfır maç ödülü finansal hareket üretmez. Kaynak
tablosundaki işlem kaydı yine saklanır.

## Eski Cüzdanlar

Toplu backfill zorunlu değildir. Ledger kaydı olmayan mevcut bir cüzdan ilk
coin hareketinde satır kilidi altında `legacy_balance_snapshot` kaydı alır.
Snapshot'ın `balanceAfter` değeri o andaki `Wallet.coinBalance` değeridir.
Ardından gerçek hareket aynı transaction içinde eklenir.

Yeni kayıtlar doğrudan `account_opening` kaydıyla başlar.

## Eşzamanlılık

Mağaza alımları daha önce bakiyeyi okuyup sonra decrement uyguluyordu. Aynı
kullanıcının iki eşzamanlı isteği aynı eski bakiyeyi yeterli görebiliyordu.
Yeni servis cüzdan satırını kilitler:

1. İlk işlem bakiyeyi kilitler, kontrol eder ve yazar.
2. İkinci işlem kilidi bekler.
3. Kilit açıldığında ikinci işlem yeni bakiyeyi görür.
4. Bakiye yetersizse purchase, promosyon rezervasyonu ve envanter yazıları
   transaction rollback'iyle birlikte iptal edilir.

Bu davranış CI'da gerçek MySQL ile
`npm run test:wallet-ledger-integration` komutuyla zorlanır.

## Admin Görünümü

Kullanıcı tablosundaki `Cüzdan` aksiyonu şunları gösterir:

- imzalı coin değişimi
- önceki ve sonraki bakiye
- kaynak ve güvenli referans
- varsa admin aktörü ve düzeltme nedeni
- ledger son bakiyesi ile güncel cüzdanın uzlaşma durumu

Admin API ham metadata ve idempotency anahtarını döndürmez.

## Production Rollout

Bu branch DB schema değişikliği içerir:

- yeni `wallet_ledger_entries` tablosu
- `wallet_adjustments.ledger_entry_id` nullable bağlantısı

`ledger_entry_id` eski admin düzeltmelerini korumak için nullable'dır; yeni
işlemler bu alanı daima doldurur. Production deploy otomatik schema değişikliği
yapmaz.

Rollout sırası:

1. Güncel MySQL backup al ve restore smoke kanıtını kaydet.
2. İleri uyumlu schema SQL'ini incele ve ayrı onaylı operasyonla uygula.
3. Tablo ve index'leri doğrula.
4. Uygulamayı deploy et.
5. Yeni hesap, maç ödülü, mağaza harcaması, coin kodu ve admin düzeltmesi smoke
   testlerini çalıştır.
6. Admin cüzdan görünümünde bakiye zincirinin uyumlu olduğunu doğrula.

Eski uygulama sürümü yeni nullable kolon ve ek tabloyla çalışabildiği için app
rollback'i schema rollback'ini zorunlu kılmaz. Ledger tablosu incident sırasında
silinmez.

Wallet mutation servisi `@hushle/platform-wallet` paketine taşınmıştır. Web
runtime eski import yolları için yalnız compatibility re-export tutar; jobs ve
payment domain aynı transaction primitive'ini doğrudan paketten kullanır.

## Sonraki Adımlar

- refund/reversal işlemini ters işaretli yeni ledger kaydı olarak eklemek
- paid coin refund/reversal işlemini özgün payment ledger referansına bağlamak
- periyodik reconciliation job ve mismatch alarmı eklemek
- yüksek hacimde admin reader için read replica veya cache kullanmak

Redis yalnız reader cache veya alarm sayaçlarında kullanılabilir. Bakiye yazma,
idempotency ve uzlaştırma MySQL'de kalır.
