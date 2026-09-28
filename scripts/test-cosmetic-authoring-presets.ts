import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    getCosmeticAuthoringPresets,
    serializeCosmeticAuthoringPreset,
} from "../apps/web/src/lib/cosmetics/authoring-presets";
import { shopItemWriteSchema } from "../apps/web/src/lib/cosmetics/shop-item-schema";

assert.equal(getCosmeticAuthoringPresets("avatar").length, 0);

for (const type of ["frame", "card_back", "card_face"] as const) {
    const presets = getCosmeticAuthoringPresets(type);
    assert.equal(presets.length >= 2, true);
    assert.equal(new Set(presets.map((preset) => preset.id)).size, presets.length);

    for (const preset of presets) {
        assert.doesNotThrow(() => JSON.parse(serializeCosmeticAuthoringPreset(preset)));
        assert.equal(shopItemWriteSchema.safeParse({
            code: `test_${type}_${preset.id}`.replaceAll("-", "_"),
            type,
            name: preset.label,
            rarity: "epic",
            renderMode: "template",
            renderSpecVersion: 1,
            priceCoin: 100,
            imageUrl: "",
            thumbnailUrl: null,
            templateKey: preset.templateKey,
            templateConfig: preset.config,
            badgeText: null,
            availabilityMode: "always_on",
            startsAt: null,
            endsAt: null,
            isFeatured: false,
            isActive: true,
            sortOrder: 0,
        }).success, true, `${type}/${preset.id} must satisfy the write schema`);
    }
}

const pageSource = readFileSync(
    "apps/web/src/app/admin/(dashboard)/shop-items/page.tsx",
    "utf8"
);
assert.match(pageSource, /Güvenli Başlangıç Presetleri/);
assert.match(pageSource, /templateKey: preset\.templateKey/);
assert.match(pageSource, /templateConfigText: serializeCosmeticAuthoringPreset\(preset\)/);

console.log("Cosmetic authoring preset checks passed.");
