import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const socketProtocol = read("apps/web/src/lib/socket/protocol-version.ts");
const gameSocket = read("apps/web/src/lib/socket/game-socket.ts");
const clientSources = [
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/room/[code]/page.tsx",
  "apps/web/src/components/game/authenticated-dashboard-home.tsx",
  "apps/web/src/components/providers/socket-provider.tsx",
].map(read);
const cardFace = read("apps/web/src/lib/cosmetics/card-face.ts");
const cardBack = read("apps/web/src/lib/cosmetics/card-back.ts");
const shopSchema = read("apps/web/src/lib/cosmetics/shop-item-schema.ts");
const docs = read("docs/architecture/release-compatibility-and-versioning.md");

assert.match(socketProtocol, /CURRENT_SOCKET_PROTOCOL_VERSION = 1/);
assert.match(socketProtocol, /MINIMUM_SOCKET_PROTOCOL_VERSION = 0/);
assert.match(gameSocket, /io\.use\(/);
assert.match(gameSocket, /evaluateSocketProtocolVersion/);
for (const source of clientSources) {
  assert.match(source, /auth: SOCKET_CLIENT_AUTH/);
}

assert.match(cardFace, /switch \(spec\.effectiveVersion\)/);
assert.match(cardFace, /resolveCardFaceThemeV1/);
assert.match(cardBack, /switch \(spec\.effectiveVersion\)/);
assert.match(cardBack, /resolveCardBackThemeV1/);
assert.match(shopSchema, /isSupportedCosmeticRenderSpecVersion/);
assert.match(docs, /N-1/);
assert.match(docs, /sessionVersion/);

console.log("Release compatibility contract checks passed.");
