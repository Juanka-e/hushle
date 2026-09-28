import type { CaptchaAction, PublicCaptchaConfig } from "@/types/captcha";

declare global {
    interface Window {
        turnstile?: {
            render: (
                container: HTMLElement,
                options: Record<string, unknown>
            ) => string;
            execute: (widgetId: string) => void;
            remove: (widgetId: string) => void;
        };
        grecaptcha?: {
            ready: (callback: () => void) => void;
            execute: (siteKey: string, options: { action: string }) => Promise<string>;
        };
    }
}

let activeTurnstileScriptPromise: Promise<void> | null = null;
let activeRecaptchaScriptPromise: Promise<void> | null = null;
const captchaConfigCache = new Map<
    CaptchaAction,
    { expiresAt: number; promise: Promise<PublicCaptchaConfig> }
>();
const CAPTCHA_CONFIG_CACHE_MS = 15_000;

function ensurePreconnect(origin: string): void {
    if (document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) {
        return;
    }

    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
}

function loadScript(src: string, dataAttribute: string): Promise<void> {
    if (typeof window === "undefined") {
        return Promise.reject(new Error("Captcha sadece client tarafinda calisir."));
    }

    const existingScript = document.querySelector<HTMLScriptElement>(
        `script[${dataAttribute}="true"]`
    );
    if (existingScript) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.defer = true;
        script.setAttribute(dataAttribute, "true");
        script.onload = () => resolve();
        script.onerror = () =>
            reject(new Error("Captcha script yuklenemedi."));
        document.head.appendChild(script);
    });
}

function ensureTurnstileLoaded(): Promise<void> {
    if (!activeTurnstileScriptPromise) {
        ensurePreconnect("https://challenges.cloudflare.com");
        activeTurnstileScriptPromise = loadScript(
            "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
            "data-turnstile-script"
        ).catch((error) => {
            activeTurnstileScriptPromise = null;
            throw error;
        });
    }

    return activeTurnstileScriptPromise;
}

function ensureRecaptchaLoaded(siteKey: string): Promise<void> {
    if (!activeRecaptchaScriptPromise) {
        ensurePreconnect("https://www.google.com");
        activeRecaptchaScriptPromise = loadScript(
            `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`,
            "data-recaptcha-script"
        ).catch((error) => {
            activeRecaptchaScriptPromise = null;
            throw error;
        });
    }

    return activeRecaptchaScriptPromise;
}

async function fetchCaptchaConfig(action: CaptchaAction): Promise<PublicCaptchaConfig> {
    const cached = captchaConfigCache.get(action);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.promise;
    }

    const promise = fetch(`/api/security/captcha-config?action=${encodeURIComponent(action)}`, {
        cache: "no-store",
    }).then(async (response) => {
        if (!response.ok) {
            throw new Error("Captcha ayarlari alinamadi.");
        }
        return (await response.json()) as PublicCaptchaConfig;
    });
    captchaConfigCache.set(action, {
        expiresAt: Date.now() + CAPTCHA_CONFIG_CACHE_MS,
        promise,
    });

    try {
        return await promise;
    } catch (error) {
        captchaConfigCache.delete(action);
        throw error;
    }
}

export function prewarmCaptchaForAction(action: CaptchaAction): void {
    void fetchCaptchaConfig(action)
        .then(async (config) => {
            if (!config.required || !config.enabled || !config.siteKey) return;
            if (config.provider === "turnstile") {
                await ensureTurnstileLoaded();
            } else if (config.provider === "recaptcha_v3") {
                await ensureRecaptchaLoaded(config.siteKey);
            }
        })
        .catch(() => {
            // Submit remains authoritative and will surface a controlled error.
        });
}

async function executeTurnstile(config: PublicCaptchaConfig, action: CaptchaAction): Promise<string> {
    const siteKey = config.siteKey;
    if (!siteKey) {
        throw new Error("Turnstile site key eksik.");
    }

    await ensureTurnstileLoaded();

    if (!window.turnstile) {
        throw new Error("Turnstile kullanima hazir degil.");
    }

    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.zIndex = "2147483647";
    container.setAttribute("aria-live", "polite");
    container.setAttribute("data-hushle-captcha", action);
    if (config.turnstileMode === "invisible") {
        container.style.right = "0";
        container.style.bottom = "0";
        container.style.width = "1px";
        container.style.height = "1px";
        container.style.overflow = "hidden";
    } else {
        container.style.left = "50%";
        container.style.top = "50%";
        container.style.transform = "translate(-50%, -50%)";
    }
    document.body.appendChild(container);
    let widgetId: string | null = null;

    try {
        const token = await new Promise<string>((resolve, reject) => {
            widgetId = window.turnstile!.render(container, {
                sitekey: siteKey,
                action,
                appearance:
                    config.turnstileMode === "managed" &&
                    config.turnstileInteractiveFallback
                        ? "interaction-only"
                        : "execute",
                execution: "execute",
                size:
                    config.turnstileMode === "invisible"
                        ? "invisible"
                        : "normal",
                callback: (value: string) => resolve(value),
                "error-callback": () => reject(new Error("Turnstile token alinamadi.")),
                "expired-callback": () => reject(new Error("Turnstile token suresi doldu.")),
            });

            window.turnstile!.execute(widgetId);
        });

        return token;
    } finally {
        // Turnstile's remove() can race with route changes and emit noisy DOM errors.
        // For our one-shot hidden widget flow, dropping the temporary container is sufficient.
        if (container.isConnected) {
            container.remove();
        }
    }
}

async function executeRecaptcha(siteKey: string, action: CaptchaAction): Promise<string> {
    await ensureRecaptchaLoaded(siteKey);

    if (!window.grecaptcha) {
        throw new Error("reCAPTCHA kullanima hazir degil.");
    }

    return await new Promise<string>((resolve, reject) => {
        window.grecaptcha!.ready(() => {
            window.grecaptcha!
                .execute(siteKey, { action })
                .then(resolve)
                .catch(() => reject(new Error("reCAPTCHA token alinamadi.")));
        });
    });
}

export async function getCaptchaTokenForAction(action: CaptchaAction): Promise<{
    token: string | null;
    action: CaptchaAction;
    config: PublicCaptchaConfig;
}> {
    const config = await fetchCaptchaConfig(action);

    if (!config.required || !config.enabled) {
        return {
            token: null,
            action,
            config,
        };
    }

    if (!config.siteKey || config.provider === "none") {
        return {
            token: null,
            action,
            config,
        };
    }

    const token =
        config.provider === "turnstile"
            ? await executeTurnstile(config, action)
            : await executeRecaptcha(config.siteKey, action);

    return {
        token,
        action,
        config,
    };
}
