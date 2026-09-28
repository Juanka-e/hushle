# Payment Activation Evidence

## Purpose

`PAYMENT_LEGAL_APPROVED=true` and
`IYZICO_SANDBOX_ACCEPTANCE_RECORDED=true` are explicit operator decisions, but a
boolean alone does not prove which documents, merchant or sandbox run was reviewed.
Production activation therefore requires immutable evidence files plus their exact
SHA-256 digests.

This mechanism prevents accidental activation with stale or unrelated evidence. It
does not replace legal advice, provider approval or the real merchant sandbox test.

## Evidence Directory

Evidence stays outside the repository and application image:

```bash
sudo install -d -o hushle -g hushle -m 0700 /srv/hushle/payment-evidence
```

Production uses:

```dotenv
PAYMENT_EVIDENCE_DIR=/srv/hushle/payment-evidence
PAYMENT_LEGAL_APPROVAL_EVIDENCE_FILE=/srv/hushle/payment-evidence/payment-legal-approval.json
IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_FILE=/srv/hushle/payment-evidence/iyzico-sandbox-acceptance.json
```

The deploy preflight mounts this directory read-only and with no network access.
Evidence files must be regular, non-symlink, at most 64 KiB and not world-readable.
They are never mounted into the public web container.

## Legal Approval Manifest

After the final business details, checkout terms, payment privacy notice, distance
sales notice and provider transfer model have been reviewed, set the exact production
configuration in the operator shell and run:

```bash
export PAYMENT_LEGAL_APPROVAL_CONFIRM=I_CONFIRM_PAYMENT_LEGAL_REVIEW_IS_COMPLETE
export PAYMENT_LEGAL_APPROVAL_REFERENCE=LEGAL-2026-001
npm run payment:create-legal-evidence -- \
  --output /srv/hushle/payment-evidence/payment-legal-approval.json
```

The reference points to the external reviewed legal record. Do not put a lawyer or
employee name, free-form legal text, customer data or secrets in the reference.

The generated manifest stores a digest of:

- active provider,
- business name/address/contact email,
- three legal document versions,
- buyer-data policy version,
- the four reviewed scopes.

It does not duplicate business fields or personal reviewer details. The command uses
exclusive creation and refuses to overwrite an existing approval. A legal or provider
change requires a new file and new reference, not an in-place edit.

Copy the printed digest exactly:

```dotenv
PAYMENT_LEGAL_APPROVED=true
PAYMENT_LEGAL_APPROVAL_EVIDENCE_SHA256=sha256:<64-lowercase-hex>
```

## Iyzico Sandbox Manifest

The real sandbox verification emits schema `iyzico-sandbox-acceptance-v2`. Redirect
only a successful `verify` run to the protected evidence path:

```bash
npm run --silent payment:iyzico-sandbox-acceptance -- verify \
  > /srv/hushle/payment-evidence/iyzico-sandbox-acceptance.json
chmod 0600 /srv/hushle/payment-evidence/iyzico-sandbox-acceptance.json
sha256sum /srv/hushle/payment-evidence/iyzico-sandbox-acceptance.json
```

The v2 evidence binds the successful checks to a hashed merchant ID and the exact
legal document/buyer-data policy versions. It contains no provider token, hosted URL,
credential, identity number, phone or address.

After independent review, configure:

```dotenv
IYZICO_SANDBOX_ACCEPTANCE_RECORDED=true
IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256=sha256:<64-lowercase-hex>
```

## Preflight Failure Cases

Checkout remains closed when any of these occurs:

- evidence path is relative, missing, symlinked, oversized or world-readable,
- configured digest does not match file bytes,
- legal provider, configuration or document versions changed,
- Iyzico merchant ID or legal versions differ from the accepted run,
- any acceptance check failed or is absent,
- a future timestamp or unsupported evidence schema is used.

Never fix a mismatch by editing the JSON or calculating a digest for fabricated
evidence. Repeat the relevant review or sandbox acceptance and create a new artifact.
