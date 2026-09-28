import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { prisma } from "@hushle/platform-db";
import { IYZICO_ACCEPTANCE_CONFIRMATION } from "./lib/iyzico-sandbox-acceptance";

async function run(): Promise<void> {
    assert.equal(process.env.IYZICO_ACCEPTANCE_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /(?:test|acceptance)/i);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
    const paymentReference = `sandbox-payment-${suffix}`;
    const now = new Date();
    const user = await prisma.user.create({
        data: {
            username: `iyzico_acceptance_${suffix}`,
            password: "integration-test-only",
            email: `iyzico-acceptance-${suffix}@example.test`,
            normalizedEmail: `iyzico-acceptance-${suffix}@example.test`,
            emailVerifiedAt: now,
        },
    });
    const order = await prisma.paymentOrder.create({
        data: {
            userId: user.id,
            provider: "iyzico",
            status: "fulfilled",
            idempotencyKey: `iyzico-acceptance:${suffix}`,
            requestFingerprint: "a".repeat(64),
            productKind: "coin_pack",
            productReference: `acceptance:${suffix}`,
            productVersion: 1,
            productNameSnapshot: "Iyzico Acceptance Pack",
            quantity: 1,
            unitAmountMinor: 1_000,
            totalAmountMinor: 1_000,
            currency: "TRY",
            grantSnapshot: { schemaVersion: 1, coinAmount: 100 },
            providerOrderReference: `acceptance-order-${suffix}`,
            paidAt: now,
            fulfilledAt: now,
            attempts: {
                create: {
                    attemptNumber: 1,
                    status: "succeeded",
                    requestFingerprint: "a".repeat(64),
                    providerRequestId: `iyzico-token-sha256:${"b".repeat(64)}`,
                },
            },
            checkoutConsent: {
                create: {
                    checkoutTermsVersion: "checkout-terms-test-v1",
                    privacyNoticeVersion: "privacy-test-v1",
                    distanceSalesNoticeVersion: "distance-sales-test-v1",
                    buyerDataPolicyVersion: "buyer-data-v1",
                    acceptedAt: now,
                },
            },
            checkoutVerification: {
                create: {
                    provider: "iyzico",
                    providerPaymentReference: paymentReference,
                    amountMinor: 1_000,
                    paidAmountMinor: 1_000,
                    currency: "TRY",
                    providerPaymentStatus: "SUCCESS",
                    providerRiskStatus: 1,
                    verifiedAt: now,
                },
            },
            fulfillment: {
                create: {
                    status: "completed",
                    fulfillmentKey: `payment:${suffix}`,
                    attemptCount: 1,
                    grantResult: { kind: "coin_pack", amount: 100 },
                    completedAt: now,
                    notificationSentAt: now,
                },
            },
            webhookEvents: {
                create: {
                    provider: "iyzico",
                    providerEventId: `event-${suffix}`,
                    eventType: "CHECKOUT_FORM_AUTH",
                    outcome: "payment_succeeded",
                    bodySha256: "c".repeat(64),
                    signatureVersion: "v3",
                    providerOrderReference: `acceptance-order-${suffix}`,
                    providerPaymentReference: paymentReference,
                    amountMinor: 1_000,
                    currency: "TRY",
                    metadata: { eventTime: now.getTime() },
                    status: "processed",
                    processedAt: now,
                },
            },
        },
    });

    try {
        const result = spawnSync(
            process.execPath,
            ["--import", "tsx", "scripts/run-iyzico-sandbox-acceptance.ts", "verify"],
            {
                encoding: "utf8",
                env: {
                    ...process.env,
                    NODE_ENV: "test",
                    IYZICO_SANDBOX_ACCEPTANCE_CONFIRM: IYZICO_ACCEPTANCE_CONFIRMATION,
                    IYZICO_CHECKOUT_MODE: "sandbox",
                    IYZICO_WEBHOOK_MODE: "sandbox",
                    IYZICO_RECONCILIATION_MODE: "sandbox",
                    IYZICO_OWNER_CHECKOUT_MODE: "sandbox",
                    IYZICO_CALLBACK_MODE: "sandbox",
                    IYZICO_API_KEY: "sandbox-integration-api-key",
                    IYZICO_SECRET_KEY: "sandbox-integration-secret-key",
                    IYZICO_MERCHANT_ID: "3404590",
                    IYZICO_ACCEPTANCE_PUBLIC_ORIGIN: "https://acceptance.example.test",
                    IYZICO_ACCEPTANCE_USER_ID: String(user.id),
                    IYZICO_ACCEPTANCE_ORDER_ID: order.id,
                },
            }
        );
        assert.equal(result.status, 0, result.stderr);
        const evidence = JSON.parse(result.stdout) as {
            status: string;
            orderId: string;
            checks: Record<string, boolean>;
            providerPaymentReferenceHash: string;
        };
        assert.equal(evidence.status, "passed");
        assert.equal(evidence.orderId, order.id);
        assert.ok(Object.values(evidence.checks).every(Boolean));
        assert.match(evidence.providerPaymentReferenceHash, /^sha256:[a-f0-9]{64}$/);
        assert.doesNotMatch(result.stdout, new RegExp(paymentReference));
        assert.doesNotMatch(result.stdout, /sandbox-integration-secret-key/);
    } finally {
        await prisma.paymentWebhookEvent.deleteMany({ where: { orderId: order.id } });
        await prisma.paymentFulfillment.deleteMany({ where: { orderId: order.id } });
        await prisma.paymentCheckoutVerification.deleteMany({ where: { orderId: order.id } });
        await prisma.paymentCheckoutConsent.deleteMany({ where: { orderId: order.id } });
        await prisma.paymentAttempt.deleteMany({ where: { orderId: order.id } });
        await prisma.paymentOrder.delete({ where: { id: order.id } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.$disconnect();
    }

    console.log("iyzico sandbox acceptance verify integration checks passed");
}

void run();
