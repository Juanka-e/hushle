import assert from "node:assert/strict";
import {
    allowOriginlessSocketClients,
    isTrustedWebOrigin,
    parseTrustedWebOrigins,
} from "../apps/web/src/lib/security/web-origin-policy";

const trustedOrigins = parseTrustedWebOrigins({
    NEXT_PUBLIC_SITE_URL: "https://hushle.example",
    TRUSTED_WEB_ORIGINS:
        "https://admin.hushle.example, https://play.hushle.example",
});

assert.deepEqual([...trustedOrigins], [
    "https://hushle.example",
    "https://admin.hushle.example",
    "https://play.hushle.example",
]);
assert.equal(
    isTrustedWebOrigin({
        origin: "https://admin.hushle.example",
        isDev: false,
        trustedOrigins,
    }),
    true
);
assert.equal(
    isTrustedWebOrigin({
        origin: "https://admin.hushle.example.attacker.test",
        isDev: false,
        trustedOrigins,
    }),
    false
);
assert.equal(
    isTrustedWebOrigin({
        origin: "http://localhost:3001",
        isDev: true,
        trustedOrigins,
    }),
    true
);
assert.throws(
    () => parseTrustedWebOrigins({ TRUSTED_WEB_ORIGINS: "*" }),
    /Wildcard origins/
);
assert.equal(allowOriginlessSocketClients(false, undefined), false);
assert.equal(allowOriginlessSocketClients(true, undefined), true);
assert.equal(allowOriginlessSocketClients(false, "true"), true);
assert.throws(
    () => allowOriginlessSocketClients(false, "yes"),
    /must be true or false/
);

console.log("web origin policy smoke test passed");
