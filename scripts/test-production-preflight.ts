import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnvFile, validateProductionEnvironment } from "./lib/production-preflight.mjs";
import {
    IYZICO_ACCEPTANCE_EVIDENCE_SCHEMA,
    IYZICO_REQUIRED_ACCEPTANCE_CHECKS,
    SHOPIER_ACCEPTANCE_EVIDENCE_SCHEMA,
    SHOPIER_REQUIRED_ACCEPTANCE_CHECKS,
    PAYMENT_BUYER_DATA_POLICY_VERSION,
    PAYMENT_LEGAL_APPROVAL_SCHEMA,
    PAYMENT_LEGAL_REVIEW_SCOPES,
    legalConfigurationDigest,
    sha256Digest,
} from "./lib/payment-activation-evidence.mjs";

const paymentEvidenceDir = mkdtempSync(join(tmpdir(), "hushle-payment-evidence-"));
let evidenceSequence = 0;

function writeEvidence(name: string, manifest: unknown): { path: string; digest: string } {
    const path = join(paymentEvidenceDir, `${evidenceSequence += 1}-${name}.json`);
    const content = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(path, content, "utf8");
    chmodSync(path, 0o600);
    return { path, digest: sha256Digest(content) };
}

function attachLegalEvidence(environment: Record<string, string>): void {
    const evidence = writeEvidence("legal", {
        schema: PAYMENT_LEGAL_APPROVAL_SCHEMA,
        status: "approved",
        approvedAt: new Date().toISOString(),
        activeProvider: environment.PAYMENT_ACTIVE_PROVIDER,
        approvalReference: "LEGAL-2026-001",
        reviewedScopes: PAYMENT_LEGAL_REVIEW_SCOPES,
        configurationDigest: legalConfigurationDigest(environment),
    });
    environment.PAYMENT_LEGAL_APPROVAL_EVIDENCE_FILE = evidence.path;
    environment.PAYMENT_LEGAL_APPROVAL_EVIDENCE_SHA256 = evidence.digest;
}

function attachIyzicoEvidence(environment: Record<string, string>): void {
    const checks = Object.fromEntries(IYZICO_REQUIRED_ACCEPTANCE_CHECKS.map((name) => [name, true]));
    const evidence = writeEvidence("iyzico", {
        schema: IYZICO_ACCEPTANCE_EVIDENCE_SCHEMA,
        phase: "verified",
        status: "passed",
        generatedAt: new Date().toISOString(),
        provider: "iyzico",
        sandbox: true,
        orderId: "acceptance-order-id",
        ownerUserId: 42,
        amountMinor: 100,
        currency: "TRY",
        merchantIdHash: sha256Digest(environment.IYZICO_MERCHANT_ID),
        legalVersions: {
            checkoutTermsVersion: environment.PAYMENT_CHECKOUT_TERMS_VERSION,
            privacyNoticeVersion: environment.PAYMENT_PRIVACY_NOTICE_VERSION,
            distanceSalesNoticeVersion: environment.PAYMENT_DISTANCE_SALES_NOTICE_VERSION,
            buyerDataPolicyVersion: PAYMENT_BUYER_DATA_POLICY_VERSION,
        },
        providerPaymentReferenceHash: sha256Digest("provider-payment-reference"),
        checks,
        failedChecks: [],
    });
    environment.IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_FILE = evidence.path;
    environment.IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256 = evidence.digest;
}

function attachShopierEvidence(environment: Record<string, string>): void {
    const checks = Object.fromEntries(SHOPIER_REQUIRED_ACCEPTANCE_CHECKS.map((name) => [name, true]));
    const evidence = writeEvidence("shopier", {
        schema: SHOPIER_ACCEPTANCE_EVIDENCE_SCHEMA,
        phase: "verified", status: "passed", generatedAt: new Date().toISOString(),
        provider: "shopier_v2", live: true, amountMinor: 100, currency: "TRY",
        accountIdHash: sha256Digest(environment.SHOPIER_ACCOUNT_ID),
        providerOrderReferenceHash: sha256Digest("shopier-order"),
        providerRefundReferenceHash: sha256Digest("shopier-refund"),
        checks, failedChecks: [],
    });
    environment.SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_FILE = evidence.path;
    environment.SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_SHA256 = evidence.digest;
}

