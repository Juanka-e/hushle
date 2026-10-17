import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dictionaries, translate } from "../apps/web/src/lib/i18n/dictionaries";
import {
    canResolveConnectionPause,
    readConnectionPauseResolution,
} from "../apps/web/src/app/room/[code]/_components/connection-pause-rules";

const componentsDir = "apps/web/src/app/room/[code]/_components";
const panelSource = readFileSync(`${componentsDir}/connection-pause-panel.tsx`, "utf8");
const rulesSource = readFileSync(`${componentsDir}/connection-pause-rules.ts`, "utf8");
const activeGameSource = readFileSync(`${componentsDir}/active-game.tsx`, "utf8");
const transitionSource = readFileSync(`${componentsDir}/transition-screen.tsx`, "utf8");
const gameOverSource = readFileSync(`${componentsDir}/game-over-screen.tsx`, "utf8");
const pageSource = readFileSync("apps/web/src/app/room/[code]/page.tsx", "utf8");

// ── Resolver rule (mirrors the server) ─────────────────────────
const online = { selfOnline: true, selfIsSpectator: false };
assert.equal(canResolveConnectionPause({ ...online, isHost: true, hostOnline: true }), true);
assert.equal(
    canResolveConnectionPause({ isHost: true, hostOnline: true, selfOnline: true, selfIsSpectator: true }),
    true,
    "the host decides even when not on a team"
);
assert.equal(canResolveConnectionPause({ ...online, isHost: false, hostOnline: true }), false);
assert.equal(canResolveConnectionPause({ ...online, isHost: false, hostOnline: false }), true);
assert.equal(
    canResolveConnectionPause({ isHost: false, hostOnline: false, selfOnline: true, selfIsSpectator: true }),
    false,
    "spectators never decide"
);
assert.equal(
    canResolveConnectionPause({ isHost: true, hostOnline: true, selfOnline: false, selfIsSpectator: false }),
    false,
    "a disconnected client cannot decide"
);
assert.equal(
    canResolveConnectionPause({ isHost: false, hostOnline: false, selfOnline: false, selfIsSpectator: false }),
    false
);

// ── Payload reading (backward compatible) ──────────────────────
assert.equal(readConnectionPauseResolution(null), null);
assert.equal(readConnectionPauseResolution(undefined), null);
assert.equal(readConnectionPauseResolution({ waitingForPlayers: false }), null);
assert.deepEqual(readConnectionPauseResolution({ waitingForPlayers: true }), {
    missingPlayers: [],
    resolutionAvailableInSeconds: null,
    canContinueWithoutMissing: false,
});
assert.deepEqual(
    readConnectionPauseResolution({
        waitingForPlayers: true,
        missingPlayers: [{ playerId: "p1", ad: "Ayşe", takim: "A" }],
        resolutionAvailableInSeconds: 42.2,
        canContinueWithoutMissing: true,
    }),
    {
        missingPlayers: [{ playerId: "p1", ad: "Ayşe", takim: "A" }],
        resolutionAvailableInSeconds: 43,
        canContinueWithoutMissing: true,
    }
);
assert.equal(
    readConnectionPauseResolution({ waitingForPlayers: true, resolutionAvailableInSeconds: -5 })
        ?.resolutionAvailableInSeconds,
    0
);
assert.equal(
    readConnectionPauseResolution({ waitingForPlayers: true, resolutionAvailableInSeconds: Number.NaN })
        ?.resolutionAvailableInSeconds,
    null
);
assert.match(rulesSource, /resolutionAvailableInSeconds/);
assert.match(rulesSource, /canContinueWithoutMissing === true/);

