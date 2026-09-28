import { NextResponse } from "next/server";
import {
    PAYTR_IFRAME_URL_PREFIX,
    isAllowedIyzicoHostedUrl,
    isAllowedShopierHostedUrl,
} from "@hushle/platform-payments";
import { prisma } from "@/lib/prisma";
import { getIyzicoOwnerSurfaceReadiness } from "@/lib/payments/iyzico-owner-surface";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
} from "@/lib/security/request-rate-limit";
import { getSessionUser } from "@/lib/session";

export async function GET(
    _request: Request,
    context: { params: Promise<{ id: string }> }
) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: "Giriş gerekli." }, { status: 401 });
    }
    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "payment-order-status",
        key: `user:${sessionUser.id}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Sipariş durumu çok sık sorgulandı." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const { id } = await context.params;
    const order = await prisma.paymentOrder.findFirst({
        where: { id, userId: sessionUser.id },
        select: {
            id: true,
            provider: true,
            providerSessionReference: true,
            providerHostedUrl: true,
            status: true,
            productKind: true,
            productNameSnapshot: true,
            quantity: true,
            totalAmountMinor: true,
            currency: true,
            createdAt: true,
            updatedAt: true,
            expiresAt: true,
            paidAt: true,
            fulfilledAt: true,
        },
    });
    if (!order) {
        return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }
    const { providerSessionReference, providerHostedUrl, provider, ...publicOrder } = order;
    const paytrSession =
        provider === "paytr"
        && order.status === "awaiting_payment"
        && providerSessionReference
        && process.env.PAYTR_CHECKOUT_MODE?.trim().toLowerCase() === "sandbox"
            ? {
                provider: "paytr" as const,
                sandbox: true,
                iframeUrl: `${PAYTR_IFRAME_URL_PREFIX}${encodeURIComponent(providerSessionReference)}`,
            }
            : null;
    const iyzicoSession =
        provider === "iyzico"
        && order.status === "awaiting_payment"
        && providerHostedUrl
        && isAllowedIyzicoHostedUrl(providerHostedUrl)
        && getIyzicoOwnerSurfaceReadiness().callbackEnabled
            ? {
                provider: "iyzico" as const,
                sandbox: true,
                redirectUrl: providerHostedUrl,
            }
            : null;
    const shopierSession =
        provider === "shopier_v2"
        && order.status === "awaiting_payment"
        && providerSessionReference
        && providerHostedUrl
        && isAllowedShopierHostedUrl(providerHostedUrl, providerSessionReference)
            ? {
                provider: "shopier_v2" as const,
                redirectUrl: providerHostedUrl,
            }
            : null;
    const paymentSession = paytrSession ?? iyzicoSession ?? shopierSession;

    return NextResponse.json(
        { order: publicOrder, paymentSession },
        { headers: { ...buildRateLimitHeaders(rateLimit), "Cache-Control": "private, no-store" } }
    );
}
