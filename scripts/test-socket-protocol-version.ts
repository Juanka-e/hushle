import assert from "node:assert/strict";
import {
  CURRENT_SOCKET_PROTOCOL_VERSION,
  MINIMUM_SOCKET_PROTOCOL_VERSION,
  SOCKET_CLIENT_AUTH,
  SOCKET_PROTOCOL_ERROR_CODE,
  evaluateSocketProtocolVersion,
  getSocketProtocolErrorMessage,
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
assert.equal(
  getSocketProtocolErrorMessage({
    data: { code: SOCKET_PROTOCOL_ERROR_CODE },
  }),
  "Yeni bir oyun sürümü hazır. Devam etmek için sayfayı yenileyin.",
);
assert.equal(getSocketProtocolErrorMessage(new Error("network")), null);

console.log("Socket protocol version checks passed.");
