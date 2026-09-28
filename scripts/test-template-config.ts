import assert from "node:assert/strict";
import {
    getTemplateNumber,
    getTemplateString,
    normalizeTemplateConfig,
} from "../apps/web/src/lib/cosmetics/template-config";

const normalized = normalizeTemplateConfig({
    palette: {
        primary: "#22c55e",
        secondary: "#bbf7d0",
    },
    pattern: {
        type: "rings",
        opacity: 0.24,
        scale: 16,
    },
    labels: ["hero", "spring"],
    invalid: {
        deep: {
            more: {
                drop: "x",
            },
        },
    },
});

assert.ok(normalized);
assert.equal(getTemplateString(normalized, ["palette", "primary"]), "#22c55e");
assert.equal(getTemplateNumber(normalized, ["pattern", "opacity"]), 0.24);
assert.equal(getTemplateString(normalized, ["invalid", "deep", "more"]), undefined);

console.log("template config smoke test passed");
