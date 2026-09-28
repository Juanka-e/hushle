import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export const PAYMENT_LEGAL_APPROVAL_SCHEMA = "payment-legal-approval-v1";
export const IYZICO_ACCEPTANCE_EVIDENCE_SCHEMA = "iyzico-sandbox-acceptance-v2";
export const SHOPIER_ACCEPTANCE_EVIDENCE_SCHEMA = "shopier-live-acceptance-v1";
export const PAYMENT_BUYER_DATA_POLICY_VERSION = "buyer-data-v1";
export const PAYMENT_LEGAL_REVIEW_SCOPES = [
    "checkout_terms",
    "distance_sales",
    "payment_privacy",
    "provider_data_transfer",
];
export const IYZICO_REQUIRED_ACCEPTANCE_CHECKS = [
    "exactRetrieveProof",
    "fulfillmentCompleted",
    "initializeAttemptSucceeded",
    "legalConsentCaptured",
    "notificationRecorded",
    "orderFulfilled",
    "ownerBound",
    "reconciliationSettled",
    "signedWebhookProcessed",
    "transientSessionCleared",
];
export const SHOPIER_REQUIRED_ACCEPTANCE_CHECKS = [
    "checkoutPaid",
    "duplicateRefundIdempotent",
    "entitlementReversed",
    "reconciliationSettled",
    "refundPendingObserved",
    "refundSucceededObserved",
    "signedWebhookProcessed",
];

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export function sha256Digest(value) {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function legalConfigurationSnapshot(environment) {
    return {
        activeProvider: environment.PAYMENT_ACTIVE_PROVIDER?.trim() ?? "",
        businessName: environment.PAYMENT_LEGAL_BUSINESS_NAME?.trim() ?? "",
        businessAddress: environment.PAYMENT_LEGAL_BUSINESS_ADDRESS?.trim() ?? "",
        contactEmail: environment.PAYMENT_LEGAL_CONTACT_EMAIL?.trim().toLowerCase() ?? "",
        checkoutTermsVersion: environment.PAYMENT_CHECKOUT_TERMS_VERSION?.trim() ?? "",
        privacyNoticeVersion: environment.PAYMENT_PRIVACY_NOTICE_VERSION?.trim() ?? "",
        distanceSalesNoticeVersion: environment.PAYMENT_DISTANCE_SALES_NOTICE_VERSION?.trim() ?? "",
        buyerDataPolicyVersion: PAYMENT_BUYER_DATA_POLICY_VERSION,
    };
}

export function legalConfigurationDigest(environment) {
    return sha256Digest(JSON.stringify(legalConfigurationSnapshot(environment)));
}

function validTimestamp(value) {
    if (typeof value !== "string") return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp <= Date.now() + 5 * 60_000;
}

export function validateLegalApprovalManifest(manifest, environment) {
    const errors = [];
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        return ["legal approval evidence must be a JSON object"];
    }
    if (manifest.schema !== PAYMENT_LEGAL_APPROVAL_SCHEMA) errors.push("legal approval evidence schema mismatch");
    if (manifest.status !== "approved") errors.push("legal approval evidence status must be approved");
    if (!validTimestamp(manifest.approvedAt)) errors.push("legal approval evidence approvedAt is invalid");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,119}$/.test(manifest.approvalReference ?? "")) {
        errors.push("legal approval evidence reference is invalid");
    }
    if (manifest.activeProvider !== environment.PAYMENT_ACTIVE_PROVIDER?.trim()) {
        errors.push("legal approval evidence provider does not match active provider");
    }
    if (manifest.configurationDigest !== legalConfigurationDigest(environment)) {
        errors.push("legal approval evidence does not match current legal configuration");
    }
    if (
        !Array.isArray(manifest.reviewedScopes)
        || JSON.stringify([...manifest.reviewedScopes].sort()) !== JSON.stringify(PAYMENT_LEGAL_REVIEW_SCOPES)
    ) {
        errors.push("legal approval evidence review scopes are incomplete");
    }
    return errors;
}

