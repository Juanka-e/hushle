import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

function listTypeScriptFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
        const absolutePath = join(directory, entry);
        if (statSync(absolutePath).isDirectory()) {
            return listTypeScriptFiles(absolutePath);
        }

        return /\.(?:ts|tsx)$/.test(entry) ? [absolutePath] : [];
    });
}

const forbiddenPlatformImports =
    /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:@prisma\/client|redis)["']/;

for (const directory of ["apps/api/src", "apps/web/src", "scripts"]) {
    for (const file of listTypeScriptFiles(join(root, directory))) {
        if (file === join(root, "scripts/test-package-boundaries.ts")) {
            continue;
        }

        const source = readFileSync(file, "utf8");
        assert.equal(
            forbiddenPlatformImports.test(source),
            false,
            `${relative(root, file)} must import through a platform package`
        );
    }
}

assert.match(
    readFileSync(join(root, "apps/web/src/lib/prisma.ts"), "utf8"),
    /@hushle\/platform-db/
);
assert.match(
    readFileSync(join(root, "apps/web/src/lib/redis.ts"), "utf8"),
    /@hushle\/platform-cache/
);

const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
assert.match(dockerfile, /apps\/api\/package\.json/);
assert.match(dockerfile, /apps\/jobs\/package\.json/);
assert.match(dockerfile, /packages\/api-contracts\/package\.json/);
assert.match(dockerfile, /packages\/auth-policy\/package\.json/);
assert.match(dockerfile, /packages\/domain-economy\/package\.json/);
assert.match(dockerfile, /packages\/domain-game\/package\.json/);
assert.match(dockerfile, /packages\/platform-auth\/package\.json/);
assert.match(dockerfile, /packages\/platform-cache\/package\.json/);
assert.match(dockerfile, /packages\/platform-db\/package\.json/);
assert.match(dockerfile, /packages\/platform-inventory\/package\.json/);
assert.match(dockerfile, /packages\/platform-observability\/package\.json/);
assert.match(dockerfile, /packages\/platform-player\/package\.json/);
assert.match(dockerfile, /packages\/platform-payments\/package\.json/);
assert.match(dockerfile, /packages\/platform-store\/package\.json/);
assert.match(dockerfile, /packages\/platform-wallet\/package\.json/);
assert.match(dockerfile, /apps\/web\/package\.json/);
assert.match(dockerfile, /SKIP_DATABASE_DURING_BUILD=true npm run build/);
assert.match(
    readFileSync(join(root, "package.json"), "utf8"),
    /"prebuild": "npm run db:generate"/
);
assert.match(
    readFileSync(join(root, "apps/web/package.json"), "utf8"),
    /"@hushle\/domain-game": "0\.1\.0"/
);
assert.match(
    readFileSync(join(root, "apps/jobs/package.json"), "utf8"),
    /"@hushle\/platform-db": "0\.1\.0"/
);
assert.match(
    readFileSync(join(root, "apps/api/package.json"), "utf8"),
    /"@hushle\/api-contracts": "0\.1\.0"/
);
assert.match(
    readFileSync(join(root, "apps/web/package.json"), "utf8"),
    /"@hushle\/platform-observability": "0\.1\.0"/
);
assert.match(
    readFileSync(join(root, "apps/web/package.json"), "utf8"),
    /"@hushle\/platform-payments": "0\.1\.0"/
);
assert.match(
    readFileSync(join(root, "packages/platform-payments/package.json"), "utf8"),
    /"@hushle\/domain-economy": "0\.1\.0"/
);
assert.match(
    readFileSync(join(root, "apps/web/package.json"), "utf8"),
    /"@hushle\/platform-wallet": "0\.1\.0"/
);
assert.match(
    readFileSync(join(root, "apps/api/package.json"), "utf8"),
    /"@hushle\/platform-observability": "0\.1\.0"/
);
assert.match(
    readFileSync(join(root, "apps/jobs/package.json"), "utf8"),
    /"@hushle\/platform-observability": "0\.1\.0"/
);

console.log("package boundary smoke test passed");
