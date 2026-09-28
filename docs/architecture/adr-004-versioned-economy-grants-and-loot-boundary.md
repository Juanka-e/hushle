# ADR-004: Versioned Economy Grants And Loot Boundary

## Status

Accepted.

## Context

Bugünkü ekonomi tek harcanabilir varlık (`COIN`) ve tekil kozmetik hakları kullanıyor.
İleride premium para birimi, etkinlik jetonu, paket ürün veya açılabilir kutu eklenebilir.
Ödeme, görev, etkinlik ve admin grant kaynaklarının her biri kendi payload biçimini
oluşturursa idempotency, refund, audit ve abuse kuralları birbirinden kopar.

Henüz ikinci para biriminin harcama, sona erme, transfer, refund ve gösterim kuralları;
loot sisteminin olasılık, pity, duplicate ve hukuki politikası belli değildir. Bu nedenle
bugün bütün tabloları kurmak gereksiz ve risklidir.

## Decision

### 1. Ortak grant planı

Ekonomik teslimat kaynakları provider veya ekran adı yerine sürümlü effect planı üretir:

```json
{
  "schemaVersion": 1,
  "effects": [
    {
      "effectId": "paid-coin",
      "type": "balance_credit",
      "assetCode": "COIN",
      "amount": 250
    }
  ]
}
```

- `effectId` plan içinde sabit ve benzersizdir.
- Plan/effect alanları strict doğrulanır; bilinmeyen alan sessizce atılmaz.
- Effect adedi, tutarı, referans uzunluğu ve toplam JSON boyutu sınırlıdır.
- Şema genişletilebilir; runtime capability registry yalnız gerçekten uygulanabilen
  asset ve katalogları açar.
- Bugün desteklenen capability yalnız `COIN` ve `shop_item`dır.
- Eski payment `schemaVersion: 1` snapshot'ları okunmaya devam eder. Yeni payment
  snapshot'ı `schemaVersion: 2` içinde ortak planı taşır.

### 2. Kaynak ve executor ayrımı

Payment provider yalnız tahsilat kanıtı üretir. Hangi hakkın verileceğini provider,
browser veya webhook payload'ı belirlemez. Sunucu kataloğu immutable snapshot üretir;
fulfillment bunu capability kontrollü executor ile atomik uygular.

Görev, etkinlik, seviye ve admin grant kaynakları ileride aynı domain planını kullanır,
ancak kendi eligibility/cap/audit politikalarını korur. Payment cap'e, admin grant match
cap'e karışmaz.

### 3. İkinci para birimi geldiğinde

Yeni asset, mevcut `Wallet.coinBalance` yanına yeni kolon eklenerek kurulmaz. Gerçek
gereksinim oluştuğunda:

1. immutable `EconomyAssetDefinition(code, precision, state, policyVersion)` tanımlanır,
2. `(userId, assetCode)` unique bakiyeler ve asset kodlu append-only ledger eklenir,
3. mevcut COIN kayıtları backfill edilir,
4. geçici dual-write invariant ve reconciliation job çalıştırılır,
5. okumalar yeni ledger'a alınır; eski kolon ancak geri dönüş süresi sonrası kaldırılır.

Asset kodu yeniden kullanılmaz. Silme yerine deprecation uygulanır. Redis yalnız balance
cache/rate limit için kullanılabilir; ledger ve sahiplik kaynağı MySQL kalır.

### 4. Açılabilir kutu sınırı

Kutu satın alma veya görev ödülü doğrudan rastgele içerik üretmez; kullanıcıya seri
kimlikli bir container entitlement verir. Açılış ayrı bir domain işlemidir:

- immutable ve yayınlanmış `LootTableVersion`,
- server-side CSPRNG ve sürümlü RNG policy,
- kullanıcı + container bazlı idempotent `OpenRequest`,
- container tüketimi ve çözülmüş grant planını aynı transaction'da uygulama,
- table version, seçilen entry ve child entitlement/ledger referanslarını taşıyan
  immutable `OpenReceipt`,
- pity sayacını atomik ve kullanıcı bazlı güncelleme,
- oranların istemciden alınmaması ve geçmiş tablonun sonradan değiştirilmemesi.

Ödeme fulfillment'ı RNG çalıştırmaz. Client yalnız kutu açma talebi gönderir; sonuç ve
animasyon kanıt değildir. Kutu açılmadan önce oran gösterimi, yaş/bölge şartları,
duplicate compensation ve refund sonrası child entitlement politikası hukuki ve ürün
onayı olmadan özellik aktif edilemez.

### 5. Refund ve provenance

- Açılmamış ücretli container exact payment provenance ile geri alınabilir.
- Açılmış container için receipt, parent container ile çıkan child grant'leri bağlar.
- Otomatik reversal yalnız bütün child haklar exact ve güvenli biçimde geri alınabiliyorsa
  çalışır; harcanmış/dönüştürülmüş sonuç manuel incelemeye gider.
