import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
    IyzicoCheckoutError,
    PaymentOrderConflictError,
    createIyzicoSandboxCheckoutSession,
    createPaymentCheckoutOrderRecord,
    getActivePaymentOffer,
    iyzicoCheckoutBuyerDataSchema,
    normalizePaymentGrantSnapshot,
    PAYMENT_BUYER_DATA_POLICY_VERSION,
} from "@hushle/platform-payments";
import { enforceAccountCapability } from "@/lib/auth/account-capability";
import {
    buildIyzicoOwnerCallbackUrl,
    getIyzicoOwnerSurfaceReadiness,
    getPublicPaymentOrigin,
} from "@/lib/payments/iyzico-owner-surface";
import { getPaymentLegalReadiness } from "@/lib/payments/legal";
import { getPaymentCheckoutAccess } from "@/lib/payments/checkout-control";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { getSessionUser } from "@/lib/session";

const MAX_BODY_BYTES = 8 * 1024;
const checkoutRequestSchema = z.object({
    offerCode: z.string().trim().min(1).max(80),
    idempotencyKey: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/),
    legalAcceptance: z.object({
        accepted: z.literal(true),
        checkoutTermsVersion: z.string().trim().min(1).max(80),
        privacyNoticeVersion: z.string().trim().min(1).max(80),
        distanceSalesNoticeVersion: z.string().trim().min(1).max(80),
    }),
    buyerDataDisclosure: z.object({
        accepted: z.literal(true),
        policyVersion: z.literal(PAYMENT_BUYER_DATA_POLICY_VERSION),
    }),
    buyerData: iyzicoCheckoutBuyerDataSchema,
});

async function readBoundedJson(request: Request): Promise<unknown> {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new Error("invalid_content_type");
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error("body_too_large");
    if (!request.body) throw new Error("body_missing");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
            await reader.cancel();
            throw new Error("body_too_large");
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function getBoundedRequestId(request: Request): string | null {
    const value = request.headers.get("x-request-id")?.trim();
    return value && /^[A-Za-z0-9._:-]{1,80}$/.test(value) ? value : null;
}

function unavailable() {
    return NextResponse.json(
        { error: "Ödeme altyapısı şu anda kullanıma hazır değil.", code: "CHECKOUT_UNAVAILABLE" },
        { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } }
    );
}

export async function POST(request: Request) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(
            { error: "Giriş gerekli." },
            { status: 401, headers: { "Cache-Control": "no-store" } }
        );
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
    if (!checkoutAccess.available) return unavailable();

    const surface = getIyzicoOwnerSurfaceReadiness();
    const legal = getPaymentLegalReadiness();
    const publicOrigin = getPublicPaymentOrigin();
    if (!surface.sessionEnabled || !legal.ready || !publicOrigin) return unavailable();

    const requestIp = getRequestIp(request);
    const [userLimit, ipLimit] = await Promise.all([
        consumeDistributedRequestRateLimit({
            bucket: "payment-checkout-user",
            key: `user:${sessionUser.id}`,
            windowMs: 5 * 60_000,
            maxRequests: 8,
        }),
        consumeDistributedRequestRateLimit({
            bucket: "payment-checkout-ip",
            key: `ip:${createHash("sha256").update(requestIp).digest("hex")}`,
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
        body = checkoutRequestSchema.parse(await readBoundedJson(request));
    } catch {
        return NextResponse.json({ error: "Geçersiz ödeme isteği." }, { status: 422 });
    }
    if (
        body.legalAcceptance.checkoutTermsVersion !== legal.checkoutTermsVersion
        || body.legalAcceptance.privacyNoticeVersion !== legal.privacyNoticeVersion
        || body.legalAcceptance.distanceSalesNoticeVersion !== legal.distanceSalesNoticeVersion
    ) {
        return NextResponse.json(
            { error: "Ödeme metinleri güncellendi. Lütfen metinleri yeniden incele.", code: "LEGAL_VERSION_MISMATCH" },
            { status: 409 }
        );
    }

    const offer = await getActivePaymentOffer(body.offerCode);
    if (!offer) return NextResponse.json({ error: "Ödeme teklifi bulunamadı." }, { status: 404 });
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

    const userIp = requestIp === "unknown"
        ? process.env.IYZICO_SANDBOX_USER_IP?.trim() ?? ""
        : requestIp;
    if (!userIp) return unavailable();

    try {
        const orderResult = await createPaymentCheckoutOrderRecord({
            userId: sessionUser.id,
            provider: "iyzico",
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
        const checkout = await createIyzicoSandboxCheckoutSession({
            orderId: orderResult.order.id,
            userId: sessionUser.id,
            requestIp: userIp,
            buyerData: body.buyerData,
            callbackUrl: buildIyzicoOwnerCallbackUrl(publicOrigin, orderResult.order.id),
            credentials: {
                apiKey: process.env.IYZICO_API_KEY ?? "",
                secretKey: process.env.IYZICO_SECRET_KEY ?? "",
            },
        });
        return NextResponse.json(
            { orderId: checkout.orderId, redirectUrl: checkout.paymentPageUrl, sandbox: true },
            {
                status: orderResult.reused || checkout.duplicate ? 200 : 201,
                headers: { ...buildRateLimitHeaders(limit), "Cache-Control": "private, no-store" },
            }
        );
    } catch (error) {
        if (error instanceof PaymentOrderConflictError) {
            return NextResponse.json(
                { error: "Bu ödeme isteği farklı bir sipariş için daha önce kullanıldı.", code: "IDEMPOTENCY_CONFLICT" },
                { status: 409 }
            );
        }
        if (error instanceof IyzicoCheckoutError) {
            const retryable = error.retryable || error.code === "checkout_in_progress";
            const status = error.code === "checkout_in_progress" || error.code === "checkout_uncertain" ? 409 : 502;
            return NextResponse.json(
                {
                    error: error.code === "checkout_in_progress"
                        ? "Ödeme hazırlanıyor. Lütfen kısa süre sonra tekrar dene."
                        : "Ödeme sağlayıcısı işlemi tamamlayamadı. Sipariş durumu güvenle korunuyor.",
                    code: error.code.toUpperCase(),
                },
                { status, headers: retryable ? { "Retry-After": "5" } : undefined }
            );
        }
        return NextResponse.json({ error: "Ödeme başlatılamadı.", code: "CHECKOUT_FAILED" }, { status: 500 });
    }
}
