import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
// The light gate is imported first and alone: what it loads is checked below.
import { isFakePlatformEnabled as fakeGate } from "@hushle/platform-streamer/fake-gate";

const root = process.cwd();

// @hushle/platform-streamer/fake-gate: only the fake-platform switch, without the platform
// clients or the connection store (and so without Prisma), for callers such as the /stream page.
{
    const streamerSource = join(root, "packages/platform-streamer/src");
    const loaded = Object.keys(require.cache).filter((file) => file.startsWith(streamerSource));
    assert.deepEqual(
        loaded.map((file) => relative(streamerSource, file)),
        ["fake-gate.ts"],
        "importing the fake gate loads no other platform-streamer module",
    );
    const gateSource = readFileSync(join(streamerSource, "fake-gate.ts"), "utf8");
    assert.doesNotMatch(gateSource, /^\s*import\b|\bimport\s*\(|\brequire\s*\(|^\s*export\s[^\n]*\bfrom\b/m, "the fake gate imports nothing");
    assert.deepEqual(
        [...gateSource.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((match) => match[1]),
        ["isFakePlatformEnabled"],
        "the fake gate exports only isFakePlatformEnabled",
    );
    const exportsMap = (JSON.parse(readFileSync(join(root, "packages/platform-streamer/package.json"), "utf8")) as { exports: Record<string, unknown> }).exports;
    assert.deepEqual(exportsMap["."], { types: "./src/index.ts", default: "./src/index.ts" }, "the root export stays");
    assert.deepEqual(exportsMap["./fake-gate"], { types: "./src/fake-gate.ts", default: "./src/fake-gate.ts" });
    // The root entry re-exports the same gate, so existing imports keep working.
    assert.match(readFileSync(join(streamerSource, "index.ts"), "utf8"), /export \{ isFakePlatformEnabled \} from "\.\/fake-gate";/);
    assert.match(readFileSync(join(streamerSource, "client-factory.ts"), "utf8"), /import \{ isFakePlatformEnabled \} from "\.\/fake-gate";/);
    assert.doesNotMatch(readFileSync(join(streamerSource, "client-factory.ts"), "utf8"), /function isFakePlatformEnabled/, "one definition only");
    assert.equal(fakeGate({ STREAMER_FAKE_PLATFORM: "1", NODE_ENV: "test" }), true);
    assert.equal(fakeGate({ STREAMER_FAKE_PLATFORM: "1", NODE_ENV: "production" }), false);
    assert.equal(fakeGate({ STREAMER_FAKE_PLATFORM: "1", NODE_ENV: "production", HUSHLE_E2E_SMOKE: "1" }), true);
    assert.equal(fakeGate({ NODE_ENV: "production", HUSHLE_E2E_SMOKE: "1" }), false);
}

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

// The custom server and the Next route bundles each load @hushle/platform-streamer, so its error
// classes exist twice at run time: the apps check them with the package's brand guards, never with
// `instanceof` (which fails for an error built by the other copy).
{
    const streamerErrorInstanceof = /\binstanceof\s+(?:StreamerConfigError|StreamerPlatformError|StreamerReconnectRequired|TokenDecryptError)\b/;
    const offenders = ["apps/web/src", "apps/jobs/src"].flatMap((directory) =>
        listTypeScriptFiles(join(root, directory))
            .filter((file) => streamerErrorInstanceof.test(readFileSync(file, "utf8")))
            .map((file) => relative(root, file))
    );
    assert.deepEqual(offenders, [], "the apps check platform-streamer errors with the is… guards");
    const streamerIndexLines = readFileSync(join(root, "packages/platform-streamer/src/index.ts"), "utf8").split(/\r?\n/).map((line) => line.trim());
    for (const guard of ["isStreamerConfigError", "isTokenDecryptError", "isStreamerPlatformError", "isStreamerReconnectRequired"]) {
        assert.ok(streamerIndexLines.includes(`${guard},`), `the package root exports ${guard}`);
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

// `npm run typecheck:packages` checks every package that has a tsconfig of its own.
{
    const scripts = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    const steps = scripts["typecheck:packages"].split(" && ");
    for (const name of readdirSync(join(root, "packages")).filter((entry) => existsSync(join(root, "packages", entry, "tsconfig.json")))) {
        assert.ok(steps.includes(`tsc -p packages/${name}/tsconfig.json`), `typecheck:packages must check packages/${name}`);
    }
}

const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
assert.match(dockerfile, /apps\/api\/package\.json/);
assert.match(dockerfile, /apps\/jobs\/package\.json/);
assert.match(dockerfile, /packages\/api-contracts\/package\.json/);
assert.match(dockerfile, /packages\/auth-policy\/package\.json/);
assert.match(dockerfile, /packages\/domain-economy\/package\.json/);
assert.match(dockerfile, /packages\/domain-game\/package\.json/);
assert.match(dockerfile, /packages\/domain-streamer\/package\.json/);
assert.match(dockerfile, /packages\/platform-auth\/package\.json/);
assert.match(dockerfile, /packages\/platform-cache\/package\.json/);
assert.match(dockerfile, /packages\/platform-db\/package\.json/);
assert.match(dockerfile, /packages\/platform-inventory\/package\.json/);
assert.match(dockerfile, /packages\/platform-observability\/package\.json/);
assert.match(dockerfile, /packages\/platform-player\/package\.json/);
assert.match(dockerfile, /packages\/platform-payments\/package\.json/);
assert.match(dockerfile, /packages\/platform-store\/package\.json/);
assert.match(dockerfile, /packages\/platform-streamer\/package\.json/);
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
