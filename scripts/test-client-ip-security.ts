import assert from "node:assert/strict";
import {
    getRequestIp,
    getSocketClientIp,
    shouldTrustProxyHeaders,
} from "../apps/web/src/lib/security/client-ip";

function restoreTrustProxy(value: string | undefined): void {
    if (value === undefined) {
        delete process.env.TRUST_PROXY;
        return;
    }

    process.env.TRUST_PROXY = value;
}

const originalTrustProxy = process.env.TRUST_PROXY;

try {
    delete process.env.TRUST_PROXY;

    assert.equal(shouldTrustProxyHeaders(), false);
    assert.equal(
        getRequestIp(
            new Request("https://hushle.app/api/test", {
                headers: {
                    "x-forwarded-for": "203.0.113.8",
                    "x-real-ip": "203.0.113.9",
                },
            })
        ),
        "unknown"
    );

    assert.equal(
        getSocketClientIp({
            handshake: {
                headers: {
                    "x-forwarded-for": "203.0.113.8",
                    "x-real-ip": "203.0.113.9",
                },
                address: "::ffff:10.0.0.25",
            },
        }),
        "10.0.0.25"
    );

    process.env.TRUST_PROXY = "true";

    assert.equal(shouldTrustProxyHeaders(), true);
    assert.equal(
        getRequestIp(
            new Request("https://hushle.app/api/test", {
                headers: {
                    "x-forwarded-for": "198.51.100.11, 10.0.0.2",
                },
            })
        ),
        "198.51.100.11"
    );

    assert.equal(
        getSocketClientIp({
            handshake: {
                headers: {
                    "x-real-ip": "::ffff:198.51.100.77",
                },
                address: "::ffff:10.0.0.25",
            },
        }),
        "198.51.100.77"
    );

    console.log("client ip security smoke test passed");
} finally {
    restoreTrustProxy(originalTrustProxy);
}
