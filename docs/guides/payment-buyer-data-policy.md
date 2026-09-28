# Payment Buyer Data Policy

## Decision

Payment buyer data is request-only provider input, not a reusable user profile.
The application must not add national identity, checkout phone, or billing address
columns to `User`, `UserProfile`, `PaymentOrder`, `PaymentAttempt`, audit, or
telemetry models merely to support a provider.

The code contract is versioned as `buyer-data-v1`. Each checkout consent stores
only this policy version. It never stores the submitted values or a hash of them.
A national identity number has a small enumerable domain; hashing it would not make
it anonymous and would create a persistent correlation identifier.

## Provider Matrix

| Provider | Request-only categories | Current state |
| --- | --- | --- |
| PayTR | verified account email, full name, phone, address, request IP | Sandbox orchestration active |
| iyzico | verified account email, given/family name, identity number, phone, billing address, request IP | Request-only sandbox UI ready; live blocked |

For virtual goods, the iyzico adapter contract derives required billing and
shipping objects from one address. The player is not asked for a second duplicate
address.

The checkout page renders these fields only when the server-selected active
provider is iyzico. Values stay in component memory until session creation, are
cleared before the hosted-page navigation, and are never placed in URL parameters,
browser storage, analytics, or reusable profile fields. Provider selection is an
operator configuration decision, not a player-controlled request field.

## Enforcement

- Input schemas normalize whitespace and phone format before provider transport.
- iyzico identity input is exactly 11 digits at the provider-contract boundary.
- Verified account email and request IP remain server-owned context.
- Sensitive values are forbidden in local logs, audit metadata, telemetry, error
  messages, order payloads, consent rows, and provider attempt rows.
- Safe diagnostics may contain provider, policy version, category names, and the
  `request_only` persistence mode only.
- Provider error text is reduced to bounded internal error codes.
- Existing source records, such as verified account email or security IP records,
  keep their own documented purpose. The checkout payload does not create another
  copy of those values.

## Versioning Rule

Adding a buyer field, changing its destination/purpose, changing persistence, or
activating a new provider requires all of the following:

1. Increment `PAYMENT_BUYER_DATA_POLICY_VERSION`.
2. Increment the payment privacy notice version.
3. Update the provider matrix and player-facing just-in-time explanation.
4. Review domestic/foreign transfer parties, subprocessors, and legal mechanism.
5. Add no-persistence and redaction regression tests.
6. Complete a separate sandbox acceptance before provider activation.

Privacy notice acknowledgement is not treated as blanket consent. The actual legal
basis and any cross-border safeguard must be reviewed for the selected merchant and
provider setup before production activation.

## Official References

- [KVKK personal-data processing principles](https://www.kvkk.gov.tr/Icerik/4189/Kisisel-Verilerin-Islenmesine-Iliskin-Temel-Ilkeler)
- [KVKK data minimization decision](https://www.kvkk.gov.tr/Icerik/5413/Islenme-Amacinin-Gerektirdiginden-Fazla-Kisisel-Veri-Islenmesi-Aktarilmasi-Veri-Minimizasyonu-Ilkesine-Aykirilik-)
- [KVKK cross-border transfer guide](https://www.kvkk.gov.tr/Icerik/8142/Kisisel-Verilerin-Yurt-Disina-Aktarilmasi-Rehberi)
- [KVKK deletion and anonymization regulation](https://www.kvkk.gov.tr/Icerik/5441/KISISEL-VERILERIN-SILINMESI-YOK-EDILMESI-VEYA-ANONIM-HALE-GETIRILMESI-HAKKINDA-YONETMELIK)
