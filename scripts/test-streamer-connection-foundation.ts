import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// Static contract checks for the streamer platform connection foundation
// (docs/superpowers/specs/2026-11-05-streamer-platform-connections-design.md).
// Each later task of the plan appends its own section here.

function read(path: string): string {
    return readFileSync(path, "utf8");
}

const schema = read("prisma/schema.prisma");
const migrationPath = "prisma/migrations/20261105120000_streamer_connections/migration.sql";

// --- Task 1: schema and migration -------------------------------------------

assert.match(schema, /enum StreamerPlatform \{\r?\n\s+twitch\r?\n\s+kick\r?\n\}/);
assert.match(
    schema,
    /enum StreamerConnectionStatus \{\r?\n\s+active\r?\n\s+needs_reconnect\r?\n\s+revoked\r?\n\}/
);

const model = schema.match(/model StreamerConnection \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.ok(model, "StreamerConnection model must exist");
assert.match(model, /id\s+String\s+@id @default\(uuid\(\)\) @db\.Char\(36\)/);
assert.match(model, /userId\s+Int\s+@map\("user_id"\)/);
assert.match(model, /platform\s+StreamerPlatform/);
assert.match(model, /platformUserId\s+String\s+@map\("platform_user_id"\) @db\.VarChar\(64\)/);
assert.match(model, /accessTokenEnc\s+String\?\s+@map\("access_token_enc"\) @db\.Text/);
assert.match(model, /refreshTokenEnc\s+String\?\s+@map\("refresh_token_enc"\) @db\.Text/);
assert.match(model, /tokenKeyVersion\s+Int\?\s+@map\("token_key_version"\)/);
assert.match(model, /status\s+StreamerConnectionStatus\s+@default\(active\)/);
assert.match(model, /statusReason\s+String\?\s+@map\("status_reason"\) @db\.VarChar\(32\)/);
assert.match(model, /onDelete: Cascade/);
assert.match(model, /@@unique\(\[platform, platformUserId\]\)/);
assert.match(model, /@@unique\(\[userId, platform\]\)/);
assert.match(model, /@@index\(\[status, lastUsedAt\]\)/);
assert.match(model, /@@map\("streamer_connections"\)/);
assert.doesNotMatch(model, /accessToken\s+String|refreshToken\s+String/, "tokens are stored encrypted only");

const userModel = schema.match(/model User \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.match(userModel, /streamerConnections\s+StreamerConnection\[\]/);
assert.match(schema, /model OAuthAccount \{/, "the login OAuth table stays untouched");

assert.ok(existsSync(migrationPath), "streamer_connections migration must be version controlled");
const migration = read(migrationPath);
assert.match(migration, /CREATE TABLE `streamer_connections`/);
assert.match(migration, /UNIQUE INDEX `streamer_connections_platform_platform_user_id_key`/);
assert.match(migration, /UNIQUE INDEX `streamer_connections_user_id_platform_key`/);
assert.match(migration, /FOREIGN KEY \(`user_id`\) REFERENCES `users`\(`id`\) ON DELETE CASCADE/);
assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE `oauth_accounts`/);

assert.match(read("package.json"), /"test:streamer-connection-foundation": "tsx scripts\/test-streamer-connection-foundation.ts"/);

// --- Task 7: streamer mode switch -------------------------------------------

assert.match(read("apps/web/src/lib/system-settings/schema.ts"), /streamerModeEnabled: z\.boolean\(\)\.default\(false\)/);
assert.match(read("apps/web/src/types/system-settings.ts"), /streamerModeEnabled: boolean;/);
assert.match(read("apps/web/src/app/admin/(dashboard)/system-settings/page.tsx"), /features\.streamerModeEnabled/);
assert.match(read("apps/web/src/app/api/admin/system-settings/route.ts"), /streamerModeEnabled: updatedSettings\.features\.streamerModeEnabled/);

// --- review 1/12: connect routes redirect to the public origin and set a hardened cookie

for (const routePath of ["apps/web/src/app/api/streamer/connect/[platform]/start/route.ts", "apps/web/src/app/api/streamer/connect/[platform]/callback/route.ts"]) {
    const route = read(routePath);
    assert.doesNotMatch(route, /NextResponse\.redirect\(new URL\([^)]*request\.nextUrl\.origin/, `${routePath} must not redirect to the bind address`);
    assert.match(route, /resolveConnectOrigin\(request\)/);
}
const startRoute = read("apps/web/src/app/api/streamer/connect/[platform]/start/route.ts");
for (const attribute of ["httpOnly: true", 'sameSite: "lax"', "path: CONNECT_STATE_COOKIE_PATH", 'secure: process.env.NODE_ENV === "production"']) {
    assert.ok(startRoute.includes(attribute), `start cookie must set ${attribute}`);
}

// --- Task 6: connections API routes ------------------------------------------

const disconnectRoute = read("apps/web/src/app/api/streamer/connections/[platform]/disconnect/route.ts").split("export async function POST")[1] ?? "";
assert.ok(disconnectRoute.indexOf("isTrustedStateChangeRequest(request)") < disconnectRoute.indexOf("getSessionUser()"), "origin check runs before the session lookup");
assert.ok(disconnectRoute.indexOf("getSessionUser()") < disconnectRoute.indexOf("consumeDistributedRequestRateLimit"), "rate limit after session");
assert.match(disconnectRoute, /bucket: "streamer-disconnect"/);
assert.match(disconnectRoute, /maxRequests: 5/);
assert.match(disconnectRoute, /STREAMER_CONNECTION_NOT_FOUND/);
const listRoute = read("apps/web/src/app/api/streamer/connections/route.ts");
assert.match(listRoute, /AUTH_REQUIRED/);
assert.doesNotMatch(listRoute + disconnectRoute, /TokenEnc|accessToken|refreshToken/, "routes never touch token columns");

// --- review 2: the systemd units must name jobs the wrapper script accepts -----

const wrapper = read("scripts/ops/run-payment-job.sh");
for (const unit of ["hushle-payment-webhook.service", "hushle-payment-reconciliation.service", "hushle-streamer-hygiene.service"]) {
    const job = /ExecStart=.*run-payment-job\.sh ([a-z-]+)/.exec(read(`infra/systemd/${unit}`))?.[1];
    assert.ok(job, `${unit} must run a job through run-payment-job.sh`);
    assert.ok(wrapper.includes(`  ${job})`), `run-payment-job.sh must accept ${job}`);
}
assert.match(wrapper, /STREAMER_HYGIENE_SCHEDULE_CONFIGURED/);
assert.match(read("scripts/ops/install-payment-schedulers.sh"), /ENABLE_STREAMER_HYGIENE/);

// --- Task 10: env examples, compose passthrough, CI, docs ----------------------

const STREAMER_ENV_NAMES = [
    "STREAMER_TWITCH_CLIENT_ID", "STREAMER_TWITCH_CLIENT_SECRET", "STREAMER_KICK_CLIENT_ID", "STREAMER_KICK_CLIENT_SECRET",
    "STREAMER_TOKEN_KEY", "STREAMER_TOKEN_KEY_VERSION", "STREAMER_TOKEN_KEY_PREVIOUS", "STREAMER_TOKEN_KEY_PREVIOUS_VERSION",
    "STREAMER_OAUTH_PUBLIC_ORIGIN", "STREAMER_FAKE_PLATFORM", "STREAMER_CONNECTION_DORMANT_DAYS", "STREAMER_HYGIENE_BATCH_SIZE", "STREAMER_HYGIENE_LEASE_TTL_MS",
];
const envExample = read(".env.example");
for (const name of STREAMER_ENV_NAMES) assert.ok(envExample.includes(name), `.env.example must document ${name}`);
const prodExample = read(".env.production.example");
for (const name of ["STREAMER_TWITCH_CLIENT_ID", "STREAMER_KICK_CLIENT_ID", "STREAMER_TOKEN_KEY", "STREAMER_OAUTH_PUBLIC_ORIGIN", "STREAMER_HYGIENE_SCHEDULE_CONFIGURED"]) {
    assert.ok(prodExample.includes(name), `.env.production.example must document ${name}`);
}
assert.doesNotMatch(prodExample, /STREAMER_FAKE_PLATFORM=1/);
const compose = read("docker-compose.yml");
const composeApp = compose.split(/\n  app:/)[1] ?? "";
const composeJobs = compose.split(/\n  jobs:/)[1]?.split(/\n  [a-z]+:/)[0] ?? "";
for (const block of [composeApp, composeJobs]) {
    for (const name of ["STREAMER_TOKEN_KEY", "STREAMER_TWITCH_CLIENT_SECRET", "STREAMER_KICK_CLIENT_SECRET"]) {
        assert.ok(block.includes(`${name}: \${${name}:-}`), `compose must pass ${name} to app and jobs`);
    }
}
const ci = read(".github/workflows/ci.yml");
for (const script of ["test:streamer-token-crypto", "test:streamer-platform-clients", "test:streamer-token-service", "test:streamer-connect-state", "test:streamer-connect-flow", "test:streamer-hygiene-job", "test:streamer-connection-foundation", "test:streamer-connection-store-integration", "test:streamer-connect-e2e"]) {
    assert.ok(ci.includes(`npm run ${script}`), `ci.yml must run ${script}`);
}
assert.match(ci, /STREAMER_FAKE_PLATFORM: "1"/);
assert.match(ci, /HUSHLE_E2E_SMOKE: "1"/);
assert.match(read("docs/stream/README.md"), /platform-connections-guide\.md/);
const guide = read("docs/stream/platform-connections-guide.md");
for (const needle of ["/api/streamer/connect/twitch/callback", "/api/streamer/connect/kick/callback", "openssl rand -base64 32", "STREAMER_TOKEN_KEY_PREVIOUS", "streamer-connection-hygiene", "revokeStreamerConnectionsForUser"]) {
    assert.ok(guide.includes(needle), `guide must mention ${needle}`);
}

console.log("PASS streamer connection foundation contract");
