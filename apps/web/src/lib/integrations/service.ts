import {
    getJsonCacheMetrics,
    getRedisHealth,
    type JsonCacheMetrics,
    type RedisHealth,
} from "@hushle/platform-cache";
import {
    getEmailProviderReadiness,
    isValidSesSourceArn,
    isValidSnsTopicArn,
    parseSesFeedbackConfig,
} from "@hushle/platform-email";
import {
    getPaymentRuntimeReadiness,
    listPaymentProviderReadiness,
} from "@hushle/platform-payments";
import { getAdminAccessPolicy } from "@/lib/admin/access-policy";
import { shouldTrustAuthHost } from "@/lib/auth-host";
import { getCaptchaProviderReadiness, getSystemSettings } from "@/lib/system-settings/service";
import type { CaptchaSettings, SystemSettings } from "@/types/system-settings";
import { getPaymentLegalReadiness } from "@/lib/payments/legal";

export type IntegrationStatus = "ready" | "partial" | "missing" | "planned";

export interface IntegrationItem {
    id: string;
    category: "runtime" | "security" | "access" | "messaging" | "storage" | "commerce";
    title: string;
    status: IntegrationStatus;
    summary: string;
    details: string[];
}

export interface IntegrationHubSnapshot {
    items: IntegrationItem[];
}

function hasEnvValue(name: string): boolean {
    const value = process.env[name];
    return Boolean(value && value.trim());
}

function isStrongAuthSecret(value: string | undefined): boolean {
    if (!value) {
        return false;
    }

    const trimmed = value.trim();
    if (!trimmed || trimmed.includes("replace_with_")) {
        return false;
    }

    return trimmed.length >= 32;
}

function getEnabledCaptchaFlows(captcha: CaptchaSettings): string[] {
    const flows: string[] = [];
    if (captcha.onRegister) flows.push("register");
    if (captcha.onLogin) flows.push("login");
    if (captcha.onRoomCreate) flows.push("room_create");
    if (captcha.onGuestJoin) flows.push("guest_join");
    return flows;
}

function buildRuntimeItems(): IntegrationItem[] {
    const databaseConfigured = hasEnvValue("DATABASE_URL");
    const authSecretStrong = isStrongAuthSecret(process.env.AUTH_SECRET);
    const nextAuthUrl = process.env.NEXTAUTH_URL?.trim() || "";
    const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "";
    const authTrustHostEnabled = shouldTrustAuthHost();
    const isProduction = process.env.NODE_ENV === "production";

    return [
        {
            id: "database",
            category: "runtime",
            title: "Database",
            status: databaseConfigured ? "ready" : "missing",
            summary: databaseConfigured ? "MySQL baglantisi tanimli." : "DATABASE_URL eksik.",
            details: [
                `DATABASE_URL: ${databaseConfigured ? "configured" : "missing"}`,
                "Source of truth MySQL tarafinda kalir.",
            ],
        },
        {
            id: "auth-core",
            category: "runtime",
            title: "Auth.js Core",
            status:
                authSecretStrong && authTrustHostEnabled && nextAuthUrl && publicSiteUrl
                    ? "ready"
                    : authSecretStrong && authTrustHostEnabled && (nextAuthUrl || publicSiteUrl)
                      ? "partial"
                    : "missing",
            summary: authSecretStrong
                ? "Auth temel env baglantilari kontrol edildi."
                : "AUTH_SECRET zayif veya eksik.",
            details: [
                `AUTH_SECRET: ${authSecretStrong ? "strong" : "missing_or_weak"}`,
                `NEXTAUTH_URL: ${nextAuthUrl ? nextAuthUrl : "missing"}`,
                `NEXT_PUBLIC_SITE_URL: ${publicSiteUrl ? publicSiteUrl : "missing"}`,
                `AUTH_TRUST_HOST: ${authTrustHostEnabled ? (isProduction ? "enabled" : "dev_auto_trust") : "disabled"}`,
            ],
        },
    ];
}

