import { NextRequest, NextResponse } from "next/server";
import { Prisma, prisma } from "@hushle/platform-db";
import {
    getPaymentRefundReadiness,
} from "@hushle/platform-payments";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { getPaymentSchedulerHealth } from "@/lib/payments/scheduler-health";
import {
    getPaymentCheckoutActivationReadiness,
    getPaymentCheckoutControl,
} from "@/lib/payments/checkout-control";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z.enum([
        "all", "created", "pending_provider", "awaiting_payment", "paid", "fulfilled",
        "failed", "expired", "refunded", "chargeback",
    ]).default("all"),
    search: z.string().trim().max(191).optional(),
});

function boundedThreshold(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10_000 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
    const admin = await requireAdminSession();
    if (admin instanceof NextResponse) return admin;
    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-payment-read",
        key: `admin:${admin.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 90,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Çok fazla ödeme sorgusu. Lütfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }
    const parsed = querySchema.safeParse({
        page: request.nextUrl.searchParams.get("page") ?? undefined,
        limit: request.nextUrl.searchParams.get("limit") ?? undefined,
        status: request.nextUrl.searchParams.get("status") ?? undefined,
        search: request.nextUrl.searchParams.get("search") || undefined,
    });
    if (!parsed.success) {
        return NextResponse.json({ error: "Geçersiz ödeme sorgusu." }, { status: 422 });
    }
    const { page, limit, status, search } = parsed.data;
    const where = {
        ...(status === "all" ? {} : { status }),
        ...(search ? {
            OR: [
                { id: { contains: search } },
                { providerOrderReference: { contains: search } },
                { user: { username: { contains: search } } },
            ],
        } : {}),
    } satisfies Prisma.PaymentOrderWhereInput;
    const [total, orders, openCases, deadLetters, pendingApprovals, openManualReviews, oldestOpenCase, schedulerHealth, checkoutControl] = await Promise.all([
        prisma.paymentOrder.count({ where }),
        prisma.paymentOrder.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
            omit: {
                providerSessionReference: true,
                providerHostedUrl: true,
            },
            include: {
                user: { select: { id: true, username: true } },
                fulfillment: { select: { status: true, errorCode: true, completedAt: true, reversedAt: true } },
                reversal: {
                    select: {
                        id: true,
                        outcome: true,
                        status: true,
                        externalReference: true,
                        reason: true,
                        evidence: true,
                        createdAt: true,
                        manualReviewCase: {
                            select: {
                                id: true,
                                status: true,
                                reasonCode: true,
                                unrecoveredCoin: true,
                                resolutionNote: true,
                                resolvedAt: true,
                                noticeSentAt: true,
                                resolvedBy: { select: { id: true, username: true } },
                            },
                        },
                    },
                },
                reconciliationCase: { select: { id: true, status: true, reasonCode: true, attemptCount: true, lastErrorCode: true, lastCheckedAt: true } },
                reversalRequests: {
                    where: { status: { in: ["pending", "processing", "provider_review", "provider_failed"] } },
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: {
                        id: true,
                        outcome: true,
                        status: true,
                        executionMode: true,
                        externalReference: true,
                        reason: true,
                        createdAt: true,
                        requestedBy: { select: { id: true, username: true } },
                        providerRefundAttempt: {
                            select: {
                                id: true, status: true, amountMinor: true, currency: true,
                                referenceNo: true, providerRefundReference: true, errorCode: true, startedAt: true,
                                completedAt: true, lastCheckedAt: true,
                            },
                        },
                    },
                },
                webhookEvents: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: { id: true, status: true, outcome: true, lastErrorCode: true, attemptCount: true },
                },
            },
        }),
        prisma.paymentReconciliationCase.count({ where: { status: "open" } }),
        prisma.paymentWebhookEvent.count({ where: { status: "dead_letter" } }),
        prisma.paymentReversalRequest.count({ where: { status: "pending" } }),
        prisma.paymentManualReviewCase.count({ where: { status: "open" } }),
        prisma.paymentReconciliationCase.findFirst({
            where: { status: "open" },
            orderBy: { createdAt: "asc" },
            select: { createdAt: true },
        }),
        getPaymentSchedulerHealth(),
        getPaymentCheckoutControl(),
    ]);
    const caseAlertThreshold = boundedThreshold(process.env.PAYMENT_OPEN_CASE_ALERT_THRESHOLD, 25);
    const deadLetterAlertThreshold = boundedThreshold(process.env.PAYMENT_DEAD_LETTER_ALERT_THRESHOLD, 10);
    const checkoutActivation = getPaymentCheckoutActivationReadiness();
    return NextResponse.json({
        items: orders.map((order) => ({
            ...order,
            createdAt: order.createdAt.toISOString(),
            updatedAt: order.updatedAt.toISOString(),
            paidAt: order.paidAt?.toISOString() ?? null,
            fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
            fulfillment: order.fulfillment ? {
                ...order.fulfillment,
                completedAt: order.fulfillment.completedAt?.toISOString() ?? null,
                reversedAt: order.fulfillment.reversedAt?.toISOString() ?? null,
            } : null,
            reversal: order.reversal ? {
                ...order.reversal,
                createdAt: order.reversal.createdAt.toISOString(),
                manualReviewCase: order.reversal.manualReviewCase ? {
                    ...order.reversal.manualReviewCase,
                    resolvedAt: order.reversal.manualReviewCase.resolvedAt?.toISOString() ?? null,
                    noticeSentAt: order.reversal.manualReviewCase.noticeSentAt?.toISOString() ?? null,
                } : null,
            } : null,
            reconciliationCase: order.reconciliationCase ? {
                ...order.reconciliationCase,
                lastCheckedAt: order.reconciliationCase.lastCheckedAt?.toISOString() ?? null,
            } : null,
            reversalRequests: order.reversalRequests.map((entry) => ({
                ...entry,
                createdAt: entry.createdAt.toISOString(),
                providerRefundAttempt: entry.providerRefundAttempt ? {
                    ...entry.providerRefundAttempt,
                    startedAt: entry.providerRefundAttempt.startedAt.toISOString(),
                    completedAt: entry.providerRefundAttempt.completedAt?.toISOString() ?? null,
                    lastCheckedAt: entry.providerRefundAttempt.lastCheckedAt?.toISOString() ?? null,
                } : null,
            })),
        })),
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
        total,
        counts: { openCases, deadLetters, pendingApprovals, openManualReviews },
        alerts: {
            caseAlertThreshold,
            deadLetterAlertThreshold,
            openCaseThresholdExceeded: openCases >= caseAlertThreshold,
            deadLetterThresholdExceeded: deadLetters >= deadLetterAlertThreshold,
            oldestOpenCaseAt: oldestOpenCase?.createdAt.toISOString() ?? null,
        },
        schedulerHealth,
        refundExecutionByProvider: {
            paytr: getPaymentRefundReadiness("paytr"),
            shopier_v2: getPaymentRefundReadiness("shopier_v2"),
        },
        checkoutControl,
        checkoutActivation,
    }, { headers: buildRateLimitHeaders(rateLimit) });
}
