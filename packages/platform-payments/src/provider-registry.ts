import {
    PAYMENT_PROVIDER_IDS,
    type PaymentProviderId,
} from "./contracts";

export interface PaymentProviderDescriptor {
    id: PaymentProviderId;
    title: string;
    requiredEnvironment: readonly string[];
    supportedCurrencies: readonly string[];
    adapterAvailable: boolean;
}

export interface PaymentProviderReadiness extends PaymentProviderDescriptor {
    credentialsConfigured: boolean;
    ready: boolean;
    missingEnvironment: string[];
}

export interface PaymentRuntimeReadiness {
    enabled: boolean;
    activeProvider: PaymentProviderId | null;
    ready: boolean;
    issues: string[];
}

export type PaymentEnvironment = Readonly<Record<string, string | undefined>>;

const providers = {
    shopier_v2: {
        id: "shopier_v2",
        title: "Shopier V2",
        requiredEnvironment: [
            "SHOPIER_PERSONAL_ACCESS_TOKEN",
            "SHOPIER_PRODUCT_MEDIA_URL",
            "SHOPIER_CHECKOUT_MODE",
            "SHOPIER_WEBHOOK_MODE",
            "SHOPIER_RECONCILIATION_MODE",
            "SHOPIER_REFUND_MODE",
            "SHOPIER_WEBHOOK_TOKEN",
            "SHOPIER_ACCOUNT_ID",
            "SHOPIER_LIVE_ACCEPTANCE_RECORDED",
            "SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_SHA256",
        ],
        supportedCurrencies: ["TRY", "USD", "EUR"],
        adapterAvailable: true,
    },
    iyzico: {
        id: "iyzico",
        title: "iyzico",
        requiredEnvironment: [
            "IYZICO_API_KEY",
            "IYZICO_SECRET_KEY",
            "IYZICO_MERCHANT_ID",
            "IYZICO_CHECKOUT_MODE",
            "IYZICO_WEBHOOK_MODE",
            "IYZICO_RECONCILIATION_MODE",
            "IYZICO_OWNER_CHECKOUT_MODE",
            "IYZICO_CALLBACK_MODE",
            "IYZICO_SANDBOX_ACCEPTANCE_RECORDED",
            "IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256",
        ],
        supportedCurrencies: ["TRY", "USD", "EUR", "GBP"],
        adapterAvailable: true,
    },
    paytr: {
        id: "paytr",
        title: "PayTR",
        requiredEnvironment: [
            "PAYTR_MERCHANT_ID",
            "PAYTR_MERCHANT_KEY",
            "PAYTR_MERCHANT_SALT",
            "PAYTR_CHECKOUT_MODE",
        ],
        supportedCurrencies: ["TRY", "USD", "EUR", "GBP", "RUB"],
        adapterAvailable: true,
    },
    stripe: {
        id: "stripe",
        title: "Stripe",
        requiredEnvironment: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_CHECKOUT_MODE"],
        supportedCurrencies: ["TRY", "USD", "EUR", "GBP"],
        adapterAvailable: false,
    },
    lemonsqueezy: {
        id: "lemonsqueezy",
        title: "Lemon Squeezy",
        requiredEnvironment: ["LEMONSQUEEZY_API_KEY", "LEMONSQUEEZY_WEBHOOK_SECRET", "LEMONSQUEEZY_STORE_ID"],
        supportedCurrencies: ["USD"],
        adapterAvailable: false,
    },
} as const satisfies Record<PaymentProviderId, PaymentProviderDescriptor>;

function hasUsableSecret(value: string | undefined): boolean {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return Boolean(normalized && !normalized.includes("replace_with_"));
}

export function getPaymentProviderDescriptor(
    provider: PaymentProviderId
): PaymentProviderDescriptor {
    return providers[provider];
}

