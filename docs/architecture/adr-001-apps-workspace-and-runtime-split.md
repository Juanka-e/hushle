# ADR-001: `apps/` Workspace Ve Runtime Ayrim Yonelimi

## Status
Accepted

## Context

Repo bugun tek Next.js + custom Socket.IO server uygulamasi olarak calisiyor.

Kod yogunlugu ayni runtime icinde su alanlari topluyor:

- oyuncu web yuzeyi
- admin paneli
- Next route handler API'leri
- realtime/socket koordinasyonu
- gelecekte ayri olacak background is mantigi

Urun hedefleri ise buyuyor:

- yeni modlar eklenebilir
- yeni web yuzeyleri acilabilir
- mobil uygulama ihtimali var
- Redis/Valkey, retention jobs ve telemetry gibi ek runtime ihtiyaclari geliyor

Bu durumda erken microservice'e gecmek yanlis, ama repo kokunde tek buyuk uygulama olarak kalmak da orta vadede maliyet uretecek.

## Decision

Repo `apps/` odakli bir modular monolith yonune alinacak.

Hedef runtime sinirlari:

- `apps/web`
- `apps/api`
- `apps/jobs`

Bu ayrim hemen fiziksel kod tasimasi olarak degil, once hedef klasor ve migration kontrati olarak baslatilacak.

## Rationale

1. Ekip ve urun olcegi icin microservice erken.
2. Mobil/API ihtimali yuzunden runtime sinirlarini simdiden dusunmek gerekli.
3. Realtime, web ve jobs'in deploy/olcek ihtiyaclari zamanla farklilasacak.
4. Kodun once `packages/` seviyesinde ayrismasi, sonra runtime ayrimi yapilmasi daha guvenli.

## Trade-offs

- Kisa vadede hem mevcut kok yapiyi hem hedef `apps/` yapisini dokumanda tasiyoruz.
- Hemen fiziksel tasima olmadigi icin gecis iki asamali olacak.
- Buna karsilik buyuk tek-seferlik refactor riskini almiyoruz.

## Consequences

### Positive
- yeni web veya backend yuzeyleri icin net hedef klasorler var
- mobil API ayirma karari daha kolay
- jobs/runtime ayrimi icin altyapi zihni netlesiyor

### Negative
- repo bir sure gecis halinde kalacak
- `apps/` klasoru ilk asamada daha cok planlama iskeleti olacak

### Mitigation
- migration planini fazlara bol
- `packages/` cikarmalari runtime tasimasindan once yap
- Docker ve env yapisini simdiden runtime-agnostic tut
