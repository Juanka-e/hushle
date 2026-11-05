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

console.log("PASS streamer session foundation contract");
