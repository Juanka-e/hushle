import { expect, test } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import { invalidateCategoryCache } from "../apps/web/src/lib/socket/category-service";

test.describe("admin category reorder", () => {
    const enabled = process.env.CATEGORY_DND_INTEGRATION_TEST === "true";
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const username = `category_admin_${suffix}`;
    const password = `Category-${suffix}!`;
    let adminId: number | null = null;
    const categoryIds: number[] = [];
    let originalOrder: Array<{ id: number; sortOrder: number }> = [];

    test.skip(!enabled, "CATEGORY_DND_INTEGRATION_TEST=true is required");

    test.beforeAll(async () => {
        originalOrder = await prisma.category.findMany({
            where: { parentId: null },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: { id: true, sortOrder: true },
        });
        const maxSortOrder = originalOrder.reduce(
            (maximum, category) => Math.max(maximum, category.sortOrder),
            0
        );
        const admin = await prisma.user.create({
            data: {
                username,
                password: await bcryptjs.hash(password, 10),
                role: "admin",
            },
        });
        adminId = admin.id;

        for (const [index, label] of ["A", "B", "C"].entries()) {
            const category = await prisma.category.create({
                data: {
                    name: `DND ${label} ${suffix}`,
                    sortOrder: maxSortOrder + (index + 1) * 10,
                    isVisible: true,
                },
            });
            categoryIds.push(category.id);
        }
    });

    test.afterAll(async () => {
        try {
            if (originalOrder.length > 0) {
                await prisma.$transaction(
                    originalOrder.map((category) =>
                        prisma.category.update({
                            where: { id: category.id },
                            data: { sortOrder: category.sortOrder },
                        })
                    )
                );
            }
            if (categoryIds.length > 0) {
                await prisma.category.deleteMany({
                    where: { id: { in: categoryIds } },
                });
            }
            if (adminId !== null) {
                await prisma.auditLog.deleteMany({
                    where: {
                        actorUserId: adminId,
                        action: "admin.category.reorder",
                    },
                });
                await prisma.user.deleteMany({ where: { id: adminId } });
            }
            invalidateCategoryCache();
        } finally {
            await prisma.$disconnect();
        }
    });

    test("mouse drag persists and mobile controls restore the order", async ({
        page,
    }) => {
        const [firstId, secondId] = categoryIds;
        await page.goto("/admin/login");
        await page.getByLabel("Kullanici Adi").fill(username);
        await page.getByLabel("Sifre").fill(password);
        await page.getByRole("button", { name: "Giris Yap" }).click();
        await page.waitForURL(/\/admin(?:\/)?$/);

        await page.goto("/admin/categories");
        await expect(page.getByTestId(`category-row-${firstId}`)).toBeVisible();

        const source = page.getByTestId(`category-drag-${firstId}`);
        const target = page.getByTestId(`category-row-${secondId}`);
        const sourceBox = await source.boundingBox();
        const targetBox = await target.boundingBox();
        expect(sourceBox).not.toBeNull();
        expect(targetBox).not.toBeNull();

        await page.mouse.move(
            sourceBox!.x + sourceBox!.width / 2,
            sourceBox!.y + sourceBox!.height / 2
        );
        const dragResponsePromise = page.waitForResponse(
            (response) =>
                response.url().endsWith("/api/admin/categories/reorder") &&
                response.request().method() === "POST"
        );
        await page.mouse.down();
        await page.mouse.move(
            targetBox!.x + targetBox!.width / 2,
            targetBox!.y + targetBox!.height * 0.8,
            { steps: 12 }
        );
        await page.mouse.up();
        const dragResponse = await dragResponsePromise;
        expect(dragResponse.ok()).toBe(true);
        await expect(
            page.getByText("Kategori sırası kaydedildi.").last()
        ).toBeVisible();

        const draggedOrder = await prisma.category.findMany({
            where: { id: { in: [firstId, secondId] } },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: { id: true },
        });
        expect(draggedOrder.map((category) => category.id)).toEqual([
            secondId,
            firstId,
        ]);

        await page.setViewportSize({ width: 390, height: 844 });
        const mobileResponsePromise = page.waitForResponse(
            (response) =>
                response.url().endsWith("/api/admin/categories/reorder") &&
                response.request().method() === "POST"
        );
        await page.getByTestId(`category-up-${firstId}`).click();
        const mobileResponse = await mobileResponsePromise;
        expect(mobileResponse.ok()).toBe(true);
        await expect(
            page.getByText("Kategori sırası kaydedildi.").last()
        ).toBeVisible();

        const restoredOrder = await prisma.category.findMany({
            where: { id: { in: [firstId, secondId] } },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: { id: true },
        });
        expect(restoredOrder.map((category) => category.id)).toEqual([
            firstId,
            secondId,
        ]);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth
            )
        ).toBe(true);
    });
});
