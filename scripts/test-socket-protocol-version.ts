import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CURRENT_SOCKET_PROTOCOL_VERSION,
  MINIMUM_SOCKET_PROTOCOL_VERSION,
  SOCKET_CLIENT_AUTH,
  SOCKET_PROTOCOL_ERROR_CODE,
  evaluateSocketProtocolVersion,
  getSocketProtocolErrorMessage,
  isSocketProtocolRefusal,
  readSocketProtocolVersionFromAuth,
} from "../apps/web/src/lib/socket/protocol-version";

assert.equal(CURRENT_SOCKET_PROTOCOL_VERSION, 1);
assert.equal(MINIMUM_SOCKET_PROTOCOL_VERSION, 0);
assert.equal(SOCKET_CLIENT_AUTH.clientProtocolVersion, 1);

const legacy = evaluateSocketProtocolVersion(undefined);
assert.equal(legacy.accepted, true);
assert.equal(legacy.clientVersion, null);
assert.equal(legacy.effectiveClientVersion, 0);

const current = evaluateSocketProtocolVersion(1);
assert.equal(current.accepted, true);
assert.equal(current.reason, "compatible");

const future = evaluateSocketProtocolVersion(2);
assert.equal(future.accepted, false);
assert.equal(future.reason, "too_new");

const invalid = evaluateSocketProtocolVersion("1");
assert.equal(invalid.accepted, false);
assert.equal(invalid.reason, "invalid");

assert.equal(
  readSocketProtocolVersionFromAuth({ clientProtocolVersion: 1 }),
  1,
);
assert.equal(readSocketProtocolVersionFromAuth(null), undefined);
assert.equal(SOCKET_PROTOCOL_ERROR_CODE, "SOCKET_PROTOCOL_UNSUPPORTED");
assert.equal(
  getSocketProtocolErrorMessage({
    data: { code: SOCKET_PROTOCOL_ERROR_CODE },
  }),
  "Yeni bir oyun sürümü hazır. Devam etmek için sayfayı yenileyin.",
);
assert.equal(
  getSocketProtocolErrorMessage({ data: { code: SOCKET_PROTOCOL_ERROR_CODE } }, "en"),
  "A new version of the game is ready. Refresh the page to continue.",
);
assert.equal(getSocketProtocolErrorMessage(new Error("network")), null);

// One guard decides what a protocol refusal is (the handshake middleware's SocketProtocolErrorData):
// the refresh prompt and the stream screen's reload both ask it.
const handshakeRefusal = Object.assign(new Error("socket protocol unsupported"), {
  data: { code: SOCKET_PROTOCOL_ERROR_CODE, clientVersion: 1, serverVersion: 2, minimumVersion: 2, reason: "too_old" },
});
const refusalCases: Array<[string, unknown, boolean]> = [
  ["the handshake middleware's refusal", handshakeRefusal, true],
  ["a bare object with the code in data", { data: { code: SOCKET_PROTOCOL_ERROR_CODE } }, true],
  ["another code", Object.assign(new Error("x"), { data: { code: "RATE_LIMITED" } }), false],
  ["data that is an array", { data: Object.assign([SOCKET_PROTOCOL_ERROR_CODE], { code: SOCKET_PROTOCOL_ERROR_CODE }) }, false],
  ["data that is the code itself", { data: SOCKET_PROTOCOL_ERROR_CODE }, false],
  ["null data", Object.assign(new Error("x"), { data: null }), false],
  ["the code at the top level", { code: SOCKET_PROTOCOL_ERROR_CODE }, false],
  ["a plain transport error", new Error("xhr poll error"), false],
  ["the code as a string", SOCKET_PROTOCOL_ERROR_CODE, false],
  ["a function", Object.assign(() => undefined, { data: { code: SOCKET_PROTOCOL_ERROR_CODE } }), false],
  ["null", null, false],
  ["undefined", undefined, false],
];
for (const [label, error, expected] of refusalCases) {
  assert.equal(isSocketProtocolRefusal(error), expected, `isSocketProtocolRefusal: ${label}`);
  assert.equal(getSocketProtocolErrorMessage(error) !== null, expected, `the refresh prompt follows the guard: ${label}`);
}
const protocolSource = readFileSync(path.join(__dirname, "../apps/web/src/lib/socket/protocol-version.ts"), "utf8");
assert.equal(protocolSource.match(/\.code\s*[!=]==/g)?.length, 1, "the code is compared in one place only");
assert.match(
  protocolSource.split("export function getSocketProtocolErrorMessage")[1] ?? "",
  /if \(!isSocketProtocolRefusal\(error\)\) return null;/,
  "the refresh prompt asks the shared guard",
);

console.log("Socket protocol version checks passed.");
