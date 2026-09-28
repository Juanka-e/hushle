import assert from "node:assert/strict";
import { DEFAULT_SYSTEM_SETTINGS, normalizeSystemSettings } from "../apps/web/src/lib/system-settings/schema";
import {
    getEffectiveCaptchaFailMode,
    getPublicCaptchaConfigForAction,
    isCaptchaRequiredForAction,
    verifyCaptchaForAction,
} from "../apps/web/src/lib/security/captcha";

async function main(): Promise<void> {
    const defaults = normalizeSystemSettings({});
    assert.equal(isCaptchaRequiredForAction(defaults, "register"), false);
    assert.equal(defaults.security.captcha.provider, "turnstile");
    assert.equal(defaults.security.captcha.failMode, "hard_fail");
    assert.equal(defaults.security.captcha.turnstileMode, "managed");

    const enforcedSettings = normalizeSystemSettings({
        security: {
            captcha: {
                enabled: true,
                provider: "turnstile",
                onRegister: true,
                onGuestJoin: true,
                onRoomCreate: true,
                onLogin: true,
                failMode: "soft_fail",
                turnstileMode: "invisible",
                recaptchaScoreThreshold: 0.5,
                turnstileInteractiveFallback: true,
            },
        },
    });

    const publicConfig = getPublicCaptchaConfigForAction(enforcedSettings, "register");
    assert.equal(publicConfig.required, true);
    assert.equal(publicConfig.provider, "turnstile");
    assert.equal(publicConfig.turnstileMode, "invisible");

    const effectiveFailMode =
        process.env.NODE_ENV === "production"
            ? "hard_fail"
            : "soft_fail";
    assert.equal(getEffectiveCaptchaFailMode(enforcedSettings), effectiveFailMode);

    const softFailResult = await verifyCaptchaForAction({
        action: "register",
        token: null,
        settings: normalizeSystemSettings({
            security: {
                captcha: {
                    enabled: true,
                    provider: "turnstile",
                    onRegister: true,
                    onGuestJoin: false,
                    onRoomCreate: false,
                    onLogin: false,
                    failMode: "soft_fail",
                    turnstileMode: "invisible",
                    recaptchaScoreThreshold: 0.5,
                    turnstileInteractiveFallback: true,
                },
            },
        }),
    });

    if (process.env.NODE_ENV === "production") {
        assert.equal(softFailResult.ok, false);
        assert.equal(softFailResult.reason, "provider_unconfigured");
    } else {
        assert.equal(softFailResult.ok, true);
        assert.equal(softFailResult.softPassed, true);
        assert.equal(softFailResult.reason, "provider_unconfigured");
    }

    const hardFailResult = await verifyCaptchaForAction({
        action: "register",
        token: null,
        settings: normalizeSystemSettings({
            security: {
                captcha: {
                    enabled: true,
                    provider: "turnstile",
                    onRegister: true,
                    onGuestJoin: false,
                    onRoomCreate: false,
                    onLogin: false,
                    failMode: "hard_fail",
                    turnstileMode: "managed",
                    recaptchaScoreThreshold: 0.5,
                    turnstileInteractiveFallback: true,
                },
            },
        }),
    });
    assert.equal(hardFailResult.ok, false);
    assert.equal(hardFailResult.reason, "provider_unconfigured");

    const disabledResult = await verifyCaptchaForAction({
        action: "login",
        token: null,
        settings: DEFAULT_SYSTEM_SETTINGS,
    });
    assert.equal(disabledResult.ok, true);
    assert.equal(disabledResult.reason, "not_required");

    console.log("captcha security smoke test passed");
}

void main();
