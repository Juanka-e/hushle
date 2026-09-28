import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
    return readFileSync(path, "utf8");
}

const packageJson = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
};
const runner = read("scripts/test-web-multiplayer-launch.ts");
const config = read("playwright.multiplayer.config.ts");
const spec = read("tests/web-multiplayer-guest.spec.ts");
const guide = read("docs/guides/web-multiplayer-launch-readiness.md");

assert.equal(
    packageJson.scripts?.["test:web-multiplayer"],
    "tsx scripts/test-web-multiplayer-launch.ts"
);
assert.equal(
    packageJson.scripts?.["test:web-multiplayer-contract"],
    "tsx scripts/test-web-multiplayer-readiness.ts"
);
assert.match(
    packageJson.scripts?.["test:web-launch-readiness"] ?? "",
    /npm run test:web-multiplayer-contract/
);
assert.match(
    packageJson.scripts?.["test:web-launch-readiness"] ?? "",
    /npm run test:web-multiplayer/
);

assert.match(runner, /WEB_LAUNCH_DB_E2E/);
assert.match(runner, /tabu_test/);
assert.match(runner, /prisma\.category\.create/);
assert.match(runner, /prisma\.word\.deleteMany/);
assert.match(runner, /finally/);
assert.match(runner, /WEB_MULTIPLAYER_ROOM_JOIN_MAX_ATTEMPTS/);
assert.match(config, /workers:\s*1/);
assert.match(config, /chromium-multiplayer/);
assert.match(config, /webkit-multiplayer/);
assert.match(spec, /browser\.newContext/);
assert.match(spec, /expectNoHorizontalOverflow/);
assert.match(spec, /tabu_playerId/);
assert.match(spec, /hostPage\.reload/);
assert.match(spec, /guestPage\.reload/);
assert.match(spec, /toHaveCount\(1\)/);
assert.match(spec, /Devam Ettir/);
assert.match(spec, /active game state survived guest reload/);
assert.match(spec, /Takım A panelini aç/);
assert.match(spec, /mobile host creates a room that a desktop guest can join/);
assert.match(spec, /four active guests formed two teams/);
assert.match(guide, /izole browser context/i);
assert.match(guide, /ödül/i);
assert.match(guide, /fiziksel cihaz kanıtı değildir/i);

console.log("Web multiplayer readiness contract checks passed.");
