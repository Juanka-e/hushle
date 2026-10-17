import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
    PAYMENT_WEBHOOK_EDGE_POLICY,
    validateEdgeSecurityEnvironment,
} from "./lib/edge-security-policy.mjs";

interface RouteClass {
    id: string;
    paths: string[];
    applicationControls: string[];
    edgeControls: string[];
    forbiddenEdgeControls: string[];
}

interface CandidateRule {
    id: string;
    status: string;
    actionAfterObservation?: string;
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

// Shape: unique ids, non-empty lists, absolute paths, no control both allowed and forbidden.
assert.equal(routes.size, policy.routeClasses.length, "route class ids are unique");
for (const route of policy.routeClasses) {
    for (const list of [route.paths, route.applicationControls, route.edgeControls, route.forbiddenEdgeControls]) {
        assert.ok(
            Array.isArray(list) && list.length > 0 && list.every((value) => typeof value === "string" && value.trim()),
            `${route.id} lists are non-empty strings`
        );
    }
    assert.ok(route.paths.every((routePath) => routePath.startsWith("/")), `${route.id} paths are absolute`);
    assert.deepEqual(
        route.edgeControls.filter((control) => route.forbiddenEdgeControls.includes(control)),
        [],
        `${route.id} does not allow a forbidden control`
    );
}

// The iyzico return is a cross-site browser POST from the hosted payment page: a challenge, an
// Origin/Referer rule or a session requirement at the edge would drop the payment return.
const providerReturn = routes.get("payment-provider-return");
assert.deepEqual(providerReturn?.paths, ["/api/payments/callback/iyzico"]);
for (const control of [
    "browser-challenge",
    "managed-challenge",
    "rate-limit-challenge",
    "referer-check",
    "origin-check",
    "session-check",
    "blanket-datacenter-asn-block",
]) {
    assert.ok(providerReturn?.forbiddenEdgeControls.includes(control), `payment-provider-return forbids ${control}`);
}
assert.deepEqual(providerReturn?.edgeControls, ["ddos", "managed-waf", "rate-limit-block-only"]);
assert.ok(providerReturn?.applicationControls.includes("token-and-order-redis-rate-limit"));

// Classes that must never be challenged keep challenging edge controls off, and every candidate rule
// that can end in a challenge excludes them.
const noChallengeIds = new Set(
    policy.routeClasses
        .filter((route) => route.forbiddenEdgeControls.some((control) => /^(browser|managed)-challenge$/.test(control)))
        .map((route) => route.id)
);
assert.deepEqual(
    [...noChallengeIds].sort(),
    ["email-provider-webhook", "payment-provider-return", "payment-webhook", "websocket"]
);
for (const id of noChallengeIds) {
    assert.ok(!routes.get(id)?.edgeControls.includes("rate-limit-observe-first"), `${id} has no challenge rate limit`);
}
for (const rule of policy.candidateRules) {
    for (const id of rule.excludedRouteClasses ?? []) {
        assert.ok(routes.has(id), `${rule.id} excludes a known route class (${id})`);
    }
    if (rule.actionAfterObservation?.includes("challenge")) {
        assert.deepEqual(
            [...noChallengeIds].filter((id) => !rule.excludedRouteClasses?.includes(id)),
            [],
            `${rule.id} excludes every no-challenge route class`
        );
    }
}

// Every provider callback and webhook route in the app falls in exactly one no-challenge class.
function routePaths(dir: string): string[] {
    return (readdirSync(dir, { recursive: true }) as string[])
        .map((entry) => entry.split(path.sep).join("/"))
        .filter((entry) => entry === "route.ts" || entry.endsWith("/route.ts"))
        .map((entry) => `/${dir.replace(/^apps\/web\/src\/app\//, "")}/${entry}`.replace(/\/route\.ts$/, ""));
}
const providerRoutes = [
    ...routePaths("apps/web/src/app/api/payments/callback"),
    ...routePaths("apps/web/src/app/api/payments/webhooks"),
    ...routePaths("apps/web/src/app/api/email/webhooks"),
];
assert.deepEqual(providerRoutes.sort(), [
    "/api/email/webhooks/ses",
    "/api/payments/callback/iyzico",
    "/api/payments/webhooks/[provider]",
]);
for (const routePath of providerRoutes) {
    const covering = policy.routeClasses.filter((route) =>
        route.paths.some((prefix) => routePath === prefix || (prefix.endsWith("/") && routePath.startsWith(prefix)))
    );
    assert.equal(covering.length, 1, `${routePath} belongs to one route class`);
    assert.ok(noChallengeIds.has(covering[0].id), `${routePath} is in a no-challenge route class`);
}
// The app agrees: the callback URL given to iyzico uses the same path, the handler needs no session
// or Origin, and the proxy (which rejects untrusted origins) does not run on provider routes.
assert.match(
    readFileSync("apps/web/src/lib/payments/iyzico-owner-surface.ts", "utf8"),
    /new URL\("\/api\/payments\/callback\/iyzico", origin\)/
);
const callbackRoute = readFileSync("apps/web/src/app/api/payments/callback/iyzico/route.ts", "utf8");
assert.doesNotMatch(callbackRoute, /getSessionUser|isTrustedStateChangeRequest|getServerSession/);
assert.match(callbackRoute, /bucket: "payment-iyzico-callback-token"/);
assert.match(callbackRoute, /bucket: "payment-iyzico-callback-order"/);
const proxyMatcher = readFileSync("apps/web/src/proxy.ts", "utf8").split("export const config")[1] ?? "";
assert.doesNotMatch(proxyMatcher, /"\/api\/(payments\/(callback|webhooks)|email\/webhooks)/);

const userAgentRule = policy.candidateRules.find((rule) => rule.id === "bad-user-agent-browser-only");
assert.equal(userAgentRule?.status, "observe");
assert.deepEqual(userAgentRule?.excludedRouteClasses, [
    "websocket",
    "payment-webhook",
    "payment-provider-return",
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
