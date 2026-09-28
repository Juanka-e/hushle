# Stripe Checkout Adapter Foundation

## Current Status

The Stripe Checkout Session transport foundation is implemented but disabled. It
is not connected to application checkout routes, UI, webhooks, fulfillment, or
live credentials. Provider registry keeps `adapterAvailable=false`.

```env
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
STRIPE_CHECKOUT_MODE=disabled
```

Only `sk_test_` and least-privilege `rk_test_` keys are accepted by this adapter.
Live keys are rejected. New integrations should prefer a restricted test key that
can create Checkout Sessions instead of an unrestricted secret key.

## Implemented Boundary

- Fixed `https://api.stripe.com/v1/checkout/sessions` endpoint.
- Pinned `Stripe-Version: 2026-02-25.clover` response contract.
- Provider `Idempotency-Key` on every session-create POST.
- Server-owned minor-unit price, currency, product name, and internal order ID.
- Internal order correlation in `client_reference_id`, Session metadata, and
  PaymentIntent metadata.
- Hosted Checkout only; returned URLs must use HTTPS `checkout.stripe.com`.
- 1-30 second timeout, 64 KiB streamed response limit, and bounded error codes.
- Response minimization: customer/card/provider error details are not returned.

The success redirect and Checkout Session creation response are not payment proof.
Fulfillment must wait for a raw-body signature-verified webhook and exact
order/session/amount/currency validation in a future durable processor.

## Merchant Eligibility Blocker

As of the review date, Stripe's official global availability list does not include
Turkey as a supported merchant country. This adapter must not be made a production
option for a Turkey-based merchant account unless Stripe officially adds support or
the business already has a legitimate eligible legal entity and banking setup.

Creating a foreign legal entity solely to bypass provider availability is not an
engineering activation step and is not recommended by this project. PayTR/iyzico
remain the locally relevant tracks subject to their own merchant acceptance.

## Activation Sequence

1. Confirm merchant country, entity, product, and currency eligibility.
2. Add durable Checkout Session attempt orchestration using the existing order.
3. Implement Stripe raw-body webhook verification and durable inbox processing.
4. Verify `checkout.session.completed`, async payment outcomes, expiry, refund,
   dispute, and duplicate/out-of-order event behavior.
5. Run real sandbox acceptance and record exact order/amount/currency evidence.
6. Review key scope, access policies, rotation, webhook endpoint version, and
   production legal configuration before a separate live activation.

Stripe retains idempotency results for at least 24 hours and rejects reuse with
different parameters. Application attempts still need durable state; provider
idempotency is not a replacement for the local order state machine.

## Official References

- [Create a Checkout Session](https://docs.stripe.com/api/checkout/sessions/create)
- [Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [API versioning](https://docs.stripe.com/api/versioning)
- [API keys and restricted keys](https://docs.stripe.com/keys)
- [Webhook security](https://docs.stripe.com/webhooks)
- [Global availability](https://stripe.com/global)