function validEnvironment(): Record<string, string> {
    return {
        NODE_ENV: "production",
        AUTH_SECRET: "auth_A7xQ2mN9pL4vR8sT6wY3kD5cF1hJ0zB",
        HEALTHCHECK_TOKEN: "health_Z9pQ4mT7vL2xN8sR5wK1dF6cA3jH0yB",
        MYSQL_ROOT_PASSWORD: "root_R8mQ2vN7xL4pT9sK5wD1cF6hJ3yA0zB",
        MYSQL_PASSWORD: "mysql_K4vN8pQ2xT7mL5sR1wD9cF3hJ6yA0zB",
        MYSQL_USER: "hushle",
        DATABASE_URL: "mysql://hushle:mysql_K4vN8pQ2xT7mL5sR1wD9cF3hJ6yA0zB@mysql:3306/hushle",
        REDIS_URL: "redis://redis:6379",
        REDIS_KEY_PREFIX: "hushle:production",
        NEXTAUTH_URL: "https://play.example.test",
        NEXT_PUBLIC_SITE_URL: "https://play.example.test",
        TRUSTED_WEB_ORIGINS: "https://play.example.test,https://admin.example.test",
        RATE_LIMIT_ENABLED: "true",
        PASSWORD_BREACH_CHECK_ENABLED: "true",
        STATE_CHANGE_ORIGIN_POLICY: "strict",
        REALTIME_TOPOLOGY: "single-writer",
        REALTIME_REPLICA_COUNT: "1",
        ALLOW_ORIGINLESS_SOCKET_CLIENTS: "false",
        ADMIN_ACCESS_MODE: "external_gateway",
        ADMIN_ACCESS_FAIL_CLOSED: "true",
        ADMIN_ACCESS_ALLOW_LOCAL_DEV_BYPASS: "false",
        ADMIN_ACCESS_EMAIL_HEADER_NAME: "cf-access-authenticated-user-email",
        ADMIN_ACCESS_ALLOWED_EMAIL_DOMAINS: "example.test",
        AUTH_TRUST_HOST: "true",
        TRUST_PROXY: "true",
        PRODUCTION_OAUTH_POLICY: "google",
        GOOGLE_OAUTH_ENABLED: "true",
        AUTH_GOOGLE_ID: "918273645001-r4nD0mClientId.apps.googleusercontent.com",
        AUTH_GOOGLE_SECRET: "google_R8mQ2vN7xL4pT9sK5wD1cF6h",
        PRODUCTION_OBSERVABILITY_POLICY: "http",
        OBSERVABILITY_EXPORT_MODE: "http",
        OBSERVABILITY_EXPORT_URL: "https://collector.example.test/v1/events",
        OBSERVABILITY_EXPORT_TOKEN: "observe_P8vN3qR7xL2mT9sK5wD1cF6hJ4yA0zB",
        PRODUCTION_CAPTCHA_POLICY: "turnstile",
        TURNSTILE_SITE_KEY: "site-key",
        TURNSTILE_SECRET_KEY: "turnstile_R8mQ2vN7xL4pT9sK5wD1cF6h",
        TURNSTILE_ALLOWED_HOSTNAMES: "play.example.test",
        PRODUCTION_EDGE_SECURITY_POLICY: "cloudflare_free_safe_launch",
        CLOUDFLARE_PROXY_ENABLED: "true",
        CLOUDFLARE_ORIGIN_LOCK_MODE: "firewall",
        CLOUDFLARE_BOT_FIGHT_MODE: "disabled_until_webhook_smoke",
        PAYMENT_WEBHOOK_EDGE_POLICY: "signature_first_no_challenge",
        PRODUCTION_EMAIL_POLICY: "smtp",
        EMAIL_PROVIDER: "smtp",
        EMAIL_TOKEN_SECRET: "email_T7vN2pQ8xL4mR9sK5wD1cF6hJ3yA0zB",
        EMAIL_FROM: "Hushle <no-reply@hushle.test>",
        SMTP_HOST: "smtp.hushle.test",
        SMTP_PORT: "587",
        PRODUCTION_EMAIL_FEEDBACK_POLICY: "ses_sns",
        SES_FEEDBACK_WEBHOOK_ENABLED: "true",
        SES_SNS_TOPIC_ARNS: "arn:aws:sns:eu-central-1:123456789012:hushle-ses-feedback",
        SES_ALLOWED_SOURCE_ARNS: "arn:aws:ses:eu-central-1:123456789012:identity/hushle.test",
        SES_SNS_AUTO_CONFIRM: "false",
        SES_FEEDBACK_WEBHOOK_RATE_LIMIT_PER_MINUTE: "600",
        JOBS_ENABLED: "true",
        BACKUP_REMOTE_ENABLED: "true",
        BACKUP_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
        BACKUP_S3_BUCKET: "hushle-production",
        BACKUP_S3_ACCESS_KEY_ID: "r2-access-key",
        BACKUP_S3_SECRET_ACCESS_KEY: "r2-secret-key",
    };
}

