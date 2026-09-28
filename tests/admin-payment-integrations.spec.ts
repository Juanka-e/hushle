import { expect, test } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";

test.describe("admin payment integration readiness", () => {
    const enabled = process.env.PAYMENT_INTEGRATIONS_ADMIN_E2E === "true";
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const username = `payment_admin_${suffix}`;
    const password = `Payment-Admin-${suffix}!`;
    let adminId: number | null = null;

    test.skip(!enabled, "PAYMENT_INTEGRATIONS_ADMIN_E2E=true is required");

    test.beforeAll(async () => {
        const admin = await prisma.user.create({
            data: {
                username,
                password: await bcryptjs.hash(password, 10),
                role: "admin",
            },
        });
        adminId = admin.id;
    });

    test.afterAll(async () => {
        if (adminId !== null) {
            await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } });
            await prisma.user.deleteMany({ where: { id: adminId } });
        }
        await prisma.$disconnect();
    });

    test("shows fail-closed checkout gate and provider readiness", async ({ page }) => {
        await page.goto("/admin/login");
        await page.getByLabel("Kullanici Adi").fill(username);
        await page.getByLabel("Sifre").fill(password);
        await page.getByRole("button", { name: "Giris Yap" }).click();
        await page.waitForURL(/\/admin(?:\/)?$/);

        await page.goto("/admin/integrations");
        await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Commerce" })).toBeVisible();
        await expect(page.getByText("Email Feedback", { exact: true })).toBeVisible();
        await expect(page.getByText("Payment Checkout Gate")).toBeVisible();
        await expect(page.getByText("Checkout is fail-closed and does not accept payments.")).toBeVisible();

        for (const provider of ["Shopier V2", "iyzico", "PayTR", "Stripe", "Lemon Squeezy"]) {
            await expect(page.getByText(provider, { exact: true })).toBeVisible();
        }
        await expect(page.getByText(/sk_test|whsec|merchant_secret/i)).toHaveCount(0);
    });
});
