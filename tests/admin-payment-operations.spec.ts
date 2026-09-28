import { expect, test } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@hushle/platform-db";

test.describe("admin payment operations", () => {
    const enabled = process.env.PAYMENT_OPERATIONS_ADMIN_E2E === "true";
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const username = `payment_ops_${suffix}`;
    const password = `Payment-Ops-${suffix}!`;
    let adminId: number | null = null;
    let targetUserId: number | null = null;
    let orderId: string | null = null;
    let reversalId: string | null = null;
    let providerReviewOrderId: string | null = null;
    let providerReviewRequestId: string | null = null;
    let originalCheckoutControl: { value: Prisma.JsonValue; updatedByUserId: number | null } | null = null;

    test.skip(!enabled, "PAYMENT_OPERATIONS_ADMIN_E2E=true is required");
    test.beforeAll(async () => {
        const admin = await prisma.user.create({
            data: { username, password: await bcryptjs.hash(password, 10), role: "admin" },
        });
        adminId = admin.id;
        originalCheckoutControl = await prisma.systemSetting.findUnique({
            where: { key: "payment_checkout_control" },
            select: { value: true, updatedByUserId: true },
        });
        await prisma.systemSetting.upsert({
            where: { key: "payment_checkout_control" },
            update: {
                value: {
                    schemaVersion: 1,
                    paused: false,
                    rolloutPercent: 100,
                    revision: 0,
                    lastChangeReason: "E2E checkout control fixture",
                },
                updatedByUserId: admin.id,
            },
            create: {
                key: "payment_checkout_control",
                value: {
                    schemaVersion: 1,
                    paused: false,
                    rolloutPercent: 100,
                    revision: 0,
                    lastChangeReason: "E2E checkout control fixture",
                },
                updatedByUserId: admin.id,
            },
        });
        const target = await prisma.user.create({
            data: { username: `payment_target_${suffix}`, password: "e2e-test" },
        });
        targetUserId = target.id;
        orderId = randomUUID();
        reversalId = randomUUID();
        await prisma.paymentOrder.create({
            data: {
                id: orderId,
                userId: target.id,
                provider: "paytr",
                status: "refunded",
                idempotencyKey: `admin-payment-ops:${suffix}`,
                requestFingerprint: "e".repeat(64),
                productKind: "coin_pack",
                productReference: `coin_pack_${suffix}`,
                productVersion: 1,
                productNameSnapshot: "E2E Coin Pack",
                quantity: 1,
                unitAmountMinor: 1_000,
                totalAmountMinor: 1_000,
                currency: "TRY",
                grantSnapshot: { schemaVersion: 1, coinAmount: 100 },
                reversal: {
                    create: {
                        id: reversalId,
                        outcome: "refund",
                        status: "manual_review",
                        externalReference: `e2e-refund-${suffix}`,
                        reason: "E2E manual review",
                        evidence: {
                            kind: "coin_pack",
                            policy: "exact_payment_lot_reversal",
                            reversedCoin: 60,
                            unrecoveredCoin: 40,
                        },
                        manualReviewCase: {
                            create: {
                                reasonCode: "coin_spent_unrecovered",
                                unrecoveredCoin: 40,
                            },
                        },
                    },
                },
            },
        });
        providerReviewOrderId = randomUUID();
        providerReviewRequestId = randomUUID();
        await prisma.paymentOrder.create({
            data: {
                id: providerReviewOrderId,
                userId: target.id,
                provider: "paytr",
                status: "fulfilled",
                idempotencyKey: `admin-provider-refund:${suffix}`,
                requestFingerprint: "d".repeat(64),
                productKind: "cosmetic_item",
                productReference: `refund_item_${suffix}`,
                productVersion: 1,
                productNameSnapshot: "E2E Provider Refund",
                quantity: 1,
                unitAmountMinor: 1_250,
                totalAmountMinor: 1_250,
                currency: "TRY",
                grantSnapshot: { schemaVersion: 1, items: [{ shopItemId: 1 }] },
                providerOrderReference: providerReviewOrderId.replaceAll("-", ""),
                providerSessionReference: `secret-session-${suffix}`,
                providerHostedUrl: `https://sandbox-cpp.iyzipay.com/?token=secret-hosted-${suffix}`,
                paidAt: new Date(),
                fulfilledAt: new Date(),
                reversalRequests: {
                    create: {
                        id: providerReviewRequestId,
                        outcome: "refund",
                        status: "provider_review",
                        executionMode: "provider_api",
                        externalReference: `RF${providerReviewRequestId.replaceAll("-", "")}`,
                        reason: "E2E timeout recovery",
                        requestedByUserId: admin.id,
                        providerRefundAttempt: {
                            create: {
                                provider: "paytr",
                                status: "uncertain",
                                amountMinor: 1_250,
                                currency: "TRY",
                                referenceNo: `RF${providerReviewRequestId.replaceAll("-", "")}`,
                                errorCode: "provider_timeout",
                            },
                        },
                    },
                },
            },
        });
    });
    test.afterAll(async () => {
        if (targetUserId !== null) {
            await prisma.notification.deleteMany({ where: { userId: targetUserId } });
        }
        if (reversalId !== null) {
            await prisma.paymentManualReviewCase.deleteMany({ where: { reversalId } });
            await prisma.paymentReversal.deleteMany({ where: { id: reversalId } });
        }
        if (orderId !== null) {
            await prisma.paymentOrder.deleteMany({ where: { id: orderId } });
        }
        if (providerReviewRequestId !== null) {
            await prisma.paymentProviderRefundAttempt.deleteMany({ where: { reversalRequestId: providerReviewRequestId } });
            await prisma.paymentReversalRequest.deleteMany({ where: { id: providerReviewRequestId } });
        }
        if (providerReviewOrderId !== null) {
            await prisma.paymentOrder.deleteMany({ where: { id: providerReviewOrderId } });
        }
        if (adminId !== null) {
            await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } });
            if (originalCheckoutControl) {
                await prisma.systemSetting.update({
                    where: { key: "payment_checkout_control" },
                    data: {
                        value: originalCheckoutControl.value as Prisma.InputJsonValue,
                        updatedByUserId: originalCheckoutControl.updatedByUserId,
                    },
                });
            } else {
                await prisma.systemSetting.deleteMany({ where: { key: "payment_checkout_control" } });
            }
            await prisma.user.deleteMany({ where: { id: adminId } });
        }
        if (targetUserId !== null) {
            await prisma.user.deleteMany({ where: { id: targetUserId } });
        }
        await prisma.$disconnect();
    });

    test("renders the responsive fail-safe operations view", async ({ page }) => {
        await page.goto("/admin/login");
        await page.getByLabel("Kullanici Adi").fill(username);
        await page.getByLabel("Sifre").fill(password);
        await page.getByRole("button", { name: "Giris Yap" }).click();
        await page.waitForURL(/\/admin(?:\/)?$/);
        await page.goto("/admin/payments");
        const operationsPayload = await page.evaluate(async () => {
            const response = await fetch("/api/admin/payments?limit=50", { cache: "no-store" });
            return JSON.stringify(await response.json());
        });
        expect(operationsPayload).not.toContain(`secret-session-${suffix}`);
        expect(operationsPayload).not.toContain(`secret-hosted-${suffix}`);
        await expect(page.getByRole("heading", { name: "Ödeme Operasyonları" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Checkout yayın kontrolü" })).toBeVisible();
        await expect(page.getByText("Açık · kullanıcıların %100'i")).toBeVisible();
        await page.getByRole("button", { name: "Acil durdur" }).click();
        await expect(page.getByText("Yeni checkout işlemleri durduruldu.")).toBeVisible();
        await expect(page.getByText("Yeni checkout durduruldu")).toBeVisible();
        await expect(page.getByText(/Sağlayıcı API iadesi yalnız hazır yapılandırmada/)).toBeVisible();
        await expect(page.getByText("PayTR sandbox iade kapalı")).toBeVisible();
        await expect(page.getByText("Shopier canlı iade kapalı")).toBeVisible();
        await expect(page.getByText("Açık uzlaştırma")).toBeVisible();
        await expect(page.getByText("İkinci onay bekliyor")).toBeVisible();
        await expect(page.getByText("Açık manuel inceleme", { exact: true })).toBeVisible();
        await expect(page.getByText("Dead-letter")).toBeVisible();
        await expect(page.getByText(/Webhook worker:/)).toBeVisible();
        await expect(page.getByText(/Uzlaştırma worker:/)).toBeVisible();
        await expect(page.getByText(/farklı bir adminin ikinci onayıyla çalışır/).first()).toBeVisible();
        await expect(page.getByText(/Sağlayıcı iadesi doğrulama bekliyor/)).toBeVisible();
        await expect(page.getByText(/Hata: provider_timeout/)).toBeVisible();
        await expect(page.getByRole("button", { name: "Sağlayıcı durumunu doğrula" })).toBeVisible();
        await expect(page.getByText("Açık manuel inceleme · coin_spent_unrecovered")).toBeVisible();
        await expect(page.getByText(/Bu karar bakiye, askıya alma veya ekonomi guard ayarını değiştirmez/)).toBeVisible();
        await page.getByPlaceholder("Zorunlu operasyon karar notu").fill("E2E provider kanıtı incelendi");
        await page.getByText("Oyuncuya genel bildirim gönder").click();
        await page.getByPlaceholder("Bildirim mesajı (boşsa güvenli varsayılan metin)").fill("Ödeme incelemeniz tamamlandı.");
        await page.getByPlaceholder(`Onay için reversal ID: ${reversalId}`).fill(reversalId!);
        await page.getByRole("button", { name: "İncelemeyi kapat" }).click();
        await expect(page.getByText("Manuel inceleme kararı kaydedildi.")).toBeVisible();
        await expect(page.getByText("İnceleme tamamlandı")).toBeVisible();
        await expect(page.getByText("Oyuncuya bildirim gönderildi")).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.getByPlaceholder("Sipariş, sağlayıcı referansı veya kullanıcı ara")).toBeVisible();
    });
});
