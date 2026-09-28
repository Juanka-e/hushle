import assert from "node:assert/strict";
import bcryptjs from "bcryptjs";
import {
    getStoreCatalogPage,
    type StoreCatalogPolicy,
} from "@hushle/platform-store";
import {
    getRedisKey,
    invalidateJsonCache,
} from "@hushle/platform-cache";
import { prisma } from "@hushle/platform-db";

const policy: StoreCatalogPolicy = {
    storePriceMultiplier: 1,
    bundlesEnabled: true,
    couponsEnabled: true,
    discountCampaignsEnabled: true,
    activeMatchCoinMultiplier: 1,
    weekendBoostApplied: false,
};

async function run(): Promise<void> {
    if (process.env.STORE_CATALOG_CORE_INTEGRATION_TEST !== "true") {
        console.log(
            "test:store-catalog-core-integration skipped (set STORE_CATALOG_CORE_INTEGRATION_TEST=true)"
        );
        return;
    }

    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const password = await bcryptjs.hash("integration-password", 10);
    const user = await prisma.user.create({
        data: {
            username: `store_catalog_${suffix}`,
            password,
            wallet: { create: { coinBalance: 725 } },
            profile: { create: {} },
        },
    });
    const itemIds: number[] = [];
    let bundleId: number | null = null;
    let discountId: number | null = null;

    try {
        for (const [index, type] of [
            "avatar",
            "frame",
            "avatar",
        ].entries()) {
            const item = await prisma.shopItem.create({
                data: {
                    code: `catalog_${suffix}_${index}`,
                    type: type as "avatar" | "frame",
                    name: `Catalog ${index}`,
                    priceCoin: 100 + index * 50,
                    imageUrl: `/integration/catalog-${index}.png`,
                    sortOrder: -1_000_000 + index,
                },
            });
            itemIds.push(item.id);
        }
        await prisma.inventoryItem.create({
            data: {
                userId: user.id,
                shopItemId: itemIds[0]!,
                source: "grant",
            },
        });
        await prisma.userProfile.update({
            where: { userId: user.id },
            data: { avatarItemId: itemIds[0] },
        });
        const bundle = await prisma.shopBundle.create({
            data: {
                code: `bundle_${suffix}`,
                name: "Integration Bundle",
                priceCoin: 400,
                sortOrder: -1_000_000,
                items: {
                    create: itemIds.slice(0, 2).map((shopItemId, index) => ({
                        shopItemId,
                        sortOrder: index,
                    })),
                },
            },
        });
        bundleId = bundle.id;
        const discount = await prisma.discountCampaign.create({
            data: {
                code: `discount_${suffix}`,
                name: "Integration Discount",
                targetType: "shop_item",
                discountType: "fixed_coin",
                fixedCoinOff: 25,
                shopItemId: itemIds[0],
                stackableWithCoupon: true,
            },
        });
        discountId = discount.id;

        await invalidateJsonCache(
            getRedisKey("cache", "store-catalog-shared", "v1")
        );
        await invalidateJsonCache(
            getRedisKey("cache", "store-catalog-revision", "v2")
        );

        const first = await getStoreCatalogPage({
            userId: user.id,
            policy,
            query: { kind: "items", limit: 2 },
        });
        assert.equal(first.coinBalance, 725);
        assert.equal(first.items.length, 2);
        assert.equal(first.page.hasMore, true);
        assert.ok(first.page.nextCursor);

        const target = first.items.find((item) => item.id === itemIds[0]);
        assert.equal(target?.owned, true);
        assert.equal(target?.equipped, true);
        assert.equal(target?.pricing.finalPriceCoin, 75);

        const second = await getStoreCatalogPage({
            userId: user.id,
            policy,
            query: {
                kind: "items",
                limit: 2,
                cursor: first.page.nextCursor,
            },
        });
        assert.ok(
            first.items.every(
                (item) => !second.items.some((next) => next.id === item.id)
            )
        );

        const frames = await getStoreCatalogPage({
            userId: user.id,
            policy,
            query: { kind: "items", type: "frame" },
        });
        assert.ok(frames.items.every((item) => item.type === "frame"));

        const bundles = await getStoreCatalogPage({
            userId: user.id,
            policy,
            query: { kind: "bundles" },
        });
        const targetBundle = bundles.bundles.find(
            (entry) => entry.id === bundleId
        );
        assert.equal(targetBundle?.ownedItemCount, 1);
        assert.equal(targetBundle?.fullyOwned, false);

        console.log("test:store-catalog-core-integration ok");
    } finally {
        await invalidateJsonCache(
            getRedisKey("cache", "store-catalog-shared", "v1")
        );
        await invalidateJsonCache(
            getRedisKey("cache", "store-catalog-revision", "v2")
        );
        if (discountId) {
            await prisma.discountCampaign.deleteMany({
                where: { id: discountId },
            });
        }
        if (bundleId) {
            await prisma.shopBundle.deleteMany({ where: { id: bundleId } });
        }
        await prisma.inventoryItem.deleteMany({ where: { userId: user.id } });
        await prisma.user.deleteMany({ where: { id: user.id } });
        await prisma.shopItem.deleteMany({ where: { id: { in: itemIds } } });
        await prisma.$disconnect();
    }
}

void run();
