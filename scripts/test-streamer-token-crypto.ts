import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
    connectionAad,
    decryptToken,
    encryptToken,
    loadTokenKeyring,
    StreamerConfigError,
    TokenDecryptError,
    type TokenKeyring,
} from "@hushle/platform-streamer";

// Token-at-rest crypto for streamer platform connections
// (spec: docs/superpowers/specs/2026-11-05-streamer-platform-connections-design.md, karar 3).

let count = 0;
function test(name: string, run: () => void): void {
    run();
    count += 1;
    console.log(`PASS ${name}`);
}

const keyA = randomBytes(32).toString("base64");
const keyB = randomBytes(32).toString("base64");
const aad = connectionAad("twitch", "12345");

function keyring(current: string, version: number, previous?: { key: string; version: number }): TokenKeyring {
    return loadTokenKeyring({
        STREAMER_TOKEN_KEY: current,
        STREAMER_TOKEN_KEY_VERSION: String(version),
        ...(previous
            ? {
                  STREAMER_TOKEN_KEY_PREVIOUS: previous.key,
                  STREAMER_TOKEN_KEY_PREVIOUS_VERSION: String(previous.version),
              }
            : {}),
    });
}

function flipFirstByte(value: string): string {
    const bytes = Buffer.from(value, "base64url");
    bytes[0] ^= 0x01;
    return bytes.toString("base64url");
}

test("connectionAad binds platform and platform user id", () => {
    assert.equal(aad, "streamer:twitch:12345");
});

test("roundtrip returns the plaintext and the format carries the key version", () => {
    const ring = keyring(keyA, 1);
    const encoded = encryptToken("access-token-secret", ring, aad);
    assert.match(encoded, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.ok(!encoded.includes("access-token-secret"));
    assert.equal(decryptToken(encoded, ring, aad), "access-token-secret");
});

test("every encryption uses a fresh IV", () => {
    const ring = keyring(keyA, 1);
    const first = encryptToken("same", ring, aad);
    const second = encryptToken("same", ring, aad);
    assert.notEqual(first, second);
    assert.notEqual(first.split(".")[1], second.split(".")[1]);
});

test("tampered ciphertext is rejected as tampered", () => {
    const ring = keyring(keyA, 1);
    const [version, iv, tag, ciphertext] = encryptToken("token", ring, aad).split(".");
    for (const tampered of [
        [version, iv, tag, flipFirstByte(ciphertext)].join("."),
        [version, iv, flipFirstByte(tag), ciphertext].join("."),
        [version, flipFirstByte(iv), tag, ciphertext].join("."),
    ]) {
        assert.throws(
            () => decryptToken(tampered, ring, aad),
            (error: unknown) => error instanceof TokenDecryptError && error.reason === "tampered"
        );
    }
});

test("a different aad is rejected as tampered (ciphertext cannot move between rows)", () => {
    const ring = keyring(keyA, 1);
    const encoded = encryptToken("token", ring, aad);
    assert.throws(
        () => decryptToken(encoded, ring, connectionAad("twitch", "99999")),
        (error: unknown) => error instanceof TokenDecryptError && error.reason === "tampered"
    );
});

test("an unknown key version fails closed", () => {
    const ring = keyring(keyA, 1);
    const encoded = encryptToken("token", ring, aad).replace(/^v1\./, "v9.");
    assert.throws(
        () => decryptToken(encoded, ring, aad),
        (error: unknown) => error instanceof TokenDecryptError && error.reason === "unknown_version"
    );
});

test("garbage is rejected as malformed", () => {
    const ring = keyring(keyA, 1);
    for (const garbage of ["", "v1", "v1.a.b", "nonsense", "v1.!!.!!.!!", "vx.a.b.c"]) {
        assert.throws(
            () => decryptToken(garbage, ring, aad),
            (error: unknown) => error instanceof TokenDecryptError && error.reason === "malformed",
            `expected malformed for ${JSON.stringify(garbage)}`
        );
    }
});

test("rotation: rows encrypted with the previous key still decrypt, new rows use the current key", () => {
    const oldRing = keyring(keyA, 1);
    const encodedOld = encryptToken("token", oldRing, aad);
    const rotated = keyring(keyB, 2, { key: keyA, version: 1 });
    assert.equal(decryptToken(encodedOld, rotated, aad), "token");
    const encodedNew = encryptToken("token", rotated, aad);
    assert.match(encodedNew, /^v2\./);
    assert.throws(() => decryptToken(encodedNew, oldRing, aad), TokenDecryptError);
});

test("error messages never carry the plaintext or key material", () => {
    const ring = keyring(keyA, 1);
    const encoded = encryptToken("super-secret-token", ring, aad);
    try {
        decryptToken(encoded.replace(/^v1\./, "v7."), ring, aad);
        assert.fail("expected throw");
    } catch (error) {
        const message = String((error as Error).message);
        assert.ok(!message.includes("super-secret-token"));
        assert.ok(!message.includes(keyA));
    }
});

test("loadTokenKeyring rejects a short key and accepts a 32-byte one", () => {
    assert.throws(
        () => loadTokenKeyring({ STREAMER_TOKEN_KEY: randomBytes(16).toString("base64") }),
        (error: unknown) => error instanceof StreamerConfigError && /32 bytes/.test(error.message)
    );
    assert.throws(() => loadTokenKeyring({}), StreamerConfigError);
    assert.throws(() => loadTokenKeyring({ STREAMER_TOKEN_KEY: "not base64 at all!!" }), StreamerConfigError);
    const ring = loadTokenKeyring({ STREAMER_TOKEN_KEY: keyA });
    assert.equal(ring.current.version, 1);
    assert.equal(ring.current.key.length, 32);
    assert.equal(ring.previous, undefined);
});

test("loadTokenKeyring rejects a previous key with the same version as the current one", () => {
    assert.throws(
        () =>
            loadTokenKeyring({
                STREAMER_TOKEN_KEY: keyB,
                STREAMER_TOKEN_KEY_VERSION: "2",
                STREAMER_TOKEN_KEY_PREVIOUS: keyA,
                STREAMER_TOKEN_KEY_PREVIOUS_VERSION: "2",
            }),
        StreamerConfigError
    );
    assert.throws(() => loadTokenKeyring({ STREAMER_TOKEN_KEY: keyA, STREAMER_TOKEN_KEY_VERSION: "0" }), StreamerConfigError);
});

console.log(`${count} checks passed.`);