export function getPaymentProviderReadiness(
    provider: PaymentProviderId,
    environment: PaymentEnvironment = process.env
): PaymentProviderReadiness {
    const descriptor = getPaymentProviderDescriptor(provider);
    const missingEnvironment = descriptor.requiredEnvironment.filter(
        (name) => !hasUsableSecret(environment[name])
    );
    if (
        provider === "shopier_v2"
        && environment.SHOPIER_CHECKOUT_MODE?.trim().toLowerCase() !== "live"
        && !missingEnvironment.includes("SHOPIER_CHECKOUT_MODE")
    ) {
        missingEnvironment.push("SHOPIER_CHECKOUT_MODE");
    }
    if (
        provider === "shopier_v2"
        && environment.SHOPIER_WEBHOOK_MODE?.trim().toLowerCase() !== "live"
        && !missingEnvironment.includes("SHOPIER_WEBHOOK_MODE")
    ) missingEnvironment.push("SHOPIER_WEBHOOK_MODE");
    if (
        provider === "shopier_v2"
        && environment.SHOPIER_RECONCILIATION_MODE?.trim().toLowerCase() !== "live"
        && !missingEnvironment.includes("SHOPIER_RECONCILIATION_MODE")
    ) missingEnvironment.push("SHOPIER_RECONCILIATION_MODE");
    if (
        provider === "shopier_v2"
        && environment.SHOPIER_REFUND_MODE?.trim().toLowerCase() !== "live"
        && !missingEnvironment.includes("SHOPIER_REFUND_MODE")
    ) missingEnvironment.push("SHOPIER_REFUND_MODE");
    if (
        provider === "shopier_v2"
        && !/^[A-Za-z0-9._:-]{1,191}$/.test(environment.SHOPIER_ACCOUNT_ID?.trim() ?? "")
        && !missingEnvironment.includes("SHOPIER_ACCOUNT_ID")
    ) missingEnvironment.push("SHOPIER_ACCOUNT_ID");
    if (
        provider === "shopier_v2"
        && !/^[\x21-\x7e]{20,2048}$/.test(environment.SHOPIER_WEBHOOK_TOKEN ?? "")
        && !missingEnvironment.includes("SHOPIER_WEBHOOK_TOKEN")
    ) missingEnvironment.push("SHOPIER_WEBHOOK_TOKEN");
    if (
        provider === "shopier_v2"
        && environment.SHOPIER_LIVE_ACCEPTANCE_RECORDED?.trim().toLowerCase() !== "true"
        && !missingEnvironment.includes("SHOPIER_LIVE_ACCEPTANCE_RECORDED")
    ) {
        missingEnvironment.push("SHOPIER_LIVE_ACCEPTANCE_RECORDED");
    }
    if (
        provider === "shopier_v2"
        && !/^sha256:[a-f0-9]{64}$/.test(environment.SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_SHA256?.trim() ?? "")
        && !missingEnvironment.includes("SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_SHA256")
    ) {
        missingEnvironment.push("SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_SHA256");
    }
    if (
        provider === "shopier_v2"
        && (() => {
            try {
                const url = new URL(environment.SHOPIER_PRODUCT_MEDIA_URL ?? "");
                return url.protocol !== "https:"
                    || Boolean(url.username || url.password)
                    || !/\.(?:jpe?g|png|bmp)$/i.test(url.pathname);
            } catch {
                return true;
            }
        })()
        && !missingEnvironment.includes("SHOPIER_PRODUCT_MEDIA_URL")
    ) {
        missingEnvironment.push("SHOPIER_PRODUCT_MEDIA_URL");
    }
    if (
        provider === "paytr"
        && environment.PAYTR_CHECKOUT_MODE?.trim().toLowerCase() !== "sandbox"
        && !missingEnvironment.includes("PAYTR_CHECKOUT_MODE")
    ) {
        missingEnvironment.push("PAYTR_CHECKOUT_MODE");
    }
    if (
        provider === "iyzico"
        && environment.IYZICO_CHECKOUT_MODE?.trim().toLowerCase() !== "sandbox"
        && !missingEnvironment.includes("IYZICO_CHECKOUT_MODE")
    ) {
        missingEnvironment.push("IYZICO_CHECKOUT_MODE");
    }
    if (
        provider === "iyzico"
        && environment.IYZICO_WEBHOOK_MODE?.trim().toLowerCase() !== "sandbox"
        && !missingEnvironment.includes("IYZICO_WEBHOOK_MODE")
    ) {
        missingEnvironment.push("IYZICO_WEBHOOK_MODE");
    }
    if (
        provider === "iyzico"
        && environment.IYZICO_RECONCILIATION_MODE?.trim().toLowerCase() !== "sandbox"
        && !missingEnvironment.includes("IYZICO_RECONCILIATION_MODE")
    ) {
        missingEnvironment.push("IYZICO_RECONCILIATION_MODE");
    }
    for (const [name, value] of [
        ["IYZICO_OWNER_CHECKOUT_MODE", environment.IYZICO_OWNER_CHECKOUT_MODE],
        ["IYZICO_CALLBACK_MODE", environment.IYZICO_CALLBACK_MODE],
    ] as const) {
        if (
            provider === "iyzico"
            && value?.trim().toLowerCase() !== "sandbox"
            && !missingEnvironment.includes(name)
        ) {
            missingEnvironment.push(name);
        }
    }
    if (
        provider === "iyzico"
        && !/^\d{1,19}$/.test(environment.IYZICO_MERCHANT_ID?.trim() ?? "")
        && !missingEnvironment.includes("IYZICO_MERCHANT_ID")
    ) {
        missingEnvironment.push("IYZICO_MERCHANT_ID");
    }
    if (
        provider === "iyzico"
        && environment.IYZICO_SANDBOX_ACCEPTANCE_RECORDED?.trim().toLowerCase() !== "true"
        && !missingEnvironment.includes("IYZICO_SANDBOX_ACCEPTANCE_RECORDED")
    ) {
        missingEnvironment.push("IYZICO_SANDBOX_ACCEPTANCE_RECORDED");
    }
    if (
        provider === "iyzico"
        && !/^sha256:[a-f0-9]{64}$/.test(environment.IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256?.trim() ?? "")
        && !missingEnvironment.includes("IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256")
    ) {
        missingEnvironment.push("IYZICO_SANDBOX_ACCEPTANCE_EVIDENCE_SHA256");
    }
    if (
        provider === "stripe"
        && environment.STRIPE_CHECKOUT_MODE?.trim().toLowerCase() !== "sandbox"
        && !missingEnvironment.includes("STRIPE_CHECKOUT_MODE")
    ) {
        missingEnvironment.push("STRIPE_CHECKOUT_MODE");
    }
    if (
        provider === "stripe"
        && !/^(?:sk|rk)_test_[A-Za-z0-9_]+$/.test(environment.STRIPE_SECRET_KEY?.trim() ?? "")
        && !missingEnvironment.includes("STRIPE_SECRET_KEY")
    ) {
        missingEnvironment.push("STRIPE_SECRET_KEY");
    }
    if (
        provider === "stripe"
        && !/^whsec_[A-Za-z0-9_]+$/.test(environment.STRIPE_WEBHOOK_SECRET?.trim() ?? "")
        && !missingEnvironment.includes("STRIPE_WEBHOOK_SECRET")
    ) {
        missingEnvironment.push("STRIPE_WEBHOOK_SECRET");
    }
    const credentialsConfigured = missingEnvironment.length === 0;

    return {
        ...descriptor,
        credentialsConfigured,
        ready: credentialsConfigured && descriptor.adapterAvailable,
        missingEnvironment,
    };
}

