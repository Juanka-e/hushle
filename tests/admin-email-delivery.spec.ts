import { expect, test } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";

test.describe("admin email delivery operations", () => {
    const enabled = process.env.EMAIL_DELIVERY_ADMIN_E2E === "true";
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const username = `email_admin_${suffix}`;
    const password = `Email-Admin-${suffix}!`;
    const messageId = randomUUID();
    let adminId: number | null = null;

    test.skip(!enabled, "EMAIL_DELIVERY_ADMIN_E2E=true is required");

    test.beforeAll(async () => {
        const admin = await prisma.user.create({
            data: { username, password: await bcryptjs.hash(password, 10), role: "admin" },
        });
        adminId = admin.id;
        await prisma.emailOutboxMessage.create({
            data: {
                id: messageId,
                deduplicationKey: `admin-email-e2e:${suffix}`,
                messageClass: "transactional",
                template: "security_notice",
                recipient: `${username}@example.test`,
                subject: `E2E delivery ${suffix}`,
                payload: { siteName: "Hushle", title: "Test", message: "Test" },
                status: "dead_letter",
                attemptCount: 5,
                lastError: "Delivery failed (E2ETest)",
            },
        });
    });

    test.afterAll(async () => {
        await prisma.emailOutboxMessage.deleteMany({ where: { id: messageId } });
        if (adminId !== null) {
            await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } });
            await prisma.user.deleteMany({ where: { id: adminId } });
        }
        await prisma.$disconnect();
    });

    test("dead-letter message is visible and retried with server-side audit", async ({ page }) => {
        await page.goto("/admin/login");
        await page.getByLabel("Kullanici Adi").fill(username);
        await page.getByLabel("Sifre").fill(password);
        await page.getByRole("button", { name: "Giris Yap" }).click();
        await page.waitForURL(/\/admin(?:\/)?$/);

        await page.goto("/admin/email-delivery");
        await expect(page.getByRole("heading", { name: "E-posta Teslimatı" })).toBeVisible();
        await expect(page.getByText(`E2E delivery ${suffix}`)).toBeVisible();
        await page.getByRole("button", { name: "Yeniden dene" }).click();
        await expect(page.getByText("Mesaj kontrollü olarak yeniden kuyruğa alındı.")).toBeVisible();

        const message = await prisma.emailOutboxMessage.findUniqueOrThrow({ where: { id: messageId } });
        expect(message.status).toBe("pending");
        expect(message.attemptCount).toBe(0);
        expect(message.manualRetryCount).toBe(1);
        expect(
            await prisma.auditLog.count({
                where: { actorUserId: adminId, action: "admin.email_delivery.retry", resourceId: messageId },
            })
        ).toBe(1);
    });
});