const valid = validateProductionEnvironment(validEnvironment());
assert.deepEqual(valid.errors, []);

const unsafe = validEnvironment();
unsafe.AUTH_SECRET = "replace_with_secret";
unsafe.NEXT_PUBLIC_SITE_URL = "http://localhost:3000/path";
unsafe.REALTIME_REPLICA_COUNT = "2";
unsafe.ADMIN_ACCESS_MODE = "public_login";
unsafe.ADMIN_ACCESS_ALLOW_LOCAL_DEV_BYPASS = "true";
unsafe.BACKUP_REMOTE_ENABLED = "false";
unsafe.STATE_CHANGE_ORIGIN_POLICY = "compatible";
unsafe.PAYMENT_WEBHOOK_EDGE_POLICY = "challenge_all";
const rejected = validateProductionEnvironment(unsafe);
assert.ok(rejected.errors.length >= 6);
assert.ok(rejected.errors.some((error) => error.includes("AUTH_SECRET")));
assert.ok(rejected.errors.some((error) => error.includes("single-writer")));
assert.ok(rejected.errors.some((error) => error.includes("ADMIN_ACCESS_MODE")));
assert.ok(rejected.errors.some((error) => error.includes("STATE_CHANGE_ORIGIN_POLICY")));
assert.ok(rejected.errors.some((error) => error.includes("PAYMENT_WEBHOOK_EDGE_POLICY")));
assert.equal(rejected.errors.join("\n").includes(unsafe.MYSQL_PASSWORD), false);

const acceptedRisk = validEnvironment();
acceptedRisk.PRODUCTION_CAPTCHA_POLICY = "disabled_risk_accepted";
acceptedRisk.PRODUCTION_EMAIL_POLICY = "disabled_risk_accepted";
acceptedRisk.EMAIL_PROVIDER = "disabled";
acceptedRisk.PRODUCTION_EMAIL_FEEDBACK_POLICY = "disabled";
acceptedRisk.SES_FEEDBACK_WEBHOOK_ENABLED = "false";
acceptedRisk.SES_SNS_TOPIC_ARNS = "";
acceptedRisk.SES_ALLOWED_SOURCE_ARNS = "";
acceptedRisk.JOBS_ENABLED = "false";
acceptedRisk.PRODUCTION_OBSERVABILITY_POLICY = "disabled_risk_accepted";
acceptedRisk.PRODUCTION_OAUTH_POLICY = "disabled_risk_accepted";
acceptedRisk.GOOGLE_OAUTH_ENABLED = "false";
acceptedRisk.AUTH_GOOGLE_ID = "";
acceptedRisk.AUTH_GOOGLE_SECRET = "";
acceptedRisk.OBSERVABILITY_EXPORT_MODE = "disabled";
acceptedRisk.OBSERVABILITY_EXPORT_URL = "";
acceptedRisk.OBSERVABILITY_EXPORT_TOKEN = "";
const riskResult = validateProductionEnvironment(acceptedRisk);
assert.deepEqual(riskResult.errors, []);
assert.equal(riskResult.warnings.length, 4);

