import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    evaluatePasswordPolicy,
    PASSWORD_MAX_UTF8_BYTES,
    PASSWORD_MIN_LENGTH,
} from "@hushle/auth-policy";
import { checkPasswordBreach } from "../apps/web/src/lib/security/password-breach";

async function run(): Promise<void> {
    const empty = evaluatePasswordPolicy("");
    assert.equal(empty.accepted, false);
    assert.equal(empty.level, "empty");

    const short = evaluatePasswordPolicy("short");
    assert.equal(short.accepted, false);
    assert.match(short.issues[0] ?? "", new RegExp(String(PASSWORD_MIN_LENGTH)));

    const minimumLengthButWeak = evaluatePasswordPolicy("abcdefgh");
    assert.equal(minimumLengthButWeak.accepted, false);
    assert.equal(
        minimumLengthButWeak.issues.some((issue) =>
            issue.includes(`en az ${PASSWORD_MIN_LENGTH} karakter`)
        ),
        false
    );

    const common = evaluatePasswordPolicy("passwordpassword");
    assert.equal(common.accepted, false);

    const strong = evaluatePasswordPolicy("Kutup-Yildizi 84 mercan vapuru");
    assert.equal(strong.accepted, true);
    assert.ok(strong.score >= 3);

    const oversized = evaluatePasswordPolicy(
        "x".repeat(PASSWORD_MAX_UTF8_BYTES + 1)
    );
    assert.equal(oversized.accepted, false);
    assert.ok(oversized.utf8Bytes > PASSWORD_MAX_UTF8_BYTES);

    const knownPassword = "password";
    const knownHash = createHash("sha1")
        .update(knownPassword, "utf8")
        .digest("hex")
        .toUpperCase();
    const suffix = knownHash.slice(5);
    const breached = await checkPasswordBreach(knownPassword, {
        fetchImpl: async () =>
            new Response(`${suffix}:42\r\n000000:0`, { status: 200 }),
    });
    assert.deepEqual(breached, { status: "breached", occurrences: 42 });

    const clear = await checkPasswordBreach("not-in-fixture", {
        fetchImpl: async () => new Response("000000:0", { status: 200 }),
    });
    assert.deepEqual(clear, { status: "clear", occurrences: 0 });

    const unavailable = await checkPasswordBreach("provider-timeout", {
        fetchImpl: async () => {
            throw new Error("fixture unavailable");
        },
    });
    assert.deepEqual(unavailable, { status: "unavailable", occurrences: null });

    console.log("auth password policy test passed");
}

void run();