function buildCaptchaItems(settings: SystemSettings): IntegrationItem[] {
    const readiness = getCaptchaProviderReadiness();
    const activeFlows = getEnabledCaptchaFlows(settings.security.captcha);

    return [
        {
            id: "turnstile",
            category: "security",
            title: "Cloudflare Turnstile",
            status: readiness.turnstileConfigured ? "ready" : "missing",
            summary:
                settings.security.captcha.provider === "turnstile"
                    ? `Aktif provider. Mode: ${settings.security.captcha.turnstileMode}.`
                    : "Alternate provider olarak hazir tutuluyor.",
            details: [
                `Configured: ${readiness.turnstileConfigured ? "yes" : "no"}`,
                `Provider active: ${settings.security.captcha.provider === "turnstile" ? "yes" : "no"}`,
                `Captcha enabled: ${settings.security.captcha.enabled ? "yes" : "no"}`,
                `Protected flows: ${activeFlows.length > 0 ? activeFlows.join(", ") : "none"}`,
            ],
        },
        {
            id: "recaptcha",
            category: "security",
            title: "reCAPTCHA v3",
            status: readiness.recaptchaConfigured ? "ready" : "missing",
            summary:
                settings.security.captcha.provider === "recaptcha_v3"
                    ? "Aktif alternate captcha provider."
                    : "Fallback/alternate provider olarak pasif.",
            details: [
                `Configured: ${readiness.recaptchaConfigured ? "yes" : "no"}`,
                `Provider active: ${settings.security.captcha.provider === "recaptcha_v3" ? "yes" : "no"}`,
                `Score threshold: ${settings.security.captcha.recaptchaScoreThreshold}`,
            ],
        },
    ];
}

function buildAccessItems(): IntegrationItem[] {
    const policy = getAdminAccessPolicy();
    const hasHeaderPolicy = Boolean(policy.headerName && policy.headerValue);
    const hasEmailPolicy =
        Boolean(policy.emailHeaderName) &&
        (policy.allowedEmails.length > 0 || policy.allowedEmailDomains.length > 0);

    const status: IntegrationStatus =
        policy.mode === "public_login"
            ? "partial"
            : hasHeaderPolicy || hasEmailPolicy
              ? "ready"
              : policy.failClosed
                ? "missing"
                : "partial";

    return [
        {
            id: "admin-access-gateway",
            category: "access",
            title: "Admin Access Gateway",
            status,
            summary: `Mode: ${policy.mode}. Fail-closed: ${policy.failClosed ? "yes" : "no"}.`,
            details: [
                `Header policy: ${hasHeaderPolicy ? "configured" : "missing"}`,
                `Email policy: ${hasEmailPolicy ? "configured" : "missing"}`,
                `Local dev bypass: ${policy.allowLocalDevBypass ? "enabled" : "disabled"}`,
            ],
        },
    ];
}

function buildMessagingItems(): IntegrationItem[] {
    const email = getEmailProviderReadiness();
    const feedback = parseSesFeedbackConfig();
    const feedbackPolicy = process.env.PRODUCTION_EMAIL_FEEDBACK_POLICY?.trim() ?? "disabled";
    const topicsValid = feedback.topicArns.size > 0
        && [...feedback.topicArns].every(isValidSnsTopicArn);
    const sourcesValid = feedback.sourceArns.size > 0
        && [...feedback.sourceArns].every(isValidSesSourceArn);
    const feedbackReady = feedbackPolicy === "ses_sns"
        && feedback.enabled
        && topicsValid
        && sourcesValid;
    const feedbackStatus: IntegrationStatus = feedbackReady
        ? "ready"
        : feedbackPolicy === "provider_managed_risk_accepted"
          ? "partial"
          : email.configured
            ? "missing"
            : "planned";

    return [
        {
            id: "email-outbound",
            category: "messaging",
            title: "Email Outbound",
            status: email.configured ? "ready" : "missing",
            summary: email.configured
                ? "Transactional SMTP provider ve outbox delivery hazir."
                : "Transactional email provider yapilandirmasi eksik.",
            details: [
                `Provider: ${email.provider}`,
                `Configured: ${email.configured ? "yes" : "no"}`,
                email.issues.length > 0
                    ? `Issues: ${email.issues.join(", ")}`
                    : "Outbox delivery: ready",
                "Marketing delivery remains disabled until explicit consent enforcement is implemented.",
            ],
        },
        {
            id: "email-feedback",
            category: "messaging",
            title: "Email Feedback",
            status: feedbackStatus,
            summary: feedbackReady
                ? "SES/SNS bounce ve complaint feedback doğrulaması hazır."
                : feedbackPolicy === "provider_managed_risk_accepted"
                  ? "Feedback yönetimi harici sağlayıcıya bırakılmış."
                  : "Bounce ve complaint feedback yapılandırması eksik.",
            details: [
                `Policy: ${feedbackPolicy}`,
                `SES endpoint: ${feedback.enabled ? "enabled" : "disabled"}`,
                `Allowed topics: ${feedback.topicArns.size}`,
                `Allowed identities: ${feedback.sourceArns.size}`,
                `Auto-confirm: ${feedback.autoConfirm ? "bootstrap enabled" : "disabled"}`,
            ],
        },
    ];
}

