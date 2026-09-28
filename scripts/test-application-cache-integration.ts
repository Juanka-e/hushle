import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
    closeRedisClient,
    getOrSetJsonCache,
    invalidateJsonCache,
} from "@hushle/platform-cache";
import {
    APPLICATION_CACHE_KEYS,
    invalidateAdminDashboardStatsCache,
    invalidateSystemSettingsCache,
} from "../apps/web/src/lib/cache/application-cache";
import {
    getVisibleCategories,
    invalidateCategoryCache,
} from "../apps/web/src/lib/socket/category-service";
import { prisma } from "@hushle/platform-db";

async function run(): Promise<void> {
    assert.equal(
        process.env.APPLICATION_CACHE_MUTATION_TEST,
        "true",
        "APPLICATION_CACHE_MUTATION_TEST=true is required"
    );
    assert.ok(process.env.REDIS_URL?.trim(), "REDIS_URL is required");

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    let parentId: number | null = null;
    let childId: number | null = null;

    try {
        await Promise.all([
            invalidateJsonCache(APPLICATION_CACHE_KEYS.visibleCategories),
            invalidateJsonCache(
                APPLICATION_CACHE_KEYS.adminDashboardStaticStats
            ),
            invalidateSystemSettingsCache(),
        ]);

        const parent = await prisma.category.create({
            data: {
                name: `Cache parent ${suffix}`,
                isVisible: true,
                sortOrder: 90_000,
            },
        });
        parentId = parent.id;
        const firstTree = await getVisibleCategories();
        const cachedParent = firstTree.find(
            (category) => category.id === parent.id
        );
        assert.ok(cachedParent);
        assert.equal(cachedParent.children.length, 0);

        const child = await prisma.category.create({
            data: {
                name: `Cache child ${suffix}`,
                parentId: parent.id,
                isVisible: true,
                sortOrder: 90_001,
            },
        });
        childId = child.id;
        const staleTree = await getVisibleCategories();
        assert.equal(
            staleTree
                .find((category) => category.id === parent.id)
                ?.children.some((category) => category.id === child.id),
            false
        );

        await invalidateCategoryCache();
        const refreshedTree = await getVisibleCategories();
        assert.equal(
            refreshedTree
                .find((category) => category.id === parent.id)
                ?.children.some((category) => category.id === child.id),
            true
        );

        let dashboardLoads = 0;
        await getOrSetJsonCache({
            key: APPLICATION_CACHE_KEYS.adminDashboardStaticStats,
            ttlMs: 30_000,
            loader: async () => ({ generation: ++dashboardLoads }),
        });
        await getOrSetJsonCache({
            key: APPLICATION_CACHE_KEYS.adminDashboardStaticStats,
            ttlMs: 30_000,
            loader: async () => ({ generation: ++dashboardLoads }),
        });
        assert.equal(dashboardLoads, 1);
        await invalidateAdminDashboardStatsCache();
        const refreshedDashboard = await getOrSetJsonCache({
            key: APPLICATION_CACHE_KEYS.adminDashboardStaticStats,
            ttlMs: 30_000,
            loader: async () => ({ generation: ++dashboardLoads }),
        });
        assert.equal(refreshedDashboard.value.generation, 2);

        let settingsLoads = 0;
        const readSettingsGeneration = () =>
            getOrSetJsonCache({
                key: APPLICATION_CACHE_KEYS.systemSettings,
                ttlMs: 15_000,
                loader: async () => ({ generation: ++settingsLoads }),
            });
        await readSettingsGeneration();
        const cachedSettings = await readSettingsGeneration();
        assert.equal(cachedSettings.value.generation, 1);
        assert.equal(settingsLoads, 1);
        await invalidateSystemSettingsCache();
        const refreshedSettings = await readSettingsGeneration();
        assert.equal(refreshedSettings.value.generation, 2);

        console.log("application cache integration test passed");
    } finally {
        if (childId !== null) {
            await prisma.category.deleteMany({ where: { id: childId } });
        }
        if (parentId !== null) {
            await prisma.category.deleteMany({ where: { id: parentId } });
        }
        await Promise.all([
            invalidateJsonCache(APPLICATION_CACHE_KEYS.visibleCategories),
            invalidateJsonCache(
                APPLICATION_CACHE_KEYS.adminDashboardStaticStats
            ),
            invalidateSystemSettingsCache(),
        ]);
        await prisma.$disconnect();
        await closeRedisClient();
    }
}

void run();
