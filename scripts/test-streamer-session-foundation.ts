import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// Static contract checks for the streamer session foundation (stream_sessions, stream_round_results).
// Each later task of the plan appends its own section here.

function read(path: string): string {
    return readFileSync(path, "utf8");
}

const schema = read("prisma/schema.prisma");
const migrationPath = "prisma/migrations/20261106120000_stream_sessions/migration.sql";

// --- Task 3: schema and migration -------------------------------------------

assert.match(schema, /enum StreamSessionStatus \{\r?\n\s+active\r?\n\s+ended\r?\n\s+interrupted\r?\n\}/);
assert.match(schema, /enum StreamRoundOutcome \{\r?\n\s+solved\r?\n\s+timeout\r?\n\s+passed\r?\n\}/);

const session = schema.match(/model StreamSession \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.ok(session, "StreamSession model must exist");
assert.match(session, /id\s+String\s+@id @default\(uuid\(\)\) @db\.Char\(36\)/);
assert.match(session, /userId\s+Int\s+@map\("user_id"\)/);
assert.match(session, /connectionId\s+String\?\s+@map\("connection_id"\) @db\.Char\(36\)/);
assert.match(session, /platform\s+StreamerPlatform/);
assert.match(session, /status\s+StreamSessionStatus\s+@default\(active\)/);
assert.match(session, /settings\s+Json/);
assert.match(session, /viewKeyHash\s+String\s+@map\("view_key_hash"\) @db\.Char\(64\)/);
assert.match(session, /startedAt\s+DateTime\s+@default\(now\(\)\) @map\("started_at"\)/);
assert.match(session, /endedAt\s+DateTime\?\s+@map\("ended_at"\)/);
assert.match(session, /roundCount\s+Int\s+@default\(0\) @map\("round_count"\)/);
assert.match(session, /summary\s+Json\?/);
assert.match(session, /createdAt\s+DateTime\s+@default\(now\(\)\) @map\("created_at"\)/);
assert.match(session, /updatedAt\s+DateTime\s+@updatedAt @map\("updated_at"\)/);
assert.match(session, /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/);
assert.match(session, /connection\s+StreamerConnection\?\s+@relation\(fields: \[connectionId\], references: \[id\], onDelete: SetNull\)/);
assert.match(session, /results\s+StreamRoundResult\[\]/);
assert.match(session, /@@unique\(\[viewKeyHash\]\)/);
assert.match(session, /@@index\(\[userId, status\]\)/);
assert.match(session, /@@map\("stream_sessions"\)/);

const result = schema.match(/model StreamRoundResult \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.ok(result, "StreamRoundResult model must exist");
assert.match(result, /id\s+Int\s+@id @default\(autoincrement\(\)\)/);
assert.match(result, /sessionId\s+String\s+@map\("session_id"\) @db\.Char\(36\)/);
assert.match(result, /round\s+Int\b/);
assert.match(result, /wordId\s+Int\?\s+@map\("word_id"\)/);
assert.match(result, /outcome\s+StreamRoundOutcome/);
assert.match(result, /winnerPlatformUserId\s+String\?\s+@map\("winner_platform_user_id"\) @db\.VarChar\(64\)/);
assert.match(result, /winnerName\s+String\?\s+@map\("winner_name"\) @db\.VarChar\(100\)/);
assert.match(result, /solveMs\s+Int\?\s+@map\("solve_ms"\)/);
assert.match(result, /startedAt\s+DateTime\s+@map\("started_at"\)/);
assert.match(result, /endedAt\s+DateTime\s+@map\("ended_at"\)/);
assert.match(result, /onDelete: Cascade/);
assert.match(result, /@@unique\(\[sessionId, round\]\)/);
assert.match(result, /@@map\("stream_round_results"\)/);

const userModel = schema.match(/model User \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.match(userModel, /streamSessions\s+StreamSession\[\]/);
const connectionModel = schema.match(/model StreamerConnection \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.match(connectionModel, /sessions\s+StreamSession\[\]/);
assert.match(schema, /model OAuthAccount \{/, "the login OAuth table stays untouched");

assert.ok(existsSync(migrationPath), "stream_sessions migration must be version controlled");
const migration = read(migrationPath);
assert.match(migration, /CREATE TABLE `stream_sessions`/);
assert.match(migration, /CREATE TABLE `stream_round_results`/);
assert.match(migration, /UNIQUE INDEX `stream_sessions_view_key_hash_key`/);
assert.match(migration, /UNIQUE INDEX `stream_round_results_session_id_round_key`/);
assert.match(migration, /INDEX `stream_sessions_user_id_status_idx`/);
assert.match(migration, /FOREIGN KEY \(`user_id`\) REFERENCES `users`\(`id`\) ON DELETE CASCADE/);
assert.match(migration, /FOREIGN KEY \(`connection_id`\) REFERENCES `streamer_connections`\(`id`\) ON DELETE SET NULL/);
assert.match(migration, /FOREIGN KEY \(`session_id`\) REFERENCES `stream_sessions`\(`id`\) ON DELETE CASCADE/);
assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE `oauth_accounts`/);

assert.match(read("package.json"), /"test:streamer-session-foundation": "tsx scripts\/test-streamer-session-foundation.ts"/);

// --- Task 5: HTTP routes ----------------------------------------------------

{
    const base = "apps/web/src/app/api/streamer/sessions";
    const routeFiles = {
        collection: `${base}/route.ts`,
        end: `${base}/current/end/route.ts`,
        viewKey: `${base}/current/view-key/route.ts`,
        testGuess: `${base}/current/test-guess/route.ts`,
    };
    const sources: Record<string, string> = {};
    for (const [name, path] of Object.entries(routeFiles)) {
        assert.ok(existsSync(path), `${path} must exist`);
        sources[name] = read(path);
        assert.match(sources[name], /export const dynamic = "force-dynamic"/, `${name} route must be force-dynamic`);
        assert.doesNotMatch(sources[name], /instanceof StreamerSessionError/, `${name} route must use isStreamerSessionError`);
    }

    const postRoutes: Array<[string, string, number, string]> = [
        ["collection", "streamer-session-create", 10, "15 * 60_000"],
        ["end", "", 0, ""],
        ["viewKey", "streamer-view-key", 10, "15 * 60_000"],
        ["testGuess", "streamer-test-guess", 120, "60_000"],
    ];
    for (const [name, bucket, max, windowMs] of postRoutes) {
        const post = sources[name].split("export async function POST")[1];
        assert.ok(post, `${name} route must export POST`);
        const origin = post.indexOf("isTrustedStateChangeRequest(request)");
        const sessionAt = post.indexOf("getSessionUser()");
        assert.ok(origin >= 0 && origin < sessionAt, `${name}: origin check before session`);
        if (bucket) {
            const limitAt = post.indexOf(`bucket: "${bucket}"`);
            assert.ok(sessionAt < limitAt, `${name}: session before rate limit bucket ${bucket}`);
            assert.match(post, new RegExp(`maxRequests: ${max},`), `${name}: ${max} requests`);
            assert.ok(post.includes(`windowMs: ${windowMs}`), `${name}: window ${windowMs}`);
        }
    }

    assert.match(sources.testGuess, /isFakeStreamerPlatformEnabled/);
    assert.match(sources.collection, /STREAMER_MODE_DISABLED/);

    const get = sources.collection.split("export async function GET")[1]?.split("export async function POST")[0] ?? sources.collection.split("export async function GET")[1];
    assert.ok(get, "collection route must export GET");
    for (const forbidden of ["viewKeyHash", "target", "taboos"]) {
        assert.ok(!get.includes(forbidden), `GET must never touch ${forbidden}`);
    }

    const http = read("apps/web/src/lib/streamer/session-http.ts");
    for (const code of [
        "STREAMER_SESSION_ACTIVE",
        "STREAMER_CONNECTION_REQUIRED",
        "STREAMER_SESSION_NOT_FOUND",
        "STREAMER_ACTION_INVALID_PHASE",
        "STREAMER_WORD_POOL_EMPTY",
        "STREAMER_CARD_NOT_ALLOWED",
        "STREAMER_CARD_CATALOGUE_UNAVAILABLE",
    ]) {
        assert.ok(http.includes(code), `session-http must map ${code}`);
        assert.ok(read("apps/web/src/lib/errors/player-error-codes.ts").includes(`${code}:`), `${code} must be a player error code`);
    }
    assert.ok(existsSync("apps/web/src/types/streamer-session.ts"));
}

// --- Task 9: scripts, CI and docs wiring ------------------------------------

{
    const pkg = read("package.json");
    for (const [name, command] of [
        ["test:stream-screen", "tsx scripts/test-stream-screen.ts"],
        ["test:streamer-panel", "tsx scripts/test-streamer-panel.ts"],
        ["test:streamer-stream-screen-e2e", "playwright test --workers=1 tests/streamer-stream-screen.spec.ts"],
        ["test:streamer-session-e2e", "playwright test --workers=1 tests/streamer-session.spec.ts"],
    ] as const) {
        assert.ok(pkg.includes(`"${name}": "${command}"`), `package.json must define ${name}`);
    }

    // A step is the text from its "- name:" line up to the next blank line.
    const ci = read(".github/workflows/ci.yml").replace(/\r\n/g, "\n");
    const stepOf = (title: string): string => ci.split(`- name: ${title}`)[1]?.split("\n\n")[0] ?? "";
    const lintStep = stepOf("Test streamer platform connections");
    for (const script of [
        "test:domain-streamer",
        "test:streamer-session-service",
        "test:streamer-card-backs",
        "test:streamer-session-foundation",
        "test:streamer-socket-integration",
        "test:stream-screen",
        "test:streamer-panel",
    ]) {
        assert.ok(lintStep.includes(`npm run ${script}`), `CI streamer unit step must run ${script}`);
    }
    const storeStep = stepOf("Test streamer session store against MySQL");
    assert.match(storeStep, /npm run test:streamer-session-store-integration/);
    assert.match(storeStep, /STREAMER_INTEGRATION_DATABASE_URL: "mysql:\/\/root:root@localhost:3306\/tabu_test"/);
    for (const [title, script] of [
        ["Test streamer stream screen UI", "test:streamer-stream-screen-e2e"],
        ["Test streamer session UI", "test:streamer-session-e2e"],
    ]) {
        const step = stepOf(title);
        assert.ok(step.includes(`npm run ${script}`), `CI must run ${script}`);
        for (const line of ['STREAMER_FAKE_PLATFORM: "1"', 'HUSHLE_E2E_SMOKE: "1"', "STREAMER_TOKEN_KEY:", "PLAYWRIGHT_REDIS_URL:"]) {
            assert.ok(step.includes(line), `${script} step needs ${line}`);
        }
    }
    const order = ["Test streamer channel linking UI", "Test streamer stream screen UI", "Test streamer session UI"].map((t) => ci.indexOf(`- name: ${t}`));
    assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], "the three streamer e2e steps run consecutively in order");
    assert.ok(!ci.slice(order[0], order[2]).includes("- name: Test notification list locale"), "no unrelated step between the streamer e2e steps");
    assert.ok(read("package.json").includes("playwright test --workers=1 tests/streamer-connect.spec.ts"), "the connect spec also runs single-worker");

    const guide = read("docs/stream/platform-connections-guide.md");
    assert.match(guide, /^## 8\. Yayın oturumu ve OBS\r?$/m);
    for (const needle of [
        "streamerModeEnabled",
        "/stream/<görüntüleme-anahtarı>",
        "?layout=half",
        "?overlay=top",
        "?overlay=bottom",
        "1920×1080",
        "960×1080",
        "1920×220",
        "1080p",
        "720p",
        "1370, 70",
        "913, 47",
        "Anahtarı yenile",
        "interrupted",
        "6 saat",
        "streamerShowcaseAllCosmetics",
        "STREAMER_FAKE_PLATFORM",
        "test-guess",
        "yalnız geliştirme",
        "sha256",
        "view-key-rotated",
        "test:streamer-stream-screen-e2e",
        "test:streamer-session-e2e",
    ]) {
        assert.ok(guide.includes(needle), `guide section 8 must mention ${needle}`);
    }
    const readme = read("docs/stream/README.md");
    assert.ok(readme.includes("platform-connections-guide.md#8-yayın-oturumu-ve-obs"), "stream README links the phase-2 guide section");
    assert.ok(readme.includes("2026-11-05-streamer-session-and-screens-design.md"), "stream README links the phase-2 spec");
    assert.ok(readme.includes("2026-11-05-streamer-session-and-screens.md"), "stream README links the phase-2 plan");

    const socketDocs = read("docs/socket-events.md");
    assert.ok(socketDocs.includes("`streamer:ended`") && socketDocs.includes('"view-key-rotated"') && socketDocs.includes('"idle"'));
}

console.log("PASS streamer session foundation contract");
