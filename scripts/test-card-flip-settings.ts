import assert from "node:assert/strict";
import {
    defaultCardFlipSettings,
    parseCardFlipSettings,
} from "../apps/web/src/lib/game/card-flip-settings";

assert.deepEqual(parseCardFlipSettings(null), defaultCardFlipSettings);
assert.deepEqual(parseCardFlipSettings(""), defaultCardFlipSettings);
assert.deepEqual(parseCardFlipSettings("{\"enabled\":true}"), { enabled: true });
assert.deepEqual(parseCardFlipSettings("{\"enabled\":false}"), { enabled: false });
assert.deepEqual(parseCardFlipSettings("{\"enabled\":\"yes\"}"), defaultCardFlipSettings);
assert.deepEqual(parseCardFlipSettings("{"), defaultCardFlipSettings);

console.log("card-flip-settings smoke test passed");
