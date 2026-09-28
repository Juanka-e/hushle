const DEFAULT_CHECKOUT_TERMS_VERSION = "checkout-terms-draft-v1";
const DEFAULT_PRIVACY_NOTICE_VERSION = "payment-privacy-draft-v1";
const DEFAULT_DISTANCE_SALES_NOTICE_VERSION = "distance-sales-draft-v1";

function configured(value: string | undefined): string | null {
    const normalized = value?.trim();
    if (!normalized || normalized.toLowerCase().includes("replace_with_")) return null;
    return normalized;
}

function evidenceDigestConfigured(value: string | undefined): boolean {
    return /^sha256:[a-f0-9]{64}$/.test(value?.trim() ?? "");
}

export interface PaymentLegalReadiness {
    ready: boolean;
    businessName: string | null;
    businessAddress: string | null;
    contactEmail: string | null;
    checkoutTermsVersion: string;
    privacyNoticeVersion: string;
    distanceSalesNoticeVersion: string;
    issues: string[];
}

export function getPaymentLegalReadiness(
    environment: Readonly<Record<string, string | undefined>> = process.env
): PaymentLegalReadiness {
    const businessName = configured(environment.PAYMENT_LEGAL_BUSINESS_NAME);
    const businessAddress = configured(environment.PAYMENT_LEGAL_BUSINESS_ADDRESS);
    const contactEmail = configured(environment.PAYMENT_LEGAL_CONTACT_EMAIL);
    const approved = environment.PAYMENT_LEGAL_APPROVED?.trim().toLowerCase() === "true";
    const issues: string[] = [];

    if (!approved) issues.push("legal_documents_not_approved");
    if (!evidenceDigestConfigured(environment.PAYMENT_LEGAL_APPROVAL_EVIDENCE_SHA256)) {
        issues.push("legal_approval_evidence_missing");
    }
    if (!businessName) issues.push("business_name_missing");
    if (!businessAddress) issues.push("business_address_missing");
    if (!contactEmail) issues.push("contact_email_missing");

    return {
        ready: issues.length === 0,
        businessName,
        businessAddress,
        contactEmail,
        checkoutTermsVersion:
            configured(environment.PAYMENT_CHECKOUT_TERMS_VERSION) ?? DEFAULT_CHECKOUT_TERMS_VERSION,
        privacyNoticeVersion:
            configured(environment.PAYMENT_PRIVACY_NOTICE_VERSION) ?? DEFAULT_PRIVACY_NOTICE_VERSION,
        distanceSalesNoticeVersion:
            configured(environment.PAYMENT_DISTANCE_SALES_NOTICE_VERSION) ?? DEFAULT_DISTANCE_SALES_NOTICE_VERSION,
        issues,
    };
}

export function getPublicPaymentLegalDocuments(readiness = getPaymentLegalReadiness()) {
    return {
        checkoutTerms: {
            version: readiness.checkoutTermsVersion,
            href: "/legal/checkout-terms",
        },
        privacyNotice: {
            version: readiness.privacyNoticeVersion,
            href: "/legal/payment-privacy-notice",
        },
        distanceSalesNotice: {
            version: readiness.distanceSalesNoticeVersion,
            href: "/legal/distance-sales-pre-information",
        },
    };
}
