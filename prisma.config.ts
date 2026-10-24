import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer reads .env. Local CLI commands keep picking DATABASE_URL up from it as
// with Prisma 6, but a variable already set in the environment (CI, tests, Docker) always wins.
if (existsSync(".env")) {
    for (const [key, value] of Object.entries(parseEnv(readFileSync(".env", "utf8")))) {
        process.env[key] ??= value;
    }
}

export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: { path: "prisma/migrations" },
    // `prisma generate` needs no connection, so the image build runs without DATABASE_URL;
    // Migrate commands then stop with Prisma's own error about the missing URL.
    datasource: { url: process.env.DATABASE_URL ?? "" },
});
