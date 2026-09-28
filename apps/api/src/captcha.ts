import { randomUUID } from "node:crypto";
import { getOrSetJsonCache, getRedisKey } from "@hushle/platform-cache";
import { prisma } from "@hushle/platform-db";

type CaptchaProvider = "none" | "turnstile" | "recaptcha_v3";
type CaptchaFailMode = "soft_fail" | "hard_fail";

type LoginCaptchaPolicy = {
    required: boolean;
    provider: CaptchaProvider;
    failMode: CaptchaFailMode;
    recaptchaScoreThreshold: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

async function getLoginCaptchaPolicy(): Promise<LoginCaptchaPolicy> {
    const result = await getOrSetJsonCache<LoginCaptchaPolicy>({
        key: getRedisKey("mobile-auth", "login-captcha-policy", "v1"),
        ttlMs: 15_000,
        loader: async () => {
            const row = await prisma.systemSetting.findUnique({
                where: { key: "security" },
                select: { value: true },
            });
            const security = asRecord(row?.value);
            const captcha = asRecord(security?.captcha);
            const provider =
                captcha?.provider === "turnstile" ||
                captcha?.provider === "recaptcha_v3"
                    ? captcha.provider
                    : "none";
            const enabled = captcha?.enabled === true;
            const configuredFailMode =
                captcha?.failMode === "soft_fail"
                    ? "soft_fail"
                    : "hard_fail";
            const threshold =
                typeof captcha?.recaptchaScoreThreshold === "number"
                    ? Math.min(
                          1,
                          Math.max(0, captcha.recaptchaScoreThreshold)
                      )
                    : 0.5;
            return {
                required:
                    enabled &&
                    provider !== "none" &&
                    captcha?.onLogin === true,
                provider,
                failMode:
                    process.env.NODE_ENV === "production"
                        ? "hard_fail"
                        : configuredFailMode,
                recaptchaScoreThreshold: threshold,
            };
        },
    });
    return result.value;
}

export async function verifyMobileLoginCaptcha(input: {
    token: string | null;
    remoteIp: string | null;
}): Promise<boolean> {
    const policy = await getLoginCaptchaPolicy();
    if (!policy.required) return true;
    if (!input.token) return false;

    const secret =
        policy.provider === "turnstile"
            ? process.env.TURNSTILE_SECRET_KEY?.trim()
            : process.env.RECAPTCHA_SECRET_KEY?.trim();
    const siteKey =
        policy.provider === "turnstile"
            ? process.env.TURNSTILE_SITE_KEY?.trim()
            : process.env.RECAPTCHA_SITE_KEY?.trim();
    if (!secret || !siteKey || policy.provider === "none") {
        return policy.failMode === "soft_fail";
    }

    const body = new URLSearchParams({
        secret,
        response: input.token,
    });
    if (input.remoteIp) body.set("remoteip", input.remoteIp);
    if (policy.provider === "turnstile") {
        body.set("idempotency_key", randomUUID());
    }

    try {
        const endpoint =
            policy.provider === "turnstile"
                ? "https://challenges.cloudflare.com/turnstile/v0/siteverify"
                : "https://www.google.com/recaptcha/api/siteverify";
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
            signal: AbortSignal.timeout(5_000),
        });
        const payload = (await response.json()) as {
            success?: boolean;
            action?: string;
            score?: number;
        };
        if (!payload.success) return false;
        if (
            policy.provider === "turnstile" &&
            payload.action &&
            payload.action !== "login"
        ) {
            return false;
        }
        if (
            policy.provider === "recaptcha_v3" &&
            payload.action !== "login"
        ) {
            return false;
        }
        if (
            policy.provider === "recaptcha_v3" &&
            (payload.score ?? 0) < policy.recaptchaScoreThreshold
        ) {
            return false;
        }
        return true;
    } catch {
        return policy.failMode === "soft_fail";
    }
}
