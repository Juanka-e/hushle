import assert from "node:assert/strict";
import { prisma } from "@hushle/platform-db";
import {
    approveProviderApiRefundRequest,
    createPaymentRefundAdapter,
    getPaymentRefundReadiness,
    queryPaytrPaymentStatus,
    requestProviderApiPaymentRefund,
} from "@hushle/platform-payments";

const REQUIRED_CONFIRMATION = "I_UNDERSTAND_THIS_CREATES_A_TEST_REFUND";

function positiveInteger(name: string): number {
    const value = Number.parseInt(process.env[name] ?? "", 10);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name}_invalid`);
    return value;
}

function assertSafeEnvironment(): void {
    if (process.env.PAYTR_REFUND_SANDBOX_ACCEPTANCE_CONFIRM !== REQUIRED_CONFIRMATION) {
        throw new Error("sandbox_acceptance_confirmation_required");
    }
    if (process.env.NODE_ENV === "production") {
        throw new Error("sandbox_acceptance_production_runtime_forbidden");
    }
    const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
    const databaseName = databaseUrl.pathname.replace(/^\//, "");
    if (!/(?:^|[_-])(test|dev|sandbox)(?:$|[_-])/i.test(databaseName)) {
        throw new Error("sandbox_acceptance_database_not_allowed");
    }
    const readiness = getPaymentRefundReadiness("paytr");
    if (!readiness.ready || readiness.mode !== "sandbox") {
        throw new Error(`sandbox_refund_not_ready:${readiness.issues.join(",")}`);
    }
}

async function run(): Promise<void> {
    assertSafeEnvironment();
    const orderId = process.env.PAYTR_REFUND_ACCEPTANCE_ORDER_ID ?? "";
    const requesterUserId = positiveInteger("PAYTR_REFUND_ACCEPTANCE_REQUESTER_USER_ID");
    const reviewerUserId = positiveInteger("PAYTR_REFUND_ACCEPTANCE_REVIEWER_USER_ID");
    if (requesterUserId === reviewerUserId) throw new Error("second_admin_required");

    const adminCount = await prisma.user.count({
        where: { id: { in: [requesterUserId, reviewerUserId] }, role: "admin" },
    });
    if (adminCount !== 2) throw new Error("sandbox_acceptance_admins_invalid");

    const order = await prisma.paymentOrder.findUnique({
        where: { id: orderId },
        include: { fulfillment: true, reversal: true },
    });
    if (
        !order
        || order.provider !== "paytr"
        || order.status !== "fulfilled"
        || order.fulfillment?.status !== "completed"
        || order.reversal
        || !order.providerOrderReference
    ) {
        throw new Error("sandbox_acceptance_order_not_reversible");
    }

    const credentials = {
        merchantId: process.env.PAYTR_MERCHANT_ID ?? "",
        merchantKey: process.env.PAYTR_MERCHANT_KEY ?? "",
        merchantSalt: process.env.PAYTR_MERCHANT_SALT ?? "",
    };
    const before = await queryPaytrPaymentStatus({
        merchantOrderId: order.providerOrderReference,
        credentials,
    });
    if (
        before.status !== "success"
        || !before.testMode
        || before.paymentAmountMinor !== order.totalAmountMinor
        || before.currency !== order.currency
    ) {
        throw new Error("sandbox_acceptance_provider_precheck_failed");
    }

    const adapter = createPaymentRefundAdapter({ provider: "paytr" });
    assert.ok(adapter, "sandbox_refund_adapter_unavailable");
    const request = await requestProviderApiPaymentRefund({
        orderId: order.id,
        reason: "PayTR sandbox refund acceptance",
        requestedByUserId: requesterUserId,
    });
    const result = await approveProviderApiRefundRequest({
        requestId: request.id,
        reviewedByUserId: reviewerUserId,
        reviewNote: "PayTR sandbox acceptance second approval",
        adapter,
    });
    if (result.outcome !== "applied") {
        throw new Error(`sandbox_acceptance_not_applied:${result.outcome}`);
    }

    const after = await queryPaytrPaymentStatus({
        merchantOrderId: order.providerOrderReference,
        credentials,
    });
    const refund = after.status === "success"
        ? (after.refunds ?? []).find((entry) => entry.referenceNo === request.externalReference)
        : undefined;
    if (
        after.status !== "success"
        || !after.testMode
        || after.currency !== order.currency
        || !refund
        || refund.amountMinor !== order.totalAmountMinor
        || !refund.completed
    ) {
        throw new Error("sandbox_acceptance_postcheck_failed");
    }

    console.log(JSON.stringify({
        status: "passed",
        provider: "paytr",
        orderId: order.id,
        reversalRequestId: request.id,
        referenceNo: request.externalReference,
        amountMinor: order.totalAmountMinor,
        currency: order.currency,
    }));
}

run().catch((error) => {
    console.error(error instanceof Error ? error.message : "sandbox_acceptance_failed");
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
