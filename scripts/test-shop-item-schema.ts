import assert from "node:assert/strict";
import {
    CosmeticRenderMode,
    ItemRarity,
    ShopItemType,
} from "@hushle/platform-db";
import {
    shopItemUpdateSchema,
    shopItemWriteSchema,
    toPrismaShopItemCreateData,
} from "../apps/web/src/lib/cosmetics/shop-item-schema";

const imageItem = shopItemWriteSchema.safeParse({
    code: "pulse_fox",
    type: "avatar",
    name: "Pulse Fox",
    rarity: "epic",
    renderMode: "image",
    priceCoin: 420,
    imageUrl: "/cosmetics/mock/avatars/pulse-fox.svg",
    thumbnailUrl: "/cosmetics/mock/thumbnails/pulse-fox.webp",
    templateKey: null,
    templateConfig: null,
    badgeText: "Yeni",
    isFeatured: true,
    isActive: true,
    sortOrder: 10,
});

assert.equal(imageItem.success, true);
if (!imageItem.success) {
    throw new Error("image item parse failed unexpectedly");
}
assert.equal(
    toPrismaShopItemCreateData(imageItem.data).thumbnailUrl,
    "/cosmetics/mock/thumbnails/pulse-fox.webp"
);

const templateItem = shopItemWriteSchema.safeParse({
    code: "ember_face",
    type: "card_face",
    name: "Ember Face",
    rarity: "legendary",
    renderMode: "template",
    priceCoin: 980,
    imageUrl: "",
    templateKey: "ember-glow",
    templateConfig: {
        palette: {
            primary: "#f97316",
            secondary: "#fb923c",
        },
    },
    badgeText: "Spotlight",
    isFeatured: true,
    isActive: true,
    sortOrder: 12,
});

assert.equal(templateItem.success, true);

if (!templateItem.success) {
    throw new Error("template item parse failed unexpectedly");
}

const prismaPayload = toPrismaShopItemCreateData(templateItem.data);
assert.equal(prismaPayload.type, ShopItemType.card_face);
assert.equal(prismaPayload.rarity, ItemRarity.legendary);
assert.equal(prismaPayload.renderMode, CosmeticRenderMode.template);

const invalidAvatar = shopItemUpdateSchema.safeParse({
    type: "avatar",
    renderMode: "template",
    templateKey: "broken-avatar",
});

assert.equal(invalidAvatar.success, false);

const invalidThumbnail = shopItemUpdateSchema.safeParse({
    thumbnailUrl: "data:image/svg+xml,<svg onload=alert(1)>",
});

assert.equal(invalidThumbnail.success, false);
assert.equal(
    shopItemUpdateSchema.parse({ thumbnailUrl: "" }).thumbnailUrl,
    ""
);

const unsupportedRenderSpec = shopItemUpdateSchema.safeParse({
    renderSpecVersion: 2,
});
assert.equal(unsupportedRenderSpec.success, false);

console.log("shop item schema smoke test passed");