const missingSesTopics = validEnvironment();
missingSesTopics.SES_SNS_TOPIC_ARNS = "";
assert.ok(
    validateProductionEnvironment(missingSesTopics).errors.some((error) =>
        error.includes("SES_SNS_TOPIC_ARNS")
    )
);

const missingSesSources = validEnvironment();
missingSesSources.SES_ALLOWED_SOURCE_ARNS = "";
assert.ok(
    validateProductionEnvironment(missingSesSources).errors.some((error) =>
        error.includes("SES_ALLOWED_SOURCE_ARNS")
    )
);

const mismatchedSesRegion = validEnvironment();
mismatchedSesRegion.SES_ALLOWED_SOURCE_ARNS =
    "arn:aws:ses:eu-west-1:123456789012:identity/hushle.test";
assert.ok(
    validateProductionEnvironment(mismatchedSesRegion).errors.some((error) =>
        error.includes("partition and region")
    )
);

const invalidSesRateLimit = validEnvironment();
invalidSesRateLimit.SES_FEEDBACK_WEBHOOK_RATE_LIMIT_PER_MINUTE = "20";
assert.ok(
    validateProductionEnvironment(invalidSesRateLimit).errors.some((error) =>
        error.includes("SES_FEEDBACK_WEBHOOK_RATE_LIMIT_PER_MINUTE")
    )
);

const providerManagedFeedback = validEnvironment();
providerManagedFeedback.PRODUCTION_EMAIL_FEEDBACK_POLICY = "provider_managed_risk_accepted";
providerManagedFeedback.SES_FEEDBACK_WEBHOOK_ENABLED = "false";
providerManagedFeedback.SES_SNS_TOPIC_ARNS = "";
providerManagedFeedback.SES_ALLOWED_SOURCE_ARNS = "";
const providerManagedResult = validateProductionEnvironment(providerManagedFeedback);
assert.deepEqual(providerManagedResult.errors, []);
assert.ok(providerManagedResult.warnings.some((warning) => warning.includes("delegated")));

const staleDisabledExporter = { ...acceptedRisk };
staleDisabledExporter.OBSERVABILITY_EXPORT_TOKEN = "stale-token";
assert.ok(
    validateProductionEnvironment(staleDisabledExporter).errors.some((error) =>
        error.includes("must not retain")
    )
);

const unsafeExporter = validEnvironment();
unsafeExporter.OBSERVABILITY_EXPORT_URL = "http://collector.example.test/events?token=unsafe";
assert.ok(
    validateProductionEnvironment(unsafeExporter).errors.some((error) =>
        error.includes("OBSERVABILITY_EXPORT_URL")
    )
);

const wildcard = validEnvironment();
wildcard.TRUSTED_WEB_ORIGINS = "*";
assert.ok(validateProductionEnvironment(wildcard).errors.some((error) => error.includes("wildcard")));

const checkoutWithoutLegalApproval = validEnvironment();
checkoutWithoutLegalApproval.PAYMENTS_ENABLED = "true";
checkoutWithoutLegalApproval.PAYMENT_LEGAL_APPROVED = "false";
assert.ok(
    validateProductionEnvironment(checkoutWithoutLegalApproval).errors.some((error) =>
        error.includes("PAYMENT_LEGAL_APPROVED")
    )
);