// ── Panel source contract ──────────────────────────────────────
assert.match(
    panelSource,
    /import \{[^}]*CONNECTION_PAUSE_RESOLVE_EVENT[^}]*\} from "@\/lib\/socket\/connection-pause-contract"/
);
assert.match(panelSource, /onEmit\(CONNECTION_PAUSE_RESOLVE_EVENT, payload\)/);
for (const [name, source] of [
    ["connection-pause-panel.tsx", panelSource],
    ["connection-pause-rules.ts", rulesSource],
    ["active-game.tsx", activeGameSource],
    ["transition-screen.tsx", transitionSource],
    ["game-over-screen.tsx", gameOverSource],
    ["page.tsx", pageSource],
] as const) {
    assert.doesNotMatch(source, /["'`]connection_pause:resolve["'`]/, `${name} must import the event constant`);
}
assert.match(panelSource, /submit\("continue_without_missing"\)/);
assert.match(panelSource, /submit\("end_match"\)/);
// "Maçı bitir" opens an inline confirmation; only the confirm button submits end_match.
assert.match(panelSource, /onClick=\{\(\) => setConfirmingEnd\(true\)\}/);
assert.match(panelSource, /connectionPause\.endConfirmBody/);
assert.match(panelSource, /connectionPause\.endCancel/);
assert.equal(panelSource.match(/submit\("end_match"\)/g)?.length, 1);
assert.doesNotMatch(panelSource, /window\.confirm|\bconfirm\(/);
// Buttons wait for the countdown, block double submits and respect the team minimum.
assert.match(panelSource, /resolutionAvailableInSeconds/);
assert.match(panelSource, /const actionsLocked = isCountingDown \|\| isSubmitting/);
assert.match(panelSource, /disabled=\{actionsLocked \|\| !canContinue\}/);
assert.match(panelSource, /canContinueWithoutMissing/);
assert.match(panelSource, /connectionPause\.continueBlocked/);
assert.match(panelSource, /setSubmittedFor\(connectionPause\)/);
assert.match(panelSource, /window\.setInterval/);
assert.match(panelSource, /window\.clearInterval/);
assert.doesNotMatch(panelSource, /Date\.now\(\)/, "countdown must not depend on clock sync");
assert.match(panelSource, /connectionPause\.hostWaiting/);

// ── Wiring ─────────────────────────────────────────────────────
for (const [name, source] of [
    ["active-game.tsx", activeGameSource],
    ["transition-screen.tsx", transitionSource],
] as const) {
    assert.match(source, /import \{ ConnectionPausePanel \} from "\.\/connection-pause-panel"/, name);
    assert.match(source, /<ConnectionPausePanel/, name);
    assert.match(source, /canResolve=\{canResolveConnectionPause\}/, name);
}
// The existing resume button stays disabled while players are missing.
assert.match(
    activeGameSource,
    /canResumePausedGame &&\s*\(!gameState\.connectionPause \|\|\s*!gameState\.connectionPause\.waitingForPlayers\)/
);
assert.match(transitionSource, /disabled=\{Boolean\(\s*transition\.connectionPause\?\.waitingForPlayers\s*\)\}/);
assert.match(pageSource, /import \{ canResolveConnectionPause \} from "\.\/_components\/connection-pause-rules"/);
assert.match(pageSource, /hostOnline: hostPlayer\?\.online === true/);
assert.match(pageSource, /currentPlayer\.rol === ROOM_ROLE_SPECTATOR/);
assert.equal(pageSource.match(/canResolveConnectionPause=\{canResolvePausedMatch\}/g)?.length, 2);
assert.equal(pageSource.match(/onEmit=\{emit\}/g)?.length, 2);
// A null connectionPause (pause cleared) must replace stale transition state.
assert.match(pageSource, /data\.connectionPause === undefined\s*\? prev\.connectionPause\s*: data\.connectionPause/);

// ── Game over ──────────────────────────────────────────────────
assert.match(gameOverSource, /gameOverData\.endReason === "host_ended"/);
assert.match(gameOverSource, /gameOver\.hostEnded/);
assert.match(gameOverSource, /gameOverData\.kazananTakim === "Berabere"/);
assert.match(gameOverSource, /gameOver\.result/);

// ── Dictionaries ───────────────────────────────────────────────
const newKeys = [
    "connectionPause.missingTitle",
    "connectionPause.countdownLabel",
    "connectionPause.seconds",
    "connectionPause.resolverWaiting",
    "connectionPause.resolverReady",
    "connectionPause.hostWaiting",
    "connectionPause.hostReady",
    "connectionPause.continueWithout",
    "connectionPause.continueBlocked",
    "connectionPause.endMatch",
    "connectionPause.endConfirmTitle",
    "connectionPause.endConfirmBody",
    "connectionPause.endConfirm",
    "connectionPause.endCancel",
    "gameOver.result",
    "gameOver.leading",
    "gameOver.hostEnded",
] as const;

function lookup(locale: "tr" | "en", key: string): unknown {
    return key.split(".").reduce<unknown>(
        (value, segment) =>
            value && typeof value === "object" ? (value as Record<string, unknown>)[segment] : undefined,
        dictionaries[locale]
    );
}

for (const key of newKeys) {
    for (const locale of ["tr", "en"] as const) {
        const value = lookup(locale, key);
        assert.equal(typeof value, "string", `${locale}.${key} missing`);
        assert.ok((value as string).trim().length > 0, `${locale}.${key} empty`);
    }
    assert.notEqual(lookup("tr", key), lookup("en", key), `${key} must be translated`);
}
assert.equal(translate("tr", "connectionPause.continueWithout"), "Onsuz devam et");
assert.equal(translate("tr", "connectionPause.endMatch"), "Maçı bitir");
assert.equal(translate("tr", "connectionPause.continueBlocked"), "Her takımda en az 2 oyuncu kalmalı.");
assert.match(translate("tr", "connectionPause.endConfirmBody"), /mevcut skorla/);
assert.match(translate("tr", "connectionPause.endConfirmBody"), /coin verilmez/);
assert.match(translate("tr", "gameOver.hostEnded"), /coin verilmedi/);
assert.equal(translate("tr", "connectionPause.seconds", { seconds: 42 }), "42 sn");
assert.equal(translate("en", "connectionPause.seconds", { seconds: 42 }), "42s");

console.log("connection pause UI contract passed");
