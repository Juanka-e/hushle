import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

interface IntegrationCheck {
    area: string;
    script: string;
    env?: Record<string, string>;
}

assert.equal(
    process.env.WEB_LAUNCH_INTEGRATION_TEST,
    "true",
    "WEB_LAUNCH_INTEGRATION_TEST=true is required"
);
assert.match(
    process.env.DATABASE_URL ?? "",
    /tabu_test/,
    "A disposable tabu_test database is required"
);
assert.ok(process.env.REDIS_URL?.trim(), "REDIS_URL is required");
assert.ok(
    process.env.SOCKET_TEST_URL?.trim(),
    "SOCKET_TEST_URL must point to a running built web server"
);

const checks: IntegrationCheck[] = [
    {
        area: "wallet ledger concurrency",
        script: "test:wallet-ledger-integration",
        env: { WALLET_LEDGER_INTEGRATION_TEST: "true" },
    },
    {
        area: "application cache invalidation",
        script: "test:application-cache",
        env: { APPLICATION_CACHE_MUTATION_TEST: "true" },
    },
    {
        area: "store catalog cache isolation",
        script: "test:store-catalog-cache",
        env: { STORE_CATALOG_CACHE_MUTATION_TEST: "true" },
    },
    {
        area: "notification unread cache",
        script: "test:notification-cache",
        env: { NOTIFICATION_CACHE_MUTATION_TEST: "true" },
    },
    {
        area: "dashboard summary cache",
        script: "test:user-dashboard-cache",
        env: { USER_DASHBOARD_CACHE_MUTATION_TEST: "true" },
    },
    {
        area: "room ownership lease",
        script: "test:room-ownership-redis",
        env: { ROOM_OWNERSHIP_REDIS_TEST: "true" },
    },
    {
        area: "finalize telemetry rollup",
        script: "test:telemetry-rollup-redis",
        env: { TELEMETRY_ROLLUP_REDIS_TEST: "true" },
    },
    {
        area: "audit retention transaction",
        script: "test:jobs-runtime-integration",
        env: { JOBS_INTEGRATION_TEST: "true" },
    },
    {
        area: "live room capacity socket",
        script: "test:room-capacity-socket",
    },
    {
        area: "registered room start rule",
        script: "test:room-registered-start-rule",
        env: { REGISTERED_START_RULE_TEST: "true" },
    },
    {
        area: "closed admission reconnect",
        script: "test:room-admission-closed",
        env: { CAPACITY_ADMISSION_MUTATION_TEST: "true" },
    },
    {
        area: "late spectator rewards",
        script: "test:late-spectator-reward",
        env: { LATE_SPECTATOR_REWARD_TEST: "true" },
    },
];

const npmCliPath = process.env.npm_execpath;
if (!npmCliPath) {
    throw new Error("npm_execpath is required to run the integration suite");
}
const failures: IntegrationCheck[] = [];

for (const [index, check] of checks.entries()) {
    console.log(
        `\n[web-launch integration ${index + 1}/${checks.length}] ${check.area}`
    );
    const result = spawnSync(process.execPath, [npmCliPath, "run", check.script], {
        cwd: process.cwd(),
        env: { ...process.env, ...check.env },
        stdio: "inherit",
    });
    if (result.status !== 0) {
        failures.push(check);
    }
}

if (failures.length > 0) {
    console.error(
        `\nWeb launch integration failed in ${failures.length}/${checks.length} checks:`
    );
    for (const failure of failures) {
        console.error(`- ${failure.area}: npm run ${failure.script}`);
    }
    process.exit(1);
}

console.log(`\nWeb launch integration passed ${checks.length}/${checks.length} checks.`);