const checkoutWithLegalApproval = validEnvironment();
Object.assign(checkoutWithLegalApproval, {
    PAYMENTS_ENABLED: "true",
    PAYMENT_ACTIVE_PROVIDER: "paytr",
    PAYTR_CHECKOUT_MODE: "sandbox",
    PAYTR_MERCHANT_ID: "sandbox-merchant-123",
    PAYTR_MERCHANT_KEY: "sandbox-key-123456",
    PAYTR_MERCHANT_SALT: "sandbox-salt-123456",
    JOBS_ENABLED: "true",
    PAYMENT_WEBHOOK_SCHEDULE_CONFIGURED: "true",
    PAYMENT_RECONCILIATION_SCHEDULE_CONFIGURED: "true",
    PAYMENT_WEBHOOK_SCHEDULE_MAX_AGE_SECONDS: "180",
    PAYMENT_RECONCILIATION_SCHEDULE_MAX_AGE_SECONDS: "1800",
    PAYMENT_LEGAL_APPROVED: "true",
    PAYMENT_LEGAL_BUSINESS_NAME: "Hushle Teknoloji A.S.",
    PAYMENT_LEGAL_BUSINESS_ADDRESS: "Maslak Mahallesi, Istanbul",
    PAYMENT_LEGAL_CONTACT_EMAIL: "odeme@hushle.com",
    PAYMENT_CHECKOUT_TERMS_VERSION: "terms-v1",
    PAYMENT_PRIVACY_NOTICE_VERSION: "privacy-v1",
    PAYMENT_DISTANCE_SALES_NOTICE_VERSION: "distance-v1",
    PAYMENT_ROLLOUT_SEED: "production-rollout-seed-v1",
});
attachLegalEvidence(checkoutWithLegalApproval);
assert.deepEqual(validateProductionEnvironment(checkoutWithLegalApproval).errors, []);

const checkoutWithoutRolloutSeed = { ...checkoutWithLegalApproval, PAYMENT_ROLLOUT_SEED: "" };
assert.ok(
    validateProductionEnvironment(checkoutWithoutRolloutSeed).errors.some((error) =>
        error.includes("PAYMENT_ROLLOUT_SEED")
    )
);

const iyzicoCheckoutWithAcceptance = {
    ...checkoutWithLegalApproval,
    PAYMENT_ACTIVE_PROVIDER: "iyzico",
    IYZICO_API_KEY: "sandbox-api-key",
    IYZICO_SECRET_KEY: "sandbox-secret-key",
    IYZICO_MERCHANT_ID: "3404590",
    IYZICO_CHECKOUT_MODE: "sandbox",
    IYZICO_OWNER_CHECKOUT_MODE: "sandbox",
    IYZICO_CALLBACK_MODE: "sandbox",
    IYZICO_WEBHOOK_MODE: "sandbox",
    IYZICO_RECONCILIATION_MODE: "sandbox",
    IYZICO_SANDBOX_ACCEPTANCE_RECORDED: "true",
};
attachLegalEvidence(iyzicoCheckoutWithAcceptance);
attachIyzicoEvidence(iyzicoCheckoutWithAcceptance);
assert.deepEqual(validateProductionEnvironment(iyzicoCheckoutWithAcceptance).errors, []);

