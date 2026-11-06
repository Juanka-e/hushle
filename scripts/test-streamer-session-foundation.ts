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

// The enum and JSON columns, exactly: a whole line each, in the schema and in the migration (a
// nullable column, another default, an extra attribute or another value list is a different line).
function enumColumnFailures(sessionModel: string, resultModel: string, migrationSql: string): string[] {
    const lines = (text: string) => text.split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, " "));
    const failures: string[] = [];
    const expect = (where: string, text: string, line: string) => {
        if (!lines(text).includes(line)) failures.push(`${where}: ${line}`);
    };
    expect("StreamSession", sessionModel, "platform StreamerPlatform");
    expect("StreamSession", sessionModel, "status StreamSessionStatus @default(active)");
    expect("StreamSession", sessionModel, "settings Json");
    expect("StreamRoundResult", resultModel, "outcome StreamRoundOutcome");
    expect("migration", migrationSql, "`platform` ENUM('twitch', 'kick') NOT NULL,");
    expect("migration", migrationSql, "`status` ENUM('active', 'ended', 'interrupted') NOT NULL DEFAULT 'active',");
    expect("migration", migrationSql, "`settings` JSON NOT NULL,");
    expect("migration", migrationSql, "`outcome` ENUM('solved', 'timeout', 'passed') NOT NULL,");
    return failures;
}
assert.deepEqual(enumColumnFailures(session, result, migration), [], "the enum and JSON columns are defined exactly");
for (const [label, mutate] of [
    ["a nullable platform", (s: string, r: string, m: string) => [s.replace(/platform(\s+)StreamerPlatform/, "platform$1StreamerPlatform?"), r, m]],
    ["a platform with a default", (s: string, r: string, m: string) => [s.replace(/platform(\s+)StreamerPlatform/, "platform$1StreamerPlatform @default(twitch)"), r, m]],
    ["a nullable settings column", (s: string, r: string, m: string) => [s.replace(/settings(\s+)Json/, "settings$1Json?"), r, m]],
    ["another status default", (s: string, r: string, m: string) => [s.replace("@default(active)", "@default(ended)"), r, m]],
    ["a nullable outcome", (s: string, r: string, m: string) => [s, r.replace(/outcome(\s+)StreamRoundOutcome/, "outcome$1StreamRoundOutcome?"), m]],
    ["a third platform in the migration", (s: string, r: string, m: string) => [s, r, m.replace("ENUM('twitch', 'kick')", "ENUM('twitch', 'kick', 'youtube')")]],
    ["a nullable platform in the migration", (s: string, r: string, m: string) => [s, r, m.replace("`platform` ENUM('twitch', 'kick') NOT NULL", "`platform` ENUM('twitch', 'kick') NULL")]],
    ["a nullable settings column in the migration", (s: string, r: string, m: string) => [s, r, m.replace("`settings` JSON NOT NULL", "`settings` JSON NULL")]],
    ["another status default in the migration", (s: string, r: string, m: string) => [s, r, m.replace("DEFAULT 'active'", "DEFAULT 'ended'")]],
    ["an outcome list without passed", (s: string, r: string, m: string) => [s, r, m.replace("ENUM('solved', 'timeout', 'passed')", "ENUM('solved', 'timeout')")]],
] as const) {
    const [s, r, m] = mutate(session, result, migration);
    assert.notDeepEqual(enumColumnFailures(s, r, m), [], `the column check refuses ${label}`);
}

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
        // The view-key limit is a shared constant (checked below with the socket path).
        ["viewKey", "", 0, ""],
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

    // One view-key limit for both paths: the HTTP route and streamer:host:rotate-key take the
    // same exported bucket, window and maximum, per user, so the two together stay within it.
    assert.match(
        read("apps/web/src/lib/streamer/view-key.ts"),
        /export const STREAMER_VIEW_KEY_LIMIT = \{ bucket: "streamer-view-key", windowMs: 15 \* 60_000, maxRequests: 10 \} as const;/,
        "view-key.ts must export the view-key rotation limit",
    );
    const streamerSocket = read("apps/web/src/lib/socket/streamer-socket.ts");
    // Any string that holds the bucket name counts, whatever its quotes (a template too); a comment does not.
    const spellsViewKeyBucket = (text: string) =>
        text
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
            .includes("streamer-view-key");
    for (const [label, spelt] of [
        ["double quotes", 'const bucket = "streamer-view-key";'],
        ["single quotes", "const bucket = 'streamer-view-key';"],
        ["a template", "const bucket = `streamer-view-key`;"],
        ["a template with a part", "const key = `${prefix}:streamer-view-key:${id}`;"],
    ] as const) {
        assert.ok(spellsViewKeyBucket(spelt), `the bucket check catches ${label}`);
    }
    assert.ok(!spellsViewKeyBucket("// the streamer-view-key bucket is shared\n/* streamer-view-key */ const x = 1;"), "a comment naming the bucket is no spelling");
    for (const [label, source] of [["view-key route", sources.viewKey], ["streamer socket", streamerSocket]]) {
        assert.match(source, /import \{[^}]*\bSTREAMER_VIEW_KEY_LIMIT\b[^}]*\} from "@\/lib\/streamer\/view-key";/, `${label} must import STREAMER_VIEW_KEY_LIMIT`);
        assert.ok(!spellsViewKeyBucket(source), `${label} must not spell the view-key bucket itself`);
    }
    const viewKeyPost = sources.viewKey.split("export async function POST")[1] ?? "";
    const viewKeyLimitAt = viewKeyPost.search(/consumeDistributedRequestRateLimit\(\{\s*\.\.\.STREAMER_VIEW_KEY_LIMIT,\s*key: `user:\$\{sessionUser\.id\}`,?\s*\}\)/);
    assert.ok(viewKeyLimitAt > viewKeyPost.indexOf("getSessionUser()"), "viewKey: session before the shared view-key limit");
    assert.ok(viewKeyLimitAt < viewKeyPost.indexOf("rotateViewKey("), "viewKey: the limit before the rotation");
    const rotateHandler = streamerSocket.split("hostAction(EVENTS.hostRotateKey")[1]?.split("handle(socket, EVENTS.publicJoin")[0] ?? "";
    const socketLimitAt = rotateHandler.indexOf("rateLimit({ ...STREAMER_VIEW_KEY_LIMIT, key: `user:${live.userId}` })");
    assert.ok(socketLimitAt >= 0, "streamer:host:rotate-key must consume the shared view-key limit per user");
    assert.ok(socketLimitAt < rotateHandler.indexOf("runtime.rotateViewKey("), "rotate-key: the limit before the rotation");

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
    // The package guards run in CI too, in the lint-typecheck job, each on a line of its own (not
    // commented out), after the job generated the Prisma client the package typecheck reads.
    const lintJob = ci.slice(ci.indexOf("\n  lint-typecheck:\n"), ci.indexOf("\n  build:\n"));
    assert.ok(lintJob.length > 0 && lintJob.includes(lintStep), "the streamer unit step belongs to the lint-typecheck job");
    for (const script of ["typecheck:packages", "test:package-boundaries", "test:socket-protocol-version"]) {
        assert.match(lintStep, new RegExp(`^ +npm run ${script}$`, "m"), `CI streamer unit step must run ${script}`);
        assert.ok(lintJob.indexOf("run: npx prisma generate") < lintJob.indexOf(`npm run ${script}`), `${script} runs after npx prisma generate`);
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
    // The numbers the guide gives operators, each as the code has it (line breaks folded).
    const section8 = guide.slice(guide.search(/^## 8\. /m)).replace(/\s+/g, " ");
    const section7 = guide.slice(guide.search(/^## 7\. /m), guide.search(/^## 8\. /m)).replace(/\s+/g, " ");
    for (const needle of [
        "Oturum oluşturma kullanıcı başına 15 dakikada 10",
        "Yenileme kullanıcı başına 15 dakikada 10 ile sınırlıdır; panel ve `POST /api/streamer/sessions/current/view-key` aynı kotayı paylaşır",
        "| Oturum açma | kullanıcı başına 15 dakikada 10 |",
        "| Anahtar yenileme | kullanıcı başına 15 dakikada 10 (panel ve HTTP ucu aynı kotayı paylaşır) |",
        "| Host olayları | soket başına 10 saniyede 10; host odasına katılmış sokette ayrıca kullanıcı başına 10 saniyede 10",
        "| Host odasına katılım | soket başına 10 saniyede 10 |",
        "| Yayın ekranına katılım | IP başına dakikada 30 |",
        "| test-guess (yalnız geliştirme) | kullanıcı başına dakikada 120 |",
        "| Sohbetten izlenen oyuncu | oturum başına en çok 2000 |",
        "katılımcı sayısı (`participants`) oturum boyunca tahmini kabul edilen kişi sayısıdır",
        "kesildiği andan itibaren 24 saat",
        "| `idle` | 6 saat boyunca etkinlik olmaz. |",
        "turun kabul ettiği tahminlerdir (yanlış ya da doğru)",
        "sunucu anahtarı 15 saniyede bir okur ve okunan değeri 5 saniye saklar; kapalı okununca bütün canlı oturumlar en geç yaklaşık 20 saniye içinde `stopped` ile biter",
        "canlı oturumu `stopped` ile biter. Bitiş en çok 10 saniye beklenir (son çare sınırı 21 saniye)",
        "| `interrupted` | Sunucu düzgün kapanır (deploy, `SIGTERM` / `SIGINT`). | `interrupted` |",
        "bekleyen işlemler en çok 10 saniye beklenir",
        "açıldığı kanal bağlantısı saatte bir doğrulanır",
        "30 sn, 60 sn, 120 sn, sonra her 300 sn'de bir",
        "kelime havuzu 10 saniyede cevap vermezse",
        "Çıkış cihaz başınadır",
        "Anahtar canlı oturumlara geriye dönük uygulanmaz",
        "`/stream/••••••`",
        "Maskeli alan seçilemez ve sürüklenemez",
        "Kartı gizle",
        "Yeni sekmede önizle",
        "desen ölçeği 8–42 px, hareket süresi 1800–12000 ms, parlama bulanıklığı 8–56; desen, parlama ve kaplama opaklığı en çok 0,42, 0,36 ve 0,45",
        "en çok 2048 karakter; ad en çok 60 karakterdir",
        "Anahtar adresin yolunda durur",
    ]) {
        assert.ok(section8.includes(needle), `guide section 8 must say: ${needle}`);
    }
    for (const needle of [
        "state'in sha256 özeti 10 dakikalığına kaydedilir",
        "Redis'te (`SET NX PX`), değilse süreç belleğindedir (en çok 10 000 kayıt)",
        "Token yenileme karşılaştır-ve-yaz ile yapılır",
        "aynı bağlantı için aynı anda tek platform yenilemesi çalışır",
        "başka bir kanala yeniden bağlandıysa",
    ]) {
        assert.ok(section7.includes(needle), `guide section 7 must say: ${needle}`);
    }
    for (const outdated of ["sunucu tarafında kullanılmış state kaydı yok", "2. aşamada refresh token üzerinden", "2. aşamada uygulanacak", "10 saniyede 10 ile sınırlıdır. Yayın"]) {
        assert.ok(!guide.replace(/\s+/g, " ").includes(outdated), `the guide no longer says: ${outdated}`);
    }
    const readme = read("docs/stream/README.md");
    assert.ok(readme.includes("platform-connections-guide.md#8-yayın-oturumu-ve-obs"), "stream README links the phase-2 guide section");
    const phase2Line = readme.split(/\r?\n/).find((line) => line.includes("#8-yayın-oturumu-ve-obs")) ?? "";
    for (const topic of ["kapanma nedenleri", "acil durdurma", "saatlik kanal doğrulaması", "sınırlar"]) {
        assert.ok(phase2Line.includes(topic), `the stream README's phase-2 line names ${topic}`);
    }
    assert.ok(readme.includes("2026-11-05-streamer-session-and-screens-design.md"), "stream README links the phase-2 spec");
    assert.ok(readme.includes("2026-11-05-streamer-session-and-screens.md"), "stream README links the phase-2 plan");

    const socketDocs = read("docs/socket-events.md");
    assert.ok(socketDocs.includes("`streamer:ended`") && socketDocs.includes('"view-key-rotated"') && socketDocs.includes('"idle"'));
}

// --- Gap batch 1a: persistence off the action queue, invalid_settings ----------

{
    const runtimePath = "apps/web/src/lib/streamer/session-runtime.ts";
    const persistencePath = "apps/web/src/lib/streamer/session-persistence.ts";
    const runtimeSource = read(runtimePath);
    assert.ok(existsSync(persistencePath), "the persistence chain has its own module");
    const runtimeLines = runtimeSource.split(/\r?\n/).length;
    assert.ok(runtimeLines < 450, `session-runtime.ts stays well below 500 lines (${runtimeLines})`);
    // Every store write of the runtime goes through the per-session chain; none is awaited on the action queue.
    assert.doesNotMatch(runtimeSource, /await\s+deps\.store\./, "the runtime never awaits a store write itself");
    assert.match(read(persistencePath), /export const STREAM_PERSIST_DRAIN_TIMEOUT_MS = 10_000;/);
    // A patch the runtime refuses is a plain invalid request on both paths.
    assert.match(read("apps/web/src/lib/streamer/session-http.ts"), /invalid_settings: \{ code: PlayerErrorCode\.INVALID_REQUEST, status: 400 \}/);
    assert.match(read("apps/web/src/lib/socket/streamer-socket.ts"), /invalid_settings: PlayerErrorCode\.INVALID_REQUEST,/);
}

// --- Gap batch 1b: the order of the checks on every state-changing session route ----

{
    const routeBase = "apps/web/src/app/api/streamer/sessions";
    // Comments are dropped first: only real calls count, a comment naming a check proves nothing.
    const codeOf = (path: string) =>
        read(path)
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    const postOf = (path: string) => {
        const post = codeOf(path).split("export async function POST")[1];
        assert.ok(post, `${path} must export POST`);
        return post;
    };
    const ORIGIN = "isTrustedStateChangeRequest(request)";
    const AUTH = "await getSessionUser()";
    const ACTIVE = 'sessionUser.accountStatus !== "active"';
    const MODE = "(await getSystemSettings()).features.streamerModeEnabled";
    const MODE_REFUSED = "PlayerErrorCode.STREAMER_MODE_DISABLED";
    const LIMIT = "consumeDistributedRequestRateLimit(";
    // Each step's first appearance comes after the previous step's: nothing runs out of order.
    const inOrder = (label: string, post: string, steps: Array<[string, string]>) => {
        let previous = -1;
        let previousName = "the start of POST";
        for (const [name, needle] of steps) {
            const at = post.indexOf(needle);
            assert.ok(at >= 0, `${label}: ${name} (${needle}) must be called`);
            assert.ok(at > previous, `${label}: ${name} must come after ${previousName}`);
            previous = at;
            previousName = name;
        }
    };
    const gated: Array<[string, string, string]> = [
        ["POST /sessions", `${routeBase}/route.ts`, "createSession("],
        ["POST /sessions/current/view-key", `${routeBase}/current/view-key/route.ts`, "rotateViewKey("],
        ["POST /sessions/current/test-guess", `${routeBase}/current/test-guess/route.ts`, "runtime.guess("],
    ];
    for (const [label, path, work] of gated) {
        inOrder(label, postOf(path), [
            ["the origin check", ORIGIN],
            ["the session user", AUTH],
            ["the active-account check", ACTIVE],
            ["the streamer-mode check", MODE],
            ["the streamer-mode refusal", MODE_REFUSED],
            ["the rate limit", LIMIT],
            ["the work", work],
        ]);
    }
    // test-guess answers a bare 404 before anything else while the fake platform is off, so a
    // production server never reveals the route.
    const testGuess = postOf(`${routeBase}/current/test-guess/route.ts`);
    assert.match(
        testGuess,
        /^\([^)]*\)\s*\{\s*if \(!isFakeStreamerPlatformEnabled\(\)\) \{\s*return new NextResponse\(null, \{ status: 404 \}\);\s*\}/,
        "test-guess: the fake-platform gate is the first statement and answers a bare 404",
    );
    assert.ok(testGuess.indexOf("isFakeStreamerPlatformEnabled()") < testGuess.indexOf(ORIGIN), "test-guess: the fake gate before the origin check");
    // Ending: origin, a signed-in owner, the work; no account-status, mode or quota gate (any
    // signed-in owner may always stop their own stream), and the answer is the end call's own.
    const end = postOf(`${routeBase}/current/end/route.ts`);
    inOrder("POST /sessions/current/end", end, [
        ["the origin check", ORIGIN],
        ["the session user", AUTH],
        ["the work", "endCurrent("],
    ]);
    for (const [name, needle] of [["an active-account check", "accountStatus"], ["a streamer-mode check", "getSystemSettings"], ["a rate limit", LIMIT], ["a read-back of the row", "findById("]]) {
        assert.ok(!end.includes(needle), `POST /sessions/current/end must not have ${name}`);
    }
    assert.match(read(`${routeBase}/current/end/route.ts`), /always\s+(?:\/\/\s*)?safe/, "end explains in a comment why it has no account gate");
}

// --- Gap batch 2: the leak guard, the session lifecycle --------------------------

{
    const socketSource = read("apps/web/src/lib/socket/streamer-socket.ts");
    // The guard has its own module; the socket layer imports it and keeps no copy.
    const guardSource = read("apps/web/src/lib/socket/streamer-leak-guard.ts");
    assert.match(socketSource, /^import \{ assertNoSecret, StreamerSecretLeakError \} from "\.\/streamer-leak-guard";$/m, "the socket layer imports the guard");
    for (const own of ["export function assertNoSecret(", "class StreamerSecretLeakError", "const KNOWN_KEYS", "function eachString("]) {
        assert.ok(guardSource.includes(own), `the guard module has ${own}`);
        assert.ok(!socketSource.includes(own), `streamer-socket.ts keeps no ${own}`);
    }
    // Every fixed vocabulary the guard skips is an exhaustive record of its union: a new member
    // (a theme, a clock, a pattern...) fails tsc until the guard lists it.
    for (const union of [
        'PublicStreamSnapshot["type"]',
        "StreamPhase",
        "BroadcastTheme",
        "CameraSlot",
        "CameraSize",
        "ClockStyle",
        'PublicStreamSnapshot["pack"]',
        "ChannelPlatform",
        "CosmeticPattern",
        "CosmeticMotionPreset",
        "Extract<keyof ResolvedCardThemeLike, `${string}Color`>",
        // The projection keys that are never compared.
        "keyof Snapshot",
        "keyof PassedCard",
        "keyof Snapshot[\"scores\"][number]",
        "keyof LastCorrect",
        "keyof NonNullable<Snapshot[\"channel\"]>",
        "keyof StreamCardBack",
        "keyof ResolvedCardThemeLike",
        "keyof NonNullable<Snapshot[\"reveal\"]>",
    ]) {
        assert.ok(guardSource.includes(`: Record<${union}, true> = {`), `the leak guard's ${union} list is an exhaustive Record<${union}, true>`);
    }
    assert.ok(!/readonly string\[\]>\(\[/.test(guardSource), "no hand-written vocabulary list is left in the guard");

    // Comments are dropped: only real calls count.
    const code = (path: string) =>
        read(path)
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    // Shutdown ends the live sessions (streamer:ended "interrupted" to both rooms) before Socket.IO closes.
    const server = code("apps/web/server-runtime.ts");
    const shutdown = server.split("const shutdown = async () => {")[1]?.split("process.on(")[0] ?? "";
    const stopAt = shutdown.indexOf("await streamerSessionRuntime.stop();");
    assert.ok(stopAt >= 0, "shutdown stops the stream session runtime");
    assert.ok(stopAt < shutdown.indexOf("io.close("), "shutdown stops the stream sessions before io.close, so the rooms hear interrupted");
    assert.equal(shutdown.split("streamerSessionRuntime.stop()").length, 2, "and only once");
    // The kill switch starts with the runtime; the hourly link check is wired into it.
    const deps = code("apps/web/src/lib/streamer/session-deps.ts");
    const boot = deps.split("export async function startStreamerSessionRuntime")[1] ?? "";
    assert.match(boot, /runtime\.watchMode\(getStreamerModeState\);/, "boot starts the streamer-mode watch on the authoritative read");
    // The authoritative read asks the stored features row (normalized as the settings service does),
    // never the cached settings service, which falls back to "off" while the database is away.
    const modeSource = code("apps/web/src/lib/streamer/streamer-mode.ts");
    assert.match(modeSource, /prisma\.systemSetting\.findUnique\(\{ where: \{ key: "features" \}/);
    assert.match(modeSource, /normalizeSystemSettings\(/);
    assert.ok(!modeSource.includes("getSystemSettings"), "streamer-mode.ts never reads the cached settings service");
    assert.match(socketSource, /return \(await readMode\(\)\) !== "off";/, "the socket refuses on an authoritative off only");
    assert.ok(!deps.includes("streamerModeEnabled"), "session-deps no longer reads the cached switch");
    assert.match(deps.split("export function getStreamerSessionRuntime")[1] ?? "", /checkConnection: checkLiveConnection,/, "the runtime checks each live link hourly");
    // An admin suspension revokes the links, then takes the owner's stream off the air (bounded),
    // then writes its audit: a stuck stream never holds the revoke, and the audit only the bound.
    const moderation = code("apps/web/src/app/api/admin/users/[id]/moderation/route.ts");
    const suspend = moderation.split('if (action.actionType === "suspend") {').slice(1).join("");
    const endAt = suspend.indexOf("await endStreamerSessionsForUser(targetUserId);");
    const revokeAt = suspend.indexOf("await revokeStreamerConnectionsForUser(targetUserId, request);");
    assert.ok(endAt >= 0, "a suspension ends the user's live stream session");
    assert.ok(revokeAt >= 0 && revokeAt < endAt, "after the links are revoked");
    assert.ok(endAt < suspend.indexOf("await writeAuditLog("), "and before the audit");
    assert.match(moderation, /import \{ endStreamerSessionsForUser \} from "@\/lib\/streamer\/session-account";/);

    // docs/socket-events.md names every reason, the notice, the limits and the mode-off answers.
    const docs = read("docs/socket-events.md");
    const row = (event: string, room: string) => docs.split(/\r?\n/).find((line) => line.startsWith(`| \`${event}\` | ${room} |`)) ?? "";
    const ended = row("streamer:ended", "host and public");
    for (const reason of ['"ended"', '"idle"', '"interrupted"', '"stopped"']) assert.ok(ended.includes(reason), `the streamer:ended row lists ${reason}`);
    assert.ok(row("streamer:ended", "public").includes('"view-key-rotated"'));
    const notice = row("streamer:host:notice", "host");
    assert.ok(notice.includes('"connection-needs-reconnect"') && notice.includes("hourly"), "the host notice has its row");
    const rotate = docs.split(/\r?\n/).find((line) => line.startsWith("| `streamer:host:rotate-key` |")) ?? "";
    assert.ok(rotate.includes("`streamer-view-key`") && rotate.includes("10 / 15 min") && rotate.includes("per user") && rotate.includes("SERVER_BUSY"), "rotate-key names the shared per-user bucket and the busy answer");
    assert.ok(docs.includes("10 per 10 s per socket and, once the socket joined a host room, 10 per 10 s per user"), "host actions are limited per socket and per user");
    // A word draw is bounded (STREAM_DRAW_TIMEOUT_MS): start, pass and next can answer SERVER_BUSY.
    const actions = docs.split(/\r?\n/).find((line) => line.startsWith("| `streamer:host:start`, ")) ?? "";
    assert.ok(actions.includes("`SERVER_BUSY` (start, pass, next: the word draw did not answer within 10 s; nothing changed, try again)"), "the host actions row names the bounded draw");
    assert.match(read("apps/web/src/lib/streamer/session-draw.ts"), /export const STREAM_DRAW_TIMEOUT_MS = 10_000;/);
    assert.ok(docs.includes("`STREAMER_MODE_DISABLED`") && docs.includes("opaque `STREAMER_VIEW_KEY_INVALID`"), "the mode-off refusals are documented");
    assert.ok(!docs.includes("does\r\nnot send it yet") && !docs.includes("not send it yet"), "the old interrupted note is gone");
}

console.log("PASS streamer session foundation contract");
