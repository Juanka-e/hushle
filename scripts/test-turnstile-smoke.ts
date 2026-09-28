import assert from "node:assert/strict";
import { normalizeSystemSettings } from "../apps/web/src/lib/system-settings/schema";
import { verifyCaptchaForAction } from "../apps/web/src/lib/security/captcha";

const TURNSTILE_INVISIBLE_PASS_SITE_KEY = "1x00000000000000000000BB";
const TURNSTILE_PASS_SECRET_KEY = "1x0000000000000000000000000000000AA";
const TURNSTILE_FAIL_SECRET_KEY = "2x0000000000000000000000000000000AA";
const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

async function main(): Promise<void> {
    process.env.TURNSTILE_SITE_KEY = TURNSTILE_INVISIBLE_PASS_SITE_KEY;
    process.env.TURNSTILE_SECRET_KEY = TURNSTILE_PASS_SECRET_KEY;

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
                turnstileMode: "invisible",
                recaptchaScoreThreshold: 0.5,
                turnstileInteractiveFallback: true,
            },
        },
    });

    const successResult = await verifyCaptchaForAction({
        action: "login",
        token: TURNSTILE_DUMMY_TOKEN,
        settings,
    });

    // Cloudflare's fixed dummy token does not carry our requested action metadata.
    // The application must reject it rather than weakening exact action validation.
    assert.equal(successResult.ok, false);
    assert.equal(successResult.provider, "turnstile");
    assert.equal(successResult.reason, "action_mismatch");

    process.env.TURNSTILE_SECRET_KEY = TURNSTILE_FAIL_SECRET_KEY;

    const failureResult = await verifyCaptchaForAction({
        action: "login",
        token: TURNSTILE_DUMMY_TOKEN,
        settings,
    });

    assert.equal(failureResult.ok, false);
    assert.equal(failureResult.provider, "turnstile");
    assert.equal(failureResult.reason, "verification_failed");

    console.log("turnstile smoke test passed");
}

void main();
