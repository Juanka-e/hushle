import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    PAYMENT_LEGAL_APPROVAL_SCHEMA,
    PAYMENT_LEGAL_REVIEW_SCOPES,
    legalConfigurationDigest,
    sha256Digest,
    validateLegalApprovalManifest,
} from "./lib/payment-activation-evidence.mjs";

const environment = {
    PAYMENT_ACTIVE_PROVIDER: "iyzico",
    PAYMENT_LEGAL_BUSINESS_NAME: "Hushle Teknoloji A.S.",
    PAYMENT_LEGAL_BUSINESS_ADDRESS: "Istanbul",
    PAYMENT_LEGAL_CONTACT_EMAIL: "ODEME@HUSHLE.COM",
    PAYMENT_CHECKOUT_TERMS_VERSION: "terms-v1",
    PAYMENT_PRIVACY_NOTICE_VERSION: "privacy-v1",
    PAYMENT_DISTANCE_SALES_NOTICE_VERSION: "distance-v1",
};
const manifest = {
    schema: PAYMENT_LEGAL_APPROVAL_SCHEMA,
    status: "approved",
    approvedAt: new Date().toISOString(),
    activeProvider: "iyzico",
    approvalReference: "LEGAL-2026-001",
    reviewedScopes: PAYMENT_LEGAL_REVIEW_SCOPES,
    configurationDigest: legalConfigurationDigest(environment),
};
assert.deepEqual(validateLegalApprovalManifest(manifest, environment), []);
assert.ok(validateLegalApprovalManifest(manifest, {
    ...environment,
    PAYMENT_PRIVACY_NOTICE_VERSION: "privacy-v2",
}).some((error: string) => error.includes("current legal configuration")));
assert.match(sha256Digest(JSON.stringify(manifest)), /^sha256:[a-f0-9]{64}$/);

const fixtureDir = mkdtempSync(join(tmpdir(), "hushle-legal-evidence-"));
try {
    const outputPath = join(fixtureDir, "legal-approval.json");
    const commandEnvironment = {
        ...process.env,
        ...environment,
        PAYMENT_LEGAL_APPROVAL_CONFIRM: "I_CONFIRM_PAYMENT_LEGAL_REVIEW_IS_COMPLETE",
        PAYMENT_LEGAL_APPROVAL_REFERENCE: "LEGAL-2026-001",
    };
    const generated = spawnSync(
        process.execPath,
        ["scripts/create-payment-legal-approval-evidence.mjs", "--output", outputPath],
        { encoding: "utf8", env: commandEnvironment }
    );
    assert.equal(generated.status, 0, generated.stderr);
    const output = JSON.parse(generated.stdout) as { digest: string };
    const content = readFileSync(outputPath);
    assert.equal(output.digest, sha256Digest(content));
    assert.equal(content.includes(Buffer.from(environment.PAYMENT_LEGAL_BUSINESS_ADDRESS)), false);
    if (process.platform !== "win32") chmodSync(outputPath, 0o600);

    const overwrite = spawnSync(
        process.execPath,
        ["scripts/create-payment-legal-approval-evidence.mjs", "--output", outputPath],
        { encoding: "utf8", env: commandEnvironment }
    );
    assert.equal(overwrite.status, 1);

    const rejectedPath = join(fixtureDir, "rejected.json");
    const rejected = spawnSync(
        process.execPath,
        ["scripts/create-payment-legal-approval-evidence.mjs", "--output", rejectedPath],
        {
            encoding: "utf8",
            env: { ...commandEnvironment, PAYMENT_LEGAL_APPROVAL_CONFIRM: "wrong" },
        }
    );
    assert.equal(rejected.status, 1);
    assert.doesNotMatch(rejected.stderr, /Hushle Teknoloji|Istanbul|ODEME@/);
} finally {
    rmSync(fixtureDir, { recursive: true, force: true });
}

console.log("Payment activation evidence checks passed.");
