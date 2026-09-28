export const EDGE_SECURITY_PROFILES = new Set([
    "cloudflare_free_safe_launch",
    "direct_origin_risk_accepted",
]);

export const PAYMENT_WEBHOOK_EDGE_POLICY = "signature_first_no_challenge";

export function validateEdgeSecurityEnvironment(env) {
    const errors = [];
    const warnings = [];
    const checks = [];
    const profile = env.PRODUCTION_EDGE_SECURITY_POLICY?.trim();

    if (!EDGE_SECURITY_PROFILES.has(profile)) {
        errors.push(
            "PRODUCTION_EDGE_SECURITY_POLICY must be cloudflare_free_safe_launch or direct_origin_risk_accepted."
        );
    } else if (profile === "cloudflare_free_safe_launch") {
        if (env.CLOUDFLARE_PROXY_ENABLED !== "true") {
            errors.push("CLOUDFLARE_PROXY_ENABLED must be true for the Cloudflare launch profile.");
        }
        if (!new Set(["firewall", "tunnel", "authenticated_origin_pulls"]).has(env.CLOUDFLARE_ORIGIN_LOCK_MODE)) {
            errors.push(
                "CLOUDFLARE_ORIGIN_LOCK_MODE must be firewall, tunnel, or authenticated_origin_pulls."
            );
        }
        const botMode = env.CLOUDFLARE_BOT_FIGHT_MODE;
        if (!new Set(["disabled", "disabled_until_webhook_smoke", "enabled_after_webhook_smoke"]).has(botMode)) {
            errors.push("CLOUDFLARE_BOT_FIGHT_MODE contains an unsupported launch decision.");
        } else if (botMode === "enabled_after_webhook_smoke") {
            warnings.push(
                "Bot Fight Mode is enabled; every payment provider callback must have a passing production smoke test."
            );
        }
        checks.push("Cloudflare proxy and origin-lock decision");
    } else {
        warnings.push("Cloudflare edge protection is explicitly disabled for public launch.");
    }

    if (env.PAYMENT_WEBHOOK_EDGE_POLICY !== PAYMENT_WEBHOOK_EDGE_POLICY) {
        errors.push(
            `PAYMENT_WEBHOOK_EDGE_POLICY must be ${PAYMENT_WEBHOOK_EDGE_POLICY}.`
        );
    } else {
        checks.push("payment webhook signature-first edge policy");
    }

    return { errors, warnings, checks };
}
