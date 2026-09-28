import { expect, test } from "@playwright/test";
import bcryptjs from "bcryptjs";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import { createPaymentOrderRecord } from "@hushle/platform-payments";

test.describe("payment checkout UI", () => {
    const enabled = process.env.PAYMENT_CHECKOUT_E2E === "true";
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const username = `checkout_ui_${suffix}`;
    const password = `Checkout-Ui-${suffix}!`;
    const offerCode = `checkout-ui-${suffix}`;
    let userId: number | null = null;
    let foreignUserId: number | null = null;
    let ownOrderId = "";
    let foreignOrderId = "";

    test.skip(!enabled, "PAYMENT_CHECKOUT_E2E=true is required");

    test.beforeAll(async () => {
        const user = await prisma.user.create({
            data: {
                username,
                password: await bcryptjs.hash(password, 10),
                email: `${username}@example.test`,
                normalizedEmail: `${username}@example.test`,
                emailVerifiedAt: new Date(),
            },
        });
        userId = user.id;
        const foreignUser = await prisma.user.create({
            data: { username: `checkout_foreign_${suffix}`, password: "test-only" },
        });
        foreignUserId = foreignUser.id;
        const quote = {
            productKind: "cosmetic_item" as const,
            productReference: `avatar-${suffix}`,
            productVersion: 1,
            productName: "Gece Mavisi Avatar",
            quantity: 1,
            unitAmountMinor: 14_900,
            currency: "TRY",
            grantSnapshot: {
                schemaVersion: 2,
                plan: { schemaVersion: 1, effects: [{
                    effectId: "avatar", type: "inventory_entitlement",
                    catalog: "shop_item", itemReference: "1", renderSnapshot: {},
                }] },
            },
        };
        ownOrderId = (await createPaymentOrderRecord({
            userId: user.id,
            provider: "iyzico",
            providerConfigVersion: 1,
            idempotencyKey: `checkout-ui-own:${suffix}`,
            quote,
        })).order.id;
        foreignOrderId = (await createPaymentOrderRecord({
            userId: foreignUser.id,
            provider: "iyzico",
            providerConfigVersion: 1,
            idempotencyKey: `checkout-ui-foreign:${suffix}`,
            quote,
        })).order.id;
        await prisma.paymentOffer.create({
            data: {
                code: offerCode,
                productKind: "cosmetic_item",
                productReference: `avatar-${suffix}`,
                productVersion: 1,
                productName: "Gece Mavisi Avatar",
                description: "Checkout responsive görünüm testi",
                unitAmountMinor: 14_900,
                currency: "TRY",
                grantSnapshot: quote.grantSnapshot,
                isActive: true,
            },
        });
    });

    test.afterAll(async () => {
        if (userId !== null) {
            await prisma.paymentCheckoutConsent.deleteMany({ where: { order: { userId } } });
            await prisma.paymentOrder.deleteMany({ where: { userId } });
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        if (foreignUserId !== null) {
            await prisma.paymentOrder.deleteMany({ where: { userId: foreignUserId } });
            await prisma.user.deleteMany({ where: { id: foreignUserId } });
        }
        await prisma.paymentOffer.deleteMany({ where: { code: offerCode } });
        await prisma.$disconnect();
    });

    test("shows server-priced offer, separate privacy notice and fail-closed action", async ({ page }) => {
        await page.goto("/login");
        await page.getByPlaceholder("Kullanıcı Adı").fill(username);
        await page.getByPlaceholder("Parola").fill(password);
        await page.getByRole("button", { name: "Giriş Yap" }).click();
        await page.waitForURL(/\/dashboard/);

        await page.goto("/checkout");
        await expect(page.getByRole("heading", { name: "Hesabın için dijital ürünler" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Gece Mavisi Avatar" })).toBeVisible();
        await expect(page.getByText("₺149,00").first()).toBeVisible();
        await expect(page.getByRole("link", { name: "Ödeme Aydınlatma Metni" })).toBeVisible();
        const submit = page.getByRole("button", { name: "Ödeme yükümlülüğü doğuran siparişi ver" });
        await expect(submit).toBeDisabled();
        await page.getByRole("checkbox").check();
        await expect(submit).toBeDisabled();
        await expect(page.getByText("Ödeme altyapısı şu anda kullanıma hazır değil.")).toBeVisible();

        const orderStatuses = await page.evaluate(async ({ own, foreign }) => {
            const [ownResponse, foreignResponse] = await Promise.all([
                fetch(`/api/payments/orders/${own}`, { cache: "no-store" }),
                fetch(`/api/payments/orders/${foreign}`, { cache: "no-store" }),
            ]);
            return [ownResponse.status, foreignResponse.status];
        }, { own: ownOrderId, foreign: foreignOrderId });
        expect(orderStatuses).toEqual([200, 404]);

        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.getByRole("heading", { name: "Hesabın için dijital ürünler" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Gece Mavisi Avatar" })).toBeVisible();
    });

    test("submits transient contact data and opens the sandbox PayTR iframe", async ({ page }) => {
        await page.goto("/login");
        await page.getByPlaceholder("Kullanıcı Adı").fill(username);
        await page.getByPlaceholder("Parola").fill(password);
        await page.getByRole("button", { name: "Giriş Yap" }).click();
        await page.waitForURL(/\/dashboard/);

        await page.route("**/api/payments/offers", async (route) => {
            await route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    offers: [{
                        code: offerCode,
                        productKind: "coin_pack",
                        productName: "500 Coin Paketi",
                        description: "Lot korumalı sandbox coin testi",
                        unitAmountMinor: 14900,
                        currency: "TRY",
                    }],
                    checkout: {
                        provider: "paytr",
                        available: true,
                        unavailableReason: null,
                        buyerDataPolicyVersion: null,
                        legalDocuments: {
                            checkoutTerms: { version: "terms-v1", href: "/legal/checkout-terms" },
                            privacyNotice: { version: "privacy-v1", href: "/legal/payment-privacy-notice" },
                            distanceSalesNotice: { version: "distance-v1", href: "/legal/distance-sales-pre-information" },
                        },
                    },
                }),
            });
        });
        let checkoutBody: Record<string, unknown> | null = null;
        await page.route("**/api/payments/checkout/session", async (route) => {
            checkoutBody = route.request().postDataJSON() as Record<string, unknown>;
            await route.fulfill({
                status: 201,
                contentType: "application/json",
                body: JSON.stringify({
                    orderId: ownOrderId,
                    iframeUrl: "https://www.paytr.com/odeme/guvenli/playwright-token",
                    sandbox: true,
                }),
            });
        });
        await page.route(`**/api/payments/orders/${ownOrderId}`, async (route) => {
            await route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    order: {
                        id: ownOrderId,
                        status: "awaiting_payment",
                        productNameSnapshot: "500 Coin Paketi",
                        quantity: 1,
                        totalAmountMinor: 14900,
                        currency: "TRY",
                        createdAt: new Date().toISOString(),
                    },
                    paymentSession: {
                        iframeUrl: "https://www.paytr.com/odeme/guvenli/playwright-token",
                    },
                }),
            });
        });
        await page.route("https://www.paytr.com/odeme/guvenli/playwright-token", async (route) => {
            await route.fulfill({
                contentType: "text/html",
                body: "<main><h1>PayTR sandbox fixture</h1></main>",
            });
        });

        await page.goto("/checkout");
        await expect(page.getByRole("heading", { name: "500 Coin Paketi" })).toBeVisible();
        await page.getByLabel("Ad ve soyad").fill("Test Oyuncu");
        await page.getByLabel("Telefon").fill("+90 555 111 22 33");
        await page.getByLabel("Fatura/iletişim adresi").fill("Test Mahallesi Istanbul");
        await page.getByRole("checkbox").check();
        const submit = page.getByRole("button", { name: "Ödeme yükümlülüğü doğuran siparişi ver" });
        await expect(submit).toBeEnabled();
        await submit.click();

        await expect(page.getByText("SANDBOX TEST")).toBeVisible();
        await expect(page.frameLocator('iframe[title="PayTR güvenli ödeme"]').getByText("PayTR sandbox fixture")).toBeVisible();
        await expect(page.getByLabel("Ad ve soyad")).toHaveValue("");
        await expect(page.getByLabel("Telefon")).toHaveValue("");
        await expect(page.getByLabel("Fatura/iletişim adresi")).toHaveValue("");
        expect(checkoutBody).toMatchObject({
            contact: {
                fullName: "Test Oyuncu",
                phone: "+90 555 111 22 33",
                address: "Test Mahallesi Istanbul",
            },
        });
    });

    test("submits request-only iyzico buyer data and follows an allowlisted redirect", async ({ page }) => {
        await page.goto("/login");
        await page.getByPlaceholder("Kullanıcı Adı").fill(username);
        await page.getByPlaceholder("Parola").fill(password);
        await page.getByRole("button", { name: "Giriş Yap" }).click();
        await page.waitForURL(/\/dashboard/);

        await page.route("**/api/payments/offers", async (route) => {
            await route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    offers: [{
                        code: offerCode,
                        productKind: "cosmetic_item",
                        productName: "Gece Mavisi Avatar",
                        description: "iyzico request-only sandbox testi",
                        unitAmountMinor: 14900,
                        currency: "TRY",
                    }],
                    checkout: {
                        provider: "iyzico",
                        available: true,
                        unavailableReason: null,
                        buyerDataPolicyVersion: "buyer-data-v1",
                        legalDocuments: {
                            checkoutTerms: { version: "terms-v1", href: "/legal/checkout-terms" },
                            privacyNotice: { version: "privacy-v1", href: "/legal/payment-privacy-notice" },
                            distanceSalesNotice: { version: "distance-v1", href: "/legal/distance-sales-pre-information" },
                        },
                    },
                }),
            });
        });
        let checkoutBody: Record<string, unknown> | null = null;
        const hostedUrl = "https://sandbox-cpp.iyzipay.com/?token=playwright-owner-token";
        await page.route("**/api/payments/checkout/iyzico/session", async (route) => {
            checkoutBody = route.request().postDataJSON() as Record<string, unknown>;
            await route.fulfill({
                status: 201,
                contentType: "application/json",
                body: JSON.stringify({ orderId: ownOrderId, redirectUrl: hostedUrl, sandbox: true }),
            });
        });
        await page.route("https://sandbox-cpp.iyzipay.com/**", async (route) => {
            await route.fulfill({
                contentType: "text/html",
                body: "<main><h1>iyzico sandbox fixture</h1></main>",
            });
        });

        await page.goto("/checkout");
        await page.getByLabel("Ad", { exact: true }).fill("Test");
        await page.getByLabel("Soyad", { exact: true }).fill("Oyuncu");
        await page.getByLabel("T.C. kimlik numarası").fill("11111111110");
        await page.getByLabel("Telefon").fill("+90 555 111 22 33");
        await page.getByLabel("Fatura adresi").fill("Test Mahallesi No 1");
        await page.getByLabel("İl", { exact: true }).fill("Istanbul");
        await page.getByLabel("Posta kodu (opsiyonel)").fill("34000");
        const checkboxes = page.getByRole("checkbox");
        await checkboxes.nth(0).check();
        await checkboxes.nth(1).check();

        const browserState = await page.evaluate(() => ({
            local: Object.values(localStorage),
            session: Object.values(sessionStorage),
            url: window.location.href,
        }));
        expect(new URL(browserState.url).pathname).toBe("/checkout");
        for (const sensitiveValue of ["11111111110", "+90 555 111 22 33", "Test Mahallesi No 1"]) {
            expect(JSON.stringify(browserState)).not.toContain(sensitiveValue);
        }

        await page.getByRole("button", { name: "Ödeme yükümlülüğü doğuran siparişi ver" }).click();
        await page.waitForURL("https://sandbox-cpp.iyzipay.com/**");
        await expect(page.getByRole("heading", { name: "iyzico sandbox fixture" })).toBeVisible();
        expect(checkoutBody).toMatchObject({
            buyerDataDisclosure: { accepted: true, policyVersion: "buyer-data-v1" },
            buyerData: {
                givenName: "Test",
                familyName: "Oyuncu",
                identityNumber: "11111111110",
                phone: "+90 555 111 22 33",
                addressLine: "Test Mahallesi No 1",
                city: "Istanbul",
                country: "Türkiye",
                zipCode: "34000",
            },
        });
        expect(page.url()).not.toContain("11111111110");
        await page.goBack();
        await expect(page.getByLabel("T.C. kimlik numarası")).toHaveValue("");
        await expect(page.getByLabel("Telefon")).toHaveValue("");
    });

    test("shows callback review without an automatic hosted-page redirect", async ({ page }) => {
        await page.goto("/login");
        await page.getByPlaceholder("Kullanıcı Adı").fill(username);
        await page.getByPlaceholder("Parola").fill(password);
        await page.getByRole("button", { name: "Giriş Yap" }).click();
        await page.waitForURL(/\/dashboard/);

        const hostedUrl = "https://sandbox-cpp.iyzipay.com/?token=playwright-resume-token";
        await page.route("**/api/payments/offers", async (route) => {
            await route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    offers: [],
                    checkout: {
                        provider: "iyzico",
                        available: false,
                        unavailableReason: "Sandbox session resume only",
                        buyerDataPolicyVersion: "buyer-data-v1",
                        legalDocuments: {
                            checkoutTerms: { version: "terms-v1", href: "/legal/checkout-terms" },
                            privacyNotice: { version: "privacy-v1", href: "/legal/payment-privacy-notice" },
                            distanceSalesNotice: { version: "distance-v1", href: "/legal/distance-sales-pre-information" },
                        },
                    },
                }),
            });
        });
        await page.route(`**/api/payments/orders/${ownOrderId}`, async (route) => {
            await route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    order: {
                        id: ownOrderId,
                        status: "awaiting_payment",
                        productNameSnapshot: "Gece Mavisi Avatar",
                        quantity: 1,
                        totalAmountMinor: 14900,
                        currency: "TRY",
                        createdAt: new Date().toISOString(),
                    },
                    paymentSession: { provider: "iyzico", redirectUrl: hostedUrl },
                }),
            });
        });
        await page.route("https://sandbox-cpp.iyzipay.com/**", async (route) => {
            await route.fulfill({ contentType: "text/html", body: "<h1>resumed iyzico fixture</h1>" });
        });

        await page.goto(`/checkout?order=${ownOrderId}&result=provider-review`);
        await expect(page.getByText("Ödeme sonucu kesinleşmedi.")).toBeVisible();
        await expect(page.getByRole("button", { name: "Ödemeye devam et" })).toBeVisible();
        await page.waitForTimeout(300);
        expect(new URL(page.url()).pathname).toBe("/checkout");
        await page.getByRole("button", { name: "Ödemeye devam et" }).click();
        await page.waitForURL("https://sandbox-cpp.iyzipay.com/**");
    });
});
