import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
};
const manager = readFileSync(
    "scripts/manage-real-device-smoke-fixture.ts",
    "utf8"
);
const guide = readFileSync("docs/guides/web-real-device-smoke.md", "utf8");

assert.equal(
    packageJson.scripts?.["smoke:web-real-device-fixture"],
    "tsx scripts/manage-real-device-smoke-fixture.ts"
);
assert.equal(
    packageJson.scripts?.["test:web-real-device-fixture-contract"],
    "tsx scripts/test-web-real-device-fixture.ts"
);
assert.equal(
    packageJson.scripts?.["test:web-real-device-fixture-integration"],
    "tsx scripts/test-web-real-device-fixture-integration.ts"
);
assert.match(manager, /REAL_DEVICE_FIXTURE_ALLOWED/);
assert.match(manager, /_dev\|_test/);
assert.match(manager, /startsWith: FIXTURE_PREFIX/);
assert.match(manager, /prepare\|status\|cleanup/);
assert.match(
    packageJson.scripts?.["test:web-launch-readiness"] ?? "",
    /test:web-real-device-fixture-integration/
);
assert.match(guide, /smoke:web-real-device-fixture -- prepare/);
assert.match(guide, /smoke:web-real-device-fixture -- cleanup/);

console.log("Web real-device fixture contract checks passed.");
