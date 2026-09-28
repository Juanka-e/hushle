import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@hushle/platform-db";
import { reconcilePaymentOrder } from "@hushle/platform-payments";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { writeAuditLog } from "@/lib/security/audit-log";
import { buildRateLimitHeaders, consumeRequestRateLimit, getRequestIp } from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({ confirmationOrderId: z.string().uuid() });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const admin = await requireAdminSession();
    if (admin instanceof NextResponse) return admin;
    const params = paramsSchema.safeParse(await context.params);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!params.success || !body.success || body.data.confirmationOrderId !== params.data.id) {
        return NextResponse.json({ error: "Sipariş onayı geçersiz." }, { status: 422 });
    }
    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-payment-reconcile",
        key: `admin:${admin.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 10,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json({ error: "Çok fazla durum sorgusu." }, { status: 429, headers: buildRateLimitHeaders(rateLimit) });
    }
    const order = await prisma.paymentOrder.findUnique({ where: { id: params.data.id } });
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    const supportedState = ["awaiting_payment", "paid", "fulfilled"].includes(order.status)
        || (
            (["iyzico", "shopier_v2"] as string[]).includes(order.provider)
            && order.status === "pending_provider"
        );
    if (!(["paytr", "iyzico", "shopier_v2"] as string[]).includes(order.provider) || !supportedState) {
        return NextResponse.json({ error: "Sipariş uzlaştırmaya uygun değil." }, { status: 409 });
    }
    if (
        order.provider === "iyzico"
        && (
            process.env.IYZICO_CHECKOUT_MODE?.trim().toLowerCase() !== "sandbox"
            || process.env.IYZICO_RECONCILIATION_MODE?.trim().toLowerCase() !== "sandbox"
        )
    ) {
        return NextResponse.json({ error: "iyzico uzlaştırma işlemi etkin değil." }, { status: 409 });
    }
    if (
        order.provider === "shopier_v2"
        && (
            process.env.SHOPIER_CHECKOUT_MODE?.trim().toLowerCase() !== "live"
            || process.env.SHOPIER_WEBHOOK_MODE?.trim().toLowerCase() !== "live"
            || process.env.SHOPIER_RECONCILIATION_MODE?.trim().toLowerCase() !== "live"
            || !/^[\x21-\x7e]{20,2048}$/.test(process.env.SHOPIER_PERSONAL_ACCESS_TOKEN ?? "")
            || !/^[\x21-\x7e]{20,2048}$/.test(process.env.SHOPIER_WEBHOOK_TOKEN ?? "")
        )
    ) {
        return NextResponse.json({ error: "Shopier uzlaştırma işlemi etkin değil." }, { status: 409 });
    }
    try {
        const outcome = await reconcilePaymentOrder({
            order,
            environment: process.env,
            now: new Date(),
            retryDelayMinutes: 15,
        });
        await writeAuditLog({
            actor: admin,
            action: "admin.payment.reconcile",
            resourceType: "payment_order",
            resourceId: order.id,
            summary: "Manually reconciled payment order",
            metadata: { provider: order.provider, outcome },
            request,
        });
        return NextResponse.json({ outcome }, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        const now = new Date();
        await prisma.paymentReconciliationCase.upsert({
            where: { orderId: order.id },
            create: {
                orderId: order.id,
                status: "open",
                reasonCode: "local_completion_failed",
                attemptCount: 1,
                lastErrorCode: error instanceof Error ? error.name.slice(0, 80) : "unknown_error",
                lastCheckedAt: now,
                nextCheckAt: new Date(now.getTime() + 15 * 60_000),
            },
            update: {
                status: "open",
                reasonCode: "local_completion_failed",
                attemptCount: { increment: 1 },
                lastErrorCode: error instanceof Error ? error.name.slice(0, 80) : "unknown_error",
                lastCheckedAt: now,
                nextCheckAt: new Date(now.getTime() + 15 * 60_000),
                resolvedAt: null,
                resolvedByUserId: null,
                resolutionNote: null,
            },
        });
        console.error("Manual payment reconciliation failed", {
            errorName: error instanceof Error ? error.name.slice(0, 80) : "unknown_error",
        });
        return NextResponse.json({ error: "Durum sorgusu tamamlanamadı; vaka kaydı korunuyor." }, { status: 502 });
    }
}
