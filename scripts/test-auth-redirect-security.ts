import assert from "node:assert/strict";
import { resolveSafeCallbackUrl } from "../apps/web/src/lib/security/safe-callback-url";

const baseOrigin = "https://tabu.example.com";

assert.equal(resolveSafeCallbackUrl("/dashboard", "/dashboard", baseOrigin), "/dashboard");
assert.equal(
    resolveSafeCallbackUrl("/dashboard?tab=shop", "/dashboard", baseOrigin),
    "/dashboard?tab=shop"
);
assert.equal(
    resolveSafeCallbackUrl("https://evil.example/phish", "/dashboard", baseOrigin),
    "/dashboard"
);
assert.equal(
    resolveSafeCallbackUrl("javascript:alert(1)", "/dashboard", baseOrigin),
    "/dashboard"
);
assert.equal(resolveSafeCallbackUrl("//evil.example", "/dashboard", baseOrigin), "/dashboard");

console.log("auth redirect security smoke test passed");
