import type { CaptchaFailMode, CaptchaProvider } from "@/types/system-settings";
import type { CaptchaTurnstileMode } from "@/types/system-settings";

export const CAPTCHA_ACTIONS = [
    "register",
    "login",
    "password_reset",
    "room_create",
    "guest_join",
] as const;

export type CaptchaAction = (typeof CAPTCHA_ACTIONS)[number];

export interface PublicCaptchaConfig {
    enabled: boolean;
    required: boolean;
    provider: CaptchaProvider;
    siteKey: string | null;
    failMode: CaptchaFailMode;
    turnstileMode: CaptchaTurnstileMode;
    turnstileInteractiveFallback: boolean;
}

export interface CaptchaVerificationResult {
    ok: boolean;
    softPassed: boolean;
    provider: CaptchaProvider;
    reason:
        | "not_required"
        | "provider_unconfigured"
        | "provider_unavailable"
        | "missing_token"
        | "token_too_long"
        | "verification_failed"
        | "action_mismatch"
        | "hostname_mismatch"
        | "low_score"
        | "verified";
    score?: number | null;
}
