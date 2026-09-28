import { randomUUID } from "node:crypto";
import { getSystemSettings } from "@/lib/system-settings/service";
import type { CaptchaFailMode, SystemSettings } from "@/types/system-settings";
import type {
    CaptchaAction,
    CaptchaVerificationResult,
    PublicCaptchaConfig,
} from "@/types/captcha";

const TURNSTILE_TOKEN_MAX_LENGTH = 2048;
const CAPTCHA_VERIFY_TIMEOUT_MS = 5_000;

export function getTurnstileAllowedHostnames(): ReadonlySet<string> {
    const hostnames = (process.env.TURNSTILE_ALLOWED_HOSTNAMES ?? "")
        .split(",")
        .map((hostname) => hostname.trim().toLowerCase())
        .filter(
            (hostname) =>
                hostname.length > 0 &&
                hostname.length <= 253 &&
                /^[a-z0-9.-]+$/.test(hostname) &&
                !hostname.startsWith(".") &&
                !hostname.endsWith(".") &&
                !hostname.includes("..")
        )
        .slice(0, 20);

    return new Set(hostnames);
}

function getCaptchaSiteKey(provider: PublicCaptchaConfig["provider"]): string | null {
    if (provider === "turnstile") {
        return process.env.TURNSTILE_SITE_KEY?.trim() || null;
    }

    if (provider === "recaptcha_v3") {
        return process.env.RECAPTCHA_SITE_KEY?.trim() || null;
    }

    return null;
}

function getCaptchaSecret(provider: PublicCaptchaConfig["provider"]): string | null {
    if (provider === "turnstile") {
        return process.env.TURNSTILE_SECRET_KEY?.trim() || null;
    }

    if (provider === "recaptcha_v3") {
        return process.env.RECAPTCHA_SECRET_KEY?.trim() || null;
    }

    return null;
}

export function isCaptchaRequiredForAction(
    settings: SystemSettings,
    action: CaptchaAction
): boolean {
    if (!settings.security.captcha.enabled) {
        return false;
    }

    if (settings.security.captcha.provider === "none") {
        return false;
    }

    switch (action) {
        case "register":
            return settings.security.captcha.onRegister;
        case "login":
        case "password_reset":
            return settings.security.captcha.onLogin;
        case "room_create":
            return settings.security.captcha.onRoomCreate;
        case "guest_join":
            return settings.security.captcha.onGuestJoin;
        default:
            return false;
    }
}

export function getPublicCaptchaConfigForAction(
    settings: SystemSettings,
    action: CaptchaAction
): PublicCaptchaConfig {
    const provider = settings.security.captcha.provider;

    return {
        enabled: settings.security.captcha.enabled,
        required: isCaptchaRequiredForAction(settings, action),
        provider,
        siteKey: getCaptchaSiteKey(provider),
        failMode: getEffectiveCaptchaFailMode(settings),
        turnstileMode: settings.security.captcha.turnstileMode,
        turnstileInteractiveFallback:
            settings.security.captcha.turnstileInteractiveFallback,
    };
}

export function getEffectiveCaptchaFailMode(
    settings: SystemSettings
): CaptchaFailMode {
    if (process.env.NODE_ENV === "production") {
        return "hard_fail";
    }

    return settings.security.captcha.failMode;
}

async function verifyTurnstileToken(options: {
    token: string;
    action: CaptchaAction;
    remoteIp: string | null;
}): Promise<CaptchaVerificationResult> {
    const secret = getCaptchaSecret("turnstile");
    if (!secret) {
        return {
            ok: false,
            softPassed: false,
            provider: "turnstile",
            reason: "provider_unconfigured",
        };
    }

    if (options.token.length > TURNSTILE_TOKEN_MAX_LENGTH) {
        return {
            ok: false,
            softPassed: false,
            provider: "turnstile",
            reason: "token_too_long",
        };
    }

    const allowedHostnames = getTurnstileAllowedHostnames();
    if (process.env.NODE_ENV === "production" && allowedHostnames.size === 0) {
        return {
            ok: false,
            softPassed: false,
            provider: "turnstile",
            reason: "provider_unconfigured",
        };
    }

    const body = new URLSearchParams({
        secret,
        response: options.token,
        idempotency_key: randomUUID(),
    });

    if (options.remoteIp) {
        body.set("remoteip", options.remoteIp);
    }

    try {
        const response = await fetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body,
                cache: "no-store",
                signal: AbortSignal.timeout(CAPTCHA_VERIFY_TIMEOUT_MS),
            }
        );

        if (!response.ok) {
            return {
                ok: false,
                softPassed: false,
                provider: "turnstile",
                reason: "provider_unavailable",
            };
        }

        const payload = (await response.json()) as {
            success?: boolean;
            action?: string;
            hostname?: string;
        };

        if (!payload.success) {
            return {
                ok: false,
                softPassed: false,
                provider: "turnstile",
                reason: "verification_failed",
            };
        }

        if (payload.action !== options.action) {
            return {
                ok: false,
                softPassed: false,
                provider: "turnstile",
                reason: "action_mismatch",
            };
        }

        if (
            allowedHostnames.size > 0 &&
            (!payload.hostname ||
                !allowedHostnames.has(payload.hostname.trim().toLowerCase()))
        ) {
            return {
                ok: false,
                softPassed: false,
                provider: "turnstile",
                reason: "hostname_mismatch",
            };
        }

        return {
            ok: true,
            softPassed: false,
            provider: "turnstile",
            reason: "verified",
        };
    } catch {
        return {
            ok: false,
            softPassed: false,
            provider: "turnstile",
            reason: "provider_unavailable",
        };
    }
}

