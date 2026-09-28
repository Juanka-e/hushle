import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
    PaytrCheckoutError,
    ShopierCheckoutError,
    PaymentOrderConflictError,
    createPaymentCheckoutOrderRecord,
    createPaytrSandboxCheckoutSession,
    createShopierCheckoutListing,
    getActivePaymentOffer,
    getPaymentRuntimeReadiness,
    normalizePaymentGrantSnapshot,
    PAYMENT_BUYER_DATA_POLICY_VERSION,
    paytrCheckoutContactSchema,
} from "@hushle/platform-payments";
import { enforceAccountCapability } from "@/lib/auth/account-capability";
import {
    getPaymentLegalReadiness,
} from "@/lib/payments/legal";
import { getPaymentCheckoutAccess } from "@/lib/payments/checkout-control";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { getSessionUser } from "@/lib/session";

const checkoutRequestSchema = z.object({
    offerCode: z.string().trim().min(1).max(80),
    idempotencyKey: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/),
    legalAcceptance: z.object({
        accepted: z.literal(true),
        checkoutTermsVersion: z.string().trim().min(1).max(80),
        privacyNoticeVersion: z.string().trim().min(1).max(80),
        distanceSalesNoticeVersion: z.string().trim().min(1).max(80),
    }),
    contact: paytrCheckoutContactSchema.optional(),
});

function getPublicSiteOrigin(): string | null {
    try {
        const url = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
        const localHttp = url.protocol === "http:"
            && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
        if (url.protocol !== "https:" && !localHttp) return null;
        return url.origin;
    } catch {
        return null;
    }
}

function getBoundedRequestId(request: Request): string | null {
    const value = request.headers.get("x-request-id")?.trim();
    return value && /^[A-Za-z0-9._:-]{1,80}$/.test(value) ? value : null;
}

