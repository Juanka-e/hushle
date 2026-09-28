import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const baselinePath = "prisma/migrations/20260731000000_baseline/migration.sql";
const packageJson = read("package.json");
const compose = read("docker-compose.yml");
const deployScript = read("scripts/ops/deploy.sh");
const baselineScript = read("scripts/baseline-existing-database.ts");
const ciWorkflow = read(".github/workflows/ci.yml");

assert.ok(
  existsSync(baselinePath),
  "baseline migration must be version controlled",
);
assert.match(read(baselinePath), /CREATE TABLE `users`/);
assert.match(
  read("prisma/migrations/migration_lock.toml"),
  /provider = "mysql"/,
);

assert.match(packageJson, /"db:push:local": "npx prisma db push/);
assert.match(packageJson, /"db:migrate:deploy": "npx prisma migrate deploy"/);
assert.match(packageJson, /"db:migrate:baseline:existing"/);
assert.match(baselineScript, /I_HAVE_A_VERIFIED_BACKUP/);
assert.match(baselineScript, /--from-schema-datasource/);
assert.match(baselineScript, /--exit-code/);
assert.match(baselineScript, /migrate[\s\S]*resolve[\s\S]*--applied/);

const migrationService =
  compose.match(/\n  migrate:[\s\S]*?\n  app:/)?.[0] ?? "";
assert.match(migrationService, /profiles: \["migration"\]/);
assert.match(
  migrationService,
  /command: \["npm", "run", "db:migrate:deploy"\]/,
);
assert.match(deployScript, /--profile migration/);
assert.match(deployScript, /run --rm migrate/);
assert.doesNotMatch(deployScript, /prisma\s+db\s+push/);
assert.match(ciWorkflow, /npx prisma migrate deploy/);
assert.doesNotMatch(ciWorkflow, /npx prisma db push/);

console.log("Prisma migration contract checks passed.");