async function verifyRecaptchaToken(options: {
    token: string;
    action: CaptchaAction;
    remoteIp: string | null;
    threshold: number;
}): Promise<CaptchaVerificationResult> {
    const secret = getCaptchaSecret("recaptcha_v3");
    if (!secret) {
        return {
            ok: false,
            softPassed: false,
            provider: "recaptcha_v3",
            reason: "provider_unconfigured",
        };
    }

    const body = new URLSearchParams({
        secret,
        response: options.token,
    });

    if (options.remoteIp) {
        body.set("remoteip", options.remoteIp);
    }

    try {
        const response = await fetch(
            "https://www.google.com/recaptcha/api/siteverify",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body,
                cache: "no-store",
                signal: AbortSignal.timeout(CAPTCHA_VERIFY_TIMEOUT_MS),
            }
        );

        if (!response.ok) {
            return {
                ok: false,
                softPassed: false,
                provider: "recaptcha_v3",
                reason: "provider_unavailable",
            };
        }

        const payload = (await response.json()) as {
            success?: boolean;
            score?: number;
            action?: string;
        };

        if (!payload.success) {
            return {
                ok: false,
                softPassed: false,
                provider: "recaptcha_v3",
                reason: "verification_failed",
            };
        }

        if (payload.action !== options.action) {
            return {
                ok: false,
                softPassed: false,
                provider: "recaptcha_v3",
                reason: "action_mismatch",
                score: payload.score ?? null,
            };
        }

        if ((payload.score ?? 0) < options.threshold) {
            return {
                ok: false,
                softPassed: false,
                provider: "recaptcha_v3",
                reason: "low_score",
                score: payload.score ?? null,
            };
        }

        return {
            ok: true,
            softPassed: false,
            provider: "recaptcha_v3",
            reason: "verified",
            score: payload.score ?? null,
        };
    } catch {
        return {
            ok: false,
            softPassed: false,
            provider: "recaptcha_v3",
            reason: "provider_unavailable",
        };
    }
}

function toSoftPassResult(
    provider: PublicCaptchaConfig["provider"],
    reason: CaptchaVerificationResult["reason"]
): CaptchaVerificationResult {
    return {
        ok: true,
        softPassed: true,
        provider,
        reason,
    };
}

export async function verifyCaptchaForAction(options: {
    action: CaptchaAction;
    token?: string | null;
    remoteIp?: string | null;
    settings?: SystemSettings;
}): Promise<CaptchaVerificationResult> {
    const settings = options.settings ?? (await getSystemSettings());
    const config = getPublicCaptchaConfigForAction(settings, options.action);

    if (!config.required) {
        return {
            ok: true,
            softPassed: false,
            provider: config.provider,
            reason: "not_required",
        };
    }

    if (!config.siteKey || config.provider === "none") {
        return config.failMode === "soft_fail"
            ? toSoftPassResult(config.provider, "provider_unconfigured")
            : {
                  ok: false,
                  softPassed: false,
                  provider: config.provider,
                  reason: "provider_unconfigured",
              };
    }

    if (!options.token) {
        return {
            ok: false,
            softPassed: false,
            provider: config.provider,
            reason: "missing_token",
        };
    }

    const remoteIp = options.remoteIp ?? null;
    const result =
        config.provider === "turnstile"
            ? await verifyTurnstileToken({
                  token: options.token,
                  action: options.action,
                  remoteIp,
              })
            : await verifyRecaptchaToken({
                  token: options.token,
                  action: options.action,
                  remoteIp,
                  threshold: settings.security.captcha.recaptchaScoreThreshold,
              });

    if (result.ok) {
        return result;
    }

    if (
        config.failMode === "soft_fail" &&
        (result.reason === "provider_unconfigured" ||
            result.reason === "provider_unavailable")
    ) {
        return toSoftPassResult(config.provider, result.reason);
    }

    return result;
}