function buildCommerceItems(): IntegrationItem[] {
    const runtime = getPaymentRuntimeReadiness();
    const legal = getPaymentLegalReadiness();
    const checkoutGate: IntegrationItem = {
        id: "payment-checkout-gate",
        category: "commerce",
        title: "Payment Checkout Gate",
        status: runtime.ready ? "ready" : runtime.enabled ? "missing" : "planned",
        summary: runtime.ready
            ? `Checkout is enabled with ${runtime.activeProvider}.`
            : runtime.enabled
              ? "Checkout was requested but the selected provider is not ready."
              : "Checkout is fail-closed and does not accept payments.",
        details: [
            `Enabled: ${runtime.enabled ? "yes" : "no"}`,
            `Active provider: ${runtime.activeProvider ?? "none"}`,
            `Issues: ${runtime.issues.length > 0 ? runtime.issues.join(", ") : "none"}`,
        ],
    };
    const legalGate: IntegrationItem = {
        id: "payment-legal-gate",
        category: "commerce",
        title: "Payment Legal Readiness",
        status: legal.ready ? "ready" : "missing",
        summary: legal.ready
            ? "Checkout legal documents and operator identity are approved."
            : "Checkout remains blocked until legal documents and operator identity are approved.",
        details: [
            `Issues: ${legal.issues.length > 0 ? legal.issues.join(", ") : "none"}`,
            `Checkout terms: ${legal.checkoutTermsVersion}`,
            `Privacy notice: ${legal.privacyNoticeVersion}`,
            `Distance sales notice: ${legal.distanceSalesNoticeVersion}`,
            "Document text changes require a new version before checkout is enabled.",
        ],
    };
    const providers: IntegrationItem[] = listPaymentProviderReadiness().map((provider) => ({
        id: `payment-${provider.id}`,
        category: "commerce" as const,
        title: provider.title,
        status: provider.ready
            ? "ready"
            : provider.credentialsConfigured
              ? "partial"
              : provider.adapterAvailable
                ? "missing"
                : "planned",
        summary: provider.ready
            ? "Checkout adapter and credentials are ready."
            : provider.adapterAvailable
              ? "Adapter exists, but provider credentials are incomplete."
              : "Provider registry is ready; checkout adapter is not enabled yet.",
        details: [
            `Adapter: ${provider.adapterAvailable ? "available" : "not_implemented"}`,
            `Credentials: ${provider.credentialsConfigured ? "configured" : "missing"}`,
            `Missing env: ${provider.missingEnvironment.length > 0 ? provider.missingEnvironment.join(", ") : "none"}`,
            `Currencies: ${provider.supportedCurrencies.join(", ")}`,
            "Secret values are read from the runtime secret store and are never shown here.",
        ],
    }));

    return [checkoutGate, legalGate, ...providers];
}

function buildStorageItems(
    redis: RedisHealth,
    cache: JsonCacheMetrics
): IntegrationItem[] {
    const redisStatus: IntegrationStatus = redis.available
        ? "ready"
        : redis.configured
          ? "partial"
          : "planned";
    const redisSummary = redis.available
        ? `Shared Redis cache and coordination are available (${redis.latencyMs ?? 0} ms).`
        : redis.configured
          ? "Redis is configured but currently unavailable; memory fallback is active where safe."
          : "Redis is not configured; local memory fallback is active where safe.";

    return [
        {
            id: "branding-assets",
            category: "storage",
            title: "Branding Asset Storage",
            status: "ready",
            summary: "Branding uploadlar local public storage uzerinden calisiyor.",
            details: [
                "Current path: public/branding/*",
                "Useful for development and simple deployments.",
                "Can later move behind storage/CDN provider without changing admin UX intent.",
            ],
        },
        {
            id: "redis-valkey",
            category: "storage",
            title: "Redis / Valkey",
            status: redisStatus,
            summary: redisSummary,
            details: [
                `Configured: ${redis.configured ? "yes" : "no"}`,
                `Available: ${redis.available ? "yes" : "no"}`,
                `Latency: ${redis.latencyMs ?? "-"} ms`,
                `Cache hits: redis=${cache.redisHits}, memory=${cache.memoryHits}`,
                `Cache misses/loads: ${cache.misses}/${cache.loads}`,
                `Cache errors: read=${cache.readErrors}, write=${cache.writeErrors}`,
                "Shared rate limits, cache invalidation, room coordination and capacity heartbeats are active when Redis is available.",
                "See docs/cache-and-storage-strategy.md",
            ],
        },
    ];
}

export async function getIntegrationHubSnapshot(
    options?: { settings?: SystemSettings }
): Promise<IntegrationHubSnapshot> {
    const [settings, redis] = await Promise.all([
        options?.settings ?? getSystemSettings(),
        getRedisHealth(),
    ]);
    const cache = getJsonCacheMetrics();

    return {
        items: [
            ...buildRuntimeItems(),
            ...buildCaptchaItems(settings),
            ...buildAccessItems(),
            ...buildMessagingItems(),
            ...buildCommerceItems(),
            ...buildStorageItems(redis, cache),
        ],
    };
}
