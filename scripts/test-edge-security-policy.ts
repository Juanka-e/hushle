import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    PAYMENT_WEBHOOK_EDGE_POLICY,
    validateEdgeSecurityEnvironment,
} from "./lib/edge-security-policy.mjs";

interface RouteClass {
    id: string;
    forbiddenEdgeControls: string[];
}

interface CandidateRule {
    id: string;
    status: string;
    excludedRouteClasses?: string[];
}

const policy = JSON.parse(
    readFileSync("infra/cloudflare/edge-security-policy.json", "utf8")
) as {
    schemaVersion: number;
    routeClasses: RouteClass[];
    candidateRules: CandidateRule[];
};

assert.equal(policy.schemaVersion, 1);
const routes = new Map(policy.routeClasses.map((route) => [route.id, route]));
assert.ok(routes.get("websocket")?.forbiddenEdgeControls.includes("require-referer"));
assert.ok(routes.get("websocket")?.forbiddenEdgeControls.includes("managed-challenge"));
assert.ok(routes.get("payment-webhook")?.forbiddenEdgeControls.includes("browser-challenge"));
assert.ok(routes.get("payment-webhook")?.forbiddenEdgeControls.includes("session-check"));
assert.ok(routes.get("email-provider-webhook")?.forbiddenEdgeControls.includes("browser-challenge"));
assert.ok(routes.get("email-provider-webhook")?.forbiddenEdgeControls.includes("origin-check"));

const userAgentRule = policy.candidateRules.find((rule) => rule.id === "bad-user-agent-browser-only");
assert.equal(userAgentRule?.status, "observe");
assert.deepEqual(userAgentRule?.excludedRouteClasses, [
    "websocket",
    "payment-webhook",
    "email-provider-webhook",
]);
assert.equal(
    policy.candidateRules.find((rule) => rule.id === "empty-or-bad-referer")?.status,
    "disabled"
);

const valid = validateEdgeSecurityEnvironment({
    PRODUCTION_EDGE_SECURITY_POLICY: "cloudflare_free_safe_launch",
    CLOUDFLARE_PROXY_ENABLED: "true",
    CLOUDFLARE_ORIGIN_LOCK_MODE: "firewall",
    CLOUDFLARE_BOT_FIGHT_MODE: "disabled_until_webhook_smoke",
    PAYMENT_WEBHOOK_EDGE_POLICY,
});
assert.deepEqual(valid.errors, []);

const unsafe = validateEdgeSecurityEnvironment({
    PRODUCTION_EDGE_SECURITY_POLICY: "cloudflare_free_safe_launch",
    CLOUDFLARE_PROXY_ENABLED: "false",
    CLOUDFLARE_ORIGIN_LOCK_MODE: "none",
    CLOUDFLARE_BOT_FIGHT_MODE: "enabled",
    PAYMENT_WEBHOOK_EDGE_POLICY: "challenge_all",
});
assert.equal(unsafe.errors.length, 4);

const acceptedRisk = validateEdgeSecurityEnvironment({
    PRODUCTION_EDGE_SECURITY_POLICY: "direct_origin_risk_accepted",
    PAYMENT_WEBHOOK_EDGE_POLICY,
});
assert.deepEqual(acceptedRisk.errors, []);
assert.equal(acceptedRisk.warnings.length, 1);

console.log("Edge security policy checks passed.");
