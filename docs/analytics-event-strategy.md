# Analytics Event Strategy

> Son guncelleme: 29 July 2026

## Amac

Urun davranisini olcmek icin audit tablosunu sisirmeyen, PII icermeyen ve Redis
arizasinda ana islemi bozmayan bir aggregate hatti kullanilir.

## Veri Sinirlari

Analytics hattinda su alanlar tutulmaz:

- user id, username veya display name
- IP, fingerprint veya cihaz kimligi
- room code
- serbest metin veya istemciden gelen serbest metadata
- tekil ham event satiri

Redis key'i UTC gun + versiyonlu event adindan olusur. Hash icinde yalniz
whitelist edilmis dusuk cardinality dimension sayaclari ve toplam metrikler vardir.
Varsayilan retention 45 gundur.

## Guven Seviyeleri

### `server_verified`

Yalniz basarili server transaction veya server-owned gameplay sonucundan uretilir.
Coin, satin alma ve oyun sonucu gibi business metrikleri bu sinifta olmalidir.

Bugun aktif:

- `store.item_purchased.v1`
- `store.bundle_purchased.v1`

### `client_observed`

Manipule edilebilir ve yalniz urun navigasyonu gibi dusuk riskli sinyaller icindir.
Business sonucu, coin veya odul karari bu siniftan uretilmez.

Bugun tanimli:

- `navigation.screen_viewed.v1`

Navigation endpoint'i strict screen enum, rate limit ve sabit payload uygular.
Otomatik page-view gonderimi bilincli olarak acik degildir; olcum plani
netlesmeden client trafigi uretilmez.

## Audit ve Match Telemetry Ayrimi

- Audit: admin islemi, kullaniciya ait satin alma ve inceleme gerektiren guvenlik
  sinyali gibi kalici operasyon gercegidir.
- Product analytics: anonim gunluk aggregate'tir; audit fallback'i degildir.
- `game.match.finalize` bugun mevcut ozel Redis telemetry rollup'inda kalir.
  Genel event hattina ayni anda yazilmaz; aksi halde cift sayim olur.
- Gameplay reader/migration ihtiyaci netlestiginde mevcut finalize rollup'i
  versiyonlu product event kontratina tek seferde tasinabilir.

## Operasyon

```env
PRODUCT_ANALYTICS_ENABLED=true
PRODUCT_ANALYTICS_RETENTION_DAYS=45
```

`/api/health` altindaki `telemetry.productAnalytics` bolumu attempted, recorded,
dropped ve son basari/hata zamanlarini gosterir. Redis veya config hatasi business
request'ini basarisiz yapmaz.

## Word Analytics Liveops

Kelime eylemleri istemcinin kelime metninden degil server-owned aktif kart
identity'sinden uretilir: `dogru`, `tabu`, `pas` ve `timeout`.

Exposure suresi `Date.now()` yerine server timer'in kart gosterildigi andaki ve
eylem anindaki `kalanZaman` farkidir. Oyun durduruldugunda timer azalmadigi icin
pause suresi kelimeye yazilmaz.

Gunluk Redis hash'lerinde yalniz word ID, category ID, difficulty, outcome ve
exposure toplamlari vardir. Kelime metni, oda, oyuncu ve anlatici kimligi yoktur.
Cok kategorili kelime her bagli kategori aggregate'ina katkida bulunur; kategori
toplamlari birbirleriyle toplanmamalidir.

Admin kelime listesi mevcut UI'da gorunen 20 kelimeyi 7 veya 30 gun icin
`HMGET` ile okur; API sayfa boyutu en fazla 50 ile sinirlidir. 30 gunluk gorunum
en fazla 30 Redis read uretir. On gosterimin altinda dusuk ornek uyarisi verilir.
Bu metrikler otomatik gizleme, zorluk degistirme veya ceza karari uretmez.

Word ve category hash key'leri ayni gun hash tag'ini kullanir. Boylece atomik
Lua yazimi Redis Cluster topolojisinde de ayni slot sinirinda kalir.

```env
WORD_ANALYTICS_ENABLED=true
WORD_ANALYTICS_RETENTION_DAYS=45
```
