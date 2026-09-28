import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    parsePlayerProfilePatch,
    PlayerCoreError,
} from "@hushle/platform-player";
import { MOBILE_API_ROUTES } from "@hushle/api-contracts";

const parsed = parsePlayerProfilePatch({
    displayName: "  Oyuncu  ",
    bio: "  Merhaba  ",
});
assert.deepEqual(parsed, {
    displayName: "Oyuncu",
    bio: "Merhaba",
});
assert.equal(parsePlayerProfilePatch({ displayName: "  " }).displayName, null);

for (const invalid of [
    {},
    { displayName: "x".repeat(61) },
    { bio: "x".repeat(301) },
    { email: "test@example.com" },
    { displayName: "Oyuncu", email: "test@example.com" },
]) {
    assert.throws(
        () => parsePlayerProfilePatch(invalid),
        (error: unknown) =>
            error instanceof PlayerCoreError &&
            error.code === "invalid_profile"
    );
}

assert.equal(MOBILE_API_ROUTES.me, "/v1/me");
assert.equal(MOBILE_API_ROUTES.profile, "/v1/profile");

const webRoute = readFileSync(
    resolve("apps/web/src/app/api/user/profile/route.ts"),
    "utf8"
);
assert.match(webRoute, /@hushle\/platform-player/);
assert.doesNotMatch(webRoute, /@\/lib\/prisma|writeAuditLog|from "zod"/);

const playerRoute = readFileSync(
    resolve("apps/api/src/player-routes.ts"),
    "utf8"
);
assert.match(playerRoute, /authenticateAccessToken/);
assert.match(playerRoute, /updatePlayerProfile/);
assert.doesNotMatch(playerRoute, /apps\/web|next\/server|@\/lib/);

console.log("test:player-core ok");
