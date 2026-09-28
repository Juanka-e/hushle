import { openSync, writeFileSync, closeSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
    PAYMENT_LEGAL_APPROVAL_SCHEMA,
    PAYMENT_LEGAL_REVIEW_SCOPES,
    isLegalVersion,
    legalConfigurationDigest,
    legalConfigurationSnapshot,
    sha256Digest,
} from "./lib/payment-activation-evidence.mjs";

const CONFIRMATION = "I_CONFIRM_PAYMENT_LEGAL_REVIEW_IS_COMPLETE";

function required(name) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function main() {
    const outputIndex = process.argv.indexOf("--output");
    if (outputIndex < 0 || !process.argv[outputIndex + 1]) {
        throw new Error("usage: npm run payment:create-legal-evidence -- --output <absolute-path>");
    }
    if (process.env.PAYMENT_LEGAL_APPROVAL_CONFIRM !== CONFIRMATION) {
        throw new Error("PAYMENT_LEGAL_APPROVAL_CONFIRM is invalid");
    }
    const outputPath = process.argv[outputIndex + 1];
    if (!isAbsolute(outputPath)) throw new Error("evidence output path must be absolute");
    const snapshot = legalConfigurationSnapshot(process.env);
    if (!new Set(["paytr", "iyzico"]).has(snapshot.activeProvider)) {
        throw new Error("PAYMENT_ACTIVE_PROVIDER must be paytr or iyzico");
    }
    for (const [name, value] of Object.entries(snapshot)) {
        if (!value) throw new Error(`${name} is required`);
    }
    for (const version of [snapshot.checkoutTermsVersion, snapshot.privacyNoticeVersion, snapshot.distanceSalesNoticeVersion]) {
        if (!isLegalVersion(version)) throw new Error("legal document version is invalid");
    }
    const approvalReference = required("PAYMENT_LEGAL_APPROVAL_REFERENCE");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,119}$/.test(approvalReference)) {
        throw new Error("PAYMENT_LEGAL_APPROVAL_REFERENCE is invalid");
    }

    const manifest = {
        schema: PAYMENT_LEGAL_APPROVAL_SCHEMA,
        status: "approved",
        approvedAt: new Date().toISOString(),
        activeProvider: snapshot.activeProvider,
        approvalReference,
        reviewedScopes: PAYMENT_LEGAL_REVIEW_SCOPES,
        configurationDigest: legalConfigurationDigest(process.env),
    };
    const content = `${JSON.stringify(manifest, null, 2)}\n`;
    const descriptor = openSync(outputPath, "wx", 0o600);
    try {
        writeFileSync(descriptor, content, "utf8");
    } finally {
        closeSync(descriptor);
    }
    console.log(JSON.stringify({ outputPath, digest: sha256Digest(content), schema: manifest.schema }));
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : "payment legal evidence generation failed");
    process.exitCode = 1;
}