export function listPaymentProviderReadiness(
    environment: PaymentEnvironment = process.env
): PaymentProviderReadiness[] {
    return PAYMENT_PROVIDER_IDS.map((provider) =>
        getPaymentProviderReadiness(provider, environment)
    );
}

export function getPaymentRuntimeReadiness(
    environment: PaymentEnvironment = process.env
): PaymentRuntimeReadiness {
    const enabled = environment.PAYMENTS_ENABLED?.trim().toLowerCase() === "true";
    const configuredProvider = environment.PAYMENT_ACTIVE_PROVIDER?.trim();
    const activeProvider = PAYMENT_PROVIDER_IDS.includes(
        configuredProvider as PaymentProviderId
    )
        ? (configuredProvider as PaymentProviderId)
        : null;
    const issues: string[] = [];

    if (!enabled) issues.push("checkout_disabled");
    if (!activeProvider) issues.push("active_provider_missing_or_invalid");
    if (activeProvider) {
        const provider = getPaymentProviderReadiness(activeProvider, environment);
        if (!provider.adapterAvailable) issues.push("active_provider_adapter_unavailable");
        if (!provider.credentialsConfigured) issues.push("active_provider_credentials_missing");
    }

    return {
        enabled,
        activeProvider,
        ready: enabled && Boolean(activeProvider) && issues.length === 0,
        issues,
    };
}

export function assertPaymentProviderReady(
    provider: PaymentProviderId,
    currency: string,
    environment: PaymentEnvironment = process.env
): void {
    const readiness = getPaymentProviderReadiness(provider, environment);
    const normalizedCurrency = currency.trim().toUpperCase();
    if (!readiness.supportedCurrencies.includes(normalizedCurrency)) {
        throw new Error(`${provider} does not support ${normalizedCurrency}`);
    }
    if (!readiness.ready) {
        throw new Error(`${provider} is not ready for checkout creation`);
    }
}
