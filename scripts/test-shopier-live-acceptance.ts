import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    SHOPIER_ACCEPTANCE_EVIDENCE_SCHEMA,
    SHOPIER_REQUIRED_ACCEPTANCE_CHECKS,
    sha256Digest,
    validateShopierAcceptanceManifest,
} from "./lib/payment-activation-evidence.mjs";
import {
    SHOPIER_ACCEPTANCE_CONFIRMATION,
    assertSafeShopierAcceptanceOutput,
    assertShopierAcceptanceAmount,
    assertShopierAcceptanceEnvironment,
    hashShopierAcceptanceReference,
    readShopierAcceptanceCheckpoint,
    shopierPaymentCheckpointSchema,
    writeShopierAcceptanceArtifact,
} from "./lib/shopier-live-acceptance";

const baseEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    PAYMENTS_ENABLED: "false",
    SHOPIER_CHECKOUT_MODE: "live",
    SHOPIER_WEBHOOK_MODE: "live",
    SHOPIER_RECONCILIATION_MODE: "live",
    SHOPIER_REFUND_MODE: "disabled",
    SHOPIER_ACCOUNT_ID: "123456",
    SHOPIER_PERSONAL_ACCESS_TOKEN: "shopier-live-token-with-safe-length",
    SHOPIER_ACCEPTANCE_CONFIRM: SHOPIER_ACCEPTANCE_CONFIRMATION,
    SHOPIER_ACCEPTANCE_MAX_AMOUNT_MINOR: "5000",
};

assert.doesNotThrow(() => assertShopierAcceptanceEnvironment(baseEnvironment, { providerMutation: true }));
for (const environment of [
    { ...baseEnvironment, PAYMENTS_ENABLED: "true" },
    { ...baseEnvironment, PAYMENTS_ENABLED: "" },
    { ...baseEnvironment, SHOPIER_LIVE_ACCEPTANCE_RECORDED: "true" },
    { ...baseEnvironment, SHOPIER_CHECKOUT_MODE: "disabled" },
    { ...baseEnvironment, SHOPIER_REFUND_MODE: "live" },
    { ...baseEnvironment, SHOPIER_ACCEPTANCE_CONFIRM: "wrong" },
    { ...baseEnvironment, SHOPIER_PERSONAL_ACCESS_TOKEN: "short" },
    { ...baseEnvironment, SHOPIER_ACCEPTANCE_MAX_AMOUNT_MINOR: "10001" },
]) {
    assert.throws(() => assertShopierAcceptanceEnvironment(environment, { providerMutation: true }));
}
assert.doesNotThrow(() => assertShopierAcceptanceEnvironment({
    ...baseEnvironment,
    SHOPIER_PERSONAL_ACCESS_TOKEN: "",
    SHOPIER_ACCEPTANCE_CONFIRM: "",
}, { providerMutation: false }));
assert.doesNotThrow(() => assertShopierAcceptanceAmount({ amountMinor: 5_000, currency: "TRY", environment: baseEnvironment }));
assert.throws(() => assertShopierAcceptanceAmount({ amountMinor: 5_001, currency: "TRY", environment: baseEnvironment }));
assert.throws(() => assertShopierAcceptanceAmount({ amountMinor: 100, currency: "USD", environment: baseEnvironment }));

const fixtureDir = mkdtempSync(join(tmpdir(), "hushle-shopier-acceptance-"));
try {
    const checkpointPath = join(fixtureDir, "payment-checkpoint.json");
    const checkpoint = {
        schema: "shopier-live-acceptance-checkpoint-v1" as const,
        phase: "payment_verified" as const,
        capturedAt: new Date().toISOString(),
        orderId: "11111111-1111-4111-8111-111111111111",
        ownerUserId: 10,
        amountMinor: 1_000,
        currency: "TRY" as const,
        accountIdHash: hashShopierAcceptanceReference("123456"),
        providerOrderReferenceHash: hashShopierAcceptanceReference("order-1"),
        checks: {
            checkoutPaid: true as const,
            fulfillmentCompleted: true as const,
            signedWebhookProcessed: true as const,
            reconciliationSettled: true as const,
        },
    };
    const digest = writeShopierAcceptanceArtifact(checkpointPath, checkpoint);
    assert.equal(digest, hashShopierAcceptanceReference(readFileSync(checkpointPath, "utf8")));
    assert.deepEqual(readShopierAcceptanceCheckpoint(checkpointPath, shopierPaymentCheckpointSchema), checkpoint);
    assert.throws(() => writeShopierAcceptanceArtifact(checkpointPath, checkpoint));
    assert.throws(() => readShopierAcceptanceCheckpoint("relative.json", shopierPaymentCheckpointSchema));
} finally {
    rmSync(fixtureDir, { recursive: true, force: true });
}

assert.throws(() => assertSafeShopierAcceptanceOutput({ token: "secret-value" }, ["secret-value"]));
assert.throws(() => assertSafeShopierAcceptanceOutput({ personalAccessToken: "redacted" }, []));
assert.doesNotThrow(() => assertSafeShopierAcceptanceOutput({ referenceHash: sha256Digest("reference") }, ["secret"]));

const evidenceEnvironment = { SHOPIER_ACCOUNT_ID: "123456" };
const checks = Object.fromEntries(SHOPIER_REQUIRED_ACCEPTANCE_CHECKS.map((name) => [name, true]));
const evidence = {
    schema: SHOPIER_ACCEPTANCE_EVIDENCE_SCHEMA,
    phase: "verified",
    status: "passed",
    generatedAt: new Date().toISOString(),
    provider: "shopier_v2",
    live: true,
    amountMinor: 1_000,
    currency: "TRY",
    accountIdHash: sha256Digest("123456"),
    providerOrderReferenceHash: sha256Digest("order-1"),
    providerRefundReferenceHash: sha256Digest("refund-1"),
    checks,
    failedChecks: [],
    acceptanceFlagChanged: false,
};
assert.deepEqual(validateShopierAcceptanceManifest(evidence, evidenceEnvironment), []);
assert.ok(validateShopierAcceptanceManifest({ ...evidence, amountMinor: 0 }, evidenceEnvironment).length > 0);
assert.ok(validateShopierAcceptanceManifest({ ...evidence, checks: { ...checks, refundSucceededObserved: false } }, evidenceEnvironment).length > 0);

const cli = readFileSync("scripts/run-shopier-live-acceptance.ts", "utf8");
assert.match(cli, /<dry-run\|initialize\|capture-payment\|refund\|verify>/);
assert.match(cli, /providerCalls: 0/);
assert.match(cli, /databaseWrites: 0/);
assert.match(cli, /approveProviderApiRefundRequest/);
assert.match(cli, /recoverProviderApiRefundRequest/);
assert.match(cli, /duplicateOne === "duplicate"/);
assert.doesNotMatch(cli, /SHOPIER_LIVE_ACCEPTANCE_RECORDED\s*=/);
assert.doesNotMatch(cli, /SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_SHA256\s*=/);

console.log("Shopier live acceptance harness checks passed");
