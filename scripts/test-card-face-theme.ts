import assert from "node:assert/strict";
import { resolveCardFaceTheme } from "../apps/web/src/lib/cosmetics/card-face";

const templateTheme = resolveCardFaceTheme({
    renderMode: "template",
    imageUrl: "",
    templateKey: "signal_grid",
    templateConfig: {
        palette: {
            primary: "#10b981",
            secondary: "#a7f3d0",
            border: "#6ee7b7",
        },
        pattern: {
            type: "rings",
            opacity: 0.3,
            scale: 22,
        },
        glow: {
            color: "#34d399",
            blur: 38,
            opacity: 0.28,
        },
        motion: {
            preset: "pulse",
            speedMs: 4100,
        },
        overlay: {
            opacity: 0.9,
        },
    },
    rarity: "epic",
});

assert.equal(templateTheme.accentColor, "#10b981");
assert.equal(templateTheme.secondaryColor, "#a7f3d0");
assert.equal(templateTheme.borderColor, "#6ee7b7");
assert.equal(templateTheme.pattern, "rings");
assert.equal(templateTheme.patternScale, 22);
assert.equal(templateTheme.motionPreset, "pulse");
assert.equal(templateTheme.motionSpeedMs, 4100);
assert.equal(templateTheme.glowBlur, 38);
assert.equal(templateTheme.overlayOpacity, 0.35);
assert.equal(templateTheme.overlayImageUrl, null);

const unsafeTheme = resolveCardFaceTheme({
    renderMode: "template",
    imageUrl: "",
    templateKey: "ember_glow",
    templateConfig: {
        palette: {
            primary: "javascript:alert(1)",
        },
        pattern: {
            type: "<script>",
        },
    },
    rarity: "legendary",
});

assert.equal(unsafeTheme.accentColor, "#f97316");
assert.equal(unsafeTheme.pattern, "diagonal");

const imageTheme = resolveCardFaceTheme({
    renderMode: "image",
    imageUrl: "/cosmetics/card-faces/signal-grid.png",
    templateKey: null,
    templateConfig: null,
    rarity: "rare",
});

assert.equal(imageTheme.overlayImageUrl, "/cosmetics/card-faces/signal-grid.png");
assert.equal(imageTheme.overlayOpacity, 0.18);

console.log("card-face theme smoke test passed");
