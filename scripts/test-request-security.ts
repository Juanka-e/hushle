import assert from "node:assert/strict";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    resetRequestRateLimitBuckets,
} from "../apps/web/src/lib/security/request-rate-limit";
import {
    isTrustedStateChangeRequest,
    resolveStateChangeOriginPolicy,
} from "../apps/web/src/lib/security/request-origin";

const productionEnv = {
    NODE_ENV: "production",
    NEXT_PUBLIC_SITE_URL: "https://tabu.example.com",
    TRUSTED_WEB_ORIGINS: "https://tabu.example.com,https://admin.tabu.example.com",
    STATE_CHANGE_ORIGIN_POLICY: "strict",
};

const sameOriginRequest = {
    headers: new Headers({
        origin: "https://tabu.example.com",
    }),
    method: "POST",
    url: "https://tabu.example.com/api/store/purchase",
};

const crossOriginRequest = {
    headers: new Headers({
        origin: "https://attacker.example.com",
    }),
    method: "POST",
    url: "https://tabu.example.com/api/store/purchase",
};

assert.equal(isTrustedStateChangeRequest(sameOriginRequest, { env: productionEnv }), true);
assert.equal(isTrustedStateChangeRequest(crossOriginRequest, { env: productionEnv }), false);
assert.equal(
    isTrustedStateChangeRequest(
        {
            headers: new Headers({
                host: "127.0.0.1:3201",
                origin: "http://127.0.0.1:3201",
                "sec-fetch-site": "same-origin",
            }),
            method: "POST",
            url: "http://localhost:3201/api/admin/categories/reorder",
        },
        { env: { NODE_ENV: "development" } }
    ),
    true
);
assert.equal(
    isTrustedStateChangeRequest(
        {
            headers: new Headers({
                host: "internal-web:3000",
                origin: "https://admin.tabu.example.com",
                "sec-fetch-site": "same-origin",
                "x-forwarded-host": "admin.tabu.example.com",
                "x-forwarded-proto": "https",
            }),
            method: "POST",
            url: "http://internal-web:3000/api/admin/categories/reorder",
        },
        { env: productionEnv }
    ),
    true
);
assert.equal(
    isTrustedStateChangeRequest(
        {
            headers: new Headers({
                host: "internal-web:3000",
                origin: "https://admin.tabu.example.com",
                "sec-fetch-site": "same-origin",
                "x-forwarded-host": "admin.tabu.example.com",
                "x-forwarded-proto": "https",
            }),
            method: "POST",
            url: "http://internal-web:3000/api/admin/categories/reorder",
        },
        { env: { NODE_ENV: "development" } }
    ),
    true
);
assert.equal(
    isTrustedStateChangeRequest(
        {
            headers: new Headers({
                host: "127.0.0.1:3201",
                origin: "https://attacker.example.com",
            }),
            method: "POST",
            url: "http://localhost:3201/api/admin/categories/reorder",
        },
        { env: productionEnv }
    ),
    false
);

assert.equal(resolveStateChangeOriginPolicy(productionEnv), "strict");
assert.equal(
    resolveStateChangeOriginPolicy({
        NODE_ENV: "production",
        STATE_CHANGE_ORIGIN_POLICY: "compatible",
    }),
    "strict"
);
assert.equal(resolveStateChangeOriginPolicy({ NODE_ENV: "development" }), "compatible");

assert.equal(
    isTrustedStateChangeRequest({
        headers: new Headers(),
        method: "POST",
        url: "https://tabu.example.com/api/store/purchase",
    }, { env: productionEnv }),
    false
);
assert.equal(
    isTrustedStateChangeRequest({
        headers: new Headers({ "sec-fetch-site": "same-origin" }),
        method: "POST",
        url: "https://tabu.example.com/api/store/purchase",
    }, { env: productionEnv }),
    false
);
assert.equal(
    isTrustedStateChangeRequest({
        headers: new Headers({
            origin: "https://tabu.example.com",
            "sec-fetch-site": "cross-site",
        }),
        method: "POST",
        url: "https://tabu.example.com/api/store/purchase",
    }, { env: productionEnv }),
    false
);
assert.equal(
    isTrustedStateChangeRequest({
        headers: new Headers({
            origin: "https://attacker.example.com",
            "x-forwarded-host": "attacker.example.com",
            "x-forwarded-proto": "https",
        }),
        method: "POST",
        url: "http://internal-web:3000/api/store/purchase",
    }, { env: productionEnv }),
    false
);
assert.equal(
    isTrustedStateChangeRequest({
        headers: new Headers(),
        method: "POST",
        url: "http://localhost:3000/api/store/purchase",
    }, { env: { NODE_ENV: "development" } }),
    true
);
assert.equal(
    isTrustedStateChangeRequest({
        headers: new Headers(),
        method: "GET",
        url: "https://tabu.example.com/api/store/items",
    }, { env: productionEnv }),
    true
);

resetRequestRateLimitBuckets();

const first = consumeRequestRateLimit({
    bucket: "test-security",
    key: "user:1",
    windowMs: 60_000,
    maxRequests: 2,
});
assert.equal(first.allowed, true);
assert.equal(first.remaining, 1);

const second = consumeRequestRateLimit({
    bucket: "test-security",
    key: "user:1",
    windowMs: 60_000,
    maxRequests: 2,
});
assert.equal(second.allowed, true);
assert.equal(second.remaining, 0);

const third = consumeRequestRateLimit({
    bucket: "test-security",
    key: "user:1",
    windowMs: 60_000,
    maxRequests: 2,
});
assert.equal(third.allowed, false);

const headers = buildRateLimitHeaders(third);
assert.equal(headers["Retry-After"], String(third.retryAfterSeconds));
assert.equal(headers["X-RateLimit-Limit"], "2");
assert.equal(headers["X-RateLimit-Remaining"], "0");

console.log("request security smoke test passed");
