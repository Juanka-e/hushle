import assert from "node:assert/strict";
import { resolveRoomCardThemes } from "../apps/web/src/lib/cosmetics/room-card-themes";

const emptyThemes = resolveRoomCardThemes(null);

assert.equal(emptyThemes.cardFaceTheme, null);
assert.equal(emptyThemes.cardBackTheme, null);

const resolvedThemes = resolveRoomCardThemes({
    cardFace: {
        renderSpecVersion: 1,
        renderMode: "template",
        imageUrl: "",
        templateKey: "signal_grid",
        templateConfig: {
            palette: {
                primary: "#22c55e",
                secondary: "#bbf7d0",
                border: "#4ade80",
            },
            motion: {
                preset: "pulse",
                speedMs: 4200,
            },
        },
        rarity: "epic",
    },
    cardBack: {
        renderSpecVersion: 999,
        renderMode: "image",
        imageUrl: "/cosmetics/mock/card-backs/ember-vault.svg",
        templateKey: null,
        templateConfig: null,
        rarity: "legendary",
    },
});

assert.equal(resolvedThemes.cardFaceTheme?.accentColor, "#22c55e");
assert.equal(resolvedThemes.cardFaceTheme?.motionPreset, "pulse");
assert.equal(resolvedThemes.cardFaceTheme?.renderSpecVersion, 1);
assert.equal(resolvedThemes.cardFaceTheme?.usedRenderSpecFallback, false);
assert.equal(resolvedThemes.cardBackTheme?.overlayImageUrl, "/cosmetics/mock/card-backs/ember-vault.svg");
assert.equal(resolvedThemes.cardBackTheme?.overlayOpacity, 0.24);
assert.equal(resolvedThemes.cardBackTheme?.requestedRenderSpecVersion, 999);
assert.equal(resolvedThemes.cardBackTheme?.renderSpecVersion, 1);
assert.equal(resolvedThemes.cardBackTheme?.usedRenderSpecFallback, true);

console.log("room-card theme smoke test passed");
