import assert from "node:assert/strict";
import {
    createGuestIdentityToken,
    resolveSocketPlayerIdentity,
    verifyGuestIdentityToken,
} from "../apps/web/src/lib/security/player-identity";

const issuedAt = Date.parse("2026-03-09T12:00:00.000Z");
const guestToken = createGuestIdentityToken("guest-test-id", issuedAt);
const originalDateNow = Date.now;

const verifiedGuest = verifyGuestIdentityToken(guestToken, issuedAt + 5_000);
assert.deepEqual(verifiedGuest, {
    guestId: "guest-test-id",
    exp: issuedAt + 24 * 60 * 60 * 1000,
});

const expiredGuest = verifyGuestIdentityToken(guestToken, issuedAt + 25 * 60 * 60 * 1000);
assert.equal(expiredGuest, null);

const tamperedGuest = verifyGuestIdentityToken(`${guestToken}tampered`, issuedAt + 5_000);
assert.equal(tamperedGuest, null);

const authIdentity = resolveSocketPlayerIdentity(17, guestToken);
assert.equal(authIdentity.playerId, "user:17");
assert.equal(authIdentity.userId, 17);
assert.equal(authIdentity.guestToken, null);
assert.equal(authIdentity.isGuest, false);

Date.now = () => issuedAt + 5_000;
const guestIdentity = resolveSocketPlayerIdentity(null, guestToken);
assert.equal(guestIdentity.playerId, "guest:guest-test-id");
assert.equal(guestIdentity.userId, null);
assert.equal(guestIdentity.guestToken, guestToken);
assert.equal(guestIdentity.isGuest, true);

const newGuestIdentity = resolveSocketPlayerIdentity(null);
assert.match(newGuestIdentity.playerId, /^guest:/);
assert.equal(newGuestIdentity.userId, null);
assert.equal(typeof newGuestIdentity.guestToken, "string");
assert.equal(newGuestIdentity.isGuest, true);
Date.now = originalDateNow;

console.log("player identity smoke test passed");
