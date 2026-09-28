import assert from "node:assert/strict";
import { resolveFrameTheme } from "../apps/web/src/lib/cosmetics/frame";

const templateTheme = resolveFrameTheme({
    renderMode: "template",
    imageUrl: "",
    templateKey: "ember_edge",
    templateConfig: {
        palette: {
            primary: "#22c55e",
            secondary: "#bbf7d0",
        },
        pattern: {
            type: "noise",
            opacity: 0.18,
            scale: 18,
        },
        frame: {
            style: "ornate",
            thickness: 4,
            radius: 22,
        },
        motion: {
            preset: "shimmer",
            speedMs: 3800,
        },
    },
    rarity: "epic",
});

assert.ok(templateTheme);
assert.equal(templateTheme?.accentColor, "#22c55e");
assert.equal(templateTheme?.secondaryColor, "#bbf7d0");
assert.equal(templateTheme?.pattern, "noise");
assert.equal(templateTheme?.frameStyle, "ornate");
assert.equal(templateTheme?.thickness, 4);
assert.equal(templateTheme?.motionPreset, "shimmer");
assert.equal(templateTheme?.imageUrl, null);

const unsafeTemplateTheme = resolveFrameTheme({
    renderMode: "template",
    imageUrl: "",
    templateKey: "royal_ring",
    templateConfig: {
        palette: {
            primary: "javascript:alert(1)",
        },
    },
    rarity: "rare",
});

assert.ok(unsafeTemplateTheme);
assert.equal(unsafeTemplateTheme?.accentColor, "#8b5cf6");

const imageTheme = resolveFrameTheme({
    renderMode: "image",
    imageUrl: "/cosmetics/frames/royal.png",
    templateKey: null,
    templateConfig: null,
    rarity: "legendary",
});

assert.ok(imageTheme);
assert.equal(imageTheme?.imageUrl, "/cosmetics/frames/royal.png");
assert.equal(imageTheme?.accentColor, "#f59e0b");

console.log("frame theme smoke test passed");
