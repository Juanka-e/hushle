import assert from "node:assert/strict";
import bcryptjs from "bcryptjs";
import {
    equipInventoryItem,
    getInventoryPage,
    InventoryError,
} from "@hushle/platform-inventory";
import { prisma } from "@hushle/platform-db";

async function run(): Promise<void> {
    if (process.env.INVENTORY_CORE_INTEGRATION_TEST !== "true") {
        console.log(
            "test:inventory-core-integration skipped (set INVENTORY_CORE_INTEGRATION_TEST=true)"
        );
        return;
    }

    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const password = await bcryptjs.hash("integration-password", 10);
    const user = await prisma.user.create({
        data: { username: `inventory_${suffix}`, password },
    });
    const other = await prisma.user.create({
        data: { username: `inventory_other_${suffix}`, password },
    });
    const itemIds: number[] = [];

    try {
        const avatar = await prisma.shopItem.create({
            data: {
                code: `avatar_${suffix}`,
                type: "avatar",
                name: "Integration Avatar",
                rarity: "rare",
                renderMode: "image",
                priceCoin: 100,
                imageUrl: "/integration/avatar.png",
            },
        });
        const frame = await prisma.shopItem.create({
            data: {
                code: `frame_${suffix}`,
                type: "frame",
                name: "Integration Frame",
                rarity: "epic",
                renderMode: "template",
                priceCoin: 200,
                imageUrl: "",
                templateKey: "integration",
                templateConfig: { accentColor: "#ffffff" },
            },
        });
        const unowned = await prisma.shopItem.create({
            data: {
                code: `unowned_${suffix}`,
                type: "avatar",
                name: "Unowned Avatar",
                priceCoin: 300,
                imageUrl: "/integration/unowned.png",
            },
        });
        itemIds.push(avatar.id, frame.id, unowned.id);

        await prisma.inventoryItem.createMany({
            data: [
                {
                    userId: user.id,
                    shopItemId: avatar.id,
                    source: "grant",
                },
                {
                    userId: user.id,
                    shopItemId: frame.id,
                    source: "purchase",
                },
            ],
        });

        const firstPage = await getInventoryPage({
            userId: user.id,
            query: { limit: 1 },
        });
        assert.equal(firstPage.items.length, 1);
        assert.equal(firstPage.page.hasMore, true);
        assert.ok(firstPage.page.nextCursor);

        const secondPage = await getInventoryPage({
            userId: user.id,
            query: { limit: 1, cursor: firstPage.page.nextCursor },
        });
        assert.equal(secondPage.items.length, 1);
        assert.notEqual(
            firstPage.items[0]?.inventoryItemId,
            secondPage.items[0]?.inventoryItemId
        );
        assert.equal(secondPage.page.hasMore, false);

        const frames = await getInventoryPage({
            userId: user.id,
            query: { type: "frame" },
        });
        assert.deepEqual(frames.items.map((item) => item.shopItemId), [
            frame.id,
        ]);

        const equipped = await equipInventoryItem({
            userId: user.id,
            request: { itemType: "avatar", shopItemId: avatar.id },
        });
        assert.equal(equipped.equippedSlots.avatarItemId, avatar.id);
        assert.equal(
            (
                await getInventoryPage({
                    userId: user.id,
                    query: { type: "avatar" },
                })
            ).items[0]?.equipped,
            true
        );

        await assert.rejects(
            () =>
                equipInventoryItem({
                    userId: user.id,
                    request: { itemType: "frame", shopItemId: avatar.id },
                }),
            (error: unknown) =>
                error instanceof InventoryError &&
                error.code === "type_mismatch"
        );
        await assert.rejects(
            () =>
                equipInventoryItem({
                    userId: user.id,
                    request: { itemType: "avatar", shopItemId: unowned.id },
                }),
            (error: unknown) =>
                error instanceof InventoryError &&
                error.code === "not_owned"
        );

        const unequipped = await equipInventoryItem({
            userId: user.id,
            request: { itemType: "avatar", shopItemId: null },
        });
        assert.equal(unequipped.equippedSlots.avatarItemId, null);

        await assert.rejects(
            () =>
                getInventoryPage({
                    userId: other.id,
                    query: { cursor: "not-a-cursor" },
                }),
            (error: unknown) =>
                error instanceof InventoryError &&
                error.code === "invalid_cursor"
        );

        console.log("test:inventory-core-integration ok");
    } finally {
        await prisma.inventoryItem.deleteMany({
            where: { userId: { in: [user.id, other.id] } },
        });
        await prisma.user.deleteMany({
            where: { id: { in: [user.id, other.id] } },
        });
        await prisma.shopItem.deleteMany({ where: { id: { in: itemIds } } });
        await prisma.$disconnect();
    }
}

void run();
