import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@hushle/platform-db";
import { closeRedisClient } from "@hushle/platform-cache";
import {
    getPaymentCheckoutControl,
    PaymentCheckoutControlConflictError,
    updatePaymentCheckoutControl,
} from "../apps/web/src/lib/payments/checkout-control";

const CONTROL_KEY = "payment_checkout_control";

async function run(): Promise<void> {
    assert.equal(process.env.PAYMENT_CHECKOUT_CONTROL_INTEGRATION_TEST, "true");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const original = await prisma.systemSetting.findUnique({ where: { key: CONTROL_KEY } });
    const admin = await prisma.user.create({
        data: { username: `checkout_control_${suffix}`, password: "integration-test-only", role: "admin" },
    });
    try {
        const initial = await getPaymentCheckoutControl({ fresh: true });
        assert.equal(initial.control.paused, true);
        const changed = await updatePaymentCheckoutControl({
            paused: true,
            rolloutPercent: 25,
            expectedRevision: initial.control.revision,
            reason: "Integration rollout preparation",
            updatedByUserId: admin.id,
            actorRole: admin.role,
            ipAddress: "127.0.0.1",
            userAgent: "payment-control-integration",
        });
        assert.equal(changed.control.revision, initial.control.revision + 1);
        assert.equal(changed.control.rolloutPercent, 25);
        assert.equal(changed.updatedBy?.id, admin.id);

        const race = await Promise.allSettled([
            updatePaymentCheckoutControl({
                paused: true,
                rolloutPercent: 30,
                expectedRevision: changed.control.revision,
                reason: "Concurrent update A",
                updatedByUserId: admin.id,
                actorRole: admin.role,
                ipAddress: null,
                userAgent: null,
            }),
            updatePaymentCheckoutControl({
                paused: true,
                rolloutPercent: 35,
                expectedRevision: changed.control.revision,
                reason: "Concurrent update B",
                updatedByUserId: admin.id,
                actorRole: admin.role,
                ipAddress: null,
                userAgent: null,
            }),
        ]);
        assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(race.filter((result) => result.status === "rejected").length, 1);
        const rejected = race.find((result) => result.status === "rejected");
        assert.ok(rejected?.status === "rejected" && rejected.reason instanceof PaymentCheckoutControlConflictError);

        await assert.rejects(
            updatePaymentCheckoutControl({
                paused: false,
                rolloutPercent: 50,
                expectedRevision: initial.control.revision,
                reason: "Stale write must fail",
                updatedByUserId: admin.id,
                actorRole: admin.role,
                ipAddress: null,
                userAgent: null,
            }),
            PaymentCheckoutControlConflictError
        );
        const audits = await prisma.auditLog.findMany({
            where: {
                actorUserId: admin.id,
                action: "admin.payment.checkout-control.update",
            },
        });
        assert.equal(audits.length, 2);
        assert.equal(
            audits.some((audit) => JSON.stringify(audit.metadata).includes("Integration rollout preparation")),
            true
        );
    } finally {
        await prisma.auditLog.deleteMany({ where: { actorUserId: admin.id } });
        if (original) {
            await prisma.systemSetting.update({
                where: { key: CONTROL_KEY },
                data: {
                    value: original.value as Prisma.InputJsonValue,
                    updatedByUserId: original.updatedByUserId,
                },
            });
        } else {
            await prisma.systemSetting.deleteMany({ where: { key: CONTROL_KEY } });
        }
        await prisma.user.delete({ where: { id: admin.id } });
        await Promise.all([
            prisma.$disconnect(),
            closeRedisClient(),
        ]);
    }
}

void run().then(() => console.log("Payment checkout control transaction checks passed."));