const shopierCheckoutWithAcceptance = {
    ...checkoutWithLegalApproval,
    PAYMENT_ACTIVE_PROVIDER: "shopier_v2",
    SHOPIER_CHECKOUT_MODE: "live", SHOPIER_WEBHOOK_MODE: "live",
    SHOPIER_RECONCILIATION_MODE: "live", SHOPIER_REFUND_MODE: "live",
    SHOPIER_PERSONAL_ACCESS_TOKEN: "shopier-live-token-with-safe-length-123",
    SHOPIER_PRODUCT_MEDIA_URL: "https://cdn.hushle.com/payment.png",
    SHOPIER_WEBHOOK_TOKEN: "shopier-webhook-token-with-safe-length-123",
    SHOPIER_ACCOUNT_ID: "123456", SHOPIER_LIVE_ACCEPTANCE_RECORDED: "true",
};
attachLegalEvidence(shopierCheckoutWithAcceptance);
attachShopierEvidence(shopierCheckoutWithAcceptance);
assert.deepEqual(validateProductionEnvironment(shopierCheckoutWithAcceptance).errors, []);
const shopierWithoutRefundGate = { ...shopierCheckoutWithAcceptance, SHOPIER_REFUND_MODE: "disabled" };
assert.ok(validateProductionEnvironment(shopierWithoutRefundGate).errors.some((error) => error.includes("SHOPIER_REFUND_MODE")));

const iyzicoWithWrongMerchant = {
    ...iyzicoCheckoutWithAcceptance,
    IYZICO_MERCHANT_ID: "9999999",
};
assert.ok(
    validateProductionEnvironment(iyzicoWithWrongMerchant).errors.some((error) =>
        error.includes("merchant does not match")
    )
);

const staleLegalEvidence = {
    ...checkoutWithLegalApproval,
    PAYMENT_PRIVACY_NOTICE_VERSION: "privacy-v2",
};
assert.ok(
    validateProductionEnvironment(staleLegalEvidence).errors.some((error) =>
        error.includes("current legal configuration")
    )
);

const tamperedIyzicoEvidence = {
    ...iyzicoCheckoutWithAcceptance,
    IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256: `sha256:${"0".repeat(64)}`,
};
assert.ok(
    validateProductionEnvironment(tamperedIyzicoEvidence).errors.some((error) =>
        error.includes("does not match the evidence file")
    )
);

const iyzicoWithoutAcceptance = {
    ...iyzicoCheckoutWithAcceptance,
    IYZICO_SANDBOX_ACCEPTANCE_RECORDED: "false",
};
assert.ok(
    validateProductionEnvironment(iyzicoWithoutAcceptance).errors.some((error) =>
        error.includes("IYZICO_SANDBOX_ACCEPTANCE_RECORDED")
    )
);

const iyzicoWithLiveMode = { ...iyzicoCheckoutWithAcceptance, IYZICO_CALLBACK_MODE: "live" };
assert.ok(
    validateProductionEnvironment(iyzicoWithLiveMode).errors.some((error) =>
        error.includes("IYZICO_CALLBACK_MODE must be sandbox")
    )
);

const livePaytrCheckout = { ...checkoutWithLegalApproval, PAYTR_CHECKOUT_MODE: "live" };
assert.ok(
    validateProductionEnvironment(livePaytrCheckout).errors.some((error) =>
        error.includes("live checkout is not available")
    )
);

const prematurelyEnabledRefund = { ...checkoutWithLegalApproval, PAYTR_REFUND_MODE: "sandbox" };
assert.ok(
    validateProductionEnvironment(prematurelyEnabledRefund).errors.some((error) =>
        error.includes("PAYTR_REFUND_MODE must remain disabled")
    )
);

const incompletePaytrCheckout = { ...checkoutWithLegalApproval, PAYTR_MERCHANT_KEY: "" };
assert.ok(
    validateProductionEnvironment(incompletePaytrCheckout).errors.some((error) =>
        error.includes("PAYTR_MERCHANT_KEY")
    )
);

const unscheduledPaytrCheckout = {
    ...checkoutWithLegalApproval,
    PAYMENT_WEBHOOK_SCHEDULE_CONFIGURED: "false",
};
assert.ok(
    validateProductionEnvironment(unscheduledPaytrCheckout).errors.some((error) =>
        error.includes("PAYMENT_WEBHOOK_SCHEDULE_CONFIGURED")
    )
);

