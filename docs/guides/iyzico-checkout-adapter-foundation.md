# iyzico Checkout Form Adapter Foundation

## Current Status

The iyzico Checkout Form transport, durable orchestration, owner-bound routes,
and just-in-time checkout UI are implemented. No production configuration is
active. Checkout, callback, webhook, and reconciliation paths each remain behind
explicit sandbox-only modes. `adapterAvailable=true` means the registry can route
an explicitly configured sandbox checkout; it does not enable checkout by itself.

```env
IYZICO_API_KEY=""
IYZICO_SECRET_KEY=""
IYZICO_MERCHANT_ID=""
IYZICO_CHECKOUT_MODE=disabled
IYZICO_WEBHOOK_MODE=disabled
IYZICO_RECONCILIATION_MODE=disabled
IYZICO_OWNER_CHECKOUT_MODE=disabled
IYZICO_CALLBACK_MODE=disabled
IYZICO_SANDBOX_ACCEPTANCE_RECORDED=false
```

Only `sandbox` credentials are accepted by the transport foundation. The API host
is fixed in code to `https://sandbox-api.iyzipay.com`; an environment-controlled
base URL is not supported. This prevents provider configuration from becoming an
SSRF surface.

## Implemented Boundary

- Checkout Form initialize and retrieve request contracts.
- Official `IYZWSv2` HMAC-SHA256 authorization construction.
- Exact minor-unit to decimal conversion for the server-owned order amount.
- Fixed initialize/retrieve paths and bounded 1-30 second request timeout.
- 64 KiB response limit and bounded internal error codes.
- Hosted payment URL allowlist limited to HTTPS `iyzipay.com` hosts.
- Constant-time token comparison after equal-length validation.
- Official Checkout Form response signature validation for initialize
  (`conversationId`, `token`) and retrieve (`paymentStatus`, `paymentId`,
  `currency`, `basketId`, `conversationId`, `paidPrice`, `price`, `token`).
- Signature decimal inputs remove trailing fractional zeros exactly as required
  by the provider contract. Invalid or missing signatures fail closed.
- Response minimization: provider HTML, card metadata, and error text are not
  returned from the adapter.

The browser callback and its `token` are not payment proof. The orchestration
retrieves the Checkout Form result server-side and verifies the order/conversation
reference, token, exact price, paid price, and currency. It stores a minimized
verification record containing provider payment reference, payment/risk status,
amount, currency, and verification time. A browser callback or unsigned retrieve
request cannot mark the order paid. The verified webhook processor or the bounded
reconciliation worker may consume the exact server-side proof.

## Durable Orchestration

- The order row is locked before creating an initialize attempt.
- A live request lease blocks concurrent initialize calls.
- A successful hosted URL is stored server-side so a repeated request resumes the
  same provider session instead of creating another one.
- Token correlation in attempt diagnostics uses SHA-256; raw buyer identity,
  phone, and address values are never persisted or hashed.
- Initialize timeout, transport failure, malformed success response, and expired
  request leases become durable `uncertain` attempts.
- An uncertain attempt opens a reconciliation case and blocks blind retry.
- Callback tokens are compared against the server-owned session reference before
  provider access, then checked again after the order row is locked.
- Exact amount/currency mismatches do not create a verification record.

`providerHostedUrl` and `providerSessionReference` are operational session data,
not public order fields. Future routes must return them only to the authenticated
order owner and must never log them.

## Owner Session and Callback Boundary

- `POST /api/payments/checkout/iyzico/session` requires the authenticated order
  owner, account capability, verified email, current legal versions, explicit
  buyer-data disclosure, user/IP distributed rate limits, strict JSON content
  type, and an 8 KiB streaming body limit.
- Buyer identity, phone, and address are request-only provider data. The route
  persists only the versioned consent record and returns only order ID, allowlisted
  hosted redirect URL, and sandbox marker.
- iyzico calls the callback as a cross-site form POST, so the callback does not
  depend on browser session cookies. Its opaque order ID and posted token must
  match the server-owned session before any provider request is made.
- The callback accepts only one bounded form token, applies token-hash and order
  keyed distributed limiters, performs an exact signed server-side retrieve, and sends
  a `303` redirect without the raw token.
- The callback writes verification proof only. It never marks an order paid and
  never fulfills coin or inventory; webhook/reconciliation retain that authority.
- Order status can expose the allowlisted hosted URL only to the authenticated
  order owner. The separate raw session reference is never serialized.

`IYZICO_OWNER_CHECKOUT_MODE` stops new owner sessions. `IYZICO_CALLBACK_MODE`
controls outstanding provider returns independently. During a sales shutdown,
disable new checkout while keeping callback, webhook, and reconciliation paths
available long enough to settle already-started orders.

