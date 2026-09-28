import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    IYZICO_ACCEPTANCE_EVIDENCE_SCHEMA,
    IYZICO_ACCEPTANCE_CONFIRMATION,
    assertIyzicoAcceptanceEnvironment,
    assertSafeAcceptanceEvidence,
    buildAcceptanceCallbackUrl,
    hashProviderReference,
    readPositiveAmountLimit,
    readPositiveInteger,
} from "./lib/iyzico-sandbox-acceptance";

const validEnvironment = {
    NODE_ENV: "test",
    DATABASE_URL: "mysql://root:root@127.0.0.1:3307/hushle_acceptance",
    IYZICO_SANDBOX_ACCEPTANCE_CONFIRM: IYZICO_ACCEPTANCE_CONFIRMATION,
    IYZICO_CHECKOUT_MODE: "sandbox",
    IYZICO_WEBHOOK_MODE: "sandbox",
    IYZICO_RECONCILIATION_MODE: "sandbox",
    IYZICO_OWNER_CHECKOUT_MODE: "sandbox",
    IYZICO_CALLBACK_MODE: "sandbox",
    IYZICO_API_KEY: "sandbox-api-key",
    IYZICO_SECRET_KEY: "sandbox-secret-key",
    IYZICO_MERCHANT_ID: "3404590",
    IYZICO_ACCEPTANCE_PUBLIC_ORIGIN: "https://acceptance.example.com",
} as const;

assert.doesNotThrow(() => assertIyzicoAcceptanceEnvironment(validEnvironment));
assert.throws(
    () => assertIyzicoAcceptanceEnvironment({ ...validEnvironment, IYZICO_SANDBOX_ACCEPTANCE_CONFIRM: "wrong" }),
    /iyzico_acceptance_confirmation_required/
);
assert.throws(
    () => assertIyzicoAcceptanceEnvironment({ ...validEnvironment, NODE_ENV: "production" }),
    /iyzico_acceptance_production_runtime_forbidden/
);
assert.throws(
    () => assertIyzicoAcceptanceEnvironment({ ...validEnvironment, DATABASE_URL: "mysql:\/\/root:root@db\/hushle" }),
    /iyzico_acceptance_database_not_allowed/
);
assert.throws(
    () => assertIyzicoAcceptanceEnvironment({ ...validEnvironment, IYZICO_WEBHOOK_MODE: "live" }),
    /iyzico_webhook_mode_must_be_sandbox/
);
assert.throws(
    () => assertIyzicoAcceptanceEnvironment({ ...validEnvironment, IYZICO_API_KEY: "live-key" }),
    /iyzico_acceptance_api_key_not_sandbox/
);
assert.throws(
    () => assertIyzicoAcceptanceEnvironment({ ...validEnvironment, IYZICO_ACCEPTANCE_PUBLIC_ORIGIN: "http:\/\/localhost:3000" }),
    /iyzico_acceptance_public_origin_invalid/
);
assert.equal(readPositiveAmountLimit({}), 100_000);
assert.equal(readPositiveAmountLimit({ IYZICO_ACCEPTANCE_MAX_AMOUNT_MINOR: "2500" }), 2_500);
assert.throws(
    () => readPositiveAmountLimit({ IYZICO_ACCEPTANCE_MAX_AMOUNT_MINOR: "2500oops" }),
    /iyzico_acceptance_max_amount_minor_invalid/
);
assert.equal(readPositiveInteger({ USER_ID: "42" }, "USER_ID"), 42);
assert.throws(() => readPositiveInteger({ USER_ID: "42oops" }, "USER_ID"), /user_id_invalid/);
assert.equal(
    buildAcceptanceCallbackUrl("https://acceptance.example.com", "order-id"),
    "https://acceptance.example.com/api/payments/callback/iyzico?order=order-id"
);
assert.match(hashProviderReference("payment-reference"), /^sha256:[a-f0-9]{64}$/);

assert.doesNotThrow(() => assertSafeAcceptanceEvidence({
    schema: IYZICO_ACCEPTANCE_EVIDENCE_SCHEMA,
    orderId: "safe-order-id",
    providerPaymentReferenceHash: hashProviderReference("payment-reference"),
}));
assert.throws(
    () => assertSafeAcceptanceEvidence({ token: "sensitive" }),
    /iyzico_acceptance_evidence_contains_sensitive_key/
);
assert.throws(
    () => assertSafeAcceptanceEvidence({ value: "private-buyer-value" }, ["private-buyer-value"]),
    /iyzico_acceptance_evidence_contains_sensitive_value/
);

const rejected = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/run-iyzico-sandbox-acceptance.ts", "initialize"],
    {
        encoding: "utf8",
        env: {
            ...process.env,
            ...validEnvironment,
            IYZICO_SECRET_KEY: "sandbox-never-print-this-secret",
            IYZICO_SANDBOX_ACCEPTANCE_CONFIRM: "wrong",
        },
    }
);
assert.equal(rejected.status, 1);
assert.match(rejected.stderr, /iyzico_acceptance_confirmation_required/);
assert.doesNotMatch(rejected.stderr, /sandbox-never-print-this-secret/);

console.log("iyzico sandbox acceptance safety and evidence checks passed");