const unreconciledPaytrCheckout = {
    ...checkoutWithLegalApproval,
    PAYMENT_RECONCILIATION_SCHEDULE_CONFIGURED: "false",
};
assert.ok(
    validateProductionEnvironment(unreconciledPaytrCheckout).errors.some((error) =>
        error.includes("PAYMENT_RECONCILIATION_SCHEDULE_CONFIGURED")
    )
);

const invalidWebhookFreshness = {
    ...checkoutWithLegalApproval,
    PAYMENT_WEBHOOK_SCHEDULE_MAX_AGE_SECONDS: "59",
};
assert.ok(
    validateProductionEnvironment(invalidWebhookFreshness).errors.some((error) =>
        error.includes("PAYMENT_WEBHOOK_SCHEDULE_MAX_AGE_SECONDS")
    )
);

const invalidReconciliationFreshness = {
    ...checkoutWithLegalApproval,
    PAYMENT_RECONCILIATION_SCHEDULE_MAX_AGE_SECONDS: "1800oops",
};
assert.ok(
    validateProductionEnvironment(invalidReconciliationFreshness).errors.some((error) =>
        error.includes("PAYMENT_RECONCILIATION_SCHEDULE_MAX_AGE_SECONDS")
    )
);

const missingTurnstileHostname = validEnvironment();
missingTurnstileHostname.TURNSTILE_ALLOWED_HOSTNAMES = "";
assert.ok(
    validateProductionEnvironment(missingTurnstileHostname).errors.some((error) =>
        error.includes("TURNSTILE_ALLOWED_HOSTNAMES")
    )
);

const mismatchedTurnstileHostname = validEnvironment();
mismatchedTurnstileHostname.TURNSTILE_ALLOWED_HOSTNAMES = "www.example.test";
assert.ok(
    validateProductionEnvironment(mismatchedTurnstileHostname).errors.some((error) =>
        error.includes("NEXT_PUBLIC_SITE_URL hostname")
    )
);

const invalidTurnstileHostname = validEnvironment();
invalidTurnstileHostname.TURNSTILE_ALLOWED_HOSTNAMES = "https://play.example.test/*";
assert.ok(
    validateProductionEnvironment(invalidTurnstileHostname).errors.some((error) =>
        error.includes("invalid or non-production hostname")
    )
);

const exampleResult = validateProductionEnvironment(parseEnvFile(".env.production.example"));
assert.ok(exampleResult.errors.some((error) => error.includes("placeholder")));

const fixtureDir = mkdtempSync(join(tmpdir(), "hushle-production-preflight-"));
try {
    const envPath = join(fixtureDir, "production.env");
    const cliSecret = validEnvironment().AUTH_SECRET;
    writeFileSync(
        envPath,
        Object.entries(validEnvironment()).map(([key, value]) => `${key}=${value}`).join("\n"),
        "utf8"
    );

    const passedCli = spawnSync(process.execPath, ["scripts/production-preflight.mjs", envPath], {
        encoding: "utf8",
    });
    assert.equal(passedCli.status, 0, passedCli.stderr);
    assert.match(passedCli.stdout, /Production preflight passed/);
    assert.equal(`${passedCli.stdout}${passedCli.stderr}`.includes(cliSecret), false);

    writeFileSync(envPath, `AUTH_SECRET=${cliSecret}\n`, "utf8");
    const failedCli = spawnSync(process.execPath, ["scripts/production-preflight.mjs", envPath], {
        encoding: "utf8",
    });
    assert.equal(failedCli.status, 1);
    assert.match(failedCli.stderr, /Production preflight failed/);
    assert.equal(`${failedCli.stdout}${failedCli.stderr}`.includes(cliSecret), false);
} finally {
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(paymentEvidenceDir, { recursive: true, force: true });
}

console.log("Production config preflight checks passed.");
