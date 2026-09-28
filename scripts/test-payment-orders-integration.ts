import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
    PaymentOrderConflictError,
    createPaymentOrderRecord,
} from "@hushle/platform-payments";
import { prisma } from "@hushle/platform-db";

async function run(): Promise<void> {
    assert.equal(
        process.env.PAYMENT_ORDERS_INTEGRATION_TEST,
        "true",
        "PAYMENT_ORDERS_INTEGRATION_TEST=true is required"
    );
    assert.match(
        process.env.DATABASE_URL ?? "",
        /tabu_test/,
        "Payment integration test requires a tabu_test database"
    );

    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const user = await prisma.user.create({
        data: {
            username: `payment_${suffix}`,
            password: "integration-test-only",
        },
        select: { id: true },
    });
    const idempotencyKey = `checkout:${suffix}:0001`;
    const input = {
        userId: user.id,
        provider: "iyzico" as const,
        providerConfigVersion: 1,
        idempotencyKey,
        quote: {
            productKind: "cosmetic_item" as const,
            productReference: "integration_avatar",
            productVersion: 1,
            productName: "Integration Avatar",
            quantity: 1,
            unitAmountMinor: 9_900,
            currency: "try",
            grantSnapshot: { schemaVersion: 1, items: [{ shopItemId: 1, renderSnapshot: {} }] },
        },
    };

    try {
        const attempts = await Promise.all([
            createPaymentOrderRecord(input),
            createPaymentOrderRecord(input),
        ]);
        assert.equal(new Set(attempts.map((result) => result.order.id)).size, 1);
        assert.equal(attempts.filter((result) => result.reused).length, 1);

        const duplicate = await createPaymentOrderRecord(input);
        assert.equal(duplicate.reused, true);
        assert.equal(duplicate.order.currency, "TRY");
        assert.equal(duplicate.order.totalAmountMinor, 9_900);

        await assert.rejects(
            () => createPaymentOrderRecord({
                ...input,
                quote: { ...input.quote, unitAmountMinor: 9_901 },
            }),
            (error: unknown) =>
                error instanceof PaymentOrderConflictError &&
                error.code === "idempotency_payload_mismatch"
        );

        assert.equal(
            await prisma.paymentOrder.count({ where: { userId: user.id } }),
            1
        );
    } finally {
        await prisma.paymentFulfillment.deleteMany({
            where: { order: { userId: user.id } },
        });
        await prisma.paymentAttempt.deleteMany({
            where: { order: { userId: user.id } },
        });
        await prisma.paymentOrder.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.$disconnect();
    }

    console.log("payment order integration checks passed");
}

void run();
