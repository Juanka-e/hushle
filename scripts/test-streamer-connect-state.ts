import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    CONNECT_STATE_COOKIE,
    CONNECT_STATE_COOKIE_PATH,
    CONNECT_STATE_TTL_MS,
    ConnectStateError,
    createConnectState,
    pkceChallenge,
    readConnectState,
    requireConnectStateSecret,
} from "../apps/web/src/lib/streamer/connect-state";

// The signed, short-lived cookie that ties an OAuth callback to the user who started it.

let count = 0;
function test(name: string, run: () => void): void {
    run();
    count += 1;
    console.log(`PASS ${name}`);
}

const secret = "s".repeat(48);
const NOW = new Date("2026-11-05T12:00:00Z");

function expectCode(run: () => unknown, code: ConnectStateError["code"]): void {
    assert.throws(run, (error: unknown) => error instanceof ConnectStateError && error.code === code, `expected ${code}`);
}

test("constants", () => {
    assert.equal(CONNECT_STATE_COOKIE, "hushle_streamer_connect");
    assert.equal(CONNECT_STATE_COOKIE_PATH, "/api/streamer/connect");
    assert.equal(CONNECT_STATE_TTL_MS, 600_000);
});

test("roundtrip without PKCE", () => {
    const created = createConnectState({ userId: 42, platform: "twitch", requiresPkce: false, secret, now: NOW });
    assert.match(created.state, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(created.codeChallenge, undefined);
    assert.ok(!created.cookieValue.includes("42:twitch"), "cookie is not plain text");
    const read = readConnectState(created.cookieValue, { userId: 42, platform: "twitch", state: created.state, secret, now: new Date(NOW.getTime() + 60_000) });
    assert.deepEqual(read, { codeVerifier: undefined });
});

test("roundtrip with PKCE: challenge is base64url(sha256(verifier))", () => {
    const created = createConnectState({ userId: 7, platform: "kick", requiresPkce: true, secret, now: NOW });
    assert.ok(created.codeChallenge);
    const read = readConnectState(created.cookieValue, { userId: 7, platform: "kick", state: created.state, secret, now: NOW });
    assert.ok(read.codeVerifier && read.codeVerifier.length >= 43);
    assert.equal(created.codeChallenge, createHash("sha256").update(read.codeVerifier).digest("base64url"));
    assert.equal(pkceChallenge(read.codeVerifier), created.codeChallenge);
});

test("two states never repeat", () => {
    const a = createConnectState({ userId: 1, platform: "twitch", requiresPkce: false, secret, now: NOW });
    const b = createConnectState({ userId: 1, platform: "twitch", requiresPkce: false, secret, now: NOW });
    assert.notEqual(a.state, b.state);
    assert.notEqual(a.cookieValue, b.cookieValue);
});

test("missing cookie", () => {
    expectCode(() => readConnectState(undefined, { userId: 1, platform: "twitch", state: "x", secret, now: NOW }), "state_missing");
    expectCode(() => readConnectState("", { userId: 1, platform: "twitch", state: "x", secret, now: NOW }), "state_missing");
});

test("tampered signature, payload or shape is invalid", () => {
    const { cookieValue, state } = createConnectState({ userId: 1, platform: "twitch", requiresPkce: false, secret, now: NOW });
    const [payload, signature] = cookieValue.split(".");
    const flipped = signature.at(-1) === "A" ? "B" : "A";
    expectCode(() => readConnectState(`${payload}.${signature.slice(0, -1)}${flipped}`, { userId: 1, platform: "twitch", state, secret, now: NOW }), "state_invalid");
    expectCode(() => readConnectState(`${payload}x.${signature}`, { userId: 1, platform: "twitch", state, secret, now: NOW }), "state_invalid");
    expectCode(() => readConnectState("garbage", { userId: 1, platform: "twitch", state, secret, now: NOW }), "state_invalid");
    expectCode(() => readConnectState(cookieValue, { userId: 1, platform: "twitch", state, secret: "t".repeat(48), now: NOW }), "state_invalid");
});

test("expired after ten minutes", () => {
    const { cookieValue, state } = createConnectState({ userId: 1, platform: "twitch", requiresPkce: false, secret, now: NOW });
    readConnectState(cookieValue, { userId: 1, platform: "twitch", state, secret, now: new Date(NOW.getTime() + 599_000) });
    expectCode(() => readConnectState(cookieValue, { userId: 1, platform: "twitch", state, secret, now: new Date(NOW.getTime() + 601_000) }), "state_expired");
    expectCode(() => readConnectState(cookieValue, { userId: 1, platform: "twitch", state, secret, now: new Date(NOW.getTime() - 120_000) }), "state_invalid");
});

test("another user, platform or state value is a mismatch", () => {
    const { cookieValue, state } = createConnectState({ userId: 1, platform: "twitch", requiresPkce: false, secret, now: NOW });
    expectCode(() => readConnectState(cookieValue, { userId: 2, platform: "twitch", state, secret, now: NOW }), "state_mismatch");
    expectCode(() => readConnectState(cookieValue, { userId: 1, platform: "kick", state, secret, now: NOW }), "state_mismatch");
    expectCode(() => readConnectState(cookieValue, { userId: 1, platform: "twitch", state: state.slice(0, -1) + "_", secret, now: NOW }), "state_mismatch");
    expectCode(() => readConnectState(cookieValue, { userId: 1, platform: "twitch", state: null, secret, now: NOW }), "state_mismatch");
});

test("the signing secret must be at least 32 characters", () => {
    assert.throws(() => requireConnectStateSecret({ AUTH_SECRET: "short" }), /32/);
    assert.throws(() => requireConnectStateSecret({}), /32/);
    assert.equal(requireConnectStateSecret({ AUTH_SECRET: secret }), secret);
});

console.log(`${count} checks passed.`);
