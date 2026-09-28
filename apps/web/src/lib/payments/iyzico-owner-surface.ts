const SANDBOX = "sandbox";

type Environment = Readonly<Record<string, string | undefined>>;

function mode(environment: Environment, name: string): string {
    return environment[name]?.trim().toLowerCase() ?? "";
}

export function getIyzicoOwnerSurfaceReadiness(
    environment: Environment = process.env
): {
    sessionEnabled: boolean;
    callbackEnabled: boolean;
    sessionIssues: string[];
    callbackIssues: string[];
} {
    const callbackIssues: string[] = [];
    if (mode(environment, "IYZICO_CHECKOUT_MODE") !== SANDBOX) {
        callbackIssues.push("iyzico_checkout_mode_disabled");
    }
    if (mode(environment, "IYZICO_CALLBACK_MODE") !== SANDBOX) {
        callbackIssues.push("iyzico_callback_mode_disabled");
    }
    if (
        !environment.IYZICO_API_KEY?.trim().startsWith("sandbox-")
        || !environment.IYZICO_SECRET_KEY?.trim().startsWith("sandbox-")
    ) {
        callbackIssues.push("iyzico_credentials_missing");
    }

    const sessionIssues = [...callbackIssues];
    if (environment.PAYMENTS_ENABLED?.trim().toLowerCase() !== "true") {
        sessionIssues.push("checkout_disabled");
    }
    if (environment.PAYMENT_ACTIVE_PROVIDER?.trim().toLowerCase() !== "iyzico") {
        sessionIssues.push("active_provider_not_iyzico");
    }
    if (environment.IYZICO_SANDBOX_ACCEPTANCE_RECORDED?.trim().toLowerCase() !== "true") {
        sessionIssues.push("iyzico_sandbox_acceptance_missing");
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(environment.IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256?.trim() ?? "")) {
        sessionIssues.push("iyzico_sandbox_acceptance_evidence_missing");
    }
    for (const [name, issue] of [
        ["IYZICO_OWNER_CHECKOUT_MODE", "iyzico_owner_checkout_mode_disabled"],
        ["IYZICO_WEBHOOK_MODE", "iyzico_webhook_mode_disabled"],
        ["IYZICO_RECONCILIATION_MODE", "iyzico_reconciliation_mode_disabled"],
    ] as const) {
        if (mode(environment, name) !== SANDBOX) sessionIssues.push(issue);
    }

    return {
        sessionEnabled: sessionIssues.length === 0,
        callbackEnabled: callbackIssues.length === 0,
        sessionIssues,
        callbackIssues,
    };
}

export function getPublicPaymentOrigin(
    environment: Environment = process.env
): string | null {
    try {
        const url = new URL(environment.NEXT_PUBLIC_SITE_URL ?? "");
        if (url.protocol !== "https:") return null;
        if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
        return url.origin;
    } catch {
        return null;
    }
}

export function buildIyzicoOwnerCallbackUrl(origin: string, orderId: string): string {
    const url = new URL("/api/payments/callback/iyzico", origin);
    url.searchParams.set("order", orderId);
    return url.toString();
}

export function buildOwnerCheckoutRedirect(
    origin: string,
    orderId: string,
    result: "provider-return" | "provider-review"
): string {
    const url = new URL("/checkout", origin);
    url.searchParams.set("order", orderId);
    url.searchParams.set("result", result);
    return url.toString();
}
