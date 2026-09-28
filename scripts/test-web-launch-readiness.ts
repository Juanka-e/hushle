import { spawnSync } from "node:child_process";

interface ReadinessCheck {
    area: string;
    script: string;
}

const checks: ReadinessCheck[] = [
    { area: "repository encoding", script: "test:encoding-integrity" },
    { area: "workspace boundaries", script: "test:package-boundaries" },
    { area: "central observability", script: "test:observability" },
    { area: "request security", script: "test:request-security" },
    { area: "client IP trust", script: "test:client-ip-security" },
    { area: "auth redirects", script: "test:auth-redirect-security" },
    { area: "captcha policy", script: "test:captcha-security" },
    { area: "adaptive Turnstile policy", script: "test:adaptive-turnstile-policy" },
    { area: "production edge policy", script: "test:edge-security-policy" },
    { area: "content security policy", script: "test:csp" },
    { area: "web origin policy", script: "test:web-origin-policy" },
    { area: "admin route guards", script: "test:admin-guards" },
    { area: "health endpoint guard", script: "test:health-guard" },
    { area: "player identity", script: "test:player-identity" },
    { area: "cross-tab room presence", script: "test:active-room-presence" },
    { area: "server room membership", script: "test:room-membership" },
    { area: "room admin handoff", script: "test:room-admin-handoff" },
    { area: "room capacity", script: "test:room-capacity-controls" },
    { area: "distributed coordination", script: "test:distributed-coordination" },
    { area: "realtime topology", script: "test:realtime-topology" },
    { area: "room display contract", script: "test:room-display" },
    { area: "word category selection", script: "test:word-category-selection-ui" },
    { area: "card flip settings", script: "test:card-flip-settings" },
    { area: "economy guardrails", script: "test:economy-guardrails" },
    { area: "economy edge cases", script: "test:economy-guardrails-edge" },
    { area: "wallet ledger", script: "test:wallet-ledger" },
    { area: "store pricing", script: "test:store-pricing" },
    { area: "inventory ownership", script: "test:inventory-core" },
    { area: "system notifications", script: "test:system-notifications" },
];

const npmCliPath = process.env.npm_execpath;
if (!npmCliPath) {
    throw new Error("npm_execpath is required to run the readiness suite");
}
const failures: ReadinessCheck[] = [];
const startedAt = Date.now();

for (const [index, check] of checks.entries()) {
    console.log(
        `\n[web-launch ${index + 1}/${checks.length}] ${check.area} (${check.script})`
    );
    const result = spawnSync(process.execPath, [npmCliPath, "run", check.script], {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
    });
    if (result.status !== 0) {
        failures.push(check);
    }
}

const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
if (failures.length > 0) {
    console.error(
        `\nWeb launch core failed in ${failures.length}/${checks.length} checks (${durationSeconds}s):`
    );
    for (const failure of failures) {
        console.error(`- ${failure.area}: npm run ${failure.script}`);
    }
    process.exit(1);
}

console.log(
    `\nWeb launch core passed ${checks.length}/${checks.length} checks in ${durationSeconds}s.`
);
