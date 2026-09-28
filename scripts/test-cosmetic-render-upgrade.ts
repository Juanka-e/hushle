import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const previewSource = readFileSync(
    "apps/web/src/components/game/cosmetic-preview.tsx",
    "utf8"
);
const shopSource = readFileSync(
    "apps/web/src/components/game/dashboard-pages/shop-content.tsx",
    "utf8"
);
const inventorySource = readFileSync(
    "apps/web/src/components/game/dashboard-pages/inventory-content.tsx",
    "utf8"
);
const profileSidebarSource = readFileSync(
    "apps/web/src/components/game/dashboard-profile-sidebar.tsx",
    "utf8"
);
const schemaSource = readFileSync("prisma/schema.prisma", "utf8");

assert.match(schemaSource, /thumbnailUrl\s+String\?\s+@map\("thumbnail_url"\)/);
assert.match(previewSource, /export const CosmeticThumbnail = memo/);
assert.match(previewSource, /data-cosmetic-thumbnail="asset"/);
assert.match(previewSource, /loading="lazy"/);

const thumbnailStart = previewSource.indexOf("export const CosmeticThumbnail");
const largePreviewStart = previewSource.indexOf("export function CosmeticLargePreview");
assert.ok(thumbnailStart >= 0 && largePreviewStart > thumbnailStart);
const thumbnailSource = previewSource.slice(thumbnailStart, largePreviewStart);
assert.doesNotMatch(thumbnailSource, /getCosmeticMotionClass|getCosmeticMotionStyle/);

for (const source of [shopSource, inventorySource]) {
    assert.match(source, /const COSMETIC_GRID_BATCH_SIZE = 24/);
    assert.match(source, /Daha fazla göster/);
    assert.match(source, /<CosmeticThumbnail item=/);
}

assert.match(shopSource, /sortedItems\.slice\(0, visibleItemCount\)/);
assert.match(inventorySource, /filteredItems\.slice\(0, visibleItemCount\)/);
assert.doesNotMatch(shopSource, /function StoreMiniPreview/);
assert.doesNotMatch(inventorySource, /CosmeticMiniPreview/);
assert.doesNotMatch(profileSidebarSource, /CosmeticMiniPreview/);
assert.match(shopSource, /previewOffer \? <PreviewModal/);
assert.match(inventorySource, /previewItem \? \(/);

console.log("Cosmetic render upgrade checks passed.");
