import { expect, test } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";

test.describe("admin promotions operations", () => {
    const enabled =
        process.env.ADMIN_PROMOTIONS_UX_INTEGRATION_TEST === "true";
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const username = `promotion_admin_${suffix}`;
    const password = `Promotion-${suffix}!`;
    let adminId: number | null = null;
    const discountIds: number[] = [];
    let couponId: number | null = null;

    test.skip(
        !enabled,
        "ADMIN_PROMOTIONS_UX_INTEGRATION_TEST=true is required"
    );

    test.beforeAll(async () => {
        const admin = await prisma.user.create({
            data: {
                username,
                password: await bcryptjs.hash(password, 10),
                role: "admin",
            },
        });
        adminId = admin.id;

        for (const label of ["A", "B"]) {
            const discount = await prisma.discountCampaign.create({
                data: {
                    code: `UX_CAMPAIGN_${label}_${suffix}`,
                    name: `UX Campaign ${label} ${suffix}`,
                    targetType: "global",
                    discountType: "percentage",
                    percentageOff: 10,
                    isActive: true,
                },
            });
            discountIds.push(discount.id);
        }

        const coupon = await prisma.couponCode.create({
            data: {
                code: `UX_COUPON_${suffix}`,
                name: `UX Coupon ${suffix}`,
                targetType: "global",
                discountType: "percentage",
                percentageOff: 15,
                isActive: true,
            },
        });
        couponId = coupon.id;
    });

    test.afterAll(async () => {
        try {
            if (discountIds.length > 0) {
                await prisma.discountCampaign.deleteMany({
                    where: { id: { in: discountIds } },
                });
            }
            if (couponId !== null) {
                await prisma.couponCode.deleteMany({
                    where: { id: couponId },
                });
            }
            if (adminId !== null) {
                await prisma.auditLog.deleteMany({
                    where: { actorUserId: adminId },
                });
                await prisma.user.deleteMany({ where: { id: adminId } });
            }
        } finally {
            await prisma.$disconnect();
        }
    });

    test("editor sheet, lifecycle confirmation and bulk status are responsive", async ({
        page,
    }) => {
        await page.goto("/admin/login");
        await page.getByLabel("Kullanici Adi").fill(username);
        await page.getByLabel("Sifre").fill(password);
        await page.getByRole("button", { name: "Giris Yap" }).click();
        await page.waitForURL(/\/admin(?:\/)?$/);

        const promotionResponses = Promise.all(
            [
                "/api/admin/shop-items?active=true",
                "/api/admin/promotions/bundles",
                "/api/admin/promotions/discounts",
                "/api/admin/promotions/coupons",
            ].map((path) =>
                page.waitForResponse(
                    (response) =>
                        response.url().endsWith(path) &&
                        response.request().method() === "GET"
                )
            )
        );
        await page.goto("/admin/promotions");
        const loadedResponses = await promotionResponses;
        for (const response of loadedResponses) {
            expect(
                response.ok(),
                `${response.url()} returned ${response.status()}`
            ).toBe(true);
        }
        await expect(
            page.getByRole("heading", { name: "Promosyonlar" })
        ).toBeVisible();
        await expect(
            page.getByText("Admin promosyon verileri yüklenemedi.")
        ).toBeHidden();

        await page.getByRole("button", { name: "Yeni Kupon" }).click();
        await expect(
            page.getByRole("heading", { name: "Yeni Kupon" })
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(
            page.getByRole("heading", { name: "Yeni Kupon" })
        ).toBeHidden();

        await page
            .getByTestId(`promotion-discount-edit-${discountIds[0]}`)
            .click();
        await expect(
            page.getByRole("heading", { name: "İndirimi Düzenle" })
        ).toBeVisible();
        await page.keyboard.press("Escape");

        await page
            .getByTestId(`promotion-coupon-lifecycle-${couponId}`)
            .click();
        await expect(
            page.getByRole("heading", { name: "Kaydı pasife al" })
        ).toBeVisible();
        await expect(
            page.getByText(
                "Kayıt mağaza ve ödeme akışında uygulanmayacak, ancak tekrar açılabilmek için sistemde kalacak."
            )
        ).toBeVisible();
        await page.getByRole("button", { name: "Vazgeç" }).click();

        await page
            .getByPlaceholder("Paket, kampanya veya kupon ara...")
            .fill(suffix);
        const bulkResponsePromise = page.waitForResponse(
            (response) =>
                response.url().endsWith(
                    "/api/admin/promotions/bulk-status"
                ) && response.request().method() === "PUT"
        );
        await page
            .locator("#discounts")
            .getByRole("button", { name: "Filtredekileri Durdur" })
            .click();
        const bulkResponse = await bulkResponsePromise;
        expect(bulkResponse.ok()).toBe(true);
        await expect(page.getByText("2 kayıt durduruldu.")).toBeVisible();

        const updatedDiscounts = await prisma.discountCampaign.findMany({
            where: { id: { in: discountIds } },
            select: { isActive: true },
        });
        expect(updatedDiscounts.every((discount) => !discount.isActive)).toBe(
            true
        );

        await page.setViewportSize({ width: 390, height: 844 });
        await page
            .getByPlaceholder("Paket, kampanya veya kupon ara...")
            .fill("");
        await page.getByRole("button", { name: "Yeni Kampanya" }).click();
        const sheet = page.locator('[data-slot="sheet-content"]');
        await expect(sheet).toBeVisible();
        const sheetBox = await sheet.boundingBox();
        expect(sheetBox).not.toBeNull();
        expect(sheetBox!.width).toBeLessThanOrEqual(390);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth
            )
        ).toBe(true);
    });
});
