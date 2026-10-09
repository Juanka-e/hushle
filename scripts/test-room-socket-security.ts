import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const socketSource = readFileSync(
    "apps/web/src/lib/socket/game-socket.ts",
    "utf8"
);
const roomActionLockSource = readFileSync(
    "apps/web/src/lib/socket/room-action-lock.ts",
    "utf8"
);
const serverRuntimeSource = readFileSync(
    "apps/web/server-runtime.ts",
    "utf8"
);
const clientTypes = readFileSync("apps/web/src/types/game.ts", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
};

const publicStateStart = socketSource.indexOf(
    "function buildPublicGameState"
);
const publicStateEnd = socketSource.indexOf(
    "async function sendVisibleCategories",
    publicStateStart
);
assert.ok(publicStateStart >= 0 && publicStateEnd > publicStateStart);
const publicStateSource = socketSource.slice(publicStateStart, publicStateEnd);

assert.doesNotMatch(publicStateSource, /aktifKart/);
assert.doesNotMatch(publicStateSource, /creatorId/);
assert.doesNotMatch(publicStateSource, /\bid:\s/);
assert.doesNotMatch(
    socketSource,
    /oyunDurumuGuncelle"\s*,\s*\{\s*\.\.\.(?:room|currentRoom)\.oyunDurumu/
);
assert.doesNotMatch(clientTypes, /aktifKart:\s*CardData/);
assert.match(socketSource, /const StartGameSchema = z\.object/);
assert.match(socketSource, /StartGameSchema\.safeParse\(rawPayload\)/);
assert.match(socketSource, /const PlayerTargetSchema = z\.object/);
assert.match(socketSource, /PlayerTargetSchema\.safeParse\(rawPayload\)/);
assert.match(socketSource, /consumeSocketActionBurstLimit/);
assert.match(socketSource, /clearSocketActionBurstLimits\(socket\.id\)/);
assert.match(serverRuntimeSource, /maxHttpBufferSize:\s*16 \* 1024/);
assert.match(
    socketSource,
    /if \(room\.oyunDurumu\.oyunAktifMi\) \{\s*socket\.emit\("hata", "Oyun zaten devam ediyor\."\)/
);
assert.match(
    socketSource,
    /runWithRoomActionLock\(\s*room\.odaKodu,\s*"word-action"/
);
assert.match(socketSource, /collectVisibleCategoryIds/);
assert.match(socketSource, /beginRoomGameStart\(room\)/);
assert.match(socketSource, /finishRoomGameStart\(room\)/);
assert.match(socketSource, /const currentStartDecision = resolveRoomStartDecision/);
assert.match(socketSource, /socketToRoom\.get\(socket\.id\) !== room\.odaKodu/);
assert.match(socketSource, /resolveConnectionContinuity/);
assert.match(socketSource, /synchronizeConnectionPause\(room\)/);
assert.match(
    socketSource,
    /if \(connectionPauseChanged\) \{\s*emitGamePauseState\(room\);\s*\}/
);
assert.match(
    socketSource,
    /const currentPlayer = room\.oyuncular\.find\(\(entry\) => entry\.id === socket\.id\);/
);
assert.match(socketSource, /if \(!currentIsHost && !currentIsNarrator\) return;/);
assert.match(socketSource, /room\.pausedDurationMs/);
assert.match(
    socketSource,
    /const player = room\.oyuncular\.find\(\(p\) => p\.id === socket\.id\);\s*if \(!player\) return;\s*player\.online = false;/
);
assert.match(
    socketSource,
    /if \(room\.oyunDurumu\.oyunAktifMi\) \{\s*socket\.emit\("hata", "Oyun sırasında oyuncu odadan atılamaz\."\);\s*return;/
);
assert.match(
    socketSource,
    /runWithRoomActionLock\(\s*room\.odaKodu,\s*"switch-team"/
);
assert.match(roomActionLockSource, /randomUUID/);
assert.match(roomActionLockSource, /redis\.call\("GET", KEYS\[1\]\)/);
assert.match(
    packageJson.scripts?.["test:web-launch-readiness"] ?? "",
    /test:room-socket-security/
);

console.log("Room socket security contract checks passed.");
