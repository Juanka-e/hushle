import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
    return readFileSync(path, "utf8");
}

const packageJson = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
};
const config = read("playwright.webkit.config.ts");
const workflow = read(".github/workflows/ci.yml");
const guide = read("docs/guides/web-webkit-readiness.md");

assert.equal(
    packageJson.scripts?.["test:web-webkit"],
    "playwright test --config=playwright.webkit.config.ts"
);
assert.equal(
    packageJson.scripts?.["test:web-webkit-contract"],
    "tsx scripts/test-web-webkit-readiness.ts"
);
assert.match(
    packageJson.scripts?.["test:web-launch-readiness"] ?? "",
    /npm run test:web-webkit-contract/
);
assert.match(
    packageJson.scripts?.["test:web-launch-readiness"] ?? "",
    /npm run test:web-webkit/
);

assert.match(config, /name:\s*"webkit-iphone-public"/);
assert.match(config, /name:\s*"webkit-desktop-public"/);
assert.match(config, /name:\s*"webkit-iphone-auth"/);
assert.match(config, /browserName:\s*"webkit"/);
assert.match(config, /testMatch:\s*"web-responsive\.spec\.ts"/);
assert.match(config, /testMatch:\s*"web-launch-auth\.spec\.ts"/);

assert.match(workflow, /playwright install --with-deps chromium webkit/);
assert.match(guide, /WebKit motoru/i);
assert.match(guide, /fiziksel iOS Safari kanıtı değildir/i);
assert.match(guide, /registered/i);
assert.match(guide, /WEB_LAUNCH_DB_E2E=true/);

console.log("WebKit readiness contract checks passed.");