## Signature V3 Webhook

- Only Checkout Form HPP events with `iyziEventType=CHECKOUT_FORM_AUTH` are
  accepted by this adapter.
- Only `X-IYZ-SIGNATURE-V3` is accepted. Legacy signature headers are rejected.
- Signature input follows the official HPP order: secret key, event type, iyzico
  payment ID, token, payment conversation ID, and status.
- The configured merchant ID must match the signed payload merchant ID.
- The raw token is never persisted in webhook metadata; only its SHA-256
  correlation value is stored and compared with the server-owned order session.
- Provider reference-code dedupe and raw-body identity conflict checks run in the
  existing durable webhook inbox.
- A signed success webhook is still not sufficient for fulfillment because it
  carries no amount or currency. The processor requires an exact server-side
  Checkout Form retrieve proof before moving the order to paid/fulfilled.
- A signed failure can close only the matching awaiting order and clears hosted
  session data. It cannot reverse an already paid or fulfilled order.

The endpoint remains off unless both checkout and webhook modes are explicitly
set to `sandbox`. Enabling `IYZICO_WEBHOOK_MODE` also requires the merchant account
Signature V3 feature and HTTPS notification URL to be configured at iyzico.

## Reconciliation

- The shared `payment-reconciliation` job supports both PayTR and iyzico while
  preserving one global Redis lease and a bounded database batch.
- iyzico queries remain disabled unless `IYZICO_CHECKOUT_MODE=sandbox` and
  `IYZICO_RECONCILIATION_MODE=sandbox` are both explicit.
- An old `awaiting_payment` order with a server-owned token is retrieved from
  iyzico. Exact price, paid price, currency, payment status, fraud status, token,
  and conversation identity are required before paid/fulfilled transitions.
- A signed webhook is not required for recovery when the same exact retrieve
  proof is available. Fulfillment and notification remain idempotent under
  concurrent webhook, job, and admin reconciliation.
- An uncertain initialize without a token cannot be retrieved. It is retained as
  `iyzico_initialize_uncertain_manual_review`; the worker never retries initialize
  and never guesses that payment succeeded.
- Successful-looking injected/provider results still require the durable
  `PaymentCheckoutVerification` record. A boolean result alone cannot grant an
  item or coin.
- `paid` or `fulfilled` iyzico orders without exact proof are held for review;
  reconciliation does not manufacture missing evidence.
- Cases stop automatic checks at the shared maximum-attempt limit and remain in
  the admin review surface.

## Buyer Data Contract

The request-only buyer data schema and `buyer-data-v1` consent snapshot are now
implemented. National identity, phone, and address values are not persisted or
hashed locally. See `docs/guides/payment-buyer-data-policy.md`.

## Activation Blockers

iyzico Checkout Form requires buyer identity, phone, IP, and address fields. The
application does not collect or persist new fields merely to activate an adapter.
Before merchant sandbox or live activation, the following still need explicit decisions:

1. Merchant-specific confirmation of every required field.
2. Provider/subprocessor and domestic or cross-border transfer legal review.
3. Final approved privacy notice and checkout-copy versions.
4. Merchant-specific field and transfer acceptance evidence.
5. Real merchant sandbox acceptance and reviewed session-data retention.

Most iyzico API operations are not generally idempotent. A timeout after initialize
becomes an `uncertain` durable attempt and cannot trigger a blind retry that could
create a second provider session.

## Next Slices

1. Merchant-specific legal/privacy and transfer approval.
2. Real merchant sandbox acceptance with exact amount/currency proof.
3. Operations runbook and callback/webhook monitoring acceptance.
4. Separate reviewed live-mode activation.

Only Signature V3 is accepted. Deprecated signature formats are not an acceptable
compatibility fallback.

## Official References

- [HMACSHA256 authentication](https://docs.iyzico.com/en/getting-started/preliminaries/authentication/hmacsha256-auth)
- [Idempotency](https://docs.iyzico.com/en/getting-started/preliminaries/idempotency)
- [Checkout Form initialize](https://docs.iyzico.com/en/payment-methods/checkoutform/cf-implementation/cf-initialize)
- [Checkout Form retrieve](https://docs.iyzico.com/en/payment-methods/checkoutform/cf-implementation/cf-retrieve)
- [Response signature validation](https://docs.iyzico.com/en/advanced/response-signature-validation)
- [Webhook Signature V3](https://docs.iyzico.com/en/advanced/webhook)
- [Sandbox environment](https://docs.iyzico.com/en/getting-started/preliminaries/sandbox)
