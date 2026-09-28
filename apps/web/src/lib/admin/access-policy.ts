export const ADMIN_ACCESS_MODES = [
    "public_login",
    "restricted_login",
    "external_gateway",
] as const;

export type AdminAccessMode = (typeof ADMIN_ACCESS_MODES)[number];

export interface AdminAccessPolicy {
    mode: AdminAccessMode;
    failClosed: boolean;
    allowLocalDevBypass: boolean;
    headerName: string | null;
    headerValue: string | null;
    emailHeaderName: string | null;
    allowedEmails: string[];
    allowedEmailDomains: string[];
}

export interface AdminAccessEvaluation {
    mode: AdminAccessMode;
    allowed: boolean;
    localDevBypass: boolean;
    failClosed: boolean;
    reason:
        | "public_login"
        | "local_dev_bypass"
        | "header_match"
        | "email_match"
        | "email_domain_match"
        | "missing_policy"
        | "missing_header"
        | "mismatched_header"
        | "missing_email"
        | "disallowed_email";
}

export interface AdminAccessRequestLike {
    headers: Headers;
    nextUrl: {
        hostname: string;
    };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (!value) {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
        return true;
    }
    if (normalized === "false") {
        return false;
    }

    return fallback;
}

function splitCsv(value: string | undefined): string[] {
    if (!value) {
        return [];
    }

    return value
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}

function normalizeMode(value: string | undefined): AdminAccessMode {
    if (value === "restricted_login" || value === "external_gateway" || value === "public_login") {
        return value;
    }

    return process.env.NODE_ENV === "production" ? "restricted_login" : "public_login";
}

export function getAdminAccessPolicy(): AdminAccessPolicy {
    return {
        mode: normalizeMode(process.env.ADMIN_ACCESS_MODE),
        failClosed: parseBoolean(process.env.ADMIN_ACCESS_FAIL_CLOSED, process.env.NODE_ENV === "production"),
        allowLocalDevBypass: parseBoolean(process.env.ADMIN_ACCESS_ALLOW_LOCAL_DEV_BYPASS, true),
        headerName: process.env.ADMIN_ACCESS_HEADER_NAME?.trim() || null,
        headerValue: process.env.ADMIN_ACCESS_HEADER_VALUE?.trim() || null,
        emailHeaderName: process.env.ADMIN_ACCESS_EMAIL_HEADER_NAME?.trim() || null,
        allowedEmails: splitCsv(process.env.ADMIN_ACCESS_ALLOWED_EMAILS),
        allowedEmailDomains: splitCsv(process.env.ADMIN_ACCESS_ALLOWED_EMAIL_DOMAINS),
    };
}

function isLocalDevelopmentRequest(request: AdminAccessRequestLike): boolean {
    if (process.env.NODE_ENV === "production") {
        return false;
    }

    const hostname = request.nextUrl.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1") {
        return true;
    }

    const forwardedHost = request.headers.get("x-forwarded-host")?.toLowerCase() ?? "";
    return forwardedHost.includes("localhost") || forwardedHost.includes("127.0.0.1");
}

export function evaluateAdminAccess(
    request: AdminAccessRequestLike
): AdminAccessEvaluation {
    const policy = getAdminAccessPolicy();

    if (policy.mode === "public_login") {
        return {
            mode: policy.mode,
            allowed: true,
            localDevBypass: false,
            failClosed: policy.failClosed,
            reason: "public_login",
        };
    }

    if (policy.allowLocalDevBypass && isLocalDevelopmentRequest(request)) {
        return {
            mode: policy.mode,
            allowed: true,
            localDevBypass: true,
            failClosed: policy.failClosed,
            reason: "local_dev_bypass",
        };
    }

    const hasHeaderPolicy = Boolean(policy.headerName && policy.headerValue);
    const hasEmailPolicy =
        Boolean(policy.emailHeaderName) &&
        (policy.allowedEmails.length > 0 || policy.allowedEmailDomains.length > 0);

    if (!hasHeaderPolicy && !hasEmailPolicy) {
        return {
            mode: policy.mode,
            allowed: !policy.failClosed,
            localDevBypass: false,
            failClosed: policy.failClosed,
            reason: "missing_policy",
        };
    }

    if (hasHeaderPolicy) {
        const currentValue = request.headers.get(policy.headerName!);
        if (!currentValue) {
            return {
                mode: policy.mode,
                allowed: false,
                localDevBypass: false,
                failClosed: policy.failClosed,
                reason: "missing_header",
            };
        }

        if (currentValue === policy.headerValue) {
            return {
                mode: policy.mode,
                allowed: true,
                localDevBypass: false,
                failClosed: policy.failClosed,
                reason: "header_match",
            };
        }

        return {
            mode: policy.mode,
            allowed: false,
            localDevBypass: false,
            failClosed: policy.failClosed,
            reason: "mismatched_header",
        };
    }

    const email = request.headers.get(policy.emailHeaderName!)?.trim().toLowerCase();
    if (!email) {
        return {
            mode: policy.mode,
            allowed: false,
            localDevBypass: false,
            failClosed: policy.failClosed,
            reason: "missing_email",
        };
    }

    if (policy.allowedEmails.includes(email)) {
        return {
            mode: policy.mode,
            allowed: true,
            localDevBypass: false,
            failClosed: policy.failClosed,
            reason: "email_match",
        };
    }

    const domain = email.split("@")[1] ?? "";
    if (domain && policy.allowedEmailDomains.includes(domain)) {
        return {
            mode: policy.mode,
            allowed: true,
            localDevBypass: false,
            failClosed: policy.failClosed,
            reason: "email_domain_match",
        };
    }

    return {
        mode: policy.mode,
        allowed: false,
        localDevBypass: false,
        failClosed: policy.failClosed,
        reason: "disallowed_email",
    };
}

export function getAdminAccessFailureMessage(result: AdminAccessEvaluation): string {
    switch (result.reason) {
        case "missing_policy":
            return "Admin access policy eksik.";
        case "missing_header":
        case "mismatched_header":
            return "Admin gateway dogrulamasi saglanmadi.";
        case "missing_email":
        case "disallowed_email":
            return "Admin erisim politikasi bu istege izin vermiyor.";
        default:
            return "Admin erisim politikasi reddetti.";
    }
}
