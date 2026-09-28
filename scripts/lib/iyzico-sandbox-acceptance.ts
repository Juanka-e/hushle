import { createHash } from "node:crypto";

export const IYZICO_ACCEPTANCE_CONFIRMATION =
    "I_UNDERSTAND_THIS_CREATES_A_REAL_IYZICO_SANDBOX_CHECKOUT";
export const IYZICO_ACCEPTANCE_EVIDENCE_SCHEMA = "iyzico-sandbox-acceptance-v2";

type Environment = Readonly<Record<string, string | undefined>>;

const requiredSandboxModes = [
    "IYZICO_CHECKOUT_MODE",
    "IYZICO_WEBHOOK_MODE",
    "IYZICO_RECONCILIATION_MODE",
    "IYZICO_OWNER_CHECKOUT_MODE",
    "IYZICO_CALLBACK_MODE",
] as const;

function required(environment: Environment, name: string): string {
    const value = environment[name]?.trim();
    if (!value) throw new Error(`${name.toLowerCase()}_required`);
    return value;
}

export function assertIyzicoAcceptanceEnvironment(environment: Environment): void {
    if (environment.IYZICO_SANDBOX_ACCEPTANCE_CONFIRM !== IYZICO_ACCEPTANCE_CONFIRMATION) {
        throw new Error("iyzico_acceptance_confirmation_required");
    }
    if (environment.NODE_ENV === "production") {
        throw new Error("iyzico_acceptance_production_runtime_forbidden");
    }

    let databaseUrl: URL;
    try {
        databaseUrl = new URL(required(environment, "DATABASE_URL"));
    } catch {
        throw new Error("iyzico_acceptance_database_url_invalid");
    }
    const databaseName = databaseUrl.pathname.replace(/^\//, "");
    if (!/(?:^|[_-])(test|dev|sandbox|staging|acceptance)(?:$|[_-])/i.test(databaseName)) {
        throw new Error("iyzico_acceptance_database_not_allowed");
    }

    for (const name of requiredSandboxModes) {
        if (environment[name]?.trim().toLowerCase() !== "sandbox") {
            throw new Error(`${name.toLowerCase()}_must_be_sandbox`);
        }
    }
    if (!required(environment, "IYZICO_API_KEY").startsWith("sandbox-")) {
        throw new Error("iyzico_acceptance_api_key_not_sandbox");
    }
    if (!required(environment, "IYZICO_SECRET_KEY").startsWith("sandbox-")) {
        throw new Error("iyzico_acceptance_secret_key_not_sandbox");
    }
    if (!/^\d{1,19}$/.test(required(environment, "IYZICO_MERCHANT_ID"))) {
        throw new Error("iyzico_acceptance_merchant_id_invalid");
    }

    let origin: URL;
    try {
        origin = new URL(required(environment, "IYZICO_ACCEPTANCE_PUBLIC_ORIGIN"));
    } catch {
        throw new Error("iyzico_acceptance_public_origin_invalid");
    }
    if (
        origin.protocol !== "https:"
        || origin.username
        || origin.password
        || origin.pathname !== "/"
        || origin.search
        || origin.hash
    ) {
        throw new Error("iyzico_acceptance_public_origin_invalid");
    }
}

export function readPositiveInteger(environment: Environment, name: string): number {
    const raw = environment[name]?.trim() ?? "";
    if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name.toLowerCase()}_invalid`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new Error(`${name.toLowerCase()}_invalid`);
    return value;
}

export function readPositiveAmountLimit(environment: Environment): number {
    const raw = environment.IYZICO_ACCEPTANCE_MAX_AMOUNT_MINOR?.trim() || "100000";
    if (!/^[1-9]\d*$/.test(raw)) {
        throw new Error("iyzico_acceptance_max_amount_minor_invalid");
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new Error("iyzico_acceptance_max_amount_minor_invalid");
    return value;
}

export function buildAcceptanceCallbackUrl(publicOrigin: string, orderId: string): string {
    const url = new URL("/api/payments/callback/iyzico", publicOrigin);
    url.searchParams.set("order", orderId);
    return url.toString();
}

export function hashProviderReference(value: string): string {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function assertSafeAcceptanceEvidence(value: unknown, forbiddenValues: readonly string[] = []): void {
    const serialized = JSON.stringify(value);
    const forbiddenKeys = [
        "token",
        "hostedurl",
        "paymentpageurl",
        "identitynumber",
        "givenname",
        "familyname",
        "addressline",
        "phonenumber",
        "gsmnumber",
        "apikey",
        "secretkey",
    ];
    const normalized = serialized.toLowerCase();
    if (forbiddenKeys.some((key) => normalized.includes(`\"${key}\"`))) {
        throw new Error("iyzico_acceptance_evidence_contains_sensitive_key");
    }
    for (const valueToReject of forbiddenValues) {
        if (valueToReject && serialized.includes(valueToReject)) {
            throw new Error("iyzico_acceptance_evidence_contains_sensitive_value");
        }
    }
}
