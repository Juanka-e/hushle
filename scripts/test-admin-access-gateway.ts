import {
    evaluateAdminAccess,
    getAdminAccessPolicy,
} from "../apps/web/src/lib/admin/access-policy";

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(values)) {
        previous.set(key, process.env[key]);
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    try {
        return run();
    } finally {
        for (const [key, value] of previous.entries()) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

function makeRequest(url: string, headers: Record<string, string> = {}) {
    return {
        nextUrl: new URL(url),
        headers: new Headers(headers),
    } as const;
}

withEnv(
    {
        NODE_ENV: "development",
        ADMIN_ACCESS_MODE: "public_login",
        ADMIN_ACCESS_FAIL_CLOSED: "true",
    },
    () => {
        const result = evaluateAdminAccess(makeRequest("http://localhost:3000/admin/login"));
        if (!result.allowed || result.reason !== "public_login") {
            throw new Error("public_login mode should allow admin access.");
        }
    }
);

withEnv(
    {
        NODE_ENV: "development",
        ADMIN_ACCESS_MODE: "restricted_login",
        ADMIN_ACCESS_ALLOW_LOCAL_DEV_BYPASS: "true",
        ADMIN_ACCESS_FAIL_CLOSED: "true",
    },
    () => {
        const result = evaluateAdminAccess(makeRequest("http://localhost:3000/admin/login"));
        if (!result.allowed || !result.localDevBypass) {
            throw new Error("development localhost should bypass restricted policy.");
        }
    }
);

withEnv(
    {
        NODE_ENV: "production",
        ADMIN_ACCESS_MODE: "restricted_login",
        ADMIN_ACCESS_FAIL_CLOSED: "true",
        ADMIN_ACCESS_HEADER_NAME: "x-admin-access",
        ADMIN_ACCESS_HEADER_VALUE: "approved",
    },
    () => {
        const denied = evaluateAdminAccess(makeRequest("https://app.example.com/admin/login"));
        if (denied.allowed) {
            throw new Error("restricted mode should deny when the header is missing.");
        }

        const allowed = evaluateAdminAccess(
            makeRequest("https://app.example.com/admin/login", {
                "x-admin-access": "approved",
            })
        );
        if (!allowed.allowed || allowed.reason !== "header_match") {
            throw new Error("restricted mode should allow matching header policy.");
        }
    }
);

withEnv(
    {
        NODE_ENV: "production",
        ADMIN_ACCESS_MODE: "external_gateway",
        ADMIN_ACCESS_FAIL_CLOSED: "true",
        ADMIN_ACCESS_EMAIL_HEADER_NAME: "cf-access-authenticated-user-email",
        ADMIN_ACCESS_ALLOWED_EMAIL_DOMAINS: "firma.com",
    },
    () => {
        const policy = getAdminAccessPolicy();
        if (policy.mode !== "external_gateway") {
            throw new Error("external_gateway mode should be preserved.");
        }

        const allowed = evaluateAdminAccess(
            makeRequest("https://admin.example.com/admin/login", {
                "cf-access-authenticated-user-email": "ops@firma.com",
            })
        );
        if (!allowed.allowed || allowed.reason !== "email_domain_match") {
            throw new Error("email domain policy should allow matching domains.");
        }
    }
);

console.log("admin access gateway smoke test passed");
