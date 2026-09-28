import assert from "node:assert/strict";
import { normalizeSystemSettings } from "../apps/web/src/lib/system-settings/schema";
import { verifyCaptchaForAction } from "../apps/web/src/lib/security/captcha";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
    nodeEnvironment: process.env.NODE_ENV,
    siteKey: process.env.TURNSTILE_SITE_KEY,
    secretKey: process.env.TURNSTILE_SECRET_KEY,
    allowedHostnames: process.env.TURNSTILE_ALLOWED_HOSTNAMES,
};

const settings = normalizeSystemSettings({
    security: {
        captcha: {
            enabled: true,
            provider: "turnstile",
            onRegister: true,
            onGuestJoin: true,
            onRoomCreate: true,
            onLogin: true,
            failMode: "hard_fail",
            turnstileMode: "managed",
            recaptchaScoreThreshold: 0.5,
            turnstileInteractiveFallback: true,
        },
    },
});

async function verify(action: "login" | "register", token = "valid-token") {
    return verifyCaptchaForAction({
        action,
        token,
        remoteIp: "203.0.113.10",
        settings,
    });
}

function setNodeEnvironment(value: string | undefined): void {
    if (value === undefined) {
        Reflect.deleteProperty(process.env, "NODE_ENV");
        return;
    }
    Object.defineProperty(process.env, "NODE_ENV", {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
    });
}

async function main(): Promise<void> {
    process.env.TURNSTILE_SITE_KEY = "test-site-key";
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key-with-enough-length";
    process.env.TURNSTILE_ALLOWED_HOSTNAMES = "play.hushle.test,admin.hushle.test";

    let requestCount = 0;
    globalThis.fetch = async (_input, init) => {
        requestCount += 1;
        const body = init?.body as URLSearchParams;
        assert.equal(body.get("remoteip"), "203.0.113.10");
        assert.ok(body.get("idempotency_key"));
        return Response.json({
            success: true,
            action: "login",
            hostname: "PLAY.HUSHLE.TEST",
        });
    };

    const success = await verify("login");
    assert.equal(success.ok, true);
    assert.equal(success.reason, "verified");
    assert.equal(requestCount, 1);

    const actionMismatch = await verify("register");
    assert.equal(actionMismatch.ok, false);
    assert.equal(actionMismatch.reason, "action_mismatch");

    globalThis.fetch = async () =>
        Response.json({ success: true, action: "login", hostname: "evil.example" });
    const hostnameMismatch = await verify("login");
    assert.equal(hostnameMismatch.ok, false);
    assert.equal(hostnameMismatch.reason, "hostname_mismatch");

    requestCount = 0;
    globalThis.fetch = async () => {
        requestCount += 1;
        return Response.json({ success: true, action: "login", hostname: "play.hushle.test" });
    };
    const oversized = await verify("login", "x".repeat(2049));
    assert.equal(oversized.ok, false);
    assert.equal(oversized.reason, "token_too_long");
    assert.equal(requestCount, 0);

    globalThis.fetch = async () => new Response(null, { status: 503 });
    const unavailable = await verify("login");
    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.reason, "provider_unavailable");

    setNodeEnvironment("production");
    delete process.env.TURNSTILE_ALLOWED_HOSTNAMES;
    const missingProductionAllowlist = await verify("login");
    assert.equal(missingProductionAllowlist.ok, false);
    assert.equal(missingProductionAllowlist.reason, "provider_unconfigured");

    console.log("Adaptive Turnstile server policy checks passed.");
}

void main().finally(() => {
    globalThis.fetch = originalFetch;
    setNodeEnvironment(originalEnvironment.nodeEnvironment);
    if (originalEnvironment.siteKey === undefined) delete process.env.TURNSTILE_SITE_KEY;
    else process.env.TURNSTILE_SITE_KEY = originalEnvironment.siteKey;
    if (originalEnvironment.secretKey === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalEnvironment.secretKey;
    if (originalEnvironment.allowedHostnames === undefined) {
        delete process.env.TURNSTILE_ALLOWED_HOSTNAMES;
    } else {
        process.env.TURNSTILE_ALLOWED_HOSTNAMES = originalEnvironment.allowedHostnames;
    }
});