- Oyuncuya otomatik büyük ceza, negatif bilinmeyen bakiye veya başka kaynaktan kazanılmış
  varlık kesintisi uygulanmaz.

### 6. LiveOps kampanya sınırı

Yeni oyuncu serisi, geri dönüş serisi, görev, etkinlik, gece marketi ve sezon gibi
özellikler kendi coin yazma kodunu oluşturmaz. İhtiyaç oluştuğunda ortak akış şu olur:

`CampaignDefinition -> EligibilityPolicy -> Progress -> Claim -> GrantPlan -> Ledger/Inventory`

- Kampanya tanımı immutable ve sürümlüdür; yayındaki sürüm yerinde değiştirilmez.
- Eligibility, ilerleme ve ödül teslimatı ayrı katmanlardır. Bir oyuncunun kampanyayı
  görmesi ödüle hak kazandığı anlamına gelmez.
- Her claim kullanıcı + kampanya dönemi + ödül adımı bazında idempotent olur.
- Gameplay, mission, event, comeback, promotion, payment ve admin kaynakları ayrı
  provenance taşır; bir kaynağın cap veya abuse politikası diğerine uygulanmaz.
- MySQL claim, ledger, inventory ve yayınlanmış kampanya gerçeğinin kaynağıdır. Redis
  kısa süreli ilerleme, sayaç, cooldown ve cache için kullanılabilir; kayıp Redis verisi
  sahiplik veya teslim edilmiş ödülü geri alamaz.
- İstemci yalnız ilerleme/claim talebi gönderir. Zaman, uygunluk, market fiyatı, loot
  sonucu ve teslim edilecek grant sunucuda doğrulanır.

Bu ortak akış bugün runtime olarak kurulmayacaktır. İlk gerçek feature seçildiğinde yalnız
o feature'ın ihtiyaç duyduğu minimum campaign/progress/claim parçaları ayrı branch'lerde
eklenir; kullanılmayan generic tablolar önceden oluşturulmaz.

### 7. Koleksiyon, market ve seri ürün sınırları

- Rarity (`common`, `rare`, `epic`, `legendary`) katalog metadata'sıdır; tek başına
  güç, fiyat veya loot oranı belirlemez.
- Kart havuzu büyüdüğünde season/set ayrımı yapılır; bütün geçmiş kartlar tek ve giderek
  seyreltilen loot havuzuna konmaz.
- Night market kullanıcıya yayın anında immutable bir teklif snapshot'ı verir. Sahiplik,
  fiyat, süre ve satın alma uygunluğu checkout sırasında yeniden doğrulanır.
- Yeni oyuncu ve comeback serileri farklı campaign türleridir. Kaçırılan tek günün bütün
  ilerlemeyi silmesi varsayılan davranış olmaz; salt login yerine server-verified anlamlı
  aktivite tercih edilir.
- Ücretli rastgele kutu ilk uygulama değildir. Önce ücretsiz/oynanarak kazanılan kozmetik
  container, açık oran, pity, duplicate compensation, yaş/bölge ve refund politikası
  onaylanmalıdır.
- Kozmetik duplicate sonucu gerekiyorsa yalnız sürümlü bir shard/crafting varlığına
  dönüşür; dönüşüm oranı loot table ile birlikte immutable kaydedilir.

## Alternatives Considered

| Seçenek | Artı | Eksi | Karar |
| --- | --- | --- | --- |
| Her para birimi için wallet kolonu | İlk geliştirme hızlı | Migration, ledger ve sorgular her asset'te büyür | Reddedildi |
| Şimdi generic asset/loot tablolarının tamamını kurmak | Görünürde hazır | Kuralsız şema ve kullanılmayan operasyon yükü | Reddedildi |
| Kaynak başına özel reward payload | Lokal olarak kolay | Audit, cap, refund ve idempotency parçalanır | Reddedildi |
| Sürümlü ortak grant + capability registry | Kontrollü genişleme | Yeni effect için açık executor gerekir | Kabul edildi |

## Consequences

- Yeni asset veya entitlement türü provider adapter değişmeden eklenebilir.
- Bilinmeyen effect fail-closed olur; paid fakat teslim edilemeyen ürün katalogda görünmez.
- Eski sipariş ve fulfillment kayıtları okunabilir kalır.
- Multi-currency ve loot açılışı ayrı branch/migration/acceptance gerektirir; yalnız JSON'a
  yeni alan ekleyerek production'a açılamaz.

## Revisit Triggers

- İkinci harcanabilir asset için onaylanmış ürün kuralları oluşması.
- Mixed bundle (`COIN + cosmetic`) satışı planlanması.
- İlk container/loot table ürününün oran, pity, duplicate ve refund politikalarının onayı.
- İlk campaign tabanlı özelliğin ölçülebilir ihtiyaç ve başarı metriğiyle seçilmesi.
- Katalog büyüklüğünün set/season, duplicate veya discovery sorununu gerçek veride göstermesi.
- Grant effect sayısı veya fulfillment throughput'un mevcut transaction sınırlarını aşması.
