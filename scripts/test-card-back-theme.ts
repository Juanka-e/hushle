import assert from "node:assert/strict";
import { resolveCardBackTheme } from "../apps/web/src/lib/cosmetics/card-back";

const templateTheme = resolveCardBackTheme({
    renderMode: "template",
    imageUrl: "",
    templateKey: "royal_seal",
    templateConfig: {
        palette: {
            primary: "#22c55e",
            secondary: "#bbf7d0",
        },
        pattern: {
            type: "grid",
            opacity: 0.26,
            scale: 24,
        },
        motion: {
            preset: "drift",
            speedMs: 6800,
        },
        glow: {
            blur: 40,
            opacity: 0.24,
        },
        overlay: {
            opacity: 0.8,
        },
    },
    rarity: "epic",
});

assert.equal(templateTheme.accentColor, "#22c55e");
assert.equal(templateTheme.secondaryColor, "#bbf7d0");
assert.equal(templateTheme.pattern, "grid");
assert.equal(templateTheme.patternScale, 24);
assert.equal(templateTheme.motionPreset, "drift");
assert.equal(templateTheme.glowBlur, 40);
assert.equal(templateTheme.overlayOpacity, 0.45);
assert.equal(templateTheme.overlayImageUrl, null);

const unsafeTheme = resolveCardBackTheme({
    renderMode: "template",
    imageUrl: "",
    templateKey: "ember_vault",
    templateConfig: {
        palette: {
            border: "javascript:alert(1)",
        },
        pattern: {
            type: "<svg>",
        },
    },
    rarity: "legendary",
});

assert.equal(unsafeTheme.borderColor, "#fb923c");
assert.equal(unsafeTheme.pattern, "diagonal");

const imageTheme = resolveCardBackTheme({
    renderMode: "image",
    imageUrl: "/cosmetics/card-backs/ember-vault.png",
    templateKey: null,
    templateConfig: null,
    rarity: "rare",
});

assert.equal(imageTheme.overlayImageUrl, "/cosmetics/card-backs/ember-vault.png");
assert.equal(imageTheme.overlayOpacity, 0.24);

console.log("card-back theme smoke test passed");
