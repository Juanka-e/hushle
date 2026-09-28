import assert from "node:assert/strict";
import { isHealthEndpointAllowed } from "../apps/web/src/lib/security/health-check";

function buildHeaders(token?: string): Headers {
    const headers = new Headers();
    if (token) {
        headers.set("x-health-token", token);
    }
    return headers;
}

function main(): void {
    const originalToken = process.env.HEALTHCHECK_TOKEN;

    try {
        process.env.HEALTHCHECK_TOKEN = "health-secret";

        assert.equal(isHealthEndpointAllowed(buildHeaders(), true), true);
        assert.equal(isHealthEndpointAllowed(buildHeaders(), false), false);
        assert.equal(isHealthEndpointAllowed(buildHeaders("wrong"), false), false);
        assert.equal(isHealthEndpointAllowed(buildHeaders("health-secret"), false), true);

        process.env.HEALTHCHECK_TOKEN = "";
        assert.equal(isHealthEndpointAllowed(buildHeaders("health-secret"), false), false);

        console.log("health guard smoke test passed");
    } finally {
        if (originalToken === undefined) {
            delete process.env.HEALTHCHECK_TOKEN;
        } else {
            process.env.HEALTHCHECK_TOKEN = originalToken;
        }
    }
}

main();