export function validateIyzicoAcceptanceManifest(manifest, environment) {
    const errors = [];
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        return ["iyzico acceptance evidence must be a JSON object"];
    }
    if (manifest.schema !== IYZICO_ACCEPTANCE_EVIDENCE_SCHEMA) errors.push("iyzico acceptance evidence schema mismatch");
    if (manifest.phase !== "verified" || manifest.status !== "passed") {
        errors.push("iyzico acceptance evidence must be a passed verification");
    }
    if (manifest.provider !== "iyzico" || manifest.sandbox !== true) {
        errors.push("iyzico acceptance evidence must describe the sandbox provider");
    }
    if (!validTimestamp(manifest.generatedAt)) errors.push("iyzico acceptance evidence generatedAt is invalid");
    if (!digestPattern.test(manifest.providerPaymentReferenceHash ?? "")) {
        errors.push("iyzico acceptance payment reference hash is invalid");
    }
    if (manifest.merchantIdHash !== sha256Digest(environment.IYZICO_MERCHANT_ID?.trim() ?? "")) {
        errors.push("iyzico acceptance evidence merchant does not match");
    }
    const expectedLegalVersions = {
        checkoutTermsVersion: environment.PAYMENT_CHECKOUT_TERMS_VERSION?.trim() ?? "",
        privacyNoticeVersion: environment.PAYMENT_PRIVACY_NOTICE_VERSION?.trim() ?? "",
        distanceSalesNoticeVersion: environment.PAYMENT_DISTANCE_SALES_NOTICE_VERSION?.trim() ?? "",
        buyerDataPolicyVersion: PAYMENT_BUYER_DATA_POLICY_VERSION,
    };
    if (JSON.stringify(manifest.legalVersions) !== JSON.stringify(expectedLegalVersions)) {
        errors.push("iyzico acceptance evidence legal versions do not match");
    }
    const checks = manifest.checks;
    if (
        !checks
        || typeof checks !== "object"
        || JSON.stringify(Object.keys(checks).sort()) !== JSON.stringify(IYZICO_REQUIRED_ACCEPTANCE_CHECKS)
        || Object.values(checks).some((value) => value !== true)
        || !Array.isArray(manifest.failedChecks)
        || manifest.failedChecks.length !== 0
    ) {
        errors.push("iyzico acceptance evidence contains failed or incomplete checks");
    }
    if (!Number.isSafeInteger(manifest.amountMinor) || manifest.amountMinor <= 0) {
        errors.push("iyzico acceptance evidence amount is invalid");
    }
    if (!/^[A-Z]{3}$/.test(manifest.currency ?? "")) {
        errors.push("iyzico acceptance evidence currency is invalid");
    }
    return errors;
}

export function validateShopierAcceptanceManifest(manifest, environment) {
    const errors = [];
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        return ["shopier acceptance evidence must be a JSON object"];
    }
    if (manifest.schema !== SHOPIER_ACCEPTANCE_EVIDENCE_SCHEMA) errors.push("shopier acceptance evidence schema mismatch");
    if (manifest.phase !== "verified" || manifest.status !== "passed") {
        errors.push("shopier acceptance evidence must be a passed verification");
    }
    if (manifest.provider !== "shopier_v2" || manifest.live !== true) {
        errors.push("shopier acceptance evidence must describe the live provider");
    }
    if (!validTimestamp(manifest.generatedAt)) errors.push("shopier acceptance evidence generatedAt is invalid");
    if (manifest.accountIdHash !== sha256Digest(environment.SHOPIER_ACCOUNT_ID?.trim() ?? "")) {
        errors.push("shopier acceptance evidence account does not match");
    }
    if (!digestPattern.test(manifest.providerOrderReferenceHash ?? "")
        || !digestPattern.test(manifest.providerRefundReferenceHash ?? "")) {
        errors.push("shopier acceptance provider references are invalid");
    }
    const checks = manifest.checks;
    if (!checks || typeof checks !== "object"
        || JSON.stringify(Object.keys(checks).sort()) !== JSON.stringify(SHOPIER_REQUIRED_ACCEPTANCE_CHECKS)
        || Object.values(checks).some((value) => value !== true)
        || !Array.isArray(manifest.failedChecks) || manifest.failedChecks.length !== 0) {
        errors.push("shopier acceptance evidence contains failed or incomplete checks");
    }
    if (!Number.isSafeInteger(manifest.amountMinor) || manifest.amountMinor <= 0 || !/^[A-Z]{3}$/.test(manifest.currency ?? "")) {
        errors.push("shopier acceptance payment amount is invalid");
    }
    return errors;
}

export function validateEvidenceFile({ environment, pathKey, digestKey, validateManifest }) {
    const path = environment[pathKey]?.trim() ?? "";
    const expectedDigest = environment[digestKey]?.trim() ?? "";
    if (!path || !isAbsolute(path)) return [`${pathKey} must be an absolute path`];
    if (!digestPattern.test(expectedDigest)) return [`${digestKey} must be a SHA-256 digest`];
    try {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) return [`${pathKey} must be a regular non-symlink file`];
        if (stat.size <= 0 || stat.size > 65_536) return [`${pathKey} must be between 1 and 65536 bytes`];
        if (process.platform !== "win32" && (stat.mode & 0o007) !== 0) {
            return [`${pathKey} must not be world-accessible`];
        }
        const content = readFileSync(path);
        if (sha256Digest(content) !== expectedDigest) return [`${digestKey} does not match the evidence file`];
        const manifest = JSON.parse(content.toString("utf8"));
        return validateManifest(manifest, environment);
    } catch {
        return [`${pathKey} could not be read or parsed`];
    }
}

export function isEvidenceDigest(value) {
    return digestPattern.test(value?.trim() ?? "");
}

export function isLegalVersion(value) {
    return versionPattern.test(value ?? "");
}
