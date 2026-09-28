import assert from "node:assert/strict";
import {
    areEmailsEqual,
    isEmailWithinLimit,
    normalizeEmail,
    sanitizeEmail,
} from "../apps/web/src/lib/users/email";

assert.equal(normalizeEmail("  Test@Example.COM "), "test@example.com");
assert.equal(sanitizeEmail("  Test@Example.COM "), "Test@Example.COM");
assert.equal(areEmailsEqual("User@Example.com", " user@example.com "), true);
assert.equal(areEmailsEqual(null, null), true);
assert.equal(areEmailsEqual("user@example.com", null), false);
assert.equal(isEmailWithinLimit("person@example.com"), true);
assert.equal(isEmailWithinLimit(`${"a".repeat(188)}@x.com`), false);

console.log("test:user-email-foundation ok");