export async function POST(request: Request) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: "Giriş gerekli." }, { status: 401 });
    }
    const capabilityError = enforceAccountCapability(sessionUser, "store_mutation");
    if (capabilityError) return capabilityError;
    if (!sessionUser.email || !sessionUser.emailVerifiedAt) {
        return NextResponse.json(
            { error: "Ödeme için doğrulanmış bir e-posta adresi gerekli.", code: "VERIFIED_EMAIL_REQUIRED" },
            { status: 403 }
        );
    }
    const checkoutAccess = await getPaymentCheckoutAccess(sessionUser.id, { fresh: true });
    if (!checkoutAccess.available) {
        return NextResponse.json(
            { error: "Ödeme altyapısı şu anda kullanıma hazır değil.", code: "CHECKOUT_UNAVAILABLE" },
            { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } }
        );
    }

    const ip = getRequestIp(request);
    const [userLimit, ipLimit] = await Promise.all([
        consumeDistributedRequestRateLimit({
            bucket: "payment-checkout-user",
            key: `user:${sessionUser.id}`,
            windowMs: 5 * 60_000,
            maxRequests: 8,
        }),
        consumeDistributedRequestRateLimit({
            bucket: "payment-checkout-ip",
            key: `ip:${createHash("sha256").update(ip).digest("hex")}`,
            windowMs: 5 * 60_000,
            maxRequests: 100,
        }),
    ]);
    const limit = userLimit.allowed ? ipLimit : userLimit;
    if (!userLimit.allowed || !ipLimit.allowed) {
        return NextResponse.json(
            { error: "Çok fazla ödeme başlatma denemesi yaptın. Biraz bekleyip tekrar dene." },
            { status: 429, headers: buildRateLimitHeaders(limit) }
        );
    }

    let body: z.infer<typeof checkoutRequestSchema>;
    try {
        body = checkoutRequestSchema.parse(await request.json());
    } catch {
        return NextResponse.json({ error: "Geçersiz ödeme isteği." }, { status: 422 });
    }

    const legal = getPaymentLegalReadiness();
    if (!legal.ready) {
        return NextResponse.json(
            { error: "Ödeme altyapısı şu anda kullanıma hazır değil.", code: "CHECKOUT_UNAVAILABLE" },
            { status: 503, headers: { "Retry-After": "60" } }
        );
    }
    if (
        body.legalAcceptance.checkoutTermsVersion !== legal.checkoutTermsVersion ||
        body.legalAcceptance.privacyNoticeVersion !== legal.privacyNoticeVersion ||
        body.legalAcceptance.distanceSalesNoticeVersion !== legal.distanceSalesNoticeVersion
    ) {
        return NextResponse.json(
            { error: "Ödeme metinleri güncellendi. Lütfen metinleri yeniden incele.", code: "LEGAL_VERSION_MISMATCH" },
            { status: 409 }
        );
    }

    const offer = await getActivePaymentOffer(body.offerCode);
    if (!offer) {
        return NextResponse.json({ error: "Ödeme teklifi bulunamadı." }, { status: 404 });
    }

    const runtime = getPaymentRuntimeReadiness();
    if (!runtime.ready || !runtime.activeProvider || !["paytr", "shopier_v2"].includes(runtime.activeProvider)) {
        return NextResponse.json(
            { error: "Ödeme altyapısı şu anda kullanıma hazır değil.", code: "CHECKOUT_UNAVAILABLE" },
            { status: 503, headers: { "Retry-After": "60" } }
        );
    }

    try {
        normalizePaymentGrantSnapshot({
            productKind: offer.productKind,
            quantity: 1,
            grantSnapshot: offer.grantSnapshot,
        });
    } catch {
        return NextResponse.json(
            { error: "Bu teklif şu anda teslimata hazır değil.", code: "INVALID_GRANT_SNAPSHOT" },
            { status: 409 }
        );
    }

    const publicOrigin = getPublicSiteOrigin();
    if (runtime.activeProvider === "paytr" && !publicOrigin) {
        return NextResponse.json(
            { error: "Ödeme altyapısı şu anda kullanıma hazır değil.", code: "CHECKOUT_UNAVAILABLE" },
            { status: 503, headers: { "Retry-After": "60" } }
        );
    }
    if (runtime.activeProvider === "paytr" && !body.contact) {
        return NextResponse.json({ error: "Geçersiz ödeme isteği." }, { status: 422 });
    }
    const requestIp = getRequestIp(request);
    const userIp = requestIp === "unknown"
        ? process.env.PAYTR_SANDBOX_USER_IP?.trim() ?? ""
        : requestIp;

    try {
        const orderResult = await createPaymentCheckoutOrderRecord({
            userId: sessionUser.id,
            provider: runtime.activeProvider,
            providerConfigVersion: 1,
            idempotencyKey: body.idempotencyKey,
            quote: {
                productKind: offer.productKind,
                productReference: offer.productReference,
                productVersion: offer.productVersion,
                productName: offer.productName,
                quantity: 1,
                unitAmountMinor: offer.unitAmountMinor,
                currency: offer.currency,
                grantSnapshot: offer.grantSnapshot as Record<string, unknown>,
            },
            legalAcceptance: {
                checkoutTermsVersion: body.legalAcceptance.checkoutTermsVersion,
                privacyNoticeVersion: body.legalAcceptance.privacyNoticeVersion,
                distanceSalesNoticeVersion: body.legalAcceptance.distanceSalesNoticeVersion,
                buyerDataPolicyVersion: PAYMENT_BUYER_DATA_POLICY_VERSION,
                acceptedAt: new Date(),
                requestId: getBoundedRequestId(request),
                userAgentHash: request.headers.get("user-agent")
                    ? createHash("sha256").update(request.headers.get("user-agent")!).digest("hex")
                    : null,
            },
        });
        if (runtime.activeProvider === "shopier_v2") {
            const checkout = await createShopierCheckoutListing({
                orderId: orderResult.order.id,
                mediaUrl: process.env.SHOPIER_PRODUCT_MEDIA_URL ?? "",
                credentials: {
                    personalAccessToken: process.env.SHOPIER_PERSONAL_ACCESS_TOKEN ?? "",
                },
            });
            return NextResponse.json(
                {
                    provider: "shopier_v2",
                    orderId: checkout.orderId,
                    redirectUrl: checkout.checkoutUrl,
                },
                {
                    status: orderResult.reused || checkout.duplicate ? 200 : 201,
                    headers: {
                        ...buildRateLimitHeaders(limit),
                        "Cache-Control": "private, no-store",
                    },
                }
            );
        }

        if (!body.contact || !publicOrigin) throw new TypeError("PayTR checkout invariant failed");
        const successUrl = new URL("/checkout", publicOrigin);
        successUrl.searchParams.set("order", orderResult.order.id);
        successUrl.searchParams.set("result", "provider-return");
        const failureUrl = new URL("/checkout", publicOrigin);
        failureUrl.searchParams.set("order", orderResult.order.id);
        failureUrl.searchParams.set("result", "provider-error");

        const checkout = await createPaytrSandboxCheckoutSession({
            orderId: orderResult.order.id,
            email: sessionUser.email,
            userIp,
            contact: body.contact,
            successUrl: successUrl.toString(),
            failureUrl: failureUrl.toString(),
            credentials: {
                merchantId: process.env.PAYTR_MERCHANT_ID ?? "",
                merchantKey: process.env.PAYTR_MERCHANT_KEY ?? "",
                merchantSalt: process.env.PAYTR_MERCHANT_SALT ?? "",
            },
        });
        return NextResponse.json(
            {
                orderId: checkout.orderId,
                iframeUrl: checkout.iframeUrl,
                sandbox: true,
            },
            {
                status: orderResult.reused || checkout.duplicate ? 200 : 201,
                headers: {
                    ...buildRateLimitHeaders(limit),
                    "Cache-Control": "private, no-store",
                },
            }
        );
    } catch (error) {
        if (error instanceof PaymentOrderConflictError) {
            return NextResponse.json(
                { error: "Bu ödeme isteği farklı bir sipariş için daha önce kullanıldı.", code: "IDEMPOTENCY_CONFLICT" },
                { status: 409 }
            );
        }
        if (error instanceof PaytrCheckoutError) {
            const status = error.code === "checkout_in_progress" ? 409 : 502;
            return NextResponse.json(
                {
                    error: error.code === "checkout_in_progress"
                        ? "Ödeme hazırlanıyor. Lütfen kısa süre sonra tekrar dene."
                        : "Ödeme sağlayıcısına şu anda ulaşılamıyor.",
                    code: error.code.toUpperCase(),
                },
                {
                    status,
                    headers: error.retryable ? { "Retry-After": "5" } : undefined,
                }
            );
        }
        if (error instanceof ShopierCheckoutError) {
            const status = ["checkout_in_progress", "checkout_uncertain"].includes(error.code) ? 409 : 502;
            return NextResponse.json(
                {
                    error: error.code === "checkout_in_progress"
                        ? "Ödeme hazırlanıyor. Lütfen kısa süre sonra tekrar dene."
                        : error.code === "checkout_uncertain"
                            ? "Shopier liste sonucu kesinleşmedi. Yeni ödeme başlatma; sipariş inceleniyor."
                            : "Ödeme sağlayıcısına şu anda ulaşılamıyor.",
                    code: error.code.toUpperCase(),
                },
                {
                    status,
                    headers: error.retryable ? { "Retry-After": "60" } : undefined,
                }
            );
        }
        return NextResponse.json(
            { error: "Ödeme başlatılamadı.", code: "CHECKOUT_FAILED" },
            { status: 500 }
        );
    }
}
